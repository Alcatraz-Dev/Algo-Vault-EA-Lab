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
import { isModelConfirmedFree, assertFreeModelAllowed } from "../models";
import { normalizeNarrative, normalizeSummary } from "../validate";
import { extractFinishReason, isTruncated } from "../finish";
import { createAbortHandle } from "../abort";

interface OpenRouterCatalogItem {
    id?: string;
    name?: string;
    pricing?: {
        prompt?: string;
        completion?: string;
        request?: string;
    };
    context_length?: number;
    supported_parameters?: string[];
    architecture?: {
        input_modalities?: string[];
    };
    expiration_date?: string | null;
}

interface CatalogCache {
    models: AIModel[];
    fetchedAt: number;
}

const DEFAULT_MODEL = "openrouter/free";

/**
 * A cached catalog may only be used inside these bounds. Beyond the TTL it is
 * refreshed; if that refresh fails, the last good catalog is still usable for
 * a bounded outage window and then discarded — an old free list must never be
 * trusted indefinitely.
 */
export function isCatalogWithinMaxStale(
    fetchedAt: number,
    now: number,
    maxStaleMs: number,
): boolean {
    return Number.isFinite(fetchedAt) && now - fetchedAt <= maxStaleMs;
}

function parseRetryAfter(header: string | null): number | undefined {
    if (!header) return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    return undefined;
}

function capabilitiesFor(item: OpenRouterCatalogItem): AIModel["capabilities"] {
    const supported = new Set(item.supported_parameters ?? []);
    const inputModalities = new Set(item.architecture?.input_modalities ?? []);
    return {
        text: true,
        vision: inputModalities.has("image"),
        tools: supported.has("tools"),
        structuredOutput: supported.has("response_format") || supported.has("structured_outputs"),
        reasoning: supported.has("reasoning") || supported.has("include_reasoning"),
    };
}

export class OpenRouterProvider implements AIProvider {
    readonly id = "openrouter";
    readonly name = "OpenRouter AI (Free Cloud)";
    /**
     * `chat()` resolves the effective model against the live public catalog and
     * verifies its pricing immediately before dispatch, so the router delegates
     * the free-only decision to this provider.
     */
    readonly verifiesModelPricing = true;

    private catalog: CatalogCache | null = null;
    private catalogFailureAt = 0;
    private catalogInFlight: Promise<AIModel[]> | null = null;

    /**
     * The last successfully fetched catalog, but only while it is inside the
     * bounded outage window. Empty means "not verified" — never a guess.
     */
    private usableCatalog(now = Date.now()): AIModel[] {
        if (!this.catalog) return [];
        return isCatalogWithinMaxStale(
            this.catalog.fetchedAt,
            now,
            AIConfig.openrouterCatalogMaxStaleMs,
        )
            ? this.catalog.models
            : [];
    }

    isAvailable(): boolean {
        return Boolean(AIConfig.openrouterApiKey && AIConfig.openrouterApiKey.trim());
    }

    /**
     * Discover the public catalog. This intentionally does NOT require an API
     * key: the official /models endpoint is public metadata, and the UI must be
     * able to show which free models exist before the operator configures a
     * key. Completion still requires a key.
     *
     * Only zero-priced models are returned. Prices are read from the provider's
     * own pricing block; a `:free` suffix alone is not used as the catalog
     * filter.
     */
    async getModels(forceRefresh = false): Promise<AIModel[]> {
        const now = Date.now();
        if (!forceRefresh) {
            if (this.catalog && now - this.catalog.fetchedAt < AIConfig.openrouterCatalogTtlMs) {
                return this.catalog.models;
            }
            if (
                this.catalogFailureAt > 0 &&
                now - this.catalogFailureAt < AIConfig.openrouterCatalogFailureTtlMs
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
            .catch((err) => {
                this.catalogFailureAt = Date.now();
                console.warn(
                    `[AI] OpenRouter catalog unavailable: ${err instanceof Error ? err.message : String(err)}`,
                );
                // A bounded-staleness cache is still safer than a hardcoded
                // list: it was real provider metadata at the time it was
                // fetched. Past the max-stale window it is discarded and the
                // caller must fail closed instead of sending an unverified id.
                return this.usableCatalog();
            })
            .finally(() => {
                this.catalogInFlight = null;
            });

        return this.catalogInFlight;
    }

    private async fetchCatalog(): Promise<AIModel[]> {
        const abort = createAbortHandle(undefined, 10_000);
        const headers: Record<string, string> = {};
        const key = AIConfig.openrouterApiKey.trim();
        if (key) headers.Authorization = `Bearer ${key}`;

        try {
            const res = await fetch(`${AIConfig.openrouterBaseUrl}/models`, {
                headers,
                signal: abort.signal,
                cache: "no-store",
            });
            if (!res.ok) {
                throw new Error(`OpenRouter catalog HTTP ${res.status}`);
            }
            const body = (await res.json()) as { data?: OpenRouterCatalogItem[] };
            if (!Array.isArray(body.data)) {
                throw new Error("OpenRouter catalog returned an invalid payload.");
            }

            const now = Date.now();
            return body.data
                .filter((item): item is OpenRouterCatalogItem & { id: string } => typeof item?.id === "string")
                .filter((item) => {
                    if (!isModelConfirmedFree(item.id, item.pricing)) return false;
                    const expiresAt = item.expiration_date ? Date.parse(item.expiration_date) : NaN;
                    return !Number.isFinite(expiresAt) || expiresAt > now;
                })
                .map((item) => ({
                    id: item.id,
                    name: item.name || item.id,
                    provider: this.id,
                    free: true,
                    confirmedFree: true,
                    enabled: true,
                    capabilities: capabilitiesFor(item),
                    contextLength:
                        typeof item.context_length === "number" && item.context_length > 0
                            ? item.context_length
                            : undefined,
                    expiresAt: item.expiration_date || undefined,
                    pricing: item.pricing
                        ? {
                              prompt: item.pricing.prompt,
                              completion: item.pricing.completion,
                              request: item.pricing.request,
                          }
                        : undefined,
                }))
                .sort((a, b) => a.id.localeCompare(b.id));
        } finally {
            abort.clear();
        }
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        const key = AIConfig.openrouterApiKey.trim();
        if (!key) {
            throw {
                code: "PROVIDER_UNAVAILABLE",
                provider: this.id,
                message: "OpenRouter API key is not configured.",
            } satisfies AIProviderError;
        }

        const explicit = request.model?.trim();
        const requested = explicit || DEFAULT_MODEL;
        const strict = request.mode === "strict";

        // Every inference request, including the `openrouter/free` default,
        // must resolve to a model that the CURRENT catalog confirms is free.
        // No catalog means no verification, so no request is sent.
        const catalog = await this.getModels();
        if (catalog.length === 0) {
            throw {
                code: "NO_FREE_PROVIDER",
                provider: this.id,
                model: requested,
                message:
                    "No OpenRouter model is currently confirmed free; the request was not sent. " +
                    "Retry when the public model catalog is available.",
            } satisfies AIProviderError;
        }

        let selected = catalog.find(
            (entry) => entry.id.toLowerCase() === requested.toLowerCase() && !entry.deprecated,
        );
        let substituted = false;

        if (!selected) {
            if (explicit && strict) {
                throw {
                    code: "MODEL_UNAVAILABLE",
                    provider: this.id,
                    model: requested,
                    message: `Model "${requested}" is not in the current OpenRouter free catalog.`,
                } satisfies AIProviderError;
            }

            // Automatic mode may replace a stale/removed model, but only with
            // a catalog entry that is itself confirmed free. It never selects
            // a paid model.
            selected = catalog.find((entry) => entry.id === DEFAULT_MODEL) ?? catalog[0];
            if (!selected) {
                throw {
                    code: "NO_FREE_PROVIDER",
                    provider: this.id,
                    model: requested,
                    message: "No OpenRouter model is currently confirmed free; the request was not sent.",
                } satisfies AIProviderError;
            }
            substituted = Boolean(explicit) && selected.id.toLowerCase() !== requested.toLowerCase();
        }

        // Final dispatch-time verification. The catalog is the authority; a
        // stale cache entry that no longer carries zero pricing is refused.
        if (!selected.pricing || !isModelConfirmedFree(selected.id, selected.pricing)) {
            throw {
                code: "PAID_MODEL_BLOCKED",
                provider: this.id,
                model: selected.id,
                message: `OpenRouter model "${selected.id}" is not confirmed free; the request was not sent.`,
            } satisfies AIProviderError;
        }

        const model = selected.id;
        assertFreeModelAllowed(model, selected.pricing, this.id);

        const messages: Array<{ role: string; content: string }> = [];
        if (request.systemPrompt) {
            messages.push({ role: "system", content: request.systemPrompt });
        }
        messages.push(...request.messages);

        const supportsJson = selected?.capabilities?.structuredOutput === true;
        const abort = createAbortHandle(request.signal, AIConfig.timeoutMs);

        try {
            const res = await fetch(`${AIConfig.openrouterBaseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${key}`,
                    "HTTP-Referer": "https://algovault.io",
                    "X-Title": "AlgoVault Platform",
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: request.temperature ?? 0.4,
                    max_tokens: request.maxTokens ?? 4000,
                    ...(request.responseFormat === "json_object" && supportsJson
                        ? { response_format: { type: "json_object" } }
                        : {}),
                }),
                signal: abort.signal,
                cache: "no-store",
            });

            if (!res.ok) {
                const status = res.status;
                // Drain the body without ever exposing it to the client.
                await res.text().catch(() => "");
                const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));

                if (status === 401) {
                    throw {
                        code: "INVALID_API_KEY",
                        provider: this.id,
                        message: "OpenRouter rejected the configured API key.",
                        status,
                        model,
                    } satisfies AIProviderError;
                }
                if (status === 429) {
                    throw {
                        code: "RATE_LIMITED",
                        provider: this.id,
                        message: "OpenRouter free-model rate limit reached.",
                        status,
                        retryAfterMs,
                        model,
                    } satisfies AIProviderError;
                }
                if (status === 402 || status === 403) {
                    throw {
                        code: "QUOTA_EXCEEDED",
                        provider: this.id,
                        message: "OpenRouter quota or account limit reached.",
                        status,
                        retryAfterMs,
                        model,
                    } satisfies AIProviderError;
                }
                if (status === 404) {
                    throw {
                        code: "MODEL_UNAVAILABLE",
                        provider: this.id,
                        message: `OpenRouter model "${model}" is unavailable.`,
                        status,
                        model,
                    } satisfies AIProviderError;
                }
                throw {
                    code: status >= 500 ? "PROVIDER_UNAVAILABLE" : "UNKNOWN_ERROR",
                    provider: this.id,
                    message: `OpenRouter request failed (HTTP ${status}).`,
                    status,
                    retryAfterMs,
                    model,
                } satisfies AIProviderError;
            }

            const data = (await res.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
            };

            const content = data.choices?.[0]?.message?.content || "";
            if (!content.trim()) {
                throw {
                    code: "UNKNOWN_ERROR",
                    provider: this.id,
                    message: "OpenRouter returned empty content.",
                    model,
                } satisfies AIProviderError;
            }

            console.log(`[AI] provider=${this.id} model=${model} attempt=success`);

            return {
                success: true,
                provider: this.id,
                model,
                content,
                requestedModel: explicit,
                substituted: substituted || undefined,
                finishReason: extractFinishReason(data),
                truncated: isTruncated(data),
                raw: data,
            };
        } catch (err: unknown) {
            if (err && typeof err === "object" && "code" in err) throw err;
            const aborted = abort.timedOut() || abort.cancelled();
            throw {
                code: aborted ? "TIMEOUT" : "PROVIDER_UNAVAILABLE",
                provider: this.id,
                model,
                message: aborted
                    ? abort.cancelled()
                        ? "OpenRouter request was cancelled."
                        : `OpenRouter request timed out after ${AIConfig.timeoutMs}ms.`
                    : "OpenRouter could not be reached.",
            } satisfies AIProviderError;
        } finally {
            abort.clear();
        }
    }

    // Legacy interface helpers for Strategy Lab & Copilot
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
