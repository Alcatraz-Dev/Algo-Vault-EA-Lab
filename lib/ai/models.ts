import { AIModel, AIModelPricing } from "./types";
import { AIConfig } from "./config";

export type { AIModelPricing };

// Hard-coded free catalog for providers whose model ids are stable and whose
// discovery endpoint is not required for a safe fallback.
//
// OpenRouter is deliberately absent: its catalog changes frequently and five of
// the six ids that used to live here disappeared from the live API. OpenRouter
// models are discovered at runtime by OpenRouterProvider.getModels().
export const KNOWN_FREE_MODELS: AIModel[] = [
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

/** Parse a provider price without ever treating an absent value as zero. */
function parsePrice(value: string | number | undefined): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) && value >= 0 ? value : null;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
    return null;
}

export function isModelConfirmedFree(modelId: string, pricing?: AIModelPricing): boolean {
    if (!modelId) return false;

    // Authoritative pricing wins, absolutely. If the provider reported a price
    // block, only an all-zero price is free: an id ending in `:free`/`-free`
    // can never override paid, malformed, or non-zero pricing. A per-request
    // fee is part of the price too.
    if (pricing) {
        const promptCost = parsePrice(pricing.prompt);
        const completionCost = parsePrice(pricing.completion);
        const requestCost = pricing.request === undefined ? 0 : parsePrice(pricing.request);

        return promptCost === 0 && completionCost === 0 && requestCost === 0;
    }

    // No pricing at all is NOT proof of free. The only remaining confirmation
    // is an explicitly reviewed entry in KNOWN_FREE_MODELS (a closed, static
    // list — never a name-pattern inference).
    const lower = modelId.toLowerCase();
    const found = KNOWN_FREE_MODELS.find((m) => m.id.toLowerCase() === lower);
    return Boolean(found?.confirmedFree);
}

/**
 * Whether a provider catalog entry is verified free.
 *
 * A provider may assert `confirmedFree` when it verified that status itself
 * (Bytez probes every id before listing it; OpenCode only exposes free-tier
 * models). That assertion is only trusted when the catalog entry actually
 * carries it; an id suffix is never consulted. When pricing is present it is
 * authoritative and the assertion is ignored in favour of the price check.
 */
export function isVerifiedFreeModel(
    model: Pick<AIModel, "id" | "confirmedFree"> & { pricing?: AIModelPricing },
): boolean {
    if (model.pricing) return isModelConfirmedFree(model.id, model.pricing);
    return model.confirmedFree === true;
}

/** Shared refusal used by both free-only guards. */
function paidModelError(modelId: string, providerId?: string): Error {
    const key = providerId?.trim().toLowerCase() ?? "";
    const base = `[AI Cost Protection] Paid AI model "${modelId}" blocked by free-only policy.`;
    const envVar = key ? PROVIDER_METERED_ENV[key] : undefined;
    return new Error(envVar ? `${base} Set ${envVar}=true to allow metered models for ${key} only.` : base);
}

/**
 * Assert that a resolved provider catalog entry may be served under the
 * current cost policy. Used where the provider's own discovery has already
 * established free status (pricing or an explicit verified assertion).
 */
export function assertVerifiedFreeModel(
    model: Pick<AIModel, "id" | "confirmedFree"> & { pricing?: AIModelPricing },
    providerId?: string,
): void {
    if (!AIConfig.freeOnly) return;
    if (isVerifiedFreeModel(model)) return;

    const key = providerId?.trim().toLowerCase() ?? "";
    if (key && isProviderMeteredAllowed(key)) return;

    throw paidModelError(model.id, providerId);
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
 * Whether a provider is even capable of putting the account on the meter.
 *
 * Derived from the EXISTING cost policy rather than from a new, parallel one:
 *  - AI_FREE_ONLY on (the default) and no provider-scoped metered opt-in
 *    -> that provider can only ever serve confirmed-free models, so its traffic
 *       is free by construction and an accounting outage is not a money risk.
 *  - AI_FREE_ONLY off -> metered models are permitted, so it is a money risk.
 *  - A provider-scoped metered opt-in (CODECRAFT_ALLOW_METERED=true) -> metered
 *    models are permitted for that provider only, so it is a money risk.
 *
 * This is what lets the budget guard fail closed for paid traffic without
 * taking down free traffic during a Firebase outage. It never widens what a
 * provider may do; it only reports the risk the existing policy already allows.
 */
export function providerHasMeteredRisk(providerId: string): boolean {
    if (!AIConfig.freeOnly) return true;
    return isProviderMeteredAllowed(providerId);
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

    throw paidModelError(modelId, providerId);
}
