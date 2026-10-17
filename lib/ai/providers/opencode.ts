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
import {
    isModelConfirmedFree,
    assertVerifiedFreeModel,
    KNOWN_FREE_MODELS,
} from "../models";
import { normalizeNarrative, normalizeSummary } from "../validate";
import { extractFinishReason, isTruncated, isAbortError } from "../finish";

interface CatalogCache {
    models: AIModel[];
    fetchedAt: number;
}

/**
 * Byte-for-byte the reviewed static registry: the ONLY fallback used when
 * OpenCode's own catalog cannot be read. These entries are explicitly
 * reviewed, not inferred from an id suffix, so a catalog outage can never turn
 * an unknown model into a confirmed-free one.
 */
function reviewedFreeModels(): AIModel[] {
    return KNOWN_FREE_MODELS.filter((m) => m.provider === "opencode");
}

export class OpenCodeProvider implements AIProvider {
    readonly id = "opencode";
    readonly name = "OpenCode AI (Free Cloud)";

    /** Bounded cache: verification must not cost an extra upstream call per request. */
    private catalog: CatalogCache | null = null;
    private catalogFailureAt = 0;
    private catalogInFlight: Promise<AIModel[]> | null = null;

    isAvailable(): boolean {
        return Boolean(AIConfig.opencodeApiKey && AIConfig.opencodeApiKey.trim());
    }

    /** Last successful catalog, or the reviewed registry when none is fresh. */
    private usableCatalog(now = Date.now()): AIModel[] {
        if (this.catalog && now - this.catalog.fetchedAt < AIConfig.opencodeCatalogMaxStaleMs) {
            return this.catalog.models;
        }
        return reviewedFreeModels();
    }

    async getModels(forceRefresh = false): Promise<AIModel[]> {
        if (!this.isAvailable()) return reviewedFreeModels();

        const now = Date.now();
        if (!forceRefresh) {
            if (this.catalog && now - this.catalog.fetchedAt < AIConfig.opencodeCatalogTtlMs) {
                return this.catalog.models;
            }
            if (
                this.catalogFailureAt > 0 &&
                now - this.catalogFailureAt < AIConfig.opencodeCatalogFailureTtlMs
            ) {
                return this.usableCatalog(now);
            }
        }
        if (this.catalogInFlight) return this.catalogInFlight;

        this.catalogInFlight = this.fetchCatalog()
            .then((models) => {
                this.catalog = { models, fetchedAt: Date.now() };
                this.catalogFailureAt = 0;
                return models;
            })
            .catch(() => {
                // Never cache a failure as a successful catalog. The reviewed
                // registry (or the last real catalog, inside its max-stale
                // window) is returned instead; nothing unknown becomes free.
                this.catalogFailureAt = Date.now();
                return this.usableCatalog();
            })
            .finally(() => {
                this.catalogInFlight = null;
            });

        return this.catalogInFlight;
    }

    private async fetchCatalog(): Promise<AIModel[]> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`${AIConfig.opencodeBaseUrl}/models`, {
            headers: {
                Authorization: `Bearer ${AIConfig.opencodeApiKey}`,
            },
            signal: controller.signal,
        }).finally(() => clearTimeout(timer));

        if (!res.ok) throw new Error(`OpenCode catalog HTTP ${res.status}`);

        const body = (await res.json()) as {
            data?: Array<{ id: string; name?: string; pricing?: { prompt?: string; completion?: string } }>;
        };
        if (!Array.isArray(body.data)) throw new Error("OpenCode catalog returned an invalid payload.");

        const freeModels: AIModel[] = body.data
            .filter((item) => isModelConfirmedFree(item.id, item.pricing))
            .map((item) => ({
                id: item.id,
                name: item.name || item.id,
                provider: "opencode",
                free: true,
                confirmedFree: true,
                enabled: true,
                capabilities: { text: true, structuredOutput: true },
            }));

        // An empty free set is a real answer, not a reason to fall back to the
        // registry: it means OpenCode currently confirms no free model.
        return freeModels;
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        if (!this.isAvailable()) {
            throw {
                code: "PROVIDER_UNAVAILABLE",
                provider: this.id,
                message: "OpenCode API key is not configured.",
            };
        }

        // Resolve the requested id against OpenCode's own catalog. A model is
        // usable only when that catalog entry is verified free; an id alone is
        // never enough (no `-free` suffix inference).
        const requested = request.model?.trim();
        const catalog = await this.getModels().catch(() => []);
        if (catalog.length === 0) {
            throw {
                code: "NO_FREE_PROVIDER",
                provider: this.id,
                model: requested,
                message:
                    "No OpenCode model is currently confirmed free; the request was not sent.",
            } satisfies AIProviderError;
        }

        let selected = requested
            ? catalog.find((entry) => entry.id.toLowerCase() === requested.toLowerCase())
            : catalog[0];

        if (!selected) {
            if (request.mode === "strict") {
                throw {
                    code: "MODEL_UNAVAILABLE",
                    provider: this.id,
                    model: requested,
                    message: `Model "${requested}" is not in the current OpenCode free catalog.`,
                } satisfies AIProviderError;
            }
            // Automatic mode may replace a stale/unknown id, but only with a
            // catalog entry that is itself confirmed free.
            selected = catalog[0];
        }

        const model = selected.id;
        const substituted =
            Boolean(requested) && requested!.toLowerCase() !== model.toLowerCase();

        // Dispatch-time guard: the resolved catalog entry must be verified free.
        assertVerifiedFreeModel(selected, this.id);

        const messages: Array<{ role: string; content: string }> = [];
        if (request.systemPrompt) {
            messages.push({ role: "system", content: request.systemPrompt });
        }
        messages.push(...request.messages);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AIConfig.timeoutMs);

        try {
            const res = await fetch(`${AIConfig.opencodeBaseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${AIConfig.opencodeApiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: request.temperature ?? 0.4,
                    max_tokens: request.maxTokens ?? 4000,
                    ...(request.responseFormat === "json_object"
                        ? { response_format: { type: "json_object" } }
                        : {}),
                }),
                signal: controller.signal,
                cache: "no-store",
            });

            if (!res.ok) {
                const status = res.status;
                const errText = await res.text().catch(() => "");

                if (status === 429) {
                    throw { code: "RATE_LIMITED", provider: this.id, message: "OpenCode rate limit reached.", status };
                }
                if (status === 402 || status === 403) {
                    throw { code: "QUOTA_EXCEEDED", provider: this.id, message: "OpenCode quota exceeded.", status };
                }
                throw { code: "UNKNOWN_ERROR", provider: this.id, message: `OpenCode HTTP ${status}: ${errText}`, status };
            }

            const data = (await res.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
            };

            const content = data.choices?.[0]?.message?.content || "";
            if (!content.trim()) {
                throw { code: "UNKNOWN_ERROR", provider: this.id, message: "OpenCode returned empty content." };
            }

            console.log(`[AI] provider=${this.id} model=${model} attempt=success`);

            return {
                success: true,
                provider: this.id,
                model,
                content,
                finishReason: extractFinishReason(data),
                truncated: isTruncated(data),
                requestedModel: requested,
                substituted: substituted || undefined,
                raw: data,
            };
        } catch (err: unknown) {
            const isAbort = isAbortError(err);
            if (!isAbort && err && typeof err === "object" && "code" in err) {
                throw err;
            }
            throw {
                code: isAbort ? "TIMEOUT" : "UNKNOWN_ERROR",
                provider: this.id,
                message: isAbort ? `OpenCode request timed out after ${AIConfig.timeoutMs}ms.` : String(err),
            };
        } finally {
            clearTimeout(timer);
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
        const res = await this.chat({
            messages,
            systemPrompt,
        });
        return res.content;
    }

    async generateStructured<T>(prompt: string, schemaDescription?: string, systemPrompt?: string): Promise<T> {
        const fullPrompt = `${prompt}\n\nStrict JSON Format required matching: ${schemaDescription || "{}"}`;
        const res = await this.chat({
            messages: [{ role: "user", content: fullPrompt }],
            systemPrompt: systemPrompt || "You are a helpful JSON generator. Return ONLY a single valid JSON object without markdown formatting.",
            responseFormat: "json_object",
        });

        const cleaned = res.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
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
