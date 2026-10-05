/**
 * Phase 11 — minimal runtime validation for sync payloads.
 *
 * Deliberately hand-rolled rather than pulled from a validation library: this is
 * the only validation surface Phase 11 adds, the repo has no validation-library
 * dependency at the root, and adding one for a single route would be heavier than
 * the thing it replaces.
 *
 * The rules are the ones that matter for a *client-supplied* payload: bounded
 * strings, bounded arrays, bounded object sizes, finite numbers, and an explicit
 * allowlist of enum values. Unknown keys are rejected rather than silently
 * stored, so a future field cannot be smuggled in by an older or hostile client.
 *
 * Pure module: no I/O.
 */

export type ValidationIssue = string;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

/** Issue sink + path context, threaded through every parser. */
export type Context = { issues: ValidationIssue[]; path: string };

/** Shorthand for a root context. */
export function rootContext(path: string): Context {
    return { issues: [], path };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function str(value: unknown, ctx: Context, opts: { min?: number; max?: number; pattern?: RegExp } = {}): string {
    if (typeof value !== "string") {
        ctx.issues.push(`${ctx.path}: expected string`);
        return "";
    }
    if (opts.min !== undefined && value.length < opts.min) ctx.issues.push(`${ctx.path}: too short`);
    if (opts.max !== undefined && value.length > opts.max) ctx.issues.push(`${ctx.path}: too long`);
    if (opts.pattern && !opts.pattern.test(value)) ctx.issues.push(`${ctx.path}: invalid format`);
    return value;
}

export function num(value: unknown, ctx: Context, opts: { min?: number; max?: number } = {}): number {
    if (!isFiniteNum(value)) {
        ctx.issues.push(`${ctx.path}: expected finite number`);
        return 0;
    }
    if (opts.min !== undefined && value < opts.min) ctx.issues.push(`${ctx.path}: below minimum`);
    if (opts.max !== undefined && value > opts.max) ctx.issues.push(`${ctx.path}: above maximum`);
    return value;
}

export function bool(value: unknown, ctx: Context): boolean {
    if (typeof value !== "boolean") {
        ctx.issues.push(`${ctx.path}: expected boolean`);
        return false;
    }
    return value;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], ctx: Context): T {
    if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
        ctx.issues.push(`${ctx.path}: expected one of ${allowed.join("|")}`);
        return allowed[0];
    }
    return value as T;
}

export function arr<T>(
    value: unknown,
    ctx: Context,
    item: (raw: unknown, itemCtx: Context) => T,
    opts: { max: number; min?: number },
): T[] {
    if (!Array.isArray(value)) {
        ctx.issues.push(`${ctx.path}: expected array`);
        return [];
    }
    if (value.length > opts.max) {
        ctx.issues.push(`${ctx.path}: array exceeds ${opts.max} items`);
        return [];
    }
    if (opts.min !== undefined && value.length < opts.min) {
        ctx.issues.push(`${ctx.path}: array needs at least ${opts.min} items`);
        return [];
    }
    return value.map((raw, i) => item(raw, { issues: ctx.issues, path: `${ctx.path}[${i}]` }));
}

export function obj<T>(
    value: unknown,
    ctx: Context,
    fields: Record<string, (raw: unknown, fieldCtx: Context) => unknown>,
    opts: { maxKeys?: number } = {},
): T {
    if (!isObj(value)) {
        ctx.issues.push(`${ctx.path}: expected object`);
        return {} as T;
    }
    const keys = Object.keys(value);
    if (opts.maxKeys !== undefined && keys.length > opts.maxKeys) {
        ctx.issues.push(`${ctx.path}: object has too many keys`);
        return {} as T;
    }
    for (const key of Object.keys(fields)) {
        if (!(key in value)) ctx.issues.push(`${ctx.path}.${key}: missing`);
    }
    const out: Record<string, unknown> = {};
    for (const [key, parse] of Object.entries(fields)) {
        out[key] = parse(value[key], { issues: ctx.issues, path: `${ctx.path}.${key}` });
    }
    return out as T;
}

/**
 * A record keyed by short strings, with a bounded number of entries. Used for
 * layers, panels and indicator config, which are user-extensible by design.
 */
export function dict<T>(
    value: unknown,
    ctx: Context,
    item: (raw: unknown, itemCtx: Context) => T,
    opts: { maxKeys: number; keyMax?: number },
): Record<string, T> {
    if (!isObj(value)) {
        ctx.issues.push(`${ctx.path}: expected object`);
        return {};
    }
    const keys = Object.keys(value);
    if (keys.length > opts.maxKeys) {
        ctx.issues.push(`${ctx.path}: too many keys`);
        return {};
    }
    const out: Record<string, T> = {};
    for (const key of keys) {
        if (key.length > (opts.keyMax ?? 64)) {
            ctx.issues.push(`${ctx.path}: key too long`);
            continue;
        }
        out[key] = item(value[key], { issues: ctx.issues, path: `${ctx.path}.${key}` });
    }
    return out;
}

export function nullable<T>(value: unknown, ctx: Context, item: (raw: unknown, itemCtx: Context) => T): T | null {
    if (value === null || value === undefined) return null;
    return item(value, ctx);
}

export function opt<T>(value: unknown, ctx: Context, item: (raw: unknown, itemCtx: Context) => T): T | undefined {
    if (value === null || value === undefined) return undefined;
    return item(value, ctx);
}

export function issuesOf(ctx: Context, limit = 25): ValidationIssue[] {
    return ctx.issues.slice(0, limit);
}
