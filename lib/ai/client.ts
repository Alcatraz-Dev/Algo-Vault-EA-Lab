import { defaultRouter } from "./router";
import { AIChatRequest, AIResponse, StrategyNarrativeInput, StrategyNarrative, AnalysisSummaryInput, AnalysisSummary, ChatMessageInput } from "./types";

export const ai = {
    /**
     * Central chat completion via Free Multi-Provider AI Gateway
     */
    chat(request: AIChatRequest): Promise<AIResponse> {
        return defaultRouter.chat(request);
    },

    /**
     * Central text generation via Free Multi-Provider AI Gateway
     */
    generateText(prompt: string, systemPrompt?: string): Promise<string> {
        return defaultRouter.generateText(prompt, systemPrompt);
    },

    /**
     * Multi-turn chat completion
     */
    chatCompletion(messages: ChatMessageInput[], systemPrompt?: string): Promise<string> {
        return defaultRouter.chatCompletion(messages, systemPrompt);
    },

    /**
     * Central structured JSON response generation
     */
    generateStructured<T>(prompt: string, schemaDescription?: string, systemPrompt?: string): Promise<T> {
        return defaultRouter.generateStructured<T>(prompt, schemaDescription, systemPrompt);
    },

    /**
     * Strategy narrative generation (Strategy Lab)
     */
    describeStrategy(input: StrategyNarrativeInput): Promise<StrategyNarrative> {
        return defaultRouter.describeStrategy(input);
    },

    /**
     * Market summary generation
     */
    summarizeAnalysis(input: AnalysisSummaryInput): Promise<AnalysisSummary> {
        return defaultRouter.summarizeAnalysis(input);
    },
};

export default ai;
