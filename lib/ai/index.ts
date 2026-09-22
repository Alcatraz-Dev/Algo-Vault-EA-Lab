import {
    AIProvider,
    StrategyNarrative,
    StrategyNarrativeInput,
    AnalysisSummary,
    AnalysisSummaryInput,
    ChatMessageInput,
} from "./types";
import { defaultRouter } from "./router";
import { ai } from "./client";

export * from "./types";
export * from "./config";
export * from "./models";
export * from "./router";
export * from "./client";

export function getAIProvider(): AIProvider {
    return defaultRouter.getProvider("gemini") || defaultRouter.getProvider("openrouter") || defaultRouter.getProvider("opencode") || defaultRouter.getProvider("bai") || defaultRouter.getProvider("bytez")!;
}

export function currentProviderInfo(): { id: string; name: string; usingExternal: boolean } {
    return {
        id: "free-ai-gateway",
        name: "Multi-Provider Free AI Gateway",
        usingExternal: true,
    };
}

export async function describeStrategyWithFallback(input: StrategyNarrativeInput): Promise<StrategyNarrative> {
    return ai.describeStrategy(input);
}

export async function summarizeAnalysisWithFallback(input: AnalysisSummaryInput): Promise<AnalysisSummary> {
    return ai.summarizeAnalysis(input);
}

export async function generateTextWithFallback(
    prompt: string,
    systemPrompt?: string,
    fallbackText: string = ""
): Promise<string> {
    try {
        const result = await ai.generateText(prompt, systemPrompt);
        return result || fallbackText;
    } catch (err) {
        console.warn("[AI Gateway] generateText error:", err);
        return fallbackText;
    }
}

export async function chatCompletionWithFallback(
    messages: ChatMessageInput[],
    systemPrompt?: string,
    fallbackText: string = ""
): Promise<string> {
    try {
        const result = await ai.chatCompletion(messages, systemPrompt);
        return result || fallbackText;
    } catch (err) {
        console.warn("[AI Gateway] chatCompletion error:", err);
        return fallbackText;
    }
}