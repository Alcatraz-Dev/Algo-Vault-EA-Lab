/**
 * Intelligence Cloud — Permission vocabulary and role matrix (Phase 13)
 *
 * Permissions are resource-based so a role can be granted narrow capability
 * ("this developer may read intelligence but never touch a strategy") without
 * inventing new roles for every combination.
 *
 * Kept dependency-free so both server routes and edge/client code can import it
 * without pulling in firebase-admin.
 */

export const TENANT_ROLES = ["OWNER", "ADMIN", "ANALYST", "DEVELOPER", "VIEWER"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/**
 * Note: there is no TRADER role in the B2B matrix. Trading execution requires a
 * separately governed entitlement (see EXECUTION_SCOPES); granting it via a
 * tenant role would let a "read intelligence" tenant place orders.
 */

export const PERMISSIONS = [
    "intelligence.read",
    "intelligence.ai",
    "strategy.read",
    "strategy.write",
    "strategy.deploy",
    "research.run",
    "research.read",
    "risk.read",
    "risk.manage",
    "deployment.manage",
    "certification.read",
    "webhook.manage",
    "api.manage",
    "usage.read",
    "snapshot.read",
    "billing.manage",
    "tenant.manage",
    "report.generate",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
    OWNER: PERMISSIONS,
    ADMIN: [
        "intelligence.read",
        "intelligence.ai",
        "strategy.read",
        "strategy.write",
        "strategy.deploy",
        "research.run",
        "research.read",
        "risk.read",
        "risk.manage",
        "deployment.manage",
        "certification.read",
        "webhook.manage",
        "api.manage",
        "usage.read",
        "snapshot.read",
        "billing.manage",
        "tenant.manage",
        "report.generate",
    ],
    // Read + run research + write strategies. No deployment, no keys, no billing.
    ANALYST: [
        "intelligence.read",
        "intelligence.ai",
        "strategy.read",
        "strategy.write",
        "research.run",
        "research.read",
        "risk.read",
        "certification.read",
        "report.generate",
    ],
    // Builds against the API. No strategy mutation, no billing, no tenant admin.
    DEVELOPER: [
        "intelligence.read",
        "strategy.read",
        "strategy.write",
        "research.run",
        "research.read",
        "webhook.manage",
        "api.manage",
        "usage.read",
        "snapshot.read",
    ],
    // Purely observational.
    VIEWER: ["intelligence.read", "strategy.read", "research.read", "usage.read"],
};

export function isPermission(value: string): value is Permission {
    return (PERMISSIONS as readonly string[]).includes(value);
}

export function isTenantRole(value: string): value is TenantRole {
    return (TENANT_ROLES as readonly string[]).includes(value);
}

/** Rank used to decide whether one role may modify another's membership. */
export const ROLE_RANK: Record<TenantRole, number> = {
    OWNER: 5,
    ADMIN: 4,
    ANALYST: 3,
    DEVELOPER: 2,
    VIEWER: 1,
};

/**
 * Whether `actor` may change the membership of `target`.
 *
 * Only OWNER/ADMIN may manage members, an ADMIN may not touch an OWNER, and
 * nobody may change their own role — so an ADMIN cannot promote themselves and
 * lock the tenant's owner out.
 */
export function canManageRole(actor: TenantRole, target: TenantRole, self: boolean): boolean {
    if (self) return false;
    if (actor !== "OWNER" && actor !== "ADMIN") return false;
    if (actor === "ADMIN" && ROLE_RANK[target] >= ROLE_RANK.ADMIN) return false;
    return true;
}
