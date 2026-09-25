// Shared AI provider abstraction & types for the AI Gateway

export type AIRole = "system" | "user" | "assistant";

export interface AIMessage {
    role: AIRole;
    content: string;
}

export interface AIChatRequest {
    messages: AIMessage[];
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: "text" | "json_object";
    model?: string;
    provider?: string;
}

export interface AIResponse {
    success: boolean;
    provider: string;
    model: string;
    content: string;
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
    raw?: unknown;
}

export interface AIModelCapabilities {
    text?: boolean;
    vision?: boolean;
    tools?: boolean;
    structuredOutput?: boolean;
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
}

export type AIErrorCode =
    | "RATE_LIMITED"
    | "QUOTA_EXCEEDED"
    | "MODEL_UNAVAILABLE"
    | "PROVIDER_UNAVAILABLE"
    | "TIMEOUT"
    | "INVALID_API_KEY"
    | "INVALID_REQUEST"
    | "PAID_MODEL_BLOCKED"
    | "NO_FREE_PROVIDER"
    | "UNKNOWN_ERROR";

export interface AIProviderError {
    code: AIErrorCode;
    provider: string;
    message: string;
    status?: number;
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
    isAvailable(): Promise<boolean> | boolean;
    getModels(): Promise<AIModel[]>;
    chat(request: AIChatRequest): Promise<AIResponse>;

    // Legacy interface support:
    describeStrategy(input: StrategyNarrativeInput): Promise<StrategyNarrative>;
    summarizeAnalysis(input: AnalysisSummaryInput): Promise<AnalysisSummary>;
    generateText?(prompt: string, systemPrompt?: string): Promise<string>;
    chatCompletion?(messages: ChatMessageInput[], systemPrompt?: string): Promise<string>;
    generateStructured?<T>(prompt: string, schemaDescription?: string, systemPrompt?: string): Promise<T>;
}