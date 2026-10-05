/**
 * Intelligence Cloud — Plans & Entitlements (Phase 13)
 *
 * Commercial rules are *configuration*. Nothing in this file branches on
 * business logic scattered through routes: an entitlement check asks "does this
 * tenant's plan grant this capability?", and the answer is data.
 *
 * Consumer subscription tiers (free/pro/elite) are mapped onto the same
 * entitlement vocabulary so the existing Pro gating is reused rather than
 * reimplemented.
 */

import type { TenantPlan } from "./tenancy";

export const ENTITLEMENTS = [
    "market.intelligence",
    "indicators",
    "smc",
    "setups",
    "strategy.intelligence",
    "research",
    "ai",
    "webhooks",
    "sdk",
    "certification",
    "white-label",
    "reports",
    "portfolio.intelligence",
] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];

export interface PlanDefinition {
    plan: TenantPlan;
    displayName: string;
    entitlements: readonly Entitlement[];
    /** Monthly included billable units. Beyond this, usage must be blocked or metered. */
    includedUnitsPerMonth: number;
    /** Max concurrent research jobs. Protects the cluster from runaway research. */
    maxConcurrentResearchJobs: number;
    /** Max API keys per tenant. */
    maxApiKeys: number;
    /** Max webhook endpoints per tenant. */
    maxWebhooks: number;
    /** Retained intelligence snapshot days. */
    snapshotRetentionDays: number;
}

export const PLAN_DEFINITIONS: Record<TenantPlan, PlanDefinition> = {
    developer: {
        plan: "developer",
        displayName: "Developer",
        entitlements: ["market.intelligence", "indicators", "smc", "setups", "sdk", "webhooks"],
        includedUnitsPerMonth: 50_000,
        maxConcurrentResearchJobs: 1,
        maxApiKeys: 2,
        maxWebhooks: 2,
        snapshotRetentionDays: 7,
    },
    professional: {
        plan: "professional",
        displayName: "Professional",
        entitlements: [
            "market.intelligence",
            "indicators",
            "smc",
            "setups",
            "strategy.intelligence",
            "research",
            "sdk",
            "webhooks",
            "reports",
            "portfolio.intelligence",
        ],
        includedUnitsPerMonth: 500_000,
        maxConcurrentResearchJobs: 2,
        maxApiKeys: 10,
        maxWebhooks: 10,
        snapshotRetentionDays: 30,
    },
    business: {
        plan: "business",
        displayName: "Business",
        entitlements: [
            "market.intelligence",
            "indicators",
            "smc",
            "setups",
            "strategy.intelligence",
            "research",
            "ai",
            "webhooks",
            "sdk",
            "certification",
            "reports",
        ],
        includedUnitsPerMonth: 5_000_000,
        maxConcurrentResearchJobs: 5,
        maxApiKeys: 50,
        maxWebhooks: 50,
        snapshotRetentionDays: 90,
    },
    enterprise: {
        plan: "enterprise",
        displayName: "Enterprise",
        entitlements: [...ENTITLEMENTS],
        includedUnitsPerMonth: Number.MAX_SAFE_INTEGER,
        maxConcurrentResearchJobs: 25,
        maxApiKeys: 500,
        maxWebhooks: 500,
        snapshotRetentionDays: 365,
    },
};

export function planFor(plan: string | undefined | null): PlanDefinition | undefined {
    if (!plan) return undefined;
    return PLAN_DEFINITIONS[plan as TenantPlan];
}

export function tenantHasEntitlement(
    plan: TenantPlan,
    entitlement: Entitlement,
    featureFlagOverrides?: Record<string, boolean>
): boolean {
    // An explicit per-tenant flag can switch a capability off, never on — a
    // disabled capability must not be re-enabled by a stray flag.
    if (featureFlagOverrides && featureFlagOverrides[`entitlement.${entitlement}`] === false) return false;
    const definition = PLAN_DEFINITIONS[plan];
    return Boolean(definition?.entitlements.includes(entitlement));
}

/**
 * Consumer subscription tier → entitlement set.
 * Lets the existing Pro/EElite consumer product reuse the B2B vocabulary.
 */
export type ConsumerTier = "free" | "pro" | "elite";

export function entitlementsForConsumerTier(tier: ConsumerTier): Entitlement[] {
    switch (tier) {
        case "elite":
            return [
                "market.intelligence",
                "indicators",
                "smc",
                "setups",
                "strategy.intelligence",
                "research",
                "ai",
                "certification",
                "reports",
            ];
        case "pro":
            return ["market.intelligence", "indicators", "smc", "setups", "strategy.intelligence", "ai"];
        default:
            return ["market.intelligence", "indicators", "smc"];
    }
}
