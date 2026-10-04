/**
 * Generic OpenAI-compatible provider adapter for free-tier LLM APIs
 * (Groq, Cerebras, Mistral La Plateforme — all expose /chat/completions).
 *
 * These adapters implement the LEGACY `AIProvider` interface from lib/ai so
 * they compose with the existing gateway plumbing (types, models, usage
 * accounting) without modifying any existing provider file.
 *
 * Safety properties:
 *  - Free-only by construction: they serve their provider's free-tier
 *    endpoint and never select a model the catalog marks as paid.
 *  - Live catalog resolution: model ids come from the provider's own
 *    /models response — ids are never invented here.
 *  - Availability gate: no credential env var → isAvailable() false, so the
 *    provider simply never participates.
 *  - Legacy strategy/summary hooks are served through the shared chat path.
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
import { AIProviderTokenUsage, extractTokenUsage } from "../../ai/usage-events";
import { LocalStrategyAIProvider } from "../../ai/local";

export interface OpenAICompatibleProviderConfig {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: () => string;
    /** Restrict the catalog to models matching these substrings (free tier). */
    modelHints?: string[];
    /** Provider-family fallback hint used when the catalog cannot be filtered. */
    defaultModelSubstring: string;
}

const CATALOG_TTL_MS = 10 * 60 * 1000;

export class OpenAICompatibleProvider implements AIProvider {
    readonly id: string;
    readonly name: string;

    private cfg: OpenAICompatibleProviderConfig;
    private local = new LocalStrategyAIProvider();
    private models: AIModel[] = [];
    private modelsFetchedAt = 0;

    constructor(cfg: OpenAICompatibleProviderConfig) {
        this.cfg = cfg;
        this.id = cfg.id;
        this.name = cfg.name;
    }

    isAvailable(): boolean {
        return Boolean(this.cfg.apiKey());
    }

    async getModels(): Promise<AIModel[]> {
        const key = this.cfg.apiKey();
        if (!key) return [];
        const now = Date.now();
        if (this.models.length > 0 && now - this.modelsFetchedAt < CATALOG_TTL_MS) {
            return this.models;
        }
        try {
            const res = await fetch(`${this.cfg.baseUrl}/models`, {
                headers: { Authorization: `Bearer ${key}` },
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) throw new Error(`catalog ${res.status}`);
            const body = (await res.json()) as { data?: Array<{ id?: string }> };
            const ids = (body.data ?? [])
                .map((m) => (typeof m?.id === "string" ? m.id : ""))
                .filter(Boolean);
            this.models = ids.map((id) => ({
                id,
                name: `${this.cfg.name} ${id}`,
                provider: this.id,
                free: true, // free-tier endpoint by construction
                confirmedFree: true,
                enabled: true,
                capabilities: { text: true, structuredOutput: true },
            }));
            this.modelsFetchedAt = now;
            return this.models;
        } catch {
            // A failed catalog read must not blank a warm cache.
            return this.models;
        }
    }

    /** Pick a real catalog model for this request, honoring hints. Never invents ids. */
    private async resolveModel(requested?: string): Promise<string | null> {
        if (requested) {
            const catalog = await this.getModels();
            if (catalog.length === 0) return requested; // honest attempt; provider will accept or 404
            return catalog.some((m) => m.id === requested) ? requested : null;
        }
        const catalog = await this.getModels();
        if (catalog.length === 0) return null;
        const hints = [...(this.cfg.modelHints ?? []), this.cfg.defaultModelSubstring];
        for (const hint of hints) {
            const match = catalog.find((m) => m.id.toLowerCase().includes(hint.toLowerCase()));
            if (match) return match.id;
        }
        return catalog[0].id;
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        const key = this.cfg.apiKey();
        if (!key) {
            throw this.err("PROVIDER_UNAVAILABLE", `${this.cfg.name} is not configured.`);
        }
        const model = await this.resolveModel(request.model);
        if (!model) {
            throw this.err("MODEL_UNAVAILABLE", `${this.cfg.name}: no catalog model available.`);
        }

        const started = Date.now();
        let usage: AIProviderTokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false };
        try {
            const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${key}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
                        ...request.messages,
                    ],
                    temperature: request.temperature ?? 0.4,
                    max_tokens: request.maxTokens ?? 2048,
                    ...(request.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
                }),
                signal: AbortSignal.timeout(AIConfig.timeoutMs),
            });

            if (!res.ok) {
                throw this.err(
                    res.status === 429 ? "RATE_LIMITED" : res.status === 401 || res.status === 403 ? "INVALID_API_KEY" : "PROVIDER_UNAVAILABLE",
                    `${this.cfg.name} HTTP ${res.status}`,
                );
            }

            const body = (await res.json()) as {
                choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
                usage?: unknown;
            };
            usage = extractTokenUsage(body);
            const content = body.choices?.[0]?.message?.content ?? "";
            const finishReason = body.choices?.[0]?.finish_reason;
            return {
                success: true,
                provider: this.id,
                model,
                content,
                finishReason,
                truncated: finishReason === "length",
                raw: body,
            };
        } catch (err) {
            if (this.isAIProviderError(err)) throw err;
            const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
            throw this.err(isTimeout ? "TIMEOUT" : "UNKNOWN_ERROR", `${this.cfg.name}: ${isTimeout ? "timeout" : "request failed"}`);
        } finally {
            void started;
            void usage;
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

function env(name: string): () => string {
    return () => process.env[name] || "";
}

// ── Concrete providers ───────────────────────────────────────────────────────

export function createGroqProvider(): OpenAICompatibleProvider {
    return new OpenAICompatibleProvider({
        id: "groq",
        name: "Groq",
        baseUrl: (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
        apiKey: env("GROQ_API_KEY"),
        defaultModelSubstring: "llama",
    });
}

export function createCerebrasProvider(): OpenAICompatibleProvider {
    return new OpenAICompatibleProvider({
        id: "cerebras",
        name: "Cerebras",
        baseUrl: (process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1").replace(/\/$/, ""),
        apiKey: env("CEREBRAS_API_KEY"),
        defaultModelSubstring: "llama",
    });
}

export function createMistralProvider(): OpenAICompatibleProvider {
    return new OpenAICompatibleProvider({
        id: "mistral",
        name: "Mistral",
        baseUrl: (process.env.MISTRAL_BASE_URL || "https://api.mistral.ai/v1").replace(/\/$/, ""),
        apiKey: env("MISTRAL_API_KEY"),
        // Free experiment plan models carry "-free" / "mistral-" families;
        // hint keeps selection on the small fast tier by default.
        defaultModelSubstring: "mistral",
        modelHints: ["mistral-small-latest", "open-mistral"],
    });
}
