/**
 * Product Analytics — funnel analytics.
 *
 * The canonical funnel:
 *   VISITOR → SIGNUP → ONBOARDING → FIRST_VALUE → ACTIVATED → RETURNING
 *            → PROSPECT → PRO → RETAINED_PRO
 *
 * Every step is defined by a real product event, and every conversion rate is
 * computed from counts the caller supplies. When the denominator is too small
 * we return `insufficient: true` so the UI can say "Insufficient data" instead
 * of printing a 100% conversion rate off two users.
 *
 * Pure module: no I/O.
 */

import type { ProductEventType } from "./events";

export const FUNNEL_STAGES = [
  "VISITOR",
  "SIGNUP",
  "ONBOARDING",
  "FIRST_VALUE",
  "ACTIVATED",
  "RETURNING",
  "PROSPECT",
  "PRO",
  "RETAINED_PRO",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/**
 * Which events put a user INTO a stage. A user counts once per stage.
 * `FIRST_VALUE` is intentionally any completed analysis — that is the first
 * moment the product gives something back.
 */
export const STAGE_EVENTS: Record<FunnelStage, ProductEventType[]> = {
    VISITOR: [],
    SIGNUP: ["USER_SIGNUP"],
    ONBOARDING: ["ONBOARDING_STARTED", "ONBOARDING_COMPLETED"],
    FIRST_VALUE: [
        "AI_ANALYSIS_COMPLETED",
        "MARKET_INTELLIGENCE_VIEWED",
        "SMART_MONEY_VIEWED",
        "SETUP_CREATED",
        "STRATEGY_BACKTESTED",
        "RESEARCH_COMPLETED",
    ],
    ACTIVATED: ["SETUP_CREATED", "STRATEGY_CREATED", "STRATEGY_BACKTESTED", "RESEARCH_COMPLETED", "TRADE_COMPLETED"],
    RETURNING: ["CHART_OPENED", "MARKET_INTELLIGENCE_VIEWED", "JOURNAL_REVIEWED", "TRADE_COMPLETED", "ROBUSTNESS_RUN"],
    PROSPECT: ["PRO_FEATURE_VIEWED", "PRO_UPGRADE_CLICKED", "CHECKOUT_STARTED", "UPGRADE_INTENT_RECORDED"],
    PRO: ["SUBSCRIPTION_STARTED"],
    RETAINED_PRO: ["SUBSCRIPTION_STARTED", "PAPER_TRADE_STARTED", "RESEARCH_COMPLETED", "JOURNAL_REVIEWED"],
};

export type FunnelStep = {
    stage: FunnelStage;
    label: string;
    /** Distinct users who reached this stage. */
    users: number;
    /** users / previous stage users × 100, or null when the previous is 0. */
    stepConversionPct: number | null;
    /** users / first stage users × 100. */
    totalConversionPct: number;
    insufficient: boolean;
};

/** Minimum users in a stage before a rate is meaningful. */
export const MIN_FUNNEL_USERS = 20;

const STAGE_LABELS: Record<FunnelStage, string> = {
    VISITOR: "Visitors",
    SIGNUP: "Signups",
    ONBOARDING: "Onboarding started",
    FIRST_VALUE: "First value",
    ACTIVATED: "Activated users",
    RETURNING: "Returning users",
    PROSPECT: "Saw Pro",
    PRO: "Pro subscribers",
    RETAINED_PRO: "Retained Pro",
};

export type FunnelInput = {
    /** Distinct-user counts per stage, already computed by the caller. */
    stageUsers: Partial<Record<FunnelStage, number>>;
    minUsers?: number;
};

/**
 * Build the funnel. Stages with zero users are still rendered (a gap in the
 * funnel is information), but their conversion is null rather than 0.
 */
export function computeFunnel(input: FunnelInput): FunnelStep[] {
    const min = input.minUsers ?? MIN_FUNNEL_USERS;
    const counts = FUNNEL_STAGES.map((stage) => Math.max(0, input.stageUsers[stage] ?? 0));
    const baseline = counts[0] ?? 0;

    return FUNNEL_STAGES.map((stage, index) => {
        const users = counts[index];
        const previous = index === 0 ? users : counts[index - 1];
        const stepConversionPct =
            index === 0 ? null : previous > 0 ? (users / previous) * 100 : null;
        return {
            stage,
            label: STAGE_LABELS[stage],
            users,
            stepConversionPct,
            totalConversionPct: baseline > 0 ? (users / baseline) * 100 : 0,
            insufficient: users < min,
        };
    });
}

/** Headline funnel summary for dashboards. Nulls mean "not measurable yet". */
export type FunnelSummary = {
    visitors: number;
    signups: number;
    activated: number;
    prospects: number;
    proSubscribers: number;
    visitorToSignupPct: number | null;
    signupToActivationPct: number | null;
    activationToProPct: number | null;
    visitorToProPct: number | null;
};

export function summarizeFunnel(input: FunnelInput): FunnelSummary {
    const get = (stage: FunnelStage) => Math.max(0, input.stageUsers[stage] ?? 0);
    const visitors = get("VISITOR");
    const signups = get("SIGNUP");
    const activated = get("ACTIVATED");
    const prospects = get("PROSPECT");
    const proSubscribers = get("PRO");
    const ratio = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
    return {
        visitors,
        signups,
        activated,
        prospects,
        proSubscribers,
        visitorToSignupPct: ratio(signups, visitors),
        signupToActivationPct: ratio(activated, signups),
        activationToProPct: ratio(proSubscribers, activated),
        visitorToProPct: ratio(proSubscribers, visitors),
    };
}

// ─── Feature revenue attribution ────────────────────────────────────────────

export type FeatureCorrelation = {
    feature: string;
    /** Users who used the feature at least once. */
    users: number;
    /** Of those, how many became Pro. */
    converted: number;
    conversionPct: number;
    /** Users who became Pro WITHOUT this feature, for comparison. */
    baselineUsers: number;
    baselineConversionPct: number;
    /** conversionPct − baselineConversionPct, in percentage points. */
    liftPctPoints: number;
    strength: "strong" | "medium" | "low" | "none";
    insufficient: boolean;
};

const STRONG_LIFT = 20;
const MEDIUM_LIFT = 8;
const MIN_FEATURE_USERS = 30;

/**
 * Correlation between using a workflow and upgrading to Pro.
 *
 * This is CORRELATION, NOT CAUSATION, and the type name plus the admin copy
 * are explicit about that. Users who use the Research engine may also be
 * power users in every other sense; we are not claiming the feature caused
 * the upgrade.
 */
export function computeFeatureAttribution(input: {
    feature: string;
    featureUsers: number;
    featureConverted: number;
    totalProUsers: number;
    totalUsers: number;
    minUsers?: number;
}): FeatureCorrelation {
    const min = input.minUsers ?? MIN_FEATURE_USERS;
    const featureUsers = Math.max(0, input.featureUsers);
    const featureConverted = Math.max(0, input.featureConverted);
    const baselineUsers = Math.max(0, input.totalUsers - featureUsers);
    const baselineConverted = Math.max(0, input.totalProUsers - featureConverted);

    const conversionPct = featureUsers > 0 ? (featureConverted / featureUsers) * 100 : 0;
    const baselineConversionPct = baselineUsers > 0 ? (baselineConverted / baselineUsers) * 100 : 0;
    const liftPctPoints = conversionPct - baselineConversionPct;

    let strength: FeatureCorrelation["strength"] = "none";
    if (liftPctPoints >= STRONG_LIFT) strength = "strong";
    else if (liftPctPoints >= MEDIUM_LIFT) strength = "medium";
    else if (liftPctPoints > 0) strength = "low";

    return {
        feature: input.feature,
        users: featureUsers,
        converted: featureConverted,
        conversionPct,
        baselineUsers,
        baselineConversionPct,
        liftPctPoints,
        strength,
        insufficient: featureUsers < min,
    };
}
