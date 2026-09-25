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
import { aiUsageTracker } from "../usage";

interface UsageData {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
}

function sanitizeErrorMessage(msg: string): string {
    let sanitized = msg;
    const apiKey = AIConfig.codecraftApiKey;
    if (apiKey && apiKey.trim().length > 0) {
        sanitized = sanitized.replaceAll(apiKey, "[REDACTED]");
    }
    sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_\-\.\=\+]+/gi, "Bearer [REDACTED]");
    return sanitized;
}

export class CodeCraftProvider implements AIProvider {
    readonly id = "codecraft";
    readonly name = "CodeCraft API";

    isAvailable(): boolean {
        return Boolean(AIConfig.codecraftApiKey && AIConfig.codecraftApiKey.trim());
    }

    async getModels(): Promise<AIModel[]> {
        const fallback = KNOWN_FREE_MODELS.filter((m) => m.provider === "codecraft");
        if (!this.isAvailable()) {
            return fallback;
        }

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(`${AIConfig.codecraftBaseUrl}/models`, {
                headers: {
                    Authorization: `Bearer ${AIConfig.codecraftApiKey}`,
                },
                signal: controller.signal,
            }).finally(() => clearTimeout(timer));

            if (!res.ok) {
                return fallback;
            }

            const body = (await res.json()) as {
                data?: Array<{
                    id: string;
                    name?: string;
                    pricing?: { prompt?: string | number; completion?: string | number };
                }>;
            };

            if (!Array.isArray(body.data) || body.data.length === 0) {
                return fallback;
            }

            const discovered: AIModel[] = body.data.map((item) => ({
                id: item.id,
                name: item.name || item.id,
                provider: "codecraft",
                free: true,
                confirmedFree: true,
                enabled: true,
                capabilities: { text: true, structuredOutput: true, tools: true },
            }));

            return discovered;
        } catch {
            return fallback;
        }
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
                model: request.model || AIConfig.codecraftModel || "codecraft-default",
                latencyMs: 0,
                status: "error",
                errorCategory: err.code,
                timestamp: Date.now(),
            });
            throw err;
        }

        const model = request.model || AIConfig.codecraftModel || "codecraft-default";

        // Enforce Free-Only Safety Guard if active
        assertFreeModelAllowed(model);

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
                const errText = sanitizeErrorMessage(errRawText.slice(0, 300));

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
