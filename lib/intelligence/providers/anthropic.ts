/**
 * Anthropic Claude adapter — OPTIONAL premium provider.
 *
 * Claude is never required: the unified router only reaches this adapter when
 * (a) ANTHROPIC_API_KEY is configured AND (b) the request policy allows paid
 * providers (Pro tier, or explicit allowPaidFallback, or deep-research tasks
 * with paid fallback enabled). With no key this adapter reports unavailable
 * and the fabric operates purely on free providers.
 *
 * Uses Anthropic's native /v1/messages API (not OpenAI-compatible) with the
 * legacy `AIProvider` interface so it composes with the gateway types.
 */

import {
    AIProvider,
    AIChatRequest,
    AIResponse,
    AIModel,
    AIProviderError,
    StrategyNarrativeInput,
    StrategyNarrative,
    AnalysisSummaryInput,
    AnalysisSummary,
    ChatMessageInput,
} from "../../ai/types";
import { AIConfig } from "../../ai/config";
import { LocalStrategyAIProvider } from "../../ai/local";

const MODELS_URL = "https://api.anthropic.com/v1/models";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const CATALOG_TTL_MS = 10 * 60 * 1000;

/** Latest-generation model hints. Resolved against the LIVE catalog; ids are
 *  never invented — a hint that matches nothing is skipped. */
const MODEL_HINTS = ["claude-sonnet-4", "claude-haiku-4", "claude-3-5", "claude-3"];

export class AnthropicProvider implements AIProvider {
    readonly id = "claude";
    readonly name = "Anthropic Claude";

    private local = new LocalStrategyAIProvider();
    private models: AIModel[] = [];
    private modelsFetchedAt = 0;

    isAvailable(): boolean {
        return Boolean(process.env.ANTHROPIC_API_KEY);
    }

    async getModels(): Promise<AIModel[]> {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) return [];
        const now = Date.now();
        if (this.models.length > 0 && now - this.modelsFetchedAt < CATALOG_TTL_MS) {
            return this.models;
        }
        try {
            const res = await fetch(MODELS_URL, {
                headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) throw new Error(`catalog ${res.status}`);
            const body = (await res.json()) as { data?: Array<{ id?: string }> };
            const ids = (body.data ?? [])
                .map((m) => (typeof m?.id === "string" ? m.id : ""))
                .filter(Boolean);
            this.models = ids.map((id) => ({
                id,
                name: `Claude ${id}`,
                provider: this.id,
                free: false,
                confirmedFree: false,
                enabled: true,
                capabilities: {
                    text: true,
                    vision: true,
                    structuredOutput: true,
                    tools: true,
                },
            }));
            this.modelsFetchedAt = now;
            return this.models;
        } catch {
            return this.models;
        }
    }

    private async resolveModel(requested?: string): Promise<string | null> {
        if (requested) return requested;
        const catalog = await this.getModels();
        if (catalog.length === 0) return null;
        for (const hint of MODEL_HINTS) {
            const match = catalog.find((m) => m.id.toLowerCase().includes(hint.toLowerCase()));
            if (match) return match.id;
        }
        return catalog[0].id;
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) throw this.err("PROVIDER_UNAVAILABLE", "Claude is not configured.");
        const model = await this.resolveModel(request.model);
        if (!model) throw this.err("MODEL_UNAVAILABLE", "Claude: no catalog model available.");

        try {
            const res = await fetch(MESSAGES_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": key,
                    "anthropic-version": ANTHROPIC_VERSION,
                },
                body: JSON.stringify({
                    model,
                    max_tokens: request.maxTokens ?? 2048,
                    temperature: request.temperature ?? 0.4,
                    ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
                    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
                }),
                signal: AbortSignal.timeout(AIConfig.timeoutMs),
            });

            if (!res.ok) {
                throw this.err(
                    res.status === 429
                        ? "RATE_LIMITED"
                        : res.status === 401 || res.status === 403
                          ? "INVALID_API_KEY"
                          : "PROVIDER_UNAVAILABLE",
                    `Claude HTTP ${res.status}`,
                );
            }

            const body = (await res.json()) as {
                content?: Array<{ type?: string; text?: string }>;
                stop_reason?: string;
                usage?: unknown;
            };
            const content = (body.content ?? [])
                .filter((c) => c.type === "text" && typeof c.text === "string")
                .map((c) => c.text as string)
                .join("");
            return {
                success: true,
                provider: this.id,
                model,
                content,
                finishReason: body.stop_reason,
                truncated: body.stop_reason === "max_tokens",
                raw: body,
            };
        } catch (err) {
            if (this.isAIProviderError(err)) throw err;
            const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
            throw this.err(isTimeout ? "TIMEOUT" : "UNKNOWN_ERROR", `Claude: ${isTimeout ? "timeout" : "request failed"}`);
        }
    }

    private isAIProviderError(err: unknown): err is AIProviderError {
        return typeof err === "object" && err !== null && "code" in err && "provider" in err;
    }

    private err(code: AIProviderError["code"], message: string): AIProviderError {
        return { code, provider: this.id, message };
    }

    // ── Legacy interface ─────────────────────────────────────────────────────

    async describeStrategy(input: StrategyNarrativeInput): Promise<StrategyNarrative> {
        return this.local.describeStrategy(input);
    }

    async summarizeAnalysis(input: AnalysisSummaryInput): Promise<AnalysisSummary> {
        return this.local.summarizeAnalysis(input);
    }

    async generateText(prompt: string, systemPrompt?: string): Promise<string> {
        const res = await this.chat({ messages: [{ role: "user", content: prompt }], systemPrompt });
        return res.content;
    }

    async chatCompletion(messages: ChatMessageInput[], systemPrompt?: string): Promise<string> {
        const res = await this.chat({ messages, systemPrompt });
        return res.content;
    }
}
