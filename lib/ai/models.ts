import { AIModel } from "./types";
import { AIConfig } from "./config";

// Known catalog of free cloud models across OpenRouter, OpenCode, and B.AI
export const KNOWN_FREE_MODELS: AIModel[] = [
    {
        id: "openrouter/free",
        name: "OpenRouter Free Router Auto",
        provider: "openrouter",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    {
        id: "google/gemma-2-9b-it:free",
        name: "Google Gemma 2 9B (Free)",
        provider: "openrouter",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    {
        id: "meta-llama/llama-3.3-70b-instruct:free",
        name: "Meta Llama 3.3 70B Instruct (Free)",
        provider: "openrouter",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    {
        id: "deepseek/deepseek-r1:free",
        name: "DeepSeek R1 (Free)",
        provider: "openrouter",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    {
        id: "qwen/qwen-2.5-coder-32b-instruct:free",
        name: "Qwen 2.5 Coder 32B (Free)",
        provider: "openrouter",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    {
        id: "mistralai/mistral-7b-instruct:free",
        name: "Mistral 7B Instruct (Free)",
        provider: "openrouter",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    // OpenCode Free Models
    {
        id: "mimo-v2.5-free",
        name: "OpenCode Mimo v2.5 (Free)",
        provider: "opencode",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    {
        id: "deepseek-v4-flash-free",
        name: "OpenCode DeepSeek v4 Flash (Free)",
        provider: "opencode",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    // B.AI Free Models
    {
        id: "bai-free-v1",
        name: "B.AI Free LLM v1",
        provider: "bai",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
];

export function isModelConfirmedFree(
    modelId: string,
    pricing?: { prompt?: string | number; completion?: string | number }
): boolean {
    if (!modelId) return false;

    // Check pricing metadata if provided
    if (pricing) {
        const promptCost = typeof pricing.prompt === "number" ? pricing.prompt : parseFloat(pricing.prompt || "1");
        const completionCost = typeof pricing.completion === "number" ? pricing.completion : parseFloat(pricing.completion || "1");

        if (promptCost === 0 && completionCost === 0) {
            return true;
        }
    }

    // Check explicit free suffix / prefix markers
    const lower = modelId.toLowerCase();
    if (
        lower.endsWith(":free") ||
        lower.endsWith("-free") ||
        lower.includes("/free") ||
        lower === "openrouter/free"
    ) {
        return true;
    }

    // Check known registered free models
    const found = KNOWN_FREE_MODELS.find((m) => m.id.toLowerCase() === lower);
    if (found && found.confirmedFree) {
        return true;
    }

    // Strict rule: Unknown pricing must be treated as NOT FREE.
    return false;
}

export function assertFreeModelAllowed(modelId: string, pricing?: { prompt?: string | number; completion?: string | number }): void {
    if (AIConfig.freeOnly && !isModelConfirmedFree(modelId, pricing)) {
        throw new Error(`[AI Cost Protection] Paid AI model "${modelId}" blocked by free-only policy.`);
    }
}
