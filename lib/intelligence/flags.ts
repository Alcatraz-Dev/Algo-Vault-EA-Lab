/**
 * Unified Intelligence Fabric — feature flags.
 *
 * Mirrors the convention in lib/ai-trading-teams/flags.ts: env-driven, safe
 * defaults, snapshot for API responses. Every new intelligence capability can
 * be disabled independently (rollback requirement) without touching the
 * deterministic engines it composes.
 *
 * Default posture:
 *  - UNIFIED_AI_INTELLIGENCE  ON  — the fabric is additive; with no providers
 *    configured every AI stage degrades to a deterministic AI_UNAVAILABLE
 *    state and deterministic engines keep working.
 *  - JEV_DECISION_ENGINE      ON  — but Jev itself is inert until JEV_API_KEY
 *    (or a Jev-capable provider) is configured; its unavailable policy then
 *    decides how pipelines proceed.
 *  - Pro-only enhancements (multi-model routing, challenge review, strategy
 *    research, pro-scalping intelligence) default ON but every one of them is
 *    individually killable.
 */

function readFlag(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const normalized = raw.trim().toLowerCase();
    if (["false", "0", "off", "no", "disabled"].includes(normalized)) return false;
    if (["true", "1", "on", "yes", "enabled"].includes(normalized)) return true;
    return fallback;
}

export const INTELLIGENCE_FLAGS = {
    /** Master switch for the Unified Intelligence Fabric. */
    unified: "UNIFIED_AI_INTELLIGENCE",
    /** Jev structured decision/validation layer. */
    jev: "JEV_DECISION_ENGINE",
    /** Free-provider-aware LLM routing on top of the existing AI gateway. */
    freeRouter: "FREE_LLM_ROUTER",
    /** Multi-model routing (task → different models) instead of single model. */
    multiModel: "MULTI_MODEL_ROUTING",
    /** AI Trading Challenge review (behavior analytics + AI narrative). */
    challengeReview: "AI_CHALLENGE_REVIEW",
    /** AI strategy research interpretation/validation stage. */
    strategyResearch: "AI_STRATEGY_RESEARCH",
    /** Pro Scalping Terminal intelligence panel + decision state. */
    proScalping: "AI_PRO_SCALPING_INTELLIGENCE",
    /** Persist decisions/requests to ai/* Realtime Database paths. */
    auditLog: "AI_INTELLIGENCE_AUDIT",
} as const;

export function isUnifiedIntelligenceEnabled(): boolean {
    return readFlag(INTELLIGENCE_FLAGS.unified, true);
}

export function isJevEnabled(): boolean {
    return isUnifiedIntelligenceEnabled() && readFlag(INTELLIGENCE_FLAGS.jev, true);
}

export function isFreeRouterEnabled(): boolean {
    return isUnifiedIntelligenceEnabled() && readFlag(INTELLIGENCE_FLAGS.freeRouter, true);
}

export function isMultiModelRoutingEnabled(): boolean {
    return isFreeRouterEnabled() && readFlag(INTELLIGENCE_FLAGS.multiModel, true);
}

export function isChallengeReviewEnabled(): boolean {
    return isUnifiedIntelligenceEnabled() && readFlag(INTELLIGENCE_FLAGS.challengeReview, true);
}

export function isStrategyResearchIntelligenceEnabled(): boolean {
    return isUnifiedIntelligenceEnabled() && readFlag(INTELLIGENCE_FLAGS.strategyResearch, true);
}

export function isProScalpingIntelligenceEnabled(): boolean {
    return isUnifiedIntelligenceEnabled() && readFlag(INTELLIGENCE_FLAGS.proScalping, true);
}

export function isIntelligenceAuditEnabled(): boolean {
    return isUnifiedIntelligenceEnabled() && readFlag(INTELLIGENCE_FLAGS.auditLog, true);
}

/** Snapshot for API responses so UIs can hide disabled surfaces. */
export function intelligenceFlagSnapshot(): Record<string, boolean> {
    return {
        unified: isUnifiedIntelligenceEnabled(),
        jev: isJevEnabled(),
        freeRouter: isFreeRouterEnabled(),
        multiModel: isMultiModelRoutingEnabled(),
        challengeReview: isChallengeReviewEnabled(),
        strategyResearch: isStrategyResearchIntelligenceEnabled(),
        proScalping: isProScalpingIntelligenceEnabled(),
        auditLog: isIntelligenceAuditEnabled(),
    };
}
