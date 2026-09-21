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

export class BAIProvider implements AIProvider {
    readonly id = "bai";
    readonly name = "B.AI (Free Cloud)";

    isAvailable(): boolean {
        if (!(AIConfig.baiApiKey && AIConfig.baiApiKey.trim())) return false;
        // B.AI exposes NO confirmed-free models in its catalog. Under the
        // free-only policy it can never serve a request, so exclude it from the
        // fallback chain instead of wasting an attempt on a guaranteed failure.
        if (AIConfig.freeOnly) return false;
        return true;
    }

    async getModels(): Promise<AIModel[]> {
        if (!this.isAvailable()) {
            return KNOWN_FREE_MODELS.filter((m) => m.provider === "bai");
        }

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(`${AIConfig.baiBaseUrl}/models`, {
                headers: {
                    Authorization: `Bearer ${AIConfig.baiApiKey}`,
                },
                signal: controller.signal,
            }).finally(() => clearTimeout(timer));

            if (!res.ok) {
                return [];
            }

            const body = (await res.json()) as { data?: Array<{ id?: unknown; name?: unknown; pricing?: { prompt?: string | number; completion?: string | number } }> };
            if (!Array.isArray(body.data)) {
                return [];
            }

            return body.data
                .filter((item): item is { id: string; name?: unknown; pricing?: { prompt?: string | number; completion?: string | number } } => typeof item.id === "string" && item.id.trim().length > 0)
                .map((item) => {
                    const confirmedFree = isModelConfirmedFree(item.id, item.pricing);
                    return {
                        id: item.id,
                        name: typeof item.name === "string" && item.name.trim() ? item.name : item.id,
                        provider: "bai" as const,
                        free: confirmedFree,
                        confirmedFree,
                        enabled: true,
                        capabilities: { text: true, structuredOutput: true },
                    };
                });
        } catch {
            return [];
        }
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        if (!this.isAvailable()) {
            throw {
                code: "PROVIDER_UNAVAILABLE",
                provider: this.id,
                message: "B.AI API key is not configured.",
            };
        }

        const models = await this.getModels();
        const requestedModel = request.model?.trim();
        const configuredModel = AIConfig.baiModel.trim();
        const model =
            [requestedModel, configuredModel].find((candidate) =>
                candidate && models.some((item) => item.id === candidate)
            ) || models.find((item) => item.enabled)?.id;

        if (!model) {
            throw {
                code: "MODEL_UNAVAILABLE",
                provider: this.id,
                message: "B.AI model catalog returned no usable model.",
            };
        }

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
            const res = await fetch(`${AIConfig.baiBaseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${AIConfig.baiApiKey}`,
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
                    throw { code: "RATE_LIMITED", provider: this.id, message: "B.AI rate limit reached.", status };
                }
                if (status === 402 || status === 403) {
                    throw { code: "QUOTA_EXCEEDED", provider: this.id, message: "B.AI quota exceeded.", status };
                }
                throw { code: "UNKNOWN_ERROR", provider: this.id, message: `B.AI HTTP ${status}: ${errText}`, status };
            }

            const data = (await res.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
            };

            const content = data.choices?.[0]?.message?.content || "";
            if (!content.trim()) {
                throw { code: "UNKNOWN_ERROR", provider: this.id, message: "B.AI returned empty content." };
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
                message: isAbort ? `B.AI request timed out after ${AIConfig.timeoutMs}ms.` : String(err),
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
