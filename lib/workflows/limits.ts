/**
 * Workflow Automation — entitlements, limits, enforcement.
 *
 * Every workflow API route resolves the caller's tier server-side through the
 * canonical subscription infra (`lib/subscription-server.ts`) and returns a
 * consistent 403 + eligibility body for non-Pro users. Limits are then applied
 * per tier, checked before create / save / activate / run.
 */

import { getAdminSubscriptionStatus } from "@/lib/subscription-server";
import { WorkflowLimits, WorkflowTier } from "./types";
import { countRunsToday, countWorkflows, getGlobalSettings } from "./database";

export const TIER_LIMITS: Record<WorkflowTier, Omit<WorkflowLimits, "tier">> = {
    free: {
        maxWorkflows: 1,
        maxActiveWorkflows: 0,
        maxNodesPerWorkflow: 8,
        maxRunsPerDay: 0,
        maxConcurrency: 2,
        schedulesEnabled: false,
        aiBuilderEnabled: false,
        marketplaceEnabled: false,
        executionEnabled: false,
        webhookTriggersEnabled: false,
        runCooldownMs: 0,
    },
    pro: {
        maxWorkflows: 25,
        maxActiveWorkflows: 10,
        maxNodesPerWorkflow: 60,
        maxRunsPerDay: 500,
        maxConcurrency: 6,
        schedulesEnabled: true,
        aiBuilderEnabled: true,
        marketplaceEnabled: true,
        executionEnabled: true,
        webhookTriggersEnabled: true,
        runCooldownMs: 2_000,
    },
    enterprise: {
        maxWorkflows: 200,
        maxActiveWorkflows: 100,
        maxNodesPerWorkflow: 150,
        maxRunsPerDay: 5000,
        maxConcurrency: 12,
        schedulesEnabled: true,
        aiBuilderEnabled: true,
        marketplaceEnabled: true,
        executionEnabled: true,
        webhookTriggersEnabled: true,
        runCooldownMs: 0,
    },
};

export interface WorkflowEntitlement {
    uid: string;
    isAdmin: boolean;
    tier: WorkflowTier;
    limits: WorkflowLimits;
    allowed: boolean;
    /** Structured denial for the client upgrade UI. */
    denial?: {
        error: string;
        hasPro: false;
        upgrade: boolean;
    };
}

/** Resolves tier (admin always treated as enterprise tier for limits). */
export async function resolveEntitlement(
    uid: string,
    isAdmin: boolean
): Promise<WorkflowEntitlement> {
    const status = isAdmin ? { hasSubscription: true, plan: "enterprise" as const, status: "active" as const }
        : await getAdminSubscriptionStatus(uid);

    const tier: WorkflowTier = status.hasSubscription
        ? status.plan === "enterprise" ? "enterprise" : "pro"
        : "free";

    const limits: WorkflowLimits = {
        tier,
        ...TIER_LIMITS[tier],
    };

    const allowed = isAdmin || tier !== "free";

    return {
        uid,
        isAdmin,
        tier,
        limits,
        allowed,
        denial: allowed ? undefined : {
            error: "Workflow Automation is a Pro feature.",
            hasPro: false,
            upgrade: true,
        },
    };
}

/** Hard 403 body used by every workflow route for non-Pro callers. */
export function workflowDenied(): { error: string; hasPro: false; upgrade: true } {
    return { error: "Workflow Automation is a Pro feature.", hasPro: false, upgrade: true };
}

export interface WorkflowUsage {
    workflows: number;
    active: number;
    runsToday: number;
    atLimitFor: string[];
}

/** Counts current usage against the entitlement limits. */
export async function collectUsage(ent: WorkflowEntitlement): Promise<WorkflowUsage> {
    const counts = await countWorkflows(ent.uid);
    const runsToday = await countRunsToday(ent.uid);
    const atLimit: string[] = [];
    if (counts.total >= ent.limits.maxWorkflows) atLimit.push("workflows");
    if (counts.active >= ent.limits.maxActiveWorkflows) atLimit.push("active_workflows");
    if (runsToday >= ent.limits.maxRunsPerDay) atLimit.push("runs_today");
    return {
        workflows: counts.total,
        active: counts.active,
        runsToday,
        atLimitFor: atLimit,
    };
}

/** True when today's run budget is already spent. */
export function runsBudgetExhausted(ent: WorkflowEntitlement, usage: WorkflowUsage): boolean {
    return ent.limits.maxRunsPerDay > 0 && usage.runsToday >= ent.limits.maxRunsPerDay;
}

/** True when the global admin kill switch is currently engaged. */
export async function isKillSwitchOn(): Promise<boolean> {
    const settings = await getGlobalSettings();
    return settings.killSwitchEnabled === true;
}

export function killSwitchReason(): string {
    return "Workflow automation has been temporarily disabled by the platform administrators.";
}

/** Cooldown between manual/scheduled runs per workflow (default 0 for admins). */
export function runCooldown(ent: WorkflowEntitlement): number {
    return ent.limits.runCooldownMs;
}