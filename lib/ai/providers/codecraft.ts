import {
    AIProvider,
    AIChatRequest,
    AIResponse,
    AIModel,
    StrategyNarrativeInput,
    StrategyNarrative,
    AnalysisSummaryInput,
    AnalysisSummary,
    ChatMessageInput,
} from "../types";
import { AIConfig } from "../config";
import { isModelConfirmedFree, assertFreeModelAllowed, isProviderMeteredAllowed, AIModelPricing } from "../models";
import { normalizeNarrative, normalizeSummary } from "../validate";
import { extractFinishReason, isTruncated, isAbortError } from "../finish";
import { aiUsageTracker } from "../usage";

interface UsageData {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
}

/** Upstream error bodies are truncated to keep logs/API payloads bounded. */
const MAX_UPSTREAM_ERROR_TEXT = 300;

/** Re-discover the model catalog at most every 10 minutes. */
const MODEL_LIST_TTL_MS = 10 * 60 * 1000;

/**
 * Telemetry label for a call whose model could not be resolved. Never sent
 * upstream — AlgoVault has no fabricated model id to fall back on.
 */
const UNRESOLVED_MODEL = "unresolved";

/**
 * Narrows a raw catalog pricing object to the fields the cost policy reads.
 * Anything the provider did not send stays absent, which the policy treats as
 * NOT free. Prices are never invented or defaulted to zero.
 */
function normalizePricing(raw: unknown): AIModelPricing | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const src = raw as Record<string, unknown>;
    const out: AIModelPricing = {};
    if (typeof src.prompt === "string" || typeof src.prompt === "number") out.prompt = src.prompt;
    if (typeof src.completion === "string" || typeof src.completion === "number") out.completion = src.completion;
    return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeErrorMessage(msg: string): string {
    let sanitized = msg;
    const apiKey = AIConfig.codecraftApiKey;
    if (apiKey && apiKey.trim().length > 0) {
        // Case-insensitive: a secret is a secret however the upstream echoed it.
        sanitized = sanitized.replace(new RegExp(escapeRegExp(apiKey), "gi"), "[REDACTED]");
    }
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_\-\.\=\+]+/gi, "Bearer [REDACTED]");
    sanitized = sanitized.replace(/("?(?:api[_-]?key|authorization)"?\s*[:=]\s*"?)[^"\s,}]+/gi, "$1[REDACTED]");
    return sanitized;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitize FIRST, then truncate. Truncating first can cut a secret in half at
 * the character limit, producing a partial key that no longer matches the
 * exact-value redaction above.
 */
function safeUpstreamErrorText(raw: string): string {
    return sanitizeErrorMessage(raw).slice(0, MAX_UPSTREAM_ERROR_TEXT);
}

export class CodeCraftProvider implements AIProvider {
    readonly id = "codecraft";
    readonly name = "CodeCraft API";

    /** Per-instance catalog cache. Assigned atomically, never mutated in place. */
    private cachedModels: AIModel[] | null = null;
    private cachedAt = 0;

    isAvailable(): boolean {
        return Boolean(AIConfig.codecraftApiKey && AIConfig.codecraftApiKey.trim());
    }

    /**
     * Discovers CodeCraft's real model catalog.
     *
     * There is deliberately NO offline fallback model: a live GET /models proved
     * "codecraft-default" is not a real id, so there is nothing safe to fall
     * back to. When the catalog cannot be discovered this returns an empty list
     * and the caller fails with a configuration error rather than sending a
     * fabricated model upstream.
     *
     * free/confirmedFree are derived from the pricing the API actually
     * returned — zero input AND zero output price is the only "free" signal.
     * Any non-zero price, or absent pricing, is reported as metered. The
     * provider name is never used to infer cost.
     */
    async getModels(): Promise<AIModel[]> {
        const fallback: AIModel[] = [];
        if (!this.isAvailable()) {
            return fallback;
        }
        if (this.cachedModels && Date.now() - this.cachedAt < MODEL_LIST_TTL_MS) {
            return this.cachedModels;
        }

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(`${AIConfig.codecraftBaseUrl}/models`, {
                headers: {
                    Authorization: `Bearer ${AIConfig.codecraftApiKey}`,
                },
                signal: controller.signal,
                cache: "no-store",
            }).finally(() => clearTimeout(timer));

            if (!res.ok) {
                this.cachedModels = fallback;
                this.cachedAt = Date.now();
                return fallback;
            }

            const body = (await res.json()) as {
                data?: Array<{
                    id: string;
                    name?: string;
                    context_length?: number;
                    context_window?: number;
                    pricing?: unknown;
                }>;
            };

            if (!Array.isArray(body.data) || body.data.length === 0) {
                this.cachedModels = fallback;
                this.cachedAt = Date.now();
                return fallback;
            }

            const discovered: AIModel[] = body.data
                .filter((item) => item && typeof item.id === "string" && item.id.trim().length > 0)
                .map((item) => {
                    const pricing = normalizePricing(item.pricing);
                    // Reuses the shared cost policy: only zero prompt AND zero
                    // completion price counts as free. Missing pricing is NOT
                    // free. No provider-name inference.
                    const confirmedFree = isModelConfirmedFree(item.id, pricing);
                    const contextLength =
                        typeof item.context_length === "number"
                            ? item.context_length
                            : typeof item.context_window === "number"
                              ? item.context_window
                              : undefined;
                    return {
                        id: item.id,
                        name: item.name || item.id,
                        provider: "codecraft",
                        free: confirmedFree,
                        confirmedFree,
                        enabled: true,
                        // Tool calling is NOT part of the AlgoVault provider
                        // contract (AIChatRequest carries no tool definitions),
                        // so it is not advertised as a capability here even
                        // though CodeCraft's own catalog lists it.
                        capabilities: { text: true, structuredOutput: true },
                        ...(pricing ? { pricing } : {}),
                        ...(contextLength !== undefined ? { contextLength } : {}),
                    };
                });

            this.cachedModels = discovered;
            this.cachedAt = Date.now();
            return discovered;
        } catch {
            this.cachedModels = fallback;
            this.cachedAt = Date.now();
            return fallback;
        }
    }

    /**
     * Picks a catalog model that is actually runnable under the current cost
     * policy. Returns undefined when none is — the caller must then fail rather
     * than invent a model id.
     */
    private pickRunnableModel(catalog: AIModel[]): string | undefined {
        const enabled = catalog.filter((m) => m.enabled && m.id.trim().length > 0);
        if (enabled.length === 0) return undefined;
        // Either the free-only policy is off, or this provider has explicitly
        // opted into metered usage: the catalog's first entry is runnable.
        if (!AIConfig.freeOnly || isProviderMeteredAllowed(this.id)) return enabled[0].id;
        // Otherwise only a genuinely zero-priced model may be used.
        return enabled.find((m) => m.confirmedFree)?.id;
    }

    /**
     * Resolves the effective model for a chat call. Never fabricates an id and
     * never substitutes one the caller did not ask for.
     *
     * An EXPLICIT model is `request.model` that is neither undefined nor empty
     * after trimming. It is distinct from `CODECRAFT_MODEL`, which is the
     * provider's configured default and only applies when no explicit model was
     * given.
     *
     * Precedence:
     *   1. an EXPLICIT caller model;
     *   2. `CODECRAFT_MODEL` — an operator-level setting, always honored verbatim;
     *   3. a real model from CodeCraft's own discovered catalog.
     *
     * For (1): if CodeCraft advertises the model it is used verbatim. If the
     * catalog is available and does NOT contain it, the call fails with
     * MODEL_UNAVAILABLE — CodeCraft never quietly swaps in a different model
     * for one the caller named. That matters once CODECRAFT_ALLOW_METERED=true:
     * substitution would turn an agent configured for another provider into an
     * unintended METERED CodeCraft request. The router's normal provider
     * fallback then handles the failure. With no catalog at all the caller's id
     * is forwarded unchanged so the upstream decides — that is the caller's own
     * model, not a substituted one, and a wrong id simply 404s.
     *
     * For (2): an operator-configured model is sent verbatim even if the catalog
     * does not list it, per the F1 policy. An unknown id fails safely upstream
     * as MODEL_UNAVAILABLE, usage is recorded, and the router falls back.
     *
     * There is no placeholder default. A live GET /models proved
     * "codecraft-default" is not a real id, so when (1) and (2) are both absent
     * and no catalog model is runnable this throws a clear configuration error
     * instead of hiding the problem behind a 404 fallback.
     */
    private async resolveModel(requested?: string): Promise<string> {
        const requestedModel = typeof requested === "string" ? requested.trim() : "";
        const configuredModel = AIConfig.codecraftModel.trim();

        if (requestedModel) {
            const catalog = await this.getModels();
            const match = catalog.find((m) => m.id.toLowerCase() === requestedModel.toLowerCase());
            // Case A: the model CodeCraft actually advertises. Used verbatim.
            if (match) return match.id;
            // No catalog to verify against: forward the caller's own id unchanged
            // and let the upstream answer. This is not a substitution.
            if (catalog.length === 0) return requestedModel;
            // Case B: the caller named a model CodeCraft does not advertise.
            // DO NOT substitute — a different (metered) model would be a billable
            // request the caller never asked for.
            throw {
                code: "MODEL_UNAVAILABLE",
                provider: this.id,
                message:
                    `Explicitly requested model "${requestedModel}" is not advertised by CodeCraft. ` +
                    `CodeCraft does not substitute a different model for an explicit request. ` +
                    `Use a model from CodeCraft's catalog, omit the model to fall back to CODECRAFT_MODEL, ` +
                    `or route the request to the provider that serves "${requestedModel}".`,
            };
        }

        // Case C: no explicit model — the operator's configured default, else a
        // real runnable catalog model. Never a fabricated id.
        if (configuredModel) return configuredModel;

        const substitute = this.pickRunnableModel(await this.getModels());
        if (substitute) return substitute;

        // Two distinct causes, named explicitly so the operator is not sent
        // chasing the wrong one. No model id is ever invented to paper over it.
        const costBlocked =
            AIConfig.freeOnly && !isProviderMeteredAllowed(this.id) && AIConfig.codecraftModel.trim() === "";
        throw {
            code: "MODEL_UNAVAILABLE",
            provider: this.id,
            message: costBlocked
                ? "No runnable CodeCraft model. Every discovered CodeCraft model is metered, so none may be used " +
                  "while the free-only policy is active. Set CODECRAFT_ALLOW_METERED=true to allow metered models " +
                  "for CodeCraft only, or set CODECRAFT_MODEL to a zero-priced model if the catalog offers one."
                : "No CodeCraft model is configured. Set CODECRAFT_MODEL to a model id from CodeCraft's /models " +
                  "catalog, or make CodeCraft's catalog reachable so a real model can be resolved.",
        };
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        if (!this.isAvailable()) {
            const err = {
                code: "PROVIDER_UNAVAILABLE" as const,
                provider: this.id,
                message: "CodeCraft API key is not configured.",
            };
            aiUsageTracker.recordUsage({
                provider: this.id,
                model: request.model?.trim() || AIConfig.codecraftModel.trim() || UNRESOLVED_MODEL,
                latencyMs: 0,
                status: "error",
                errorCategory: err.code,
                timestamp: Date.now(),
            });
            throw err;
        }

        // Resolve before the cost guard so the guard always sees the model that
        // will actually be sent. A resolution failure is a configuration error,
        // not an upstream one: record it and surface it instead of falling back.
        let model: string;
        try {
            model = await this.resolveModel(request.model);
        } catch (err: unknown) {
            aiUsageTracker.recordUsage({
                provider: this.id,
                model: request.model?.trim() || AIConfig.codecraftModel.trim() || UNRESOLVED_MODEL,
                latencyMs: 0,
                status: "error",
                errorCategory: "MODEL_UNAVAILABLE",
                timestamp: Date.now(),
            });
            throw err;
        }

        // Enforce the Free-Only Safety Guard if active. `this.id` scopes the
        // check to CodeCraft, so CODECRAFT_ALLOW_METERED can only ever relax
        // the policy for this provider — every other provider is unaffected.
        assertFreeModelAllowed(model, undefined, this.id);

        const messages: Array<{ role: string; content: string }> = [];
        if (request.systemPrompt) {
            messages.push({ role: "system", content: request.systemPrompt });
        }
        messages.push(...request.messages);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AIConfig.timeoutMs);
        const startTime = Date.now();

        try {
            const res = await fetch(`${AIConfig.codecraftBaseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${AIConfig.codecraftApiKey}`,
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

            const latencyMs = Date.now() - startTime;

            if (!res.ok) {
                const status = res.status;
                const errRawText = await res.text().catch(() => "");
                const errText = safeUpstreamErrorText(errRawText);

                let thrownErr: { code: string; provider: string; message: string; status?: number };

                if (status === 401) {
                    thrownErr = {
                        code: "INVALID_API_KEY",
                        provider: this.id,
                        message: "CodeCraft rejected the API key (401).",
                        status,
                    };
                } else if (status === 402 || status === 403) {
                    thrownErr = {
                        code: "QUOTA_EXCEEDED",
                        provider: this.id,
                        message: "CodeCraft quota exceeded or forbidden.",
                        status,
                    };
                } else if (status === 404) {
                    thrownErr = {
                        code: "MODEL_UNAVAILABLE",
                        provider: this.id,
                        message: `CodeCraft model "${model}" not found (404).`,
                        status,
                    };
                } else if (status === 408) {
                    thrownErr = {
                        code: "TIMEOUT",
                        provider: this.id,
                        message: "CodeCraft request timed out (408).",
                        status,
                    };
                } else if (status === 429) {
                    thrownErr = {
                        code: "RATE_LIMITED",
                        provider: this.id,
                        message: "CodeCraft rate limit reached (429).",
                        status,
                    };
                } else if (status >= 500) {
                    thrownErr = {
                        code: "PROVIDER_UNAVAILABLE",
                        provider: this.id,
                        message: `CodeCraft upstream error HTTP ${status}: ${errText}`,
                        status,
                    };
                } else {
                    thrownErr = {
                        code: "UNKNOWN_ERROR",
                        provider: this.id,
                        message: `CodeCraft HTTP ${status}: ${errText}`,
                        status,
                    };
                }

                aiUsageTracker.recordUsage({
                    provider: this.id,
                    model,
                    latencyMs,
                    status,
                    errorCategory: thrownErr.code,
                    timestamp: Date.now(),
                });

                throw thrownErr;
            }

            const data = (await res.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
                usage?: UsageData;
            };

            const content = data.choices?.[0]?.message?.content || "";
            if (!content.trim()) {
                const emptyErr = {
                    code: "UNKNOWN_ERROR",
                    provider: this.id,
                    message: "CodeCraft returned empty content.",
                };
                aiUsageTracker.recordUsage({
                    provider: this.id,
                    model,
                    latencyMs,
                    status: 200,
                    errorCategory: emptyErr.code,
                    timestamp: Date.now(),
                });
                throw emptyErr;
            }

            // Track Usage (Internal Telemetry Hook)
            const usage = data.usage;
            aiUsageTracker.recordUsage({
                provider: this.id,
                model,
                inputTokens: usage?.prompt_tokens,
                outputTokens: usage?.completion_tokens,
                totalTokens: usage?.total_tokens,
                latencyMs,
                status: 200,
                timestamp: Date.now(),
            });

            return {
                success: true,
                provider: this.id,
                model,
                content,
                finishReason: extractFinishReason(data),
                truncated: isTruncated(data),
                raw: data,
            };
        } catch (err: unknown) {
            const latencyMs = Date.now() - startTime;
            const isAbort = isAbortError(err);

            if (!isAbort && err && typeof err === "object" && "code" in err) {
                // Secret safety re-sanitization check on thrown error messages
                const typed = err as { code: string; provider: string; message: string; status?: number };
                typed.message = sanitizeErrorMessage(typed.message);
                throw typed;
            }

            const rawMsg = isAbort
                ? `CodeCraft request timed out after ${AIConfig.timeoutMs}ms.`
                : String(err instanceof Error ? err.message : err);

            const thrownErr = {
                code: isAbort ? "TIMEOUT" : "UNKNOWN_ERROR",
                provider: this.id,
                message: sanitizeErrorMessage(rawMsg),
            };

            aiUsageTracker.recordUsage({
                provider: this.id,
                model,
                latencyMs,
                status: "error",
                errorCategory: thrownErr.code,
                timestamp: Date.now(),
            });

            throw thrownErr;
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

    async generateStructured<T>(
        prompt: string,
        schemaDescription?: string,
        systemPrompt?: string
    ): Promise<T> {
        const fullPrompt = `${prompt}\n\nStrict JSON Format required matching: ${schemaDescription || "{}"}`;
        const res = await this.chat({
            messages: [{ role: "user", content: fullPrompt }],
            systemPrompt:
                systemPrompt ||
                "You are a helpful JSON generator. Return ONLY a single valid JSON object without markdown formatting.",
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
