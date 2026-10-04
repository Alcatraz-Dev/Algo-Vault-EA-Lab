/**
 * Intelligence Fabric — canonical version constants.
 *
 * Every AI decision records the versions of the schemas and policies that
 * produced it, so historical decisions stay auditable and reproducible.
 * Bump these when behavior changes; never mutate old semantics in place.
 */

export const INTELLIGENCE_VERSION = {
    /** MarketIntelligenceContext compression schema. */
    marketContextSchema: "mic-1",
    /** Decision policy (orchestrator rules, risk-wins semantics). */
    decisionPolicy: "dp-1",
    /** Provider registry layout + metadata semantics. */
    providerRegistry: "pr-1",
    /** Routing policy (task profiles, scoring weights). */
    routingPolicy: "rp-1",
    /** Jev question set + validation rules. */
    jevPolicy: "jp-1",
    /** Prompt template set. */
    promptTemplates: "pt-1",
    /** Signal intelligence enrichment schema. */
    signalPolicy: "sp-1",
} as const;

export type IntelligenceVersion = typeof INTELLIGENCE_VERSION;

/** Fabric's own task taxonomy — independent of any provider's naming. */
export const AI_TASKS = [
    "FAST_MARKET_CLASSIFICATION",
    "SIGNAL_EXPLANATION",
    "DEEP_STRATEGY_RESEARCH",
    "CODE_GENERATION",
    "CHART_VISION_ANALYSIS",
    "LONG_CONTEXT_RESEARCH",
    "CHALLENGE_REVIEW",
    "PRO_SCALPING_DECISION",
    "SETUP_VALIDATION",
    "REGIME_CLASSIFICATION",
    "TRADE_REVIEW",
    "ANOMALY_DETECTION",
    "HYPOTHESIS_GENERATION",
    "STRATEGY_RANKING",
] as const;

export type AITask = (typeof AI_TASKS)[number];

/** Coarse decision states the orchestrator can emit. */
export const DECISION_STATES = [
    "READY",
    "WAITING",
    "VALIDATING",
    "HOLD",
    "BLOCKED",
    "AI_UNAVAILABLE",
    "INVALID",
] as const;

export type DecisionState = (typeof DECISION_STATES)[number];
