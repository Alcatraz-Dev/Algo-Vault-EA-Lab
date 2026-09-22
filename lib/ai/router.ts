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
} from "./types";
import { AIConfig } from "./config";
import { assertFreeModelAllowed, KNOWN_FREE_MODELS } from "./models";
import { isAbortError } from "./finish";
import { OpenRouterProvider } from "./providers/openrouter";
import { OpenCodeProvider } from "./providers/opencode";
import { BAIProvider } from "./providers/bai";
import { GeminiProvider } from "./providers/gemini";
import { BytezProvider } from "./providers/bytez";
import { LocalStrategyAIProvider } from "./local";

export class AIRouter {
    private providers: Map<string, AIProvider> = new Map();
    private localProvider: LocalStrategyAIProvider;

    constructor() {
        this.localProvider = new LocalStrategyAIProvider();

        // Register cloud providers
        const gemini = new GeminiProvider();
        const openrouter = new OpenRouterProvider();
        const opencode = new OpenCodeProvider();
        const bai = new BAIProvider();
        const bytez = new BytezProvider();

        this.providers.set(gemini.id, gemini);
        this.providers.set(openrouter.id, openrouter);
        this.providers.set(opencode.id, opencode);
        this.providers.set(bai.id, bai);
        this.providers.set(bytez.id, bytez);
    }

    getProvider(id: string): AIProvider | undefined {
        return this.providers.get(id.toLowerCase());
    }

    async getAvailableProviders(): Promise<AIProvider[]> {
        return this.getAvailableCloudProviders();
    }

    private async getAvailableCloudProviders(): Promise<AIProvider[]> {
        const result: AIProvider[] = [];
        const providers = [
            this.providers.get("gemini"),
            this.providers.get("openrouter"),
            this.providers.get("opencode"),
            this.providers.get("bai"),
            this.providers.get("bytez"),
        ];

        for (const provider of providers) {
            if (provider && await provider.isAvailable()) {
                result.push(provider);
            }
        }
        return result;
    }

    async getAllModels(): Promise<AIModel[]> {
        const models: AIModel[] = [];
        for (const provider of this.providers.values()) {
            try {
                const list = await provider.getModels();
                models.push(...list);
            } catch {
                // Ignore provider error during model discovery
            }
        }
        return models.length > 0 ? models : KNOWN_FREE_MODELS;
    }

    /**
     * Executes chat request with automatic provider fallback
     * (Gemini -> OpenRouter -> OpenCode -> B.AI -> Bytez -> Local Heuristic).
     * Bytez participates whenever BYTEZ_API_KEY is configured: under
     * AI_FREE_ONLY=true (the default) only its `*-free` models are served, and
     * when a paid budget is allowed it may use its full discovered catalog.
     * Each provider resolves the effective model against its own catalog, so a
     * quota failure on one provider no longer cascades into the next provider
     * being handed an unsupported model.
     */
    async chat(request: AIChatRequest): Promise<AIResponse> {
        // Enforce hard free-only check if model specified
        if (request.model) {
            assertFreeModelAllowed(request.model);
        }

        const candidateOrder = await this.getAvailableCloudProviders();

        let attempts = 0;
        const maxAttempts = Math.min(AIConfig.maxAttempts, candidateOrder.length);
        const lastErrors: AIProviderError[] = [];

        for (const provider of candidateOrder) {
            if (attempts >= maxAttempts) break;
            attempts++;

            try {
                console.log(`[AI] Attempt ${attempts}/${maxAttempts}: provider=${provider.id}`);
                const res = await provider.chat(request);
                return res;
            } catch (err: unknown) {
                const isAbort = isAbortError(err);
                const provErr = isAbort
                    ? { code: "TIMEOUT" as const, provider: provider.id, message: `${provider.id} request timed out after ${AIConfig.timeoutMs}ms.` }
                    : (err && typeof err === "object" && "code" in err)
                        ? (err as AIProviderError)
                        : { code: "UNKNOWN_ERROR" as const, provider: provider.id, message: String(err) };

                console.warn(`[AI] Fallback triggered: provider=${provider.id} error=${provErr.code} message=${provErr.message}`);
                lastErrors.push(provErr);
            }
        }

        // If no cloud free providers succeeded or were available, check local fallback strategy provider
        console.log("[AI] Utilizing local heuristic free AI provider fallback.");
        const fallback = await this.localProvider.chat(request);
        return lastErrors.length > 0 ? { ...fallback, fallbackErrors: lastErrors } : fallback;
    }

    async describeStrategy(input: StrategyNarrativeInput): Promise<StrategyNarrative> {
        const candidateOrder = await this.getAvailableCloudProviders();

        for (const provider of candidateOrder) {
            try {
                return await provider.describeStrategy(input);
            } catch (err) {
                console.warn(`[AI] describeStrategy fallback from ${provider.id}:`, err);
            }
        }

        return this.localProvider.describeStrategy(input);
    }

    async summarizeAnalysis(input: AnalysisSummaryInput): Promise<AnalysisSummary> {
        const candidateOrder = await this.getAvailableCloudProviders();

        for (const provider of candidateOrder) {
            try {
                return await provider.summarizeAnalysis(input);
            } catch (err) {
                console.warn(`[AI] summarizeAnalysis fallback from ${provider.id}:`, err);
            }
        }

        return this.localProvider.summarizeAnalysis(input);
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
}

export const defaultRouter = new AIRouter();
