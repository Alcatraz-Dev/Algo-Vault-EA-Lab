/**
 * Unified Intelligence Fabric — shared types.
 *
 * Type imports in other modules: `import type { AITask, AICapability } from "./types"`.
 * AITask is re-exported from ./versions via the interface below.
 * These types COMPOSE the existing AlgoVault AI gateway (lib/ai) — they never
 * replace it. The unified router adapts legacy `AIProvider` implementations
 * and this file describes the layer above them: task routing, structured
 * decisioning, Jev validation and orchestration.
 */

import type { DecisionState } from "./versions";

/** Task type re-exported for convenience (defined in ./versions). */
export type { AITask } from "./versions";
import type { AITask } from "./versions";

// ── Provider registry ────────────────────────────────────────────────────────

export type AIProviderType =
    | "free_cloud"
    | "premium"
    | "local"
    | "decision_engine";

export type AICapability =
    | "text"
    | "structuredOutput"
    | "vision"
    | "audio"
    | "video"
    | "toolCalling"
    | "reasoning"
    | "coding"
    | "longContext";

export type LatencyClass = "fast" | "balanced" | "slow";
export type CostClass = "free" | "freemium" | "paid";
export type ProviderHealthStatus = "unknown" | "healthy" | "degraded" | "down" | "cooldown";

export interface AIProviderDescriptor {
    /** Stable registry id (lowercase). Never contains secrets. */
    id: string;
    name: string;
    type: AIProviderType;
    capabilities: AICapability[];
    /** Default model ids served by this provider (metadata only, no keys). */
    models: string[];
    baseUrl?: string;
    /** Env var name that configures the key — never the key value itself. */
    apiKeyEnvVar?: string;
    /** Free tier description. */
    freeTier?: string;
    /** Documented rate limits (metadata only). */
    rateLimits?: { requestsPerMinute?: number; requestsPerDay?: number };
    /** 0..1 — operational confidence derived from observed health. */
    reliabilityScore?: number;
    health: ProviderHealthStatus;
    costClass: CostClass;
    /** Whether the provider's terms allow commercial use of its free tier. */
    commercialUse: boolean;
    /** Privacy policy URL for metadata display. */
    privacyPolicyUrl?: string;
    /** Human-readable region/data-residency restrictions, if any. */
    regionRestrictions?: string;
    /** Whether an administrator disabled this provider. */
    enabled: boolean;
    /** Routing priority: lower is preferred among equal-quality candidates. */
    priority: number;
}

// ── Requests / responses ─────────────────────────────────────────────────────

export type UserTier = "free" | "pro" | "admin";

export interface AIRequest {
    task: AITask;
    systemPrompt?: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    /** Compact MarketIntelligenceContext (see market-context.ts) — never raw candles. */
    marketContext?: Record<string, unknown>;
    /** JSON-schema-ish description the response must satisfy, when structured. */
    structuredSchema?: Record<string, unknown>;
    requiredCapabilities?: AICapability[];
    maxLatencyMs?: number;
    priority?: "low" | "normal" | "high";
    userTier?: UserTier;
    /** Allow paid providers (Claude etc.) when free ones cannot serve. */
    allowPaidFallback?: boolean;
    /** Restrict to free providers only (default true unless pro capability). */
    allowFreeOnly?: boolean;
    /** Preferred model ids, in order. Honored when the provider serves them. */
    preferredModels?: string[];
    maxTokens?: number;
    temperature?: number;
}

export type AIResponseValidationStatus =
    | "ok"
    | "invalid_output"
    | "schema_mismatch"
    | "ai_unavailable"
    | "timeout"
    | "blocked_policy";

export interface AITokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reported: boolean;
}

export interface AIResponse {
    /** Provider that produced the content, or the empty string when unavailable. */
    provider: string;
    model: string;
    content: string;
    /** Parsed structured output when requested and parseable. */
    structuredData?: Record<string, unknown>;
    /** 0..1; undefined when the response carries no confidence. */
    confidence?: number;
    latencyMs: number;
    tokenUsage: AITokenUsage;
    /** True when a non-preferred provider/model served the request. */
    fallbackUsed: boolean;
    requestId: string;
    timestamp: number;
    validationStatus: AIResponseValidationStatus;
    /** Attempts made, for observability. */
    attempts: number;
    /** Sanitized error codes observed (never raw provider messages with secrets). */
    errors?: string[];
    /** Versions of the policies that routed this request. */
    versions: {
        routingPolicy: string;
        providerRegistry: string;
        promptTemplates: string;
    };
}

// ── Market context (compressed) ──────────────────────────────────────────────

/** Versioned compact market context — see market-context.ts for the builder. */
export interface MarketIntelligenceContext {
    schema: string;
    symbol: string;
    timeframe: string;
    /** ms epoch of the newest fact; staleness checks use it. */
    asOf: number;
    /** Age of the underlying data in ms, as reported by the market pipeline. */
    dataAgeMs?: number;
    price?: number;
    trend?: string;
    regime?: string;
    structure?: {
        bias?: string;
        label?: string;
        higherHighs?: number;
        higherLows?: number;
        lowerHighs?: number;
        lowerLows?: number;
        lastEvent?: string;
    };
    htf?: { timeframe?: string; bias?: string };
    liquidity?: { sweeps?: number; nearest?: string };
    fvg?: { active?: number; direction?: string };
    orderBlocks?: { active?: number; direction?: string };
    volatility?: { atr?: number; state?: string };
    volume?: { state?: string };
    session?: string;
    newsRisk?: string;
    setup?: { state?: string; quality?: number };
    risk?: { state?: string };
    strategy?: { name?: string; version?: string };
    /** Data-quality flags; AI requests are refused when facts are missing/stale. */
    dataQuality?: { status?: string; issues?: string[] };
}

// ── Jev ──────────────────────────────────────────────────────────────────────

export type JevAnswerValue = "yes" | "no" | "unclear";

export interface JevQuestion {
    id: string;
    /** Human-readable question shown in the Why? panel. */
    question: string;
    /** Deterministic fact key from MarketIntelligenceContext used to answer. */
    factKey?: string;
    /** Weight in the Jev score (default 1). */
    weight?: number;
}

export interface JevAnswer {
    id: string;
    question: string;
    answer: JevAnswerValue;
    confidence: number;
    evidence?: string;
}

export interface JevResult {
    decision: "BUY" | "SELL" | "HOLD";
    confidence: number;
    answers: JevAnswer[];
    reasoningSummary: string;
    validationStatus: "VALIDATED" | "DEGRADED" | "UNAVAILABLE" | "REJECTED";
    provider: string;
    model: string;
    latency: number;
    timestamp: number;
    jevPolicyVersion: string;
    /** Present when validationStatus is UNAVAILABLE/REJECTED. */
    reason?: string;
}

// ── Orchestration ────────────────────────────────────────────────────────────

export type RiskEvaluation = {
    approved: boolean;
    code: string;
    reason?: string;
    volume?: number;
};

export interface DecisionFactor {
    source: "market_facts" | "deterministic" | "jev" | "llm" | "risk" | "memory" | "policy";
    label: string;
    value: string;
    /** Signals a factor that argues against the proposed direction. */
    negative?: boolean;
}

export interface IntelligenceDecision {
    requestId: string;
    symbol: string;
    timeframe: string;
    direction: "BUY" | "SELL" | "HOLD";
    state: DecisionState;
    confidence: number;
    factors: DecisionFactor[];
    jev?: JevResult;
    llm?: {
        provider: string;
        model: string;
        summary: string;
        confidence?: number;
        fallbackUsed?: boolean;
    };
    risk?: RiskEvaluation;
    /** One-line human explanation for the Why? panel (no chain-of-thought). */
    rationale: string;
    validationStatus: "VALIDATED" | "DEGRADED" | "AI_UNAVAILABLE" | "RISK_BLOCKED" | "INVALID";
    timestamp: number;
    versions: {
        marketContextSchema: string;
        decisionPolicy: string;
        jevPolicy: string;
        signalPolicy: string;
    };
}

// ── Signal enrichment ────────────────────────────────────────────────────────

/** Attached to AISignal when the fabric evaluates a signal (optional field). */
export interface SignalIntelligence {
    decisionState: DecisionState;
    jev?: { decision: string; confidence: number; status: string };
    llm?: { provider: string; model: string; summary: string; confidence?: number };
    risk?: RiskEvaluation;
    htfAlignment?: string;
    factors?: DecisionFactor[];
    rationale?: string;
    intelligenceVersion: string;
    evaluatedAt: number;
}
