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

export class GeminiProvider implements AIProvider {
    readonly id = "gemini";
    readonly name = "Google Gemini AI";

    isAvailable(): boolean {
        return Boolean(AIConfig.geminiApiKey && AIConfig.geminiApiKey.trim());
    }

    async getModels(): Promise<AIModel[]> {
        return [
            {
                id: "gemini-1.5-flash",
                name: "Gemini 1.5 Flash",
                provider: "gemini",
                free: true,
                confirmedFree: true,
                enabled: true,
                capabilities: { text: true, structuredOutput: true },
            },
        ];
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        if (!this.isAvailable()) {
            throw {
                code: "PROVIDER_UNAVAILABLE",
                provider: this.id,
                message: "Gemini API key is not configured.",
            };
        }

        const model = request.model || "gemini-1.5-flash";
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

        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${AIConfig.geminiApiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: fullPrompt }] }],
                    }),
                    signal: controller.signal,
                }
            ).finally(() => clearTimeout(timer));

            if (!res.ok) {
                const status = res.status;
                const errText = await res.text().catch(() => "");
                throw { code: "UNKNOWN_ERROR", provider: this.id, message: `Gemini HTTP ${status}: ${errText}`, status };
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
            if (err && typeof err === "object" && "code" in err) throw err;
            const isAbort = err instanceof Error && err.name === "AbortError";
            throw {
                code: isAbort ? "TIMEOUT" : "UNKNOWN_ERROR",
                provider: this.id,
                message: isAbort ? `Gemini request timed out` : String(err),
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
