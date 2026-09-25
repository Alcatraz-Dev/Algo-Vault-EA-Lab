import { AIModel, AIModelPricing } from "./types";
import { AIConfig } from "./config";

export type { AIModelPricing };

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
    // OpenCode Zen Free Models (https://opencode.ai/docs/zen/)
    {
        id: "mimo-v2.5-free",
        name: "OpenCode Zen MiMo-V2.5 Free",
        provider: "opencode",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    {
        id: "big-pickle",
        name: "OpenCode Zen Big Pickle (Free)",
        provider: "opencode",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    {
        id: "nemotron-3-ultra-free",
        name: "OpenCode Zen Nemotron 3 Ultra (Free)",
        provider: "opencode",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    {
        id: "ling-3.0-flash-fin-free",
        name: "OpenCode Zen Ling 3.0 Flash Fin (Free)",
        provider: "opencode",
        free: true,
        confirmedFree: true,
        enabled: true,
        capabilities: { text: true, structuredOutput: true },
    },
    // CodeCraft Models
    // NO hardcoded entry. A live GET /models returned 33 real ids (gpt-5.6-sol,
    // claude-opus-5, gemini-3.7-flash, deepseek-v4-flash-0731, …) and did NOT
    // contain "codecraft-default". Every one of them returns non-zero pricing,
    // so none of them is free. The catalog is discovered at runtime from the
    // provider's own /models response, and free/paid status is derived from
    // that response's pricing — never from the provider name. When the catalog
    // is unavailable there is deliberately no fallback model: the provider
    // fails with a configuration error instead of sending a fabricated id.
    // CodeCraft's allowance is a per-account matter on CodeCraft's side, NOT a
    // per-user AlgoVault quota; no quota number is modelled here.
    // B.AI models
    // NOTE: B.AI's catalog currently contains NO free models, so no B.AI entries
    // are registered here. Under AI_FREE_ONLY=true the B.AI provider is skipped
    // entirely (see BAIProvider.isAvailable).
];

export function isModelConfirmedFree(modelId: string, pricing?: AIModelPricing): boolean {
    if (!modelId) return false;

    // Check pricing metadata if provided
    if (pricing) {
        const promptCost = typeof pricing.prompt === "number" ? pricing.prompt : parseFloat(pricing.prompt || "1");
        const completionCost = typeof pricing.completion === "number" ? pricing.completion : parseFloat(pricing.completion || "1");

        if (promptCost === 0 && completionCost === 0) {
            return true;
        }
    }

    // Check explicit free suffix / prefix / provider markers.
    // NOTE: there is deliberately NO provider-name rule here. An earlier
    // `lower.startsWith("codecraft")` branch claimed free access purely from
    // the provider name; a live /models check proved every real CodeCraft model
    // is metered, so that inference was wrong and has been removed. Free status
    // now comes only from zero pricing or an explicit `-free`/`:free` marker.
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

/**
 * PER-PROVIDER metered opt-ins.
 *
 * A provider registered here may use its paid models while the global
 * AI_FREE_ONLY policy is on — but only when that provider's own server-side
 * flag is explicitly enabled. The registry is deliberately a closed list: a
 * provider that is not listed can never gain a metered allowance, and enabling
 * one provider here never relaxes the policy for any other provider.
 *
 * This is the only extension point to the existing cost policy. It is not a
 * parallel authorization system: it is consumed by assertFreeModelAllowed()
 * below, and it never bypasses the guard for any provider other than the one
 * explicitly named.
 */
const PROVIDER_METERED_OPT_IN: Record<string, () => boolean> = {
    // CodeCraft bills per token. All 33 live catalog models return non-zero
    // pricing, so without this explicit opt-in the free-only policy blocks
    // every one of them. Off by default.
    codecraft: () => AIConfig.codecraftAllowMetered,
};

/**
 * Server-side env var that enables a provider's metered opt-in. The naming
 * convention is `<PROVIDER>_ALLOW_METERED`, declared here so the flag a
 * provider is actually gated by is auditable in one place.
 */
const PROVIDER_METERED_ENV: Record<string, string> = {
    codecraft: "CODECRAFT_ALLOW_METERED",
};

/** True only when THIS provider has explicitly opted into metered models. */
export function isProviderMeteredAllowed(providerId: string): boolean {
    if (!providerId) return false;
    const optIn = PROVIDER_METERED_OPT_IN[providerId.trim().toLowerCase()];
    return optIn ? optIn() : false;
}

/**
 * Global cost guard. Throws when a metered model is requested while
 * AI_FREE_ONLY is on, unless `providerId` names a provider that has explicitly
 * opted into metered usage.
 *
 * `providerId` is optional so every existing call site keeps its exact
 * behaviour; a call without it is strictly as strict as before.
 */
export function assertFreeModelAllowed(modelId: string, pricing?: AIModelPricing, providerId?: string): void {
    if (!AIConfig.freeOnly) return;
    if (isModelConfirmedFree(modelId, pricing)) return;

    const key = providerId?.trim().toLowerCase() ?? "";
    if (key && isProviderMeteredAllowed(key)) return;

    const base = `[AI Cost Protection] Paid AI model "${modelId}" blocked by free-only policy.`;
    const envVar = key ? PROVIDER_METERED_ENV[key] : undefined;
    throw new Error(envVar ? `${base} Set ${envVar}=true to allow metered models for ${key} only.` : base);
}
