import {
    AIProvider,
    AIChatRequest,
    AIResponse,
    AIModel,
    StrategyNarrative,
    StrategyNarrativeInput,
    AnalysisSummary,
    AnalysisSummaryInput,
} from "./types";
import { normalizeNarrative, normalizeSummary, hasOwn } from "./validate";

interface ChatMessage {
    role: "system" | "user";
    content: string;
}

export class OpenAICompatibleProvider implements AIProvider {
    readonly id = "openai-compatible";
    readonly name = "OpenAI-compatible";

    isAvailable(): boolean {
        return Boolean(process.env.AI_API_KEY);
    }

    available(): boolean {
        return this.isAvailable();
    }

    async getModels(): Promise<AIModel[]> {
        return [
            {
                id: this.model,
                name: this.model,
                provider: this.id,
                free: false,
                confirmedFree: false,
                enabled: this.isAvailable(),
            },
        ];
    }

    async chat(request: AIChatRequest): Promise<AIResponse> {
        const key = process.env.AI_API_KEY;
        if (!key) {
            throw { code: "PROVIDER_UNAVAILABLE", provider: this.id, message: "AI_API_KEY not configured." };
        }

        const messages: Array<{ role: string; content: string }> = [];
        if (request.systemPrompt) {
            messages.push({ role: "system", content: request.systemPrompt });
        }
        messages.push(...request.messages);

        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
                model: request.model || this.model,
                messages,
                temperature: request.temperature ?? 0.4,
                max_tokens: request.maxTokens ?? 4000,
            }),
        });

        if (!res.ok) {
            throw { code: "UNKNOWN_ERROR", provider: this.id, message: `HTTP ${res.status}` };
        }

        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content || "";

        return {
            success: true,
            provider: this.id,
            model: request.model || this.model,
            content,
            raw: data,
        };
    }

    private get baseUrl(): string {
        return (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    }

    private get model(): string {
        return process.env.AI_MODEL || "gpt-4o-mini";
    }

    private async complete(
        system: string,
        user: string
    ): Promise<string> {
        const res = await this.chat({
            messages: [{ role: "user", content: user }],
            systemPrompt: system,
        });
        return res.content;
    }

    private stripCodeFences(text: string): string {
        return text
            .trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "");
    }

    private safeParseJson<T>(text: string, keys: string[]): Partial<T> {
        const cleaned = this.stripCodeFences(text);
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        const candidate = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        const out: Partial<T> = {};
        for (const key of keys) {
            if (hasOwn(parsed, key)) (out as Record<string, unknown>)[key] = parsed[key];
        }
        return out;
    }

    async describeStrategy(input: StrategyNarrativeInput): Promise<StrategyNarrative> {
        const system =
            "You are a quantitative trading strategy researcher. You write concise, professional, jargon-light narratives. " +
            "You NEVER fabricate numbers: use only the statistics provided. You never promise returns. " +
            "Output a single JSON object with exactly these string keys: name, description, why, risks, bestRegimes, weakRegimes. " +
            "Do not include markdown or code fences.";

        const user = `Produce a strategy narrative for this data.
Asset: ${input.asset}
Analysis window: ${input.period}
Setup timeframe: ${input.timeframe}
Hierarchy: macro ${input.hierarchy.macro}, structure ${input.hierarchy.structure}, setup ${input.hierarchy.setup}, entry ${input.hierarchy.entry}
Direction: ${input.direction}
Pattern: ${input.patternName}
Conditions: ${input.conditions.join("; ")}
Market regime: ${input.regime}
Volatility: ${input.volatility}
Best session: ${input.bestSession}
Best day: ${input.bestDay}
Real statistics (must be echoed exactly): occurrences=${input.stats.occurrences ?? "n/a"}, winRate=${input.stats.winRate ?? "n/a"}, averageR=${input.stats.averageR ?? "n/a"}, maxDrawdownPct=${input.stats.maxDrawdownPct ?? "n/a"}, profitFactor=${input.stats.profitFactor ?? "n/a"}, maxLossStreak=${input.stats.maxLossStreak ?? "n/a"}
Name must be "XAUUSD Long — <pattern>" style, under 60 chars.`;

        try {
            const content = await this.complete(system, user);
            const parsed = this.safeParseJson<StrategyNarrative>(content, [
                "name",
                "description",
                "why",
                "risks",
                "bestRegimes",
                "weakRegimes",
            ]);
            if (!parsed.name && !parsed.why) throw new Error("AI response did not parse.");
            parsed.generatedBy = this.id;
            return normalizeNarrative(parsed, {
                name: `${input.asset} ${input.direction === "long" ? "Long" : "Short"} — ${input.patternName}`,
                description: "",
                why: "",
                risks: "",
                bestRegimes: input.regime,
                weakRegimes: "",
                generatedBy: this.id,
            });
        } catch (err) {
            console.error("[ai/openai] describeStrategy failed:", err instanceof Error ? err.message : err);
            throw err;
        }
    }

    async summarizeAnalysis(input: AnalysisSummaryInput): Promise<AnalysisSummary> {
        const system =
            "You are a market analyst. Provide a thorough, detailed explanation using only provided facts. Output JSON: {\"summary\": \"...\"}.";
        const user = `Asset ${input.asset} ${input.timeframe}: trend=${input.trend}, volatility=${input.volatility}, regime=${input.regime}, bestSession=${input.bestSession}, bestDay=${input.bestDay}, strongestSetup=${input.strongestSetup}, averageR=${input.averageR ?? "n/a"}.`;

        try {
            const content = await this.complete(system, user);
            const parsed = this.safeParseJson<{ summary: string }>(content, ["summary"]);
            return normalizeSummary(parsed, `${input.asset} shows ${input.trend} on ${input.timeframe}.`);
        } catch (err) {
            console.error("[ai/openai] summarizeAnalysis failed:", err instanceof Error ? err.message : err);
            throw err;
        }
    }
}