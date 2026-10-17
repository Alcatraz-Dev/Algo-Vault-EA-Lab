// Shared AI provider abstraction & types for the AI Gateway

export type AIRole = "system" | "user" | "assistant";

export interface AIMessage {
    role: AIRole;
    content: string;
}

export type AIProviderMode = "auto" | "strict";

export interface AIChatRequest {
    messages: AIMessage[];
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: "text" | "json_object";
    model?: string;
    provider?: string;
    /**
     * "auto" preserves the gateway's existing free-first fallback chain.
     * "strict" uses only `provider` and throws instead of substituting another
     * provider or model. Default is "auto" for backward compatibility.
     */
    mode?: AIProviderMode;
    /** Client cancellation signal, propagated to the provider request. */
    signal?: AbortSignal;
}

export interface AIResponse {
    success: boolean;
    provider: string;
    model: string;
    content: string;
    /** Provider/model the caller explicitly asked for, when one was given. */
    requestedProvider?: string;
    requestedModel?: string;
    /** True when the provider replaced an unavailable model with a free one. */
    substituted?: boolean;
    /**
     * Provider-reported finish reason (e.g. "stop" | "length").
     * When "length" the response was cut off at the token limit and must
     * be surfaced to the client instead of silently looking complete.
     */
    finishReason?: string;
    /** True when the provider hit its output token limit mid-response. */
    truncated?: boolean;
    /** Provider failures observed before a fallback response was returned. */
    fallbackErrors?: AIProviderError[];
    /**
     * Set when the AI budget guard refused every candidate provider, so the
     * response came from the local heuristic rather than from any provider.
     * `providers` lists which ones were budget-blocked and `reason` explains
     * the limit that stopped them. Model selection is unaffected by this.
     */
    budgetBlocked?: { reason: string; providers: string[] };
    raw?: unknown;
}

export interface AIModelCapabilities {
    text?: boolean;
    vision?: boolean;
    tools?: boolean;
    structuredOutput?: boolean;
    reasoning?: boolean;
    streaming?: boolean;
}

/**
 * Provider-reported pricing. Only ever populated from what the provider's own
 * catalog actually returned — AlgoVault never infers or hardcodes prices.
 */
export interface AIModelPricing {
    prompt?: string | number;
    completion?: string | number;
    /** Per-request price, when the provider reports one. */
    request?: string | number;
}

export interface AIModel {
    id: string;
    name: string;
    provider: string;
    free: boolean;
    confirmedFree: boolean;
    enabled: boolean;
    capabilities?: AIModelCapabilities;
    contextLength?: number;
    /** Provider-reported expiry, when the catalog exposes one. */
    expiresAt?: string;
    /** True when the catalog marks the model as no longer routed. */
    deprecated?: boolean;
    /** Absent when the provider does not expose pricing. */
    pricing?: AIModelPricing;
}

export type AIErrorCode =
    | "RATE_LIMITED"
    | "QUOTA_EXCEEDED"
    | "MODEL_UNAVAILABLE"
    | "PROVIDER_UNAVAILABLE"
    | "RESOURCE_EXHAUSTED"
    | "TIMEOUT"
    | "INVALID_API_KEY"
    | "INVALID_REQUEST"
    | "PAID_MODEL_BLOCKED"
    | "AI_BUDGET_EXCEEDED"
    | "NO_FREE_PROVIDER"
    | "UNKNOWN_ERROR";

export interface AIProviderError {
    code: AIErrorCode;
    provider: string;
    message: string;
    status?: number;
    /** Provider-requested wait before retrying, in milliseconds. */
    retryAfterMs?: number;
    /** Model involved in the failure, when one was selected. */
    model?: string;
}

// Legacy Strategy Lab compatibility types
export interface PatternStatsForAI {
    occurrences: number | null;
    winRate: number | null;
    averageR: number | null;
    maxDrawdownPct: number | null;
    profitFactor: number | null;
    maxLossStreak: number | null;
}

export interface StrategyNarrativeInput {
    asset: string;
    period: string;
    timeframe: string;
    direction: "long" | "short";
    patternKind: string;
    patternName: string;
    conditions: string[];
    regime: string;
    volatility: string;
    bestSession: string;
    bestDay: string;
    stats: PatternStatsForAI;
    hierarchy: { macro: string; structure: string; setup: string; entry: string };
}

export interface StrategyNarrative {
    name: string;
    description: string;
    why: string;
    risks: string;
    bestRegimes: string;
    weakRegimes: string;
    generatedBy: string;
}

export interface AnalysisSummaryInput {
    asset: string;
    timeframe: string;
    trend: string;
    volatility: string;
    bestSession: string;
    bestDay: string;
    strongestSetup: string;
    averageR: number | null;
    regime: string;
}

export interface AnalysisSummary {
    summary: string;
    generatedBy: string;
}

export interface ChatMessageInput {
    role: AIRole;
    content: string;
}

export interface AIProvider {
    readonly id: string;
    readonly name: string;
    /** Local, on-device inference. Such providers are never cloud-substituted. */
    readonly isLocal?: boolean;
    /** False when automatic routing must not select this provider. */
    readonly autoSelectable?: boolean;
    /**
     * True when `chat()` resolves the effective model against the provider's
     * own live catalog and verifies its current pricing before dispatch. The
     * router then delegates the free-only decision to that provider instead of
     * applying its id-based guard (whose heuristics cannot resolve such ids).
     */
    readonly verifiesModelPricing?: boolean;
    isAvailable(): Promise<boolean> | boolean;
    /** `forceRefresh` is a hint; providers without a cache may ignore it. */
    getModels(forceRefresh?: boolean): Promise<AIModel[]>;
    chat(request: AIChatRequest): Promise<AIResponse>;

    // Legacy interface support:
    describeStrategy(input: StrategyNarrativeInput): Promise<StrategyNarrative>;
    summarizeAnalysis(input: AnalysisSummaryInput): Promise<AnalysisSummary>;
    generateText?(prompt: string, systemPrompt?: string): Promise<string>;
    chatCompletion?(messages: ChatMessageInput[], systemPrompt?: string): Promise<string>;
    generateStructured?<T>(prompt: string, schemaDescription?: string, systemPrompt?: string): Promise<T>;
}