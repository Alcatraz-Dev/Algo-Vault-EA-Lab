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
import { isModelConfirmedFree, assertFreeModelAllowed, KNOWN_FREE_MODELS } from "../models";
import { normalizeNarrative, normalizeSummary } from "../validate";
import { extractFinishReason, isTruncated, isAbortError } from "../finish";

export class OpenRouterProvider implements AIProvider {
    readonly id = "openrouter";
    readonly name = "OpenRouter AI (Free Cloud)";

    isAvailable(): boolean {
        return Boolean(AIConfig.openrouterApiKey && AIConfig.openrouterApiKey.trim());
    }

    async getModels(): Promise<AIModel[]> {
        if (!this.isAvailable()) {
            return KNOWN_FREE_MODELS.filter((m) => m.provider === "openrouter");
        }

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(`${AIConfig.openrouterBaseUrl}/models`, {
                headers: {
                    Authorization: `Bearer ${AIConfig.openrouterApiKey}`,
                },
                signal: controller.signal,
            }).finally(() => clearTimeout(timer));

            if (!res.ok) {
                return KNOWN_FREE_MODELS.filter((m) => m.provider === "openrouter");
            }

            const body = (await res.json()) as { data?: Array<{ id: string; name?: string; pricing?: { prompt?: string; completion?: string } }> };
            if (!Array.isArray(body.data)) {
                return KNOWN_FREE_MODELS.filter((m) => m.provider === "openrouter");
            }

            const freeModels: AIModel[] = body.data
                .filter((item) => isModelConfirmedFree(item.id, item.pricing))
                .map((item) => ({
                    id: item.id,
                    name: item.name || item.id,
                    provider: "openrouter",
                    free: true,
                    confirmedFree: true,
                    enabled: true,
                    capabilities: { text: true, structuredOutput: true },
                }));

            return freeModels.length > 0 ? freeModels : KNOWN_FREE_MODELS.filter((m) => m.provider === "openrouter");
        } catch {
            return KNOWN_FREE_MODELS.filter((m) => m.provider === "openrouter");
        }
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        if (!this.isAvailable()) {
            throw {
                code: "PROVIDER_UNAVAILABLE",
                provider: this.id,
                message: "OpenRouter API key is not configured.",
            };
        }

        // The global default model (e.g. "gemini-2.5-flash") is the default for
        // the *Gemini* provider and is paid on OpenRouter. Only honor an
        // explicitly requested model when it is confirmed free here, otherwise
        // route through OpenRouter's own free router so this provider can serve
        // as a working fallback instead of always failing the free-only guard.
        const model =
            request.model && isModelConfirmedFree(request.model) ? request.model : "openrouter/free";

        // Enforce Free-Only Safety Guard
        assertFreeModelAllowed(model);

        const messages: Array<{ role: string; content: string }> = [];
        if (request.systemPrompt) {
            messages.push({ role: "system", content: request.systemPrompt });
        }
        messages.push(...request.messages);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AIConfig.timeoutMs);

        try {
            const res = await fetch(`${AIConfig.openrouterBaseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${AIConfig.openrouterApiKey}`,
                    "HTTP-Referer": "https://algovault.io",
                    "X-Title": "AlgoVault Platform",
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
                    throw { code: "RATE_LIMITED", provider: this.id, message: "OpenRouter rate limit reached.", status };
                }
                if (status === 402 || status === 403) {
                    throw { code: "QUOTA_EXCEEDED", provider: this.id, message: "OpenRouter quota exceeded.", status };
                }
                throw { code: "UNKNOWN_ERROR", provider: this.id, message: `OpenRouter HTTP ${status}: ${errText}`, status };
            }

            const data = (await res.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
            };

            const content = data.choices?.[0]?.message?.content || "";
            if (!content.trim()) {
                throw { code: "UNKNOWN_ERROR", provider: this.id, message: "OpenRouter returned empty content." };
            }

            console.log(`[AI] provider=${this.id} model=${model} attempt=success`);

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
            const isAbort = isAbortError(err);
            if (!isAbort && err && typeof err === "object" && "code" in err) {
                throw err;
            }
            throw {
                code: isAbort ? "TIMEOUT" : "UNKNOWN_ERROR",
                provider: this.id,
                message: isAbort ? `OpenRouter request timed out after ${AIConfig.timeoutMs}ms.` : String(err),
            };
        } finally {
            clearTimeout(timer);
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
