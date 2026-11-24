/**
 * AlgoVault — deterministic canonicalisation + hashing.
 *
 * Used wherever the platform must prove that two inputs are *the same input*
 * (validation evidence, order fingerprints, experiment records). Pure and
 * isomorphic: no node built-ins, no crypto, no randomness.
 *
 * The hash is FNV-1a applied twice with different offset bases to produce a
 * 64-bit hex digest. It is NOT a cryptographic hash — callers that need
 * tamper evidence store the canonical string alongside the digest (order
 * fingerprinting does exactly that).
 */

/** Recursively sort object keys so structurally equal values stringify equally. */
export function canonicalize(value: unknown): string {
    return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
    if (value === null || typeof value !== "object") {
        if (typeof value === "number") {
            if (!Number.isFinite(value)) return String(value); // NaN / ±Infinity
            // Normalise -0 so it cannot produce a distinct digest.
            return Object.is(value, -0) ? 0 : value;
        }
        if (value === undefined) return "__undefined__";
        return value;
    }
    if (Array.isArray(value)) return value.map(normalize);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const v = (value as Record<string, unknown>)[key];
        if (v === undefined) continue;
        out[key] = normalize(v);
    }
    return out;
}

function fnv1a(input: string, offset: number): string {
    let hash = offset >>> 0;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        // hash *= 16777619 with 32-bit overflow semantics
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

/** Stable 64-bit hex digest of any JSON-ish value. */
export function stableHash(value: unknown): string {
    const canonical = typeof value === "string" ? value : canonicalize(value);
    return `${fnv1a(canonical, 0x811c9dc5)}${fnv1a(canonical, 0x01000193)}`;
}

/** Fixed-precision rounding that never returns -0. */
export function roundTo(value: number, decimals: number): number {
    if (!Number.isFinite(value)) return value;
    const factor = Math.pow(10, decimals);
    const rounded = Math.round(value * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
}
