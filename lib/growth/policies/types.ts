/**
 * Growth Engine — growth policy (Phase 3 core).
 *
 * Adds server-side policy mode support. The mode is enforced server-side by
 * the loop runner and qualify decisions; the client only ever *reads* it.
 */

export type PolicyMode = "ASSISTED" | "APPROVAL" | "AUTONOMOUS";

export type GrowthPolicy = {
    mode: PolicyMode;
    maxRunsPerDay: number;
    maxContentPerDay: number;
    maxPublicationsPerDay: number;
    allowAutoPublish: boolean;
    allowAutoCampaignCreation: boolean;
    allowAutoOptimization: boolean;
    requireCompliancePass: boolean;
    requireApprovalForCampaigns: boolean;
    maxAiCostPerDay?: number;
    /** Cooldown (ms) applied to re-detected opportunities of the same dedup key. */
    opportunityCooldownMs?: number;
    /** Hard expiration (ms) for opportunities that never advance. */
    opportunityExpirationMs?: number;
    /** Minimum confidence required for autonomous (no-approval) execution. */
    minConfidenceAutonomous?: number;
    /** Allow experiments to auto-declare a winner without review. */
    allowAutoExperimentResolution?: boolean;
};

export const DEFAULT_GROWTH_POLICY: GrowthPolicy = {
    mode: "APPROVAL",
    maxRunsPerDay: 3,
    maxContentPerDay: 5,
    maxPublicationsPerDay: 2,
    allowAutoPublish: false,
    allowAutoCampaignCreation: true,
    allowAutoOptimization: true,
    requireCompliancePass: true,
    requireApprovalForCampaigns: true,
    opportunityCooldownMs: 24 * 60 * 60 * 1000,
    opportunityExpirationMs: 14 * 24 * 60 * 60 * 1000,
    minConfidenceAutonomous: 0.7,
    allowAutoExperimentResolution: false,
};

/** Resolve a stored/partial policy, falling back to defaults for missing fields. */
export function resolvePolicy(partial?: Partial<GrowthPolicy> | null): GrowthPolicy {
    if (!partial) return DEFAULT_GROWTH_POLICY;
    return {
        ...DEFAULT_GROWTH_POLICY,
        ...partial,
        mode: (partial.mode as PolicyMode) || DEFAULT_GROWTH_POLICY.mode,
    };
}

/** True when the policy allows autonomous execution without human approval. */
export function isAutonomousMode(policy: GrowthPolicy): boolean {
    return policy.mode === "AUTONOMOUS";
}

/** True when every action requires explicit human approval. */
export function isApprovalMode(policy: GrowthPolicy): boolean {
    return policy.mode === "APPROVAL";
}

/** True when the assistant may suggest but never act without approval. */
export function isAssistedMode(policy: GrowthPolicy): boolean {
    return policy.mode === "ASSISTED";
}