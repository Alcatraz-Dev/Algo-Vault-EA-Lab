/**
 * Intelligence Cloud — API Key scopes (Phase 13)
 *
 * Scopes are least-privilege by default: a key can only do what it was created
 * for, and `*_write` scopes never imply execution rights. Execution is a
 * separate scope family that is refused entirely by the public API.
 */

export const API_SCOPES = [
    // ── Read-only intelligence ──────────────────────────────────────────────
    "market:read",
    "indicators:read",
    "smartmoney:read",
    "setups:read",
    "strategy:read",
    "strategy:write",
    "research:read",
    "research:write",
    "risk:read",
    "webhook:read",
    "webhook:write",
    "certification:read",
    "research:read",
    // ── Account / tenant management ─────────────────────────────────────────
    "api:manage",
    "usage:read",
    "snapshot:read",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Scopes that grant any ability to affect trading state. Never issuable via the public API. */
export const EXECUTION_SCOPES = [
    "execution:prepare",
    "execution:approve",
    "execution:live",
] as const;
export type ExecutionScope = (typeof EXECUTION_SCOPES)[number];

export function isExecutionScope(scope: string): scope is ExecutionScope {
    return (EXECUTION_SCOPES as readonly string[]).includes(scope);
}

/**
 * Scopes a new key may request.
 *
 * Execution scopes are deliberately excluded. An execution capability must be
 * granted through an explicit, audited, server-side entitlement decision — not
 * by self-service key creation — so that "AI must never become an
 * authorization layer" holds even if the key-management endpoint is abused.
 */
export function isGrantableScope(scope: string): scope is ApiScope {
    return (API_SCOPES as readonly string[]).includes(scope);
}

/** Strip anything ungrantable so a crafted request body cannot widen a key. */
export function sanitiseScopes(requested: readonly string[] | undefined | null): ApiScope[] {
    if (!Array.isArray(requested)) return [];
    const unique = new Set<ApiScope>();
    for (const raw of requested) {
        if (typeof raw !== "string") continue;
        const scope = raw.trim().toLowerCase();
        if (isGrantableScope(scope)) unique.add(scope);
    }
    return Array.from(unique);
}

/**
 * Least-privilege default for a freshly created key that named no scopes.
 * Read-only intelligence, nothing that mutates state.
 */
export const DEFAULT_KEY_SCOPES: ApiScope[] = ["market:read", "indicators:read", "smartmoney:read"];

/**
 * Exact-match scope check.
 *
 * There is deliberately no "parent scope" derivation: an earlier version
 * granted `market:read` to any key holding `indicators:read`, which silently
 * widened every narrowly-scoped key. Access is now decided purely by the
 * scopes explicitly issued to the key.
 */
export function hasScope(granted: readonly string[] | undefined | null, required: ApiScope): boolean {
    if (!Array.isArray(granted)) return false;
    return granted.includes(required);
}

/**
 * Check a set of requirements, returning the first missing one.
 * Callers use it to emit `SCOPE_INSUFFICIENT` naming the exact gap.
 */
export function missingScopes(
    granted: readonly string[] | undefined | null,
    required: readonly ApiScope[]
): ApiScope[] {
    const missing: ApiScope[] = [];
    for (const scope of required) {
        if (!hasScope(granted, scope)) missing.push(scope);
    }
    return missing;
}
