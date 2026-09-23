/**
 * Safe value resolution + template rendering for workflow nodes.
 *
 * References:
 *   $nodeId            → upstream node output object
 *   $nodeId.field.path → nested value
 *   variables.name     → run variable
 *
 * Templates:
 *   {{ $nodeId.field }}   → interpolated string
 *   {{ variables.name }}  → interpolated string
 *
 * No eval, no functions, no arbitrary JS. `renderTemplate` performs
 * interpolation only; template arithmetic is out of scope on purpose.
 */

import { NodeExecutionRecord } from "./types";

export type PayloadLookup = {
    /** Completed node records keyed by node id. */
    nodes: Record<string, NodeExecutionRecord>;
    variables: Record<string, unknown>;
};

/** Splits "a.b[0].c" into ["a","b",0,"c"]. */
export function parsePath(path: string): Array<string | number> {
    const segments: Array<string | number> = [];
    // Split on dots and bracket boundaries. Bare digits inside [] become indices.
    const parts = path.split(/([.[\]])/);
    let pendingKey = "";
    for (const p of parts) {
        if (!p) continue;
        if (p === "." || p === "[") {
            if (pendingKey) { segments.push(pendingKey); pendingKey = ""; }
            continue;
        }
        if (p === "]") {
            if (pendingKey && /^\d+$/.test(pendingKey)) segments.push(Number(pendingKey));
            else if (pendingKey) segments.push(pendingKey);
            pendingKey = "";
            continue;
        }
        // plain token
        pendingKey = pendingKey ? `${pendingKey}${p}` : p;
    }
    if (pendingKey) segments.push(pendingKey);
    return segments;
}

export function lookupValue(lookup: PayloadLookup, path: string): { found: boolean; value: unknown } {
    const segments = parsePath(path);
    if (segments.length === 0) return { found: false, value: undefined };

    let current: unknown;
    const head = String(segments[0]);

    if (head.startsWith("$")) {
        const nodeId = head.slice(1);
        const record = lookup.nodes[nodeId];
        current = record?.output;
    } else if (head === "variables") {
        current = lookup.variables;
    } else {
        // Bare keys resolve against variables then root payloads.
        current = lookup.variables[head];
    }

    if (current === undefined) return { found: false, value: undefined };

    for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        if (current === null || current === undefined) return { found: false, value: undefined };
        if (typeof current !== "object") return { found: false, value: undefined };
        current = (current as Record<string | number, unknown>)[seg];
        if (current === undefined) return { found: false, value: undefined };
    }

    return { found: true, value: current };
}

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Renders {{ reference }} interpolation in a string. Missing refs → empty string. */
export function renderTemplate(template: string, lookup: PayloadLookup, hash?: string): string {
    if (!template || template.indexOf("{{") === -1) return template;
    return template.replace(TOKEN_RE, (_m, raw: string) => {
        const ref = raw.trim();
        const { found, value } = lookupValue(lookup, ref);
        if (!found) return "";
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") return String(value);
        try {
            return JSON.stringify(value, null, 0);
        } catch {
            return "";
        }
    }).replace(/\u0000/g, String(hash ?? ""));
}

/**
 * Recursively resolves `$refs` and `{{ }}` templates inside a config object.
 * Strings containing only a `$ref` (e.g. "$rsi.value") are replaced with the
 * raw value; template strings are interpolated.
 */
export function resolveConfig(config: Record<string, unknown>, lookup: PayloadLookup): Record<string, unknown> {
    return resolveValue(config, lookup) as Record<string, unknown>;
}

function resolveValue(value: unknown, lookup: PayloadLookup): unknown {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.startsWith("$") && !trimmed.includes("{")) {
            const { found, value: resolved } = lookupValue(lookup, trimmed);
            if (found) return resolved;
            return value; // leave as-is when unresolvable (validated earlier)
        }
        if (value.includes("{{")) {
            return renderTemplate(value, lookup);
        }
        return value;
    }
    if (Array.isArray(value)) return value.map((v) => resolveValue(v, lookup));
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            out[key] = resolveValue(val, lookup);
        }
        return out;
    }
    return value;
}

/** Extracts every {{ ref }} from a string into a unique list. */
export function extractTemplateRefs(template: string): string[] {
    const refs = new Set<string>();
    const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template)) !== null) {
        refs.add(m[1].trim());
    }
    return [...refs];
}