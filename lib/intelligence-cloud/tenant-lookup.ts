/**
 * Intelligence Cloud — Tenant lookup (Phase 13)
 *
 * Resolves a tenant's plan and feature flags from its own RTDB record.
 *
 * A missing or unreadable tenant record resolves to the MOST RESTRICTIVE plan
 * rather than throwing or defaulting permissively. That way deleting or
 * suspending a tenant degrades their access instead of silently opening it.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { tenantPath, type Tenant, type TenantPlan } from "./tenancy";

export interface ResolvedTenant {
    plan: TenantPlan;
    featureFlags?: Record<string, boolean>;
    status: Tenant["status"];
}

const MOST_RESTRICTIVE_PLAN: TenantPlan = "developer";

export async function loadTenantForRequest(tenantId: string): Promise<ResolvedTenant> {
    try {
        const snap = await adminDatabase.ref(tenantPath(tenantId, "settings", "profile")).get();
        if (snap.exists()) {
            const value = snap.val() as {
                plan?: TenantPlan;
                featureFlags?: Record<string, boolean>;
                status?: Tenant["status"];
            };
            return {
                plan: value.plan ?? MOST_RESTRICTIVE_PLAN,
                featureFlags: value.featureFlags,
                status: value.status ?? "active",
            };
        }
    } catch {
        // Fall through to the restrictive default.
    }
    return { plan: MOST_RESTRICTIVE_PLAN, status: "active" };
}
