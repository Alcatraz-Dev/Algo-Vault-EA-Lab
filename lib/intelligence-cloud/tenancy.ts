/**
 * Intelligence Cloud — Tenancy, Roles & Permissions (Phase 13)
 *
 * Every B2B resource is tenant-isolated. The invariant this module enforces:
 *
 *   A tenant identifier is NEVER accepted from client input.
 *
 * It is always resolved server-side, either from the authenticated API key's
 * tenant binding, or from a verified Firebase session's membership list. A
 * caller-supplied `tenantId` is at most a *hint* that must still match the
 * resolved membership, which closes the IDOR class where a client asks for
 * `?tenantId=<someone else>` and the server obliges.
 */

import { TENANT_ROLES, ROLE_PERMISSIONS, type Permission, type TenantRole } from "./permissions";
import { errors } from "./errors";

export type { Permission, TenantRole };
export { TENANT_ROLES, ROLE_PERMISSIONS };

export type TenantPlan = "developer" | "professional" | "business" | "enterprise";

export interface Tenant {
    tenantId: string;
    name: string;
    plan: TenantPlan;
    /** White-label branding; absent for the default AlgoVault-branded tenant. */
    branding?: { logoUrl?: string; primaryColor?: string; accentColor?: string; domain?: string };
    /** Market universe this tenant is entitled to. Empty/absent means platform default. */
    marketUniverse?: string[];
    featureFlags?: Record<string, boolean>;
    /** AI providers approved for this tenant; empty/absent means platform default. */
    aiProviders?: string[];
    /** Mandatory legal disclosures appended to every public intelligence output. */
    disclosures?: string[];
    createdAt: number;
    status: "active" | "suspended" | "closed";
    suspendedReason?: string;
}

export interface TenantMembership {
    userId: string;
    tenantId: string;
    role: TenantRole;
    /** Per-user narrowing of the role's permissions. Can only remove, never add. */
    permissionOverrides?: Partial<Record<Permission, boolean>>;
    createdAt: number;
    status: "active" | "revoked";
}

/** The resolved, server-derived authority for one authenticated request. */
export interface TenantContext {
    tenantId: string;
    tenant: Tenant;
    role: TenantRole;
    /** Effective permissions = role permissions narrowed by overrides. */
    permissions: Set<Permission>;
    userId: string;
}

/**
 * Effective permissions for a membership.
 *
 * Overrides can only *restrict*. A membership record that tries to grant a
 * permission its role does not hold is ignored rather than escalated, so a
 * compromised membership write cannot promote a VIEWER to OWNER.
 */
export function effectivePermissions(
    role: TenantRole,
    overrides?: Partial<Record<Permission, boolean>>
): Set<Permission> {
    const base = new Set<Permission>(ROLE_PERMISSIONS[role] ?? []);
    if (overrides) {
        for (const [permission, granted] of Object.entries(overrides) as Array<[Permission, boolean]>) {
            if (base.has(permission)) {
                if (granted === false) base.delete(permission);
            }
        }
    }
    return base;
}

export function roleCan(role: TenantRole, permission: Permission): boolean {
    return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/**
 * Narrow an authenticated context by an explicit permission requirement.
 * Throws FORBIDDEN so routes never hand-roll the check.
 */
export function requirePermission(
    context: TenantContext | null | undefined,
    permission: Permission
): TenantContext {
    if (!context) {
        throw errors.tenantRequired();
    }
    if (context.tenant.status !== "active") {
        throw errors.forbidden("This organisation is not currently active.");
    }
    if (!context.permissions.has(permission)) {
        throw errors.forbidden(`Missing tenant permission: ${permission}.`);
    }
    return context;
}

export function describePermissions(context: TenantContext): Permission[] {
    return Array.from(context.permissions).sort();
}

/** A tenant-scoped RTDB path. The single choke point for tenant isolation. */
export function tenantPath(tenantId: string, ...rest: string[]): string {
    const safeTenant = sanitizeSegment(tenantId);
    const parts = [safeTenant, ...rest.map(sanitizeSegment)];
    return `intelligenceCloud/tenants/${parts.join("/")}`;
}

export function sanitizeSegment(value: string): string {
    // RTDB keys cannot contain `.`, `#`, `$`, `[`, `]`, or `/`.
    return String(value).replace(/[.#$\[\]/]/g, "_");
}
