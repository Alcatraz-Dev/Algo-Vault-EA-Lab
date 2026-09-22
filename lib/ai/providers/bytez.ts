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
import { assertFreeModelAllowed } from "../models";
import { normalizeNarrative, normalizeSummary } from "../validate";
import { extractFinishReason, isTruncated, isAbortError } from "../finish";

/**
 * Bytez model API provider (https://api.bytez.com).
 *
 * Bytez is a CREDIT-BASED inference API — it is NOT free. Model availability
 * and pricing come exclusively from dynamic discovery:
 *
 *   GET /models/v2/list/tasks                      → { error, output: string[] }
 *   GET /models/v2/list/models?task=<task>          → { error, output: [{ meter, meterPrice, modelId, params, ramRequired, task }] }
 *
 * Libre/free-eligible models are the only ones whose `meter` ends in `-free`
 * (e.g. `sm-free`). Under `AI_FREE_ONLY=true` (the default) every other model
 * is blocked by the free-only guard — never label a Bytez model "free" without
 * checking its `meter`.
 *
 * Auth: the `Authorization` header is the RAW key — no "Bearer" prefix.
 * Errors: 401 → INVALID_API_KEY, 402 → QUOTA_EXCEEDED (insufficient credits),
 * 429 → RATE_LIMITED.
 */

const BYTEZ_BASE_URL = "https://api.bytez.com";
const MODEL_LIST_TTL_MS = 10 * 60 * 1000; // re-discover catalog every 10 min

interface BytezModelInfo {
    modelId: string;
    meter?: string;
    meterPrice?: unknown;
    params?: unknown;
    ramRequired?: unknown;
    task?: string;
}

export class BytezProvider implements AIProvider {
    readonly id = "bytez";
    readonly name = "Bytez (Credits)";

    private cachedModels: AIModel[] | null = null;
    private cachedAt = 0;

    isAvailable(): boolean {
        return Boolean(AIConfig.bytezApiKey && AIConfig.bytezApiKey.trim());
    }

    private authHeaders(): Record<string, string> {
        return { Authorization: AIConfig.bytezApiKey };
    }

    private async fetch<T>(path: string): Promise<T | null> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
            const res = await fetch(`${BYTEZ_BASE_URL}${path}`, {
                headers: this.authHeaders(),
                signal: controller.signal,
                cache: "no-store",
            });
            if (!res.ok) return null;
            return (await res.json()) as T;
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    /** Discovers the live model catalog from Bytez — never a hardcoded list. */
    async getModels(): Promise<AIModel[]> {
        if (!this.isAvailable()) return [];
        if (this.cachedModels && Date.now() - this.cachedAt < MODEL_LIST_TTL_MS) {
            return this.cachedModels;
        }

        const models: AIModel[] = [];

        // 1. Discover the task catalog, prefer the chat task.
        const tasksBody = await this.fetch<{ error?: unknown; output?: string[] }>("/models/v2/list/tasks");
        const tasks = Array.isArray(tasksBody?.output) ? tasksBody.output : [];
        const chatTask = tasks.find((t) => t.toLowerCase().includes("chat")) ?? tasks[0];

        // 2. Discover models for the chat task (falling back to no task filter).
        if (chatTask) {
            const modelsBody = await this.fetch<{ error?: unknown; output?: BytezModelInfo[] }>(
                `/models/v2/list/models?task=${encodeURIComponent(chatTask)}`
            );
            if (Array.isArray(modelsBody?.output)) {
                for (const item of modelsBody.output) {
                    if (!item || typeof item.modelId !== "string") continue;
                    // Free-eligibility is ONLY the `*-free` meter. Everything
                    // else (open/metered/closed) is paid on Bytez.
                    const meterFree = typeof item.meter === "string" && item.meter.endsWith("-free");
                    const free = meterFree;
                    models.push({
                        id: item.modelId,
                        name: item.modelId,
                        provider: this.id,
                        free,
                        confirmedFree: free,
                        enabled: true,
                        capabilities: { text: true, structuredOutput: true },
                    });
                }
            }
        }

        this.cachedModels = models;
        this.cachedAt = Date.now();
        return models;
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        if (!this.isAvailable()) {
            throw {
                code: "PROVIDER_UNAVAILABLE",
                provider: this.id,
                message: "Bytez API key is not configured.",
            };
        }

        // Resolve the effective model from Bytez's own live catalog.
        const models = await this.getModels();
        const freeModels = models.filter((m) => m.confirmedFree && m.enabled);

        // Explicit model: enforce the canonical free-only guard, then only pass
        // a model that Bytez actually exposes; otherwise fall back to a
        // discovered free model rather than sending a foreign model id.
        if (request.model) {
            assertFreeModelAllowed(request.model);
        }

        let model: string;
        if (request.model) {
            const match = models.find((m) => m.id.toLowerCase() === request.model!.toLowerCase());
            model = match ? match.id : freeModels[0]?.id ?? "";
        } else if (!AIConfig.freeOnly) {
            // A paid budget is allowed: default to Bytez's first enabled
            // discovered model so the credit-based capacity is usable, not
            // just the `*-free` subset.
            model = models.find((m) => m.enabled)?.id ?? "";
        } else {
            model = freeModels[0]?.id ?? "";
        }

        if (!model) {
            throw {
                code: "MODEL_UNAVAILABLE",
                provider: this.id,
                message: "Bytez returned no usable model. Check that BYTEZ_API_KEY is valid and the discovery endpoint is reachable.",
            };
        }

        // Defense-in-depth: the canonical free-only guard on the resolved model
        // (redundant when it came from `freeModels`, required for the paid path).
        assertFreeModelAllowed(model);

        const messages: Array<{ role: string; content: string }> = [];
        if (request.systemPrompt) {
            messages.push({ role: "system", content: request.systemPrompt });
        }
        messages.push(...request.messages);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AIConfig.timeoutMs);

        try {
            const res = await fetch(`${BYTEZ_BASE_URL}/models/v2/openai/v1/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...this.authHeaders(),
                },
                body: JSON.stringify({
                    model,
                    messages,
                    max_completion_tokens: request.maxTokens ?? 4000,
                    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
                }),
                signal: controller.signal,
                cache: "no-store",
            });

            if (!res.ok) {
                const status = res.status;
                const errText = await res.text().catch(() => "");

                if (status === 401) {
                    throw { code: "INVALID_API_KEY", provider: this.id, message: "Bytez rejected the API key (401).", status };
                }
                if (status === 402) {
                    throw { code: "QUOTA_EXCEEDED", provider: this.id, message: "Bytez insufficient credits (402).", status };
                }
                if (status === 429) {
                    throw { code: "RATE_LIMITED", provider: this.id, message: "Bytez rate limit reached (429).", status };
                }
                if (status === 404) {
                    throw { code: "MODEL_UNAVAILABLE", provider: this.id, message: `Bytez model "${model}" not found (404): ${errText}`, status };
                }
                throw { code: "UNKNOWN_ERROR", provider: this.id, message: `Bytez HTTP ${status}: ${errText}`, status };
            }

            const data = (await res.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
            };

            const content = data.choices?.[0]?.message?.content || "";
            if (!content.trim()) {
                throw { code: "UNKNOWN_ERROR", provider: this.id, message: "Bytez returned empty content." };
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
                message: isAbort ? `Bytez request timed out after ${AIConfig.timeoutMs}ms.` : String(err),
            };
        } finally {
            clearTimeout(timer);
        }
    }

    // Legacy interface helpers (Strategy Lab & Copilot).
    async generateText(prompt: string, systemPrompt?: string): Promise<string> {
        const res = await this.chat({ messages: [{ role: "user", content: prompt }], systemPrompt });
        return res.content;
    }

    async chatCompletion(messages: ChatMessageInput[], systemPrompt?: string): Promise<string> {
        const res = await this.chat({ messages, systemPrompt });
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