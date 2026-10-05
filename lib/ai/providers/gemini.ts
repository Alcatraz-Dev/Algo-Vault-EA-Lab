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
import { isAbortError } from "../finish";

/**
 * Free-tier eligible model ids. Google's catalog drifts (models/gemini-2.5-
 * flash can be quota-retired while gemini-flash-latest keeps working), so the
 * live catalog is preferred and this list is only the cold-cache fallback.
 */
const FALLBACK_MODEL_IDS = [
    "gemini-flash-latest",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
];

/** Modality-specific ids that accept generateContent but are not text/JSON. */
const NON_TEXT_MODEL = /tts|image|video|lyria|transcribe|robotics|embed|aqa|nano-banana|deep-research|computer-use|antigravity|preview-customtools/i;

function textModel(id: string, free: boolean): AIModel {
    return {
        id,
        name: id.replace(/^models\//, "").replace(/-/g, " "),
        provider: "gemini",
        free,
        confirmedFree: free,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    };
}

/** Higher is better: alias first, then newest stable flash, then the rest. */
function rankModel(id: string): number {
    if (id === "gemini-flash-latest") return 10_000;
    const version = id.match(/-(\d+)\.(\d+)-/);
    let score = version ? Number(version[1]) * 100 + Number(version[2]) : 0;
    if (id.includes("lite")) score -= 5;
    if (id.includes("preview")) score -= 1;
    if (id.includes("omni")) score -= 1;
    return score;
}

export class GeminiProvider implements AIProvider {
    readonly id = "gemini";
    readonly name = "Google Gemini AI";

    private catalogCache: { at: number; models: AIModel[] } | null = null;
    private static readonly CATALOG_TTL_MS = 60 * 60 * 1000;

    isAvailable(): boolean {
        return Boolean(AIConfig.geminiApiKey && AIConfig.geminiApiKey.trim());
    }

    /**
     * Model catalog from Google's own /v1beta/models endpoint (never a
     * hardcoded guess): only generateContent-capable text models, restricted
     * to free-tier class ids while AI_FREE_ONLY is on. Falls back to
     * FALLBACK_MODEL_IDS when the catalog cannot be read.
     */
    async getModels(): Promise<AIModel[]> {
        const now = Date.now();
        if (this.catalogCache && now - this.catalogCache.at < GeminiProvider.CATALOG_TTL_MS) {
            return this.catalogCache.models;
        }

        let models: AIModel[] = [];
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${AIConfig.geminiApiKey}`,
                { cache: "no-store", signal: AbortSignal.timeout(8_000) },
            );
            if (res.ok) {
                const data = (await res.json()) as { models?: Array<Record<string, unknown>> };
                models = (data.models ?? [])
                    .filter((m) => {
                        const name = typeof m.name === "string" ? m.name : "";
                        const methods = Array.isArray(m.supportedGenerationMethods)
                            ? (m.supportedGenerationMethods as string[])
                            : [];
                        return name.includes("/") && methods.includes("generateContent") && !NON_TEXT_MODEL.test(name);
                    })
                    .map((m) => {
                        const id = String(m.name).replace(/^models\//, "");
                        // Free-tier class: flash/lite/gemma aliases are the AI
                        // Studio free quota; pro/research ids are metered.
                        const free = /flash|lite|gemma|latest/i.test(id) && !/pro|research/i.test(id);
                        return { id, free };
                    })
                    .filter(({ id, free }) => (AIConfig.freeOnly ? free : true) || FALLBACK_MODEL_IDS.includes(id))
                    .map(({ id, free }) => textModel(id, free));
            }
        } catch {
            // Network failure → fall through to the known-good list.
        }

        if (models.length === 0) {
            models = FALLBACK_MODEL_IDS.map((id) => textModel(id, true));
        }
        // Deterministic best-first order: the unified router's model picker
        // scores ties by catalog order, so a retired/quota-exhausted id must
        // never outrank the alias Google keeps pointed at a working model.
        models.sort((a, b) => rankModel(b.id) - rankModel(a.id));
        this.catalogCache = { at: now, models };
        return models;
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        if (!this.isAvailable()) {
            throw {
                code: "PROVIDER_UNAVAILABLE",
                provider: this.id,
                message: "Gemini API key is not configured.",
            };
        }

        // Never fall back to AIConfig.defaultModel: it names the DEFAULT
        // GATEWAY provider's model (e.g. "openrouter/free") which this endpoint
        // rejects with a 404.
        const model = request.model || FALLBACK_MODEL_IDS[0];
        const promptParts: string[] = [];

        if (request.systemPrompt) {
            promptParts.push(`System Instruction: ${request.systemPrompt}`);
        }

        for (const msg of request.messages) {
            promptParts.push(`${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`);
        }

        const fullPrompt = promptParts.join("\n\n");

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AIConfig.timeoutMs);

        const generationConfig: Record<string, unknown> =
            request.responseFormat === "json_object"
                ? { responseMimeType: "application/json", temperature: 0.4 }
                : { temperature: 0.7 };

        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${AIConfig.geminiApiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: fullPrompt }] }],
                        generationConfig,
                    }),
                    signal: controller.signal,
                }
            ).finally(() => clearTimeout(timer));

            if (!res.ok) {
                const status = res.status;
                const errText = await res.text().catch(() => "");
                // Mapped codes feed the fabric circuit breaker: a rate-limited
                // provider backs off, an invalid key is never retried, and a
                // retired model id does not poison reliability forever.
                const code =
                    status === 429
                        ? "RATE_LIMITED"
                        : status === 401 || status === 403
                          ? "INVALID_API_KEY"
                          : status === 404 || status === 400
                            ? "MODEL_UNAVAILABLE"
                            : "PROVIDER_UNAVAILABLE";
                throw { code, provider: this.id, message: `Gemini HTTP ${status}: ${errText.slice(0, 300)}`, status };
            }

            const data = await res.json();
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

            if (!content.trim()) {
                throw { code: "UNKNOWN_ERROR", provider: this.id, message: "Gemini returned empty response." };
            }

            return {
                success: true,
                provider: this.id,
                model,
                content,
                raw: data,
            };
        } catch (err: unknown) {
            const isAbort = isAbortError(err);
            if (!isAbort && err && typeof err === "object" && "code" in err) throw err;
            throw {
                code: isAbort ? "TIMEOUT" : "UNKNOWN_ERROR",
                provider: this.id,
                message: isAbort ? `Gemini request timed out after ${AIConfig.timeoutMs}ms.` : String(err),
            };
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

    async generateStructured<T>(prompt: string, schemaDescription?: string, systemPrompt?: string): Promise<T> {
        const fullPrompt = `${prompt}\n\nReturn ONLY a single valid JSON object matching: ${schemaDescription || "{}"}`;
        const res = await this.chat({
            messages: [{ role: "user", content: fullPrompt }],
            systemPrompt: systemPrompt || "You are a JSON generator. Return ONLY raw valid JSON.",
            responseFormat: "json_object",
        });

        const cleaned = res.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        const candidate = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
        return JSON.parse(candidate) as T;
    }

    async describeStrategy(input: StrategyNarrativeInput): Promise<StrategyNarrative> {
        const prompt = `Produce strategy narrative for ${input.asset} (${input.direction}) on ${input.timeframe}, regime ${input.regime}. Stats: winRate=${input.stats.winRate}%, profitFactor=${input.stats.profitFactor}`;
        const schema = `{"name": "string", "description": "string", "why": "string", "risks": "string", "bestRegimes": "string", "weakRegimes": "string"}`;
        const data = await this.generateStructured<Partial<StrategyNarrative>>(prompt, schema);
        return {
            name: data.name || `${input.asset} ${input.patternName}`,
            description: data.description || `AI analyzed strategy on ${input.asset} ${input.timeframe}`,
            why: data.why || "High probability momentum alignment.",
            risks: data.risks || "Standard market risk.",
            bestRegimes: data.bestRegimes || input.regime,
            weakRegimes: data.weakRegimes || "High volatility market chop.",
            generatedBy: this.id,
        };
    }

    async summarizeAnalysis(input: AnalysisSummaryInput): Promise<AnalysisSummary> {
        const prompt = `Summarize analysis for ${input.asset} ${input.timeframe} (${input.regime}): trend=${input.trend}, volatility=${input.volatility}`;
        const schema = `{"summary": "string"}`;
        const data = await this.generateStructured<{ summary?: string }>(prompt, schema);
        return {
            summary: data.summary || `${input.asset} ${input.timeframe} analysis summary.`,
            generatedBy: this.id,
        };
    }
}
