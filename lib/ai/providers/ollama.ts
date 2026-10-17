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
} from "../types";
import { AIConfig } from "../config";
import { normalizeNarrative, normalizeSummary } from "../validate";
import { createAbortHandle } from "../abort";
import { isLoopbackHostname } from "../local-endpoint";

interface OllamaTag {
    name?: string;
    model?: string;
    details?: {
        family?: string;
        parameter_size?: string;
    };
}

interface OllamaShow {
    capabilities?: string[];
    details?: {
        family?: string;
        parameter_size?: string;
    };
    model_info?: Record<string, unknown>;
}

interface OllamaChatResponse {
    model?: string;
    message?: { role?: string; content?: string; thinking?: string };
    done?: boolean;
    done_reason?: string;
    prompt_eval_count?: number;
    eval_count?: number;
}

interface CatalogCache {
    models: AIModel[];
    fetchedAt: number;
}

/**
 * Only a loopback Ollama endpoint is accepted.
 *
 * The URL is configured server-side (desktop shell or self-hosted server), never
 * supplied by a browser request. Rejecting credentials, paths and query strings
 * keeps this from becoming a generic proxy or an SSRF primitive.
 */
export function resolveOllamaEndpoint(raw: string): string | null {
    try {
        const url = new URL(raw);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        if (url.username || url.password) return null;
        if (url.search || url.hash) return null;
        if (url.pathname !== "/" && url.pathname !== "") return null;
        if (!isLoopbackHostname(url.hostname)) return null;
        return url.origin;
    } catch {
        return null;
    }
}

function parseContextLength(modelInfo: Record<string, unknown> | undefined): number | undefined {
    if (!modelInfo) return undefined;
    for (const [key, value] of Object.entries(modelInfo)) {
        if (key.endsWith(".context_length") && typeof value === "number" && value > 0) {
            return value;
        }
    }
    return undefined;
}

function capabilitiesFor(capabilities: string[]): AIModel["capabilities"] {
    const set = new Set(capabilities);
    return {
        text: set.has("completion"),
        tools: set.has("tools"),
        vision: set.has("vision"),
        reasoning: set.has("thinking"),
        // `format: "json"` is attempted when JSON is requested, but Ollama's
        // capability list does not guarantee reliable structured output. Do not
        // advertise it as a model capability until it is actually verified.
        structuredOutput: false,
    };
}

function error(
    code: AIProviderError["code"],
    message: string,
    extra: Partial<AIProviderError> = {},
): AIProviderError {
    return { code, provider: "ollama", message, ...extra };
}

export class OllamaProvider implements AIProvider {
    readonly id = "ollama";
    readonly name = "Ollama (Local)";
    readonly isLocal = true;
    /** Local inference is opt-in only; automatic routing must never select it. */
    readonly autoSelectable = false;

    private availability: { ok: boolean; at: number } | null = null;
    private catalog: CatalogCache | null = null;
    private catalogFailureAt = 0;
    private catalogInFlight: Promise<AIModel[]> | null = null;

    isAvailable(): Promise<boolean> {
        if (!AIConfig.localAIEnabled) return Promise.resolve(false);
        const endpoint = this.endpoint();
        if (!endpoint) return Promise.resolve(false);
        const now = Date.now();
        if (this.availability && now - this.availability.at < 10_000) {
            return Promise.resolve(this.availability.ok);
        }
        return this.probe(endpoint).then((ok) => {
            this.availability = { ok, at: Date.now() };
            return ok;
        });
    }

    private endpoint(): string | null {
        return resolveOllamaEndpoint(AIConfig.ollamaBaseUrl);
    }

    private async probe(endpoint: string): Promise<boolean> {
        const abort = createAbortHandle(undefined, AIConfig.ollamaProbeTimeoutMs);
        try {
            const res = await fetch(`${endpoint}/api/tags`, {
                signal: abort.signal,
                cache: "no-store",
            });
            return res.ok;
        } catch {
            return false;
        } finally {
            abort.clear();
        }
    }

    async getModels(forceRefresh = false): Promise<AIModel[]> {
        if (!AIConfig.localAIEnabled) return [];
        const endpoint = this.endpoint();
        if (!endpoint) return [];

        const now = Date.now();
        if (!forceRefresh) {
            if (this.catalog && now - this.catalog.fetchedAt < AIConfig.ollamaCatalogTtlMs) {
                return this.catalog.models;
            }
            if (this.catalogFailureAt > 0 && now - this.catalogFailureAt < 10_000) {
                return this.catalog?.models ?? [];
            }
        }
        if (this.catalogInFlight) return this.catalogInFlight;

        this.catalogInFlight = this.fetchModels(endpoint)
            .then((models) => {
                this.catalog = { models, fetchedAt: Date.now() };
                this.catalogFailureAt = 0;
                // A forced refresh also refreshes reachability, so "Recheck"
                // reports the service that was just contacted rather than a
                // 10-second-old probe result.
                this.availability = { ok: true, at: Date.now() };
                return models;
            })
            .catch((err) => {
                this.catalogFailureAt = Date.now();
                this.availability = { ok: false, at: Date.now() };
                console.warn(
                    `[AI] Ollama catalog unavailable: ${err instanceof Error ? err.message : String(err)}`,
                );
                return this.catalog?.models ?? [];
            })
            .finally(() => {
                this.catalogInFlight = null;
            });

        return this.catalogInFlight;
    }

    private async fetchModels(endpoint: string): Promise<AIModel[]> {
        const abort = createAbortHandle(undefined, AIConfig.ollamaProbeTimeoutMs);
        let body: { models?: OllamaTag[] };
        try {
            const res = await fetch(`${endpoint}/api/tags`, {
                signal: abort.signal,
                cache: "no-store",
            });
            if (!res.ok) throw new Error(`Ollama tags HTTP ${res.status}`);
            body = (await res.json()) as { models?: OllamaTag[] };
        } finally {
            abort.clear();
        }

        const tags = (body.models ?? [])
            .map((entry) => entry.name || entry.model || "")
            .filter((name) => name.length > 0)
            .slice(0, 50);

        const models = await Promise.all(tags.map((name) => this.describeModel(endpoint, name)));
        return models.sort((a, b) => a.id.localeCompare(b.id));
    }

    private async describeModel(endpoint: string, name: string): Promise<AIModel> {
        const abort = createAbortHandle(undefined, AIConfig.ollamaProbeTimeoutMs);
        try {
            const res = await fetch(`${endpoint}/api/show`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: name }),
                signal: abort.signal,
                cache: "no-store",
            });
            if (!res.ok) return this.modelFrom(name, undefined);
            const show = (await res.json()) as OllamaShow;
            return this.modelFrom(name, show);
        } catch {
            // A show failure must not hide an otherwise installed model.
            return this.modelFrom(name, undefined);
        } finally {
            abort.clear();
        }
    }

    private modelFrom(name: string, show: OllamaShow | undefined): AIModel {
        return {
            id: name,
            name,
            provider: this.id,
            free: true,
            confirmedFree: true,
            enabled: true,
            capabilities: capabilitiesFor(show?.capabilities ?? []),
            contextLength: parseContextLength(show?.model_info),
        };
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        if (!AIConfig.localAIEnabled) {
            throw error(
                "PROVIDER_UNAVAILABLE",
                "Local AI is not enabled on this server.",
            );
        }
        const endpoint = this.endpoint();
        if (!endpoint) {
            throw error(
                "PROVIDER_UNAVAILABLE",
                "The configured Ollama endpoint is not a loopback URL.",
            );
        }

        const requested = request.model?.trim();
        const model = requested || AIConfig.ollamaModel.trim();
        if (!model) {
            throw error("INVALID_REQUEST", "No Ollama model was selected.", {
                model: requested,
            });
        }

        const catalog = await this.getModels();
        if (catalog.length > 0 && !catalog.some((entry) => entry.id === model)) {
            throw error("MODEL_UNAVAILABLE", `Ollama model "${model}" is not installed.`, {
                model,
            });
        }

        const messages: Array<{ role: string; content: string }> = [];
        if (request.systemPrompt) {
            messages.push({ role: "system", content: request.systemPrompt });
        }
        messages.push(...request.messages);

        const abort = createAbortHandle(request.signal, AIConfig.ollamaTimeoutMs);
        try {
            const res = await fetch(`${endpoint}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model,
                    messages,
                    stream: false,
                    // Never surface chain-of-thought as assistant content.
                    think: false,
                    ...(request.responseFormat === "json_object" ? { format: "json" } : {}),
                    options: {
                        ...(typeof request.temperature === "number"
                            ? { temperature: request.temperature }
                            : {}),
                        ...(typeof request.maxTokens === "number" && request.maxTokens > 0
                            ? { num_predict: request.maxTokens }
                            : {}),
                    },
                }),
                signal: abort.signal,
                cache: "no-store",
            });

            if (!res.ok) {
                const status = res.status;
                const detail = (await res.text().catch(() => "")).toLowerCase();
                if (status === 404) {
                    throw error("MODEL_UNAVAILABLE", `Ollama model "${model}" is unavailable.`, {
                        status,
                        model,
                    });
                }
                if (status === 429) {
                    throw error("RATE_LIMITED", "Ollama is busy or rate limited.", {
                        status,
                        model,
                    });
                }
                if (
                    status >= 500 &&
                    (detail.includes("memory") ||
                        detail.includes("out of memory") ||
                        detail.includes("failed to load"))
                ) {
                    throw error(
                        "RESOURCE_EXHAUSTED",
                        "Ollama could not load the model, usually due to insufficient memory.",
                        { status, model },
                    );
                }
                throw error("PROVIDER_UNAVAILABLE", `Ollama request failed (HTTP ${status}).`, {
                    status,
                    model,
                });
            }

            const data = (await res.json()) as OllamaChatResponse;
            const content = data.message?.content || "";
            if (!content.trim()) {
                throw error("UNKNOWN_ERROR", "Ollama returned empty content.", { model });
            }

            const promptTokens = data.prompt_eval_count ?? 0;
            const completionTokens = data.eval_count ?? 0;
            return {
                success: true,
                provider: this.id,
                model: data.model || model,
                requestedModel: requested,
                content,
                finishReason: data.done_reason || "stop",
                truncated: data.done_reason === "length",
                raw: {
                    ...data,
                    usage: {
                        prompt_tokens: promptTokens,
                        completion_tokens: completionTokens,
                        total_tokens: promptTokens + completionTokens,
                    },
                },
            };
        } catch (err: unknown) {
            if (err && typeof err === "object" && "code" in err) throw err;
            if (abort.cancelled()) {
                throw error("TIMEOUT", "Ollama request was cancelled.", { model });
            }
            if (abort.timedOut()) {
                throw error(
                    "TIMEOUT",
                    `Ollama request timed out after ${AIConfig.ollamaTimeoutMs}ms.`,
                    { model },
                );
            }
            throw error(
                "PROVIDER_UNAVAILABLE",
                "Ollama is not reachable. Start Ollama and verify the local endpoint.",
                { model },
            );
        } finally {
            abort.clear();
        }
    }

    async generateText(prompt: string, systemPrompt?: string): Promise<string> {
        const res = await this.chat({
            messages: [{ role: "user", content: prompt }],
            systemPrompt,
        });
        return res.content;
    }

    async chatCompletion(messages: ChatMessageInput[], systemPrompt?: string): Promise<string> {
        const res = await this.chat({ messages, systemPrompt });
        return res.content;
    }

    async generateStructured<T>(
        prompt: string,
        schemaDescription?: string,
        systemPrompt?: string,
    ): Promise<T> {
        const fullPrompt = `${prompt}\n\nStrict JSON Format required matching: ${schemaDescription || "{}"}`;
        const res = await this.chat({
            messages: [{ role: "user", content: fullPrompt }],
            systemPrompt:
                systemPrompt ||
                "You are a helpful JSON generator. Return ONLY a single valid JSON object without markdown formatting.",
            responseFormat: "json_object",
        });

        const cleaned = res.content
            .trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "");
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        const candidate = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
        return JSON.parse(candidate) as T;
    }

    async describeStrategy(input: StrategyNarrativeInput): Promise<StrategyNarrative> {
        const system =
            "You are a quantitative trading strategy researcher. Output a single JSON object with exact string keys: name, description, why, risks, bestRegimes, weakRegimes.";
        const prompt = `Produce a strategy narrative for: Asset ${input.asset} (${input.direction}), Pattern ${input.patternName} on ${input.timeframe}, Regime: ${input.regime}. Stats: winRate=${input.stats.winRate ?? "n/a"}%, profitFactor=${input.stats.profitFactor ?? "n/a"}`;
        const schema = `{"name": "string", "description": "string", "why": "string", "risks": "string", "bestRegimes": "string", "weakRegimes": "string"}`;
        const data = await this.generateStructured<Partial<StrategyNarrative>>(prompt, schema, system);

        return normalizeNarrative(data, {
            name: `${input.asset} ${input.direction === "long" ? "Long" : "Short"} — ${input.patternName}`,
            description: "",
            why: "",
            risks: "",
            bestRegimes: input.regime,
            weakRegimes: "",
            generatedBy: this.id,
        });
    }

    async summarizeAnalysis(input: AnalysisSummaryInput): Promise<AnalysisSummary> {
        const system = "You are a market analyst. Output a JSON object with key summary.";
        const prompt = `Summarize market state: ${input.asset} ${input.timeframe} trend=${input.trend}, volatility=${input.volatility}, regime=${input.regime}.`;
        const schema = `{"summary": "string"}`;
        const data = await this.generateStructured<{ summary?: string }>(prompt, schema, system);
        return normalizeSummary(data, `${input.asset} shows ${input.trend} on ${input.timeframe}.`);
    }
}
