/**
 * Product Analytics — privacy sanitizer.
 *
 * The event model in `events.ts` is only as safe as what we let INTO it. This
 * module is the single chokepoint: every property bag passes through
 * `sanitizeProps` before an event is stored.
 *
 * What we deliberately NEVER store:
 *  - broker credentials, API keys, server names, account numbers
 *  - private positions, order details, P&L, trade notes
 *  - email, name, phone, address, IP-derived personal data
 *  - free text (a user's notes can contain anything, including credentials)
 *
 * We keep only a small allowlist of low-cardinality, product-relevant context:
 * symbol, timeframe, feature keys, counts, booleans, durations.
 *
 * Pure module: no I/O.
 */

/** Keys that must never be persisted, matched case-insensitively. */
const FORBIDDEN_KEY_PATTERN =
    /(pass|secret|token|api[-_]?key|credential|broker|account[-_]?(id|number)|iban|ssn|tax|email|phone|address|password|otp|2fa|seed|mnemonic|private|card|cvv|note|comment|description|pnl|p&l|profit|loss|balance|equity|deposit|withdraw)/i;

/**
 * Property keys we allow. Anything not listed is dropped. An allowlist (not a
 * denylist) is the only design that survives someone adding a new call site.
 */
export const ALLOWED_PROP_KEYS = new Set([
    "symbol",
    "timeframe",
    "feature",
    "surface",
    "intent",
    "variant",
    "experimentId",
    "source",
    "medium",
    "campaign",
    "step",
    "outcome",
    "count",
    "durationMs",
    "trades",
    "symbols",
    "indicators",
    "plan",
    "trigger",
    "result",
    "category",
    "kind",
    "strategyId",
    "productId",
    "digestId",
    "channel",
    "blocker",
    "confidence",
    // ── Phase 11 cross-device context ─────────────────────────────────────
    // Coarse, non-identifying: which client surface produced the event, whether
    // it was an installed app or a browser, and how the device was connected.
    // `deviceId` is deliberately NOT here — it is a pseudonymous identifier and
    // counting devices, not profiling them, is the whole point of this phase.
    "platform",
    "appVersion",
    "networkState",
    "syncOutcome",
    "freshness",
    "deepLinkKind",
]);

/** Values longer than this are almost certainly free text, not an enum. */
const MAX_VALUE_LENGTH = 64;
/** Max distinct properties per event. Keeps events small and cheap to store. */
const MAX_PROPS = 12;
/** Max items in an array-valued prop. */
const MAX_ARRAY_ITEMS = 10;

/** Symbols are uppercase alphanumerics, optional separator (`EURUSD`, `BTCUSD`, `XAUUSD`). */
const SYMBOL_PATTERN = /^[A-Z0-9]{2,12}(?:[.\-_/][A-Z0-9]{1,6})?$/;
/** Timeframes: `M5`, `H1`, `D`, `W1`, `1m`, `1h`. */
const TIMEFRAME_PATTERN = /^[A-Za-z0-9]{1,4}$/;
/** Feature keys: kebab-case, e.g. `strategy-research`. */
const FEATURE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}$/;
/** An enum-ish token: letters, digits, `_`, `-`, `.`, space. No arbitrary prose. */
const TOKEN_PATTERN = /^[A-Za-z0-9 _.\-/]{1,64}$/;

export type SanitizeResult = {
    props: Record<string, string | number | boolean | null>;
    /** Keys that were rejected, for server-side logging. Never stored on the event. */
    dropped: string[];
};

function sanitizeValue(key: string, value: unknown): { ok: boolean; value?: string | number | boolean | null } {
    // Booleans and finite numbers are always safe (they cannot carry text).
    if (typeof value === "boolean") return { ok: true, value };
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return { ok: false };
        // Guard against absurd values that would be meaningless in a funnel.
        if (Math.abs(value) > 1e12) return { ok: false };
        return { ok: true, value: Math.round(value * 1000) / 1000 };
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed || trimmed.length > MAX_VALUE_LENGTH) return { ok: false };
        switch (key) {
            case "symbol":
                return SYMBOL_PATTERN.test(trimmed) ? { ok: true, value: trimmed } : { ok: false };
            case "timeframe":
                return TIMEFRAME_PATTERN.test(trimmed) ? { ok: true, value: trimmed } : { ok: false };
            case "feature":
            case "strategyId":
            case "productId":
            case "experimentId":
            case "digestId":
                return FEATURE_KEY_PATTERN.test(trimmed) ? { ok: true, value: trimmed } : { ok: false };
            default:
                return TOKEN_PATTERN.test(trimmed) ? { ok: true, value: trimmed } : { ok: false };
        }
    }
    if (Array.isArray(value)) {
        // Only compact token arrays (e.g. indicator names) survive.
        const items = value
            .slice(0, MAX_ARRAY_ITEMS)
            .filter((v): v is string => typeof v === "string" && FEATURE_KEY_PATTERN.test(v.trim()));
        if (items.length === 0) return { ok: false };
        return { ok: true, value: items.join(",") };
    }
    // Objects, functions, symbols, bigint, null-in-array → dropped. We never
    // recurse: nested structures are the classic place for a leak to hide.
    return { ok: false };
}

/**
 * Sanitize an arbitrary property bag down to the safe allowlist.
 * Never throws — a bad property bag must not break product instrumentation.
 */
export function sanitizeProps(input: unknown): SanitizeResult {
    const props: Record<string, string | number | boolean | null> = {};
    const dropped: string[] = [];
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { props, dropped };
    }

    let kept = 0;
    for (const [rawKey, value] of Object.entries(input as Record<string, unknown>)) {
        if (kept >= MAX_PROPS) {
            dropped.push(rawKey);
            continue;
        }
        if (FORBIDDEN_KEY_PATTERN.test(rawKey)) {
            dropped.push(rawKey);
            continue;
        }
        if (!ALLOWED_PROP_KEYS.has(rawKey)) {
            dropped.push(rawKey);
            continue;
        }
        if (value === null || value === undefined) {
            props[rawKey] = null;
            kept++;
            continue;
        }
        const result = sanitizeValue(rawKey, value);
        if (result.ok && result.value !== undefined) {
            props[rawKey] = result.value;
            kept++;
        } else {
            dropped.push(rawKey);
        }
    }
    return { props, dropped };
}

/** Convenience wrapper when the caller does not care which keys were dropped. */
export function safeProps(input: unknown): Record<string, string | number | boolean | null> {
    return sanitizeProps(input).props;
}

/**
 * `true` when a property bag contains anything we must never persist.
 * Used by the admin data-integrity audit and by tests.
 */
export function containsForbiddenData(props: unknown): boolean {
    if (!props || typeof props !== "object") return false;
    for (const key of Object.keys(props as Record<string, unknown>)) {
        if (FORBIDDEN_KEY_PATTERN.test(key)) return true;
        if (!ALLOWED_PROP_KEYS.has(key)) return true;
    }
    return false;
}
