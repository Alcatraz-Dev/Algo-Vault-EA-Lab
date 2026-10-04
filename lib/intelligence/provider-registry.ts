/**
 * Free LLM Provider Registry.
 *
 * External reference: https://github.com/mnfst/awesome-free-llm-apis — an
 * ecosystem catalog of free-tier LLM APIs. This registry deliberately does NOT
 * hardcode that README's model lists: model ids drift, tiers change and
 * availability is region-dependent. Instead the registry stores provider-level
 * metadata (capabilities, restrictions, privacy, commercial-use compatibility)
 * and lets each ADAPTER report its live model catalog at runtime (the legacy
 * gateway already does this via `AIProvider.getModels()`).
 *
 * Rules encoded here:
 *  - `verified` is true only when AlgoVault has an adapter wired AND the
 *    endpoint has actually been exercised in this deployment. Unverified
 *    providers are registered for metadata/roadmap purposes and never routed.
 *  - A provider is ROUTABLE only when: enabled + adapter present + credential
 *    configured (checked via env var NAME, never the value) + policy allows.
 *  - No API key value ever appears in this file or in anything derived from it.
 */

import type { AIProviderDescriptor } from "./types";

/**
 * Registry entry — descriptor plus routing metadata the fabric needs that the
 * generic descriptor type keeps optional.
 */
export interface RegistryEntry extends AIProviderDescriptor {
    /** True when an AlgoVault adapter exists and the endpoint was exercised. */
    verified: boolean;
    /** Env var that, when set, disables the provider (admin kill switch). */
    disabledEnvVar?: string;
    /** Whether this provider may serve paid traffic when budgets allow. */
    allowPaidUse?: boolean;
    /** Resolved at read time: is the configured credential env var present? */
    credentialsConfigured?: boolean;
}

const REGISTRY: RegistryEntry[] = [
    {
        id: "gemini",
        name: "Google AI Studio (Gemini)",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput", "vision", "longContext", "toolCalling"],
        models: ["gemini-2.5-flash", "gemini-2.5-pro"],
        apiKeyEnvVar: "GEMINI_API_KEY",
        freeTier: "Google AI Studio free tier",
        rateLimits: { requestsPerMinute: 15, requestsPerDay: 1500 },
        health: "unknown",
        costClass: "free",
        commercialUse: false,
        privacyPolicyUrl: "https://ai.google.dev/gemini-api/terms",
        regionRestrictions: "Not available in all regions (EEA/UK/CH restrictions on free tier).",
        enabled: true,
        priority: 1,
        verified: true,
        disabledEnvVar: "AI_PROVIDER_GEMINI_DISABLED",
    },
    {
        id: "openrouter",
        name: "OpenRouter (:free models)",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput", "vision", "toolCalling", "longContext"],
        models: [],
        apiKeyEnvVar: "OPENROUTER_API_KEY",
        freeTier: ":free-suffixed models",
        rateLimits: { requestsPerMinute: 20, requestsPerDay: 1000 },
        health: "unknown",
        costClass: "freemium",
        commercialUse: true,
        privacyPolicyUrl: "https://openrouter.ai/privacy",
        regionRestrictions: "None documented for free models.",
        enabled: true,
        priority: 2,
        verified: true,
        disabledEnvVar: "AI_PROVIDER_OPENROUTER_DISABLED",
    },
    {
        id: "groq",
        name: "Groq",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput", "toolCalling"],
        models: [],
        apiKeyEnvVar: "GROQ_API_KEY",
        freeTier: "Free developer tier, generous TPM",
        rateLimits: { requestsPerMinute: 30 },
        health: "unknown",
        costClass: "free",
        commercialUse: true,
        privacyPolicyUrl: "https://groq.com/privacy-policy/",
        regionRestrictions: "None documented.",
        enabled: true,
        priority: 3,
        verified: false,
        disabledEnvVar: "AI_PROVIDER_GROQ_DISABLED",
    },
    {
        id: "cerebras",
        name: "Cerebras Inference",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput", "toolCalling"],
        models: [],
        apiKeyEnvVar: "CEREBRAS_API_KEY",
        freeTier: "Free tier with very high token throughput",
        rateLimits: { requestsPerMinute: 30 },
        health: "unknown",
        costClass: "free",
        commercialUse: true,
        privacyPolicyUrl: "https://www.cerebras.ai/privacy-policy",
        regionRestrictions: "None documented.",
        enabled: true,
        priority: 4,
        verified: false,
        disabledEnvVar: "AI_PROVIDER_CEREBRAS_DISABLED",
    },
    {
        id: "mistral",
        name: "Mistral La Plateforme",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput", "toolCalling"],
        models: [],
        apiKeyEnvVar: "MISTRAL_API_KEY",
        freeTier: "Free experiment plan",
        rateLimits: { requestsPerMinute: 20 },
        health: "unknown",
        costClass: "freemium",
        commercialUse: false,
        privacyPolicyUrl: "https://legal.mistral.ai/terms/privacy-policy",
        regionRestrictions: "Free experiment plan requires opt-in to data training; EU-based.",
        enabled: true,
        priority: 5,
        verified: false,
        disabledEnvVar: "AI_PROVIDER_MISTRAL_DISABLED",
    },
    {
        id: "cohere",
        name: "Cohere (trial key)",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput", "toolCalling"],
        models: [],
        apiKeyEnvVar: "COHERE_API_KEY",
        freeTier: "Trial keys, rate-limited, production-unsafe",
        rateLimits: { requestsPerMinute: 5 },
        health: "unknown",
        costClass: "free",
        commercialUse: false,
        privacyPolicyUrl: "https://cohere.com/privacy",
        regionRestrictions: "Trial keys only; no commercial use.",
        enabled: false,
        priority: 6,
        verified: false,
        disabledEnvVar: "AI_PROVIDER_COHERE_DISABLED",
    },
    {
        id: "cloudflare",
        name: "Cloudflare Workers AI",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput"],
        models: [],
        apiKeyEnvVar: "CLOUDFLARE_AI_API_KEY",
        freeTier: "Daily neuron allocation",
        rateLimits: { requestsPerDay: 10000 },
        health: "unknown",
        costClass: "free",
        commercialUse: true,
        privacyPolicyUrl: "https://www.cloudflare.com/privacypolicy/",
        regionRestrictions: "Requires Cloudflare account id + gateway.",
        enabled: false,
        priority: 7,
        verified: false,
        disabledEnvVar: "AI_PROVIDER_CLOUDFLARE_DISABLED",
    },
    {
        id: "github-models",
        name: "GitHub Models",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput", "toolCalling"],
        models: [],
        apiKeyEnvVar: "GITHUB_MODELS_TOKEN",
        freeTier: "Free tier for GitHub accounts; rate-limited",
        rateLimits: { requestsPerMinute: 15, requestsPerDay: 150 },
        health: "unknown",
        costClass: "free",
        commercialUse: false,
        privacyPolicyUrl: "https://docs.github.com/en/site-policy/privacy-policies",
        regionRestrictions: "Previews only — not for production workloads.",
        enabled: false,
        priority: 8,
        verified: false,
        disabledEnvVar: "AI_PROVIDER_GITHUB_MODELS_DISABLED",
    },
    {
        id: "huggingface",
        name: "Hugging Face Inference (serverless)",
        type: "free_cloud",
        capabilities: ["text"],
        models: [],
        apiKeyEnvVar: "HF_TOKEN",
        freeTier: "Free monthly credits",
        rateLimits: { requestsPerMinute: 10 },
        health: "unknown",
        costClass: "freemium",
        commercialUse: false,
        privacyPolicyUrl: "https://huggingface.co/privacy",
        regionRestrictions: "Model-dependent; many models train on inputs.",
        enabled: false,
        priority: 9,
        verified: false,
        disabledEnvVar: "AI_PROVIDER_HUGGINGFACE_DISABLED",
    },
    {
        id: "opencode",
        name: "OpenCode Zen",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput", "coding"],
        models: [],
        apiKeyEnvVar: "OPENCODE_API_KEY",
        freeTier: "Free models exposed by OpenCode Zen",
        rateLimits: { requestsPerMinute: 20 },
        health: "unknown",
        costClass: "free",
        commercialUse: true,
        privacyPolicyUrl: "https://opencode.ai/privacy",
        regionRestrictions: "None documented.",
        enabled: true,
        priority: 3,
        verified: true,
        disabledEnvVar: "AI_PROVIDER_OPENCODE_DISABLED",
    },
    {
        id: "codecraft",
        name: "CodeCraft API",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput", "coding"],
        models: [],
        apiKeyEnvVar: "CODECRAFT_API_KEY",
        freeTier: "Metered per token — blocked unless CODECRAFT_ALLOW_METERED",
        rateLimits: { requestsPerMinute: 20 },
        health: "unknown",
        costClass: "paid",
        commercialUse: true,
        privacyPolicyUrl: "https://www.codecraftapi.com/privacy",
        regionRestrictions: "None documented.",
        enabled: true,
        priority: 8,
        verified: true,
        disabledEnvVar: "AI_PROVIDER_CODECRAFT_DISABLED",
        allowPaidUse: true,
    },
    {
        id: "bai",
        name: "B.AI",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput"],
        models: [],
        apiKeyEnvVar: "BAI_API_KEY",
        freeTier: "Deployment-configured",
        health: "unknown",
        costClass: "free",
        commercialUse: true,
        regionRestrictions: "None documented.",
        enabled: true,
        priority: 5,
        verified: true,
        disabledEnvVar: "AI_PROVIDER_BAI_DISABLED",
    },
    {
        id: "bytez",
        name: "Bytez",
        type: "free_cloud",
        capabilities: ["text", "structuredOutput", "vision"],
        models: [],
        apiKeyEnvVar: "BYTEZ_API_KEY",
        freeTier: "Only models whose meter ends in `-free`",
        rateLimits: { requestsPerMinute: 20 },
        health: "unknown",
        costClass: "freemium",
        commercialUse: true,
        privacyPolicyUrl: "https://bytez.com/privacy",
        regionRestrictions: "None documented.",
        enabled: true,
        priority: 6,
        verified: true,
        disabledEnvVar: "AI_PROVIDER_BYTEZ_DISABLED",
    },
    {
        id: "claude",
        name: "Anthropic Claude (premium)",
        type: "premium",
        capabilities: ["text", "structuredOutput", "vision", "reasoning", "longContext", "toolCalling", "coding"],
        models: [],
        apiKeyEnvVar: "ANTHROPIC_API_KEY",
        freeTier: "None — paid API",
        health: "unknown",
        costClass: "paid",
        commercialUse: true,
        privacyPolicyUrl: "https://www.anthropic.com/legal/privacy",
        regionRestrictions: "None documented.",
        enabled: true,
        priority: 20,
        verified: false,
        disabledEnvVar: "AI_PROVIDER_CLAUDE_DISABLED",
        allowPaidUse: true,
    },
    {
        id: "local",
        name: "Local Heuristic Engine",
        type: "local",
        capabilities: ["text", "structuredOutput"],
        models: ["local-heuristic"],
        freeTier: "Always available — deterministic fallback",
        health: "healthy",
        costClass: "free",
        commercialUse: true,
        regionRestrictions: "None — runs in-process.",
        enabled: true,
        priority: 99,
        verified: true,
    },
];

// ── Accessors ────────────────────────────────────────────────────────────────

/** Full registry — safe to expose: metadata only, never secrets. */
export function getProviderRegistry(): RegistryEntry[] {
    return REGISTRY.map((entry) => withRuntimeState(entry));
}

export function getProviderDescriptor(id: string): RegistryEntry | undefined {
    const entry = REGISTRY.find((p) => p.id === id);
    return entry ? withRuntimeState(entry) : undefined;
}

function flagEnabled(entry: RegistryEntry): boolean {
    if (entry.disabledEnvVar) {
        const raw = process.env[entry.disabledEnvVar];
        if (raw !== undefined && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase())) {
            return false;
        }
    }
    return entry.enabled;
}

/**
 * Resolve runtime state for display. `credentialsConfigured` reads only the
 * PRESENCE of the env var — the value itself never enters any return value.
 */
function withRuntimeState(entry: RegistryEntry): RegistryEntry {
    const credentialsConfigured = entry.apiKeyEnvVar
        ? Boolean(process.env[entry.apiKeyEnvVar])
        : true; // local provider needs no credential
    return {
        ...entry,
        enabled: flagEnabled(entry),
        credentialsConfigured,
    };
}

/** Providers that an adapter exists for and policy currently permits. */
export function getRoutableProviderIds(): string[] {
    return REGISTRY.filter((e) => e.verified && flagEnabled(e)).map((e) => e.id);
}
