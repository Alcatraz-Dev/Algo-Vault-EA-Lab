/**
 * UnifiedLLMRouter — task-aware routing layer ABOVE the existing AlgoVault AI
 * gateway (lib/ai). It does not replace the gateway: it adapts its legacy
 * `AIProvider` implementations, adds the new free-tier OpenAI-compatible
 * adapters and the optional Claude adapter, and selects the best provider per
 * TASK PROFILE using health, capability, cost-class, tier and priority.
 *
 * Guarantees:
 *  - Never fabricates an AI result. When every provider is unavailable the
 *    router returns a deterministic AI_UNAVAILABLE response.
 *  - Health-aware: the shared circuit breaker (lib/intelligence/health.ts)
 *    gates attempts; failures feed it; cooldowns prevent retry storms.
 *  - Free-first: paid providers (claude, codecraft) are skipped unless the
 *    request policy allows them (Pro tier / allowPaidFallback / deep tasks).
 *  - Existing default gateway (`ai.chat`) remains untouched for every
 *    existing caller.
 */

import { AIConfig } from "../ai/config";
import { defaultRouter as legacyRouter } from "../ai/router";
import type { AIUsageSource } from "../ai/usage-events";
import { AIProvider, AIChatRequest, AIResponse as LegacyAIResponse } from "../ai/types";
import { AIRequest, AIResponse } from "./types";
import type { AITask, AICapability } from "./types";
import { INTELLIGENCE_VERSION } from "./versions";
import { getSharedHealthTracker, isNonRetryable } from "./health";
import { getProviderDescriptor } from "./provider-registry";
import { isFreeRouterEnabled } from "./flags";
import { createGroqProvider, createCerebrasProvider, createMistralProvider } from "./providers/openai-compatible";
import { AnthropicProvider } from "./providers/anthropic";

// ── Task profiles ────────────────────────────────────────────────────────────

export interface TaskProfile {
    task: AITask;
    /** Capabilities the chosen provider must advertise. */
    capabilities: AICapability[];
    /** Preferred latency class ordering. */
    latency: "fast" | "balanced" | "slow";
    /** Deep tasks MAY escalate to premium when policy allows. */
    allowPremium: boolean;
    /** Smaller maxTokens ceiling — high-frequency tasks stay cheap. */
    defaultMaxTokens: number;
    /** Providers excluded for this task (e.g. vision-only for text tasks). */
    exclude?: string[];
}

const TASK_PROFILES: Record<AITask, TaskProfile> = {
    FAST_MARKET_CLASSIFICATION: { task: "FAST_MARKET_CLASSIFICATION", capabilities: ["text", "structuredOutput"], latency: "fast", allowPremium: false, defaultMaxTokens: 400 },
    SIGNAL_EXPLANATION: { task: "SIGNAL_EXPLANATION", capabilities: ["text", "structuredOutput"], latency: "balanced", allowPremium: false, defaultMaxTokens: 800 },
    DEEP_STRATEGY_RESEARCH: { task: "DEEP_STRATEGY_RESEARCH", capabilities: ["text", "structuredOutput", "reasoning"], latency: "slow", allowPremium: true, defaultMaxTokens: 4000 },
    CODE_GENERATION: { task: "CODE_GENERATION", capabilities: ["text", "coding"], latency: "balanced", allowPremium: false, defaultMaxTokens: 3000 },
    CHART_VISION_ANALYSIS: { task: "CHART_VISION_ANALYSIS", capabilities: ["text", "vision"], latency: "balanced", allowPremium: false, defaultMaxTokens: 1200 },
    LONG_CONTEXT_RESEARCH: { task: "LONG_CONTEXT_RESEARCH", capabilities: ["text", "longContext"], latency: "slow", allowPremium: true, defaultMaxTokens: 4000 },
    CHALLENGE_REVIEW: { task: "CHALLENGE_REVIEW", capabilities: ["text", "structuredOutput"], latency: "fast", allowPremium: false, defaultMaxTokens: 1000 },
    PRO_SCALPING_DECISION: { task: "PRO_SCALPING_DECISION", capabilities: ["text", "structuredOutput"], latency: "fast", allowPremium: false, defaultMaxTokens: 500 },
    SETUP_VALIDATION: { task: "SETUP_VALIDATION", capabilities: ["text", "structuredOutput"], latency: "fast", allowPremium: false, defaultMaxTokens: 600 },
    REGIME_CLASSIFICATION: { task: "REGIME_CLASSIFICATION", capabilities: ["text", "structuredOutput"], latency: "fast", allowPremium: false, defaultMaxTokens: 300 },
    TRADE_REVIEW: { task: "TRADE_REVIEW", capabilities: ["text", "structuredOutput"], latency: "balanced", allowPremium: false, defaultMaxTokens: 900 },
    ANOMALY_DETECTION: { task: "ANOMALY_DETECTION", capabilities: ["text", "structuredOutput"], latency: "fast", allowPremium: false, defaultMaxTokens: 400 },
    HYPOTHESIS_GENERATION: { task: "HYPOTHESIS_GENERATION", capabilities: ["text", "reasoning"], latency: "balanced", allowPremium: true, defaultMaxTokens: 2000 },
    STRATEGY_RANKING: { task: "STRATEGY_RANKING", capabilities: ["text", "structuredOutput"], latency: "fast", allowPremium: false, defaultMaxTokens: 1200 },
};

export function getTaskProfile(task: AITask): TaskProfile {
    return TASK_PROFILES[task] ?? TASK_PROFILES.FAST_MARKET_CLASSIFICATION;
}

// ── Candidate scoring ────────────────────────────────────────────────────────

const PAID_PROVIDER_IDS = new Set(["claude", "codecraft"]);

function scoreCandidate(params: {
    provider: AIProvider;
    model: string;
    profile: TaskProfile;
    health: ReturnType<ReturnType<typeof getSharedHealthTracker>["snapshot"]>;
    isFreeRouterOn: boolean;
    paidAllowed: boolean;
}): number {
    const { provider, profile, health, paidAllowed } = params;
    const descriptor = getProviderDescriptor(provider.id);
    let score = 50;

    // Health dominates: a circuit-open provider is never chosen.
    // Resolved (last-resort): when all free providers are blocked and CODECRAFT_ALLOW_METERED is true.
    const resolvedPaid = (AIConfig.freeOnly && AIConfig.codecraftAllowMetered && provider.id === "codecraft") ? true : false;
    if (health.circuitState === "open") return -Infinity;
    score += health.reliabilityScore * 30; // 0..30
    if (health.lastErrorCode && isNonRetryable(health.lastErrorCode)) score -= 40;

    // Last-resort fallback: a working metered provider is preferred over "nothing" when free tier is exhausted.
    if (resolvedPaid) score += 8;

    // Latency fit.
    const fast = health.avgLatencyMs !== null && health.avgLatencyMs < 1500;
    const slow = health.avgLatencyMs !== null && health.avgLatencyMs > 8000;
    if (profile.latency === "fast") {
        if (fast) score += 15;
        if (slow) score -= 15;
    } else if (profile.latency === "balanced") {
        if (fast) score += 6;
        if (slow) score -= 6;
    } else if (slow) {
        score += 2; // deep research tolerates slow models
    }

    // Free-first policy.
    const costClass = descriptor?.costClass ?? "free";
    const isPaid = PAID_PROVIDER_IDS.has(provider.id) || costClass === "paid";
    const isMeteredOptIn = provider.id === "codecraft" && AIConfig.codecraftAllowMetered && AIConfig.freeOnly;
    if (!isPaid) score += 25;
    if (isPaid && paidAllowed) score += 10;
    else if (isMeteredOptIn && paidAllowed) score += 5; // metered opt-in allowed as fallback
    if (isPaid && !paidAllowed && !isMeteredOptIn) return -Infinity; // hard policy gate

    // Registry priority: lower number = more preferred.
    const priority = descriptor?.priority ?? 50;
    score += Math.max(0, 20 - priority);

    // Task capability fit (vision / coding / reasoning / long context).
    if (profile.capabilities.includes("vision") && descriptor?.capabilities.includes("vision")) score += 20;
    if (profile.capabilities.includes("coding") && descriptor?.capabilities.includes("coding")) score += 15;
    if (profile.capabilities.includes("reasoning") && descriptor?.capabilities.includes("reasoning")) score += 15;
    if (profile.capabilities.includes("longContext") && descriptor?.capabilities.includes("longContext")) score += 10;

    return score;
}

// ── Router ───────────────────────────────────────────────────────────────────

export class UnifiedLLMRouter {
    private adapters: Map<string, AIProvider> = new Map();
    private health = getSharedHealthTracker();

    constructor(adapters?: AIProvider[]) {
        // Legacy gateway providers (already free-tier aware).
        for (const p of legacyRouter.getRegisteredProviders()) {
            this.adapters.set(p.id, p);
        }
        // New adapters.
        const extra: AIProvider[] = adapters ?? [
            createGroqProvider(),
            createCerebrasProvider(),
            createMistralProvider(),
            new AnthropicProvider(),
        ];
        for (const p of extra) {
            if (!this.adapters.has(p.id)) this.adapters.set(p.id, p);
        }
    }

    /** Test seam: drop the auto-registered adapters. */
    static forTest(adapters: AIProvider[]): UnifiedLLMRouter {
        return new UnifiedLLMRouter(adapters);
    }

    /** Provider ids eligible for the given request, health- and policy-filtered. */
    async candidateOrder(req: AIRequest): Promise<Array<{ provider: AIProvider; model?: string }>> {
        const profile = getTaskProfile(req.task);
        const health = this.health;
        const paidAllowed =
            req.allowPaidFallback === true ||
            (req.userTier === "pro" && profile.allowPremium) ||
            (req.userTier === "admin");
        // Last-resort metered fallback: when free-only is on and the metered opt-in is set,
        // allow the metered provider even on free tier (only after free providers exhausted).
        const meteredOptInAllowed = AIConfig.freeOnly && AIConfig.codecraftAllowMetered;

        const candidates: Array<{ provider: AIProvider; model?: string; score: number; isPaid: boolean }> = [];

        for (const id of Array.from(this.adapters.keys())) {
            const provider = this.adapters.get(id);
            if (!provider) continue;
            const descriptor = getProviderDescriptor(id);
            if (descriptor && !descriptor.enabled) continue; // admin kill switch
            const snap = health.snapshot(id);
            const hasCredential = descriptor ? (descriptor.credentialsConfigured ?? true) : provider.isAvailable();
            const available = await provider.isAvailable();
            if (!hasCredential && !available) continue;

            const model = await this.pickModel(provider, req, profile);
            if (!model) continue;

            const isPaid = PAID_PROVIDER_IDS.has(id) || descriptor?.costClass === "paid";
            const isMeteredOptIn = id === "codecraft" && meteredOptInAllowed;
            const score = scoreCandidate({
                provider,
                model,
                profile,
                health: snap,
                isFreeRouterOn: isFreeRouterEnabled(),
                paidAllowed: paidAllowed || isMeteredOptIn,
            });
            if (score === -Infinity) continue;
            candidates.push({ provider, model, score, isPaid });
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates.map((c) => ({ provider: c.provider, model: c.model }));
    }

    private async pickModel(
        provider: AIProvider,
        req: AIRequest,
        profile: TaskProfile,
    ): Promise<string | undefined> {
        // Preferred models first.
        if (req.preferredModels?.length) {
            for (const m of req.preferredModels) {
                if (await this.providerServesModel(provider, m)) return m;
            }
        }
        // Then profile-driven model selection from the provider's live catalog.
        const models = await provider.getModels().catch(() => []);
        if (models.length === 0) return profile.latency === "fast" ? undefined : undefined;
        const vision = profile.capabilities.includes("vision");
        const coding = profile.capabilities.includes("coding");
        const reasoning = profile.capabilities.includes("reasoning");
        const scored = models
            .filter((m) => m.enabled)
            .map((m) => {
                let s = 0;
                const id = m.id.toLowerCase();
                if (vision && (id.includes("vision") || m.capabilities?.vision)) s += 10;
                if (coding && (id.includes("coder") || id.includes("code") || m.capabilities?.tools)) s += 8;
                if (reasoning && (id.includes("r1") || id.includes("thinking") || id.includes("reason"))) s += 8;
                if (profile.latency === "fast" && (id.includes("flash") || id.includes("haiku") || id.includes("mini") || id.includes("small") || id.includes("instant"))) s += 8;
                if (profile.latency === "slow" && (id.includes("pro") || id.includes("ultra") || id.includes("large") || id.includes("r1"))) s += 8;
                if (m.free || m.confirmedFree) s += 5;
                return { id: m.id, s };
            })
            .sort((a, b) => b.s - a.s);
        return scored[0]?.id;
    }

    private async providerServesModel(provider: AIProvider, model: string): Promise<boolean> {
        const models = await provider.getModels().catch(() => []);
        if (models.length === 0) return true; // provider will accept-or-fail honestly
        return models.some((m) => m.id === model);
    }

    /**
     * Execute a unified request with health-aware fallback. Returns a
     * deterministic AI_UNAVAILABLE response when nothing can serve it — never
     * a fabricated result.
     */
    async execute(req: AIRequest, context?: { source?: AIUsageSource; sourceId?: string; userId?: string }): Promise<AIResponse> {
        const started = Date.now();
        const requestId = `ai_${started.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const profile = getTaskProfile(req.task);
        const errors: string[] = [];
        let attempts = 0;

        const candidates = await this.candidateOrder(req);
        const maxAttempts = Math.min(
            Number(process.env.AI_MAX_PROVIDER_ATTEMPTS || "4") || 4,
            candidates.length,
        );

        for (const { provider, model } of candidates) {
            if (attempts >= maxAttempts) break;
            if (!this.health.canAttempt(provider.id)) {
                errors.push(`${provider.id}:circuit_open`);
                continue;
            }
            attempts += 1;
            const attemptStart = Date.now();
            try {
                const legacyReq: AIChatRequest = {
                    messages: req.messages,
                    systemPrompt: req.systemPrompt,
                    temperature: req.temperature ?? 0.3,
                    maxTokens: req.maxTokens ?? profile.defaultMaxTokens,
                    model,
                    provider: undefined,
                    responseFormat: req.structuredSchema ? "json_object" : undefined,
                };
                // Structured tasks first ask with JSON mode. Several free-tier
                // models reject `response_format` even though the prompt already
                // demands JSON (the parser tolerates fenced/inline JSON), so a
                // non-quota failure of that first call is retried once WITHOUT
                // it against the same provider before moving on.
                const call = (jsonMode: boolean): Promise<LegacyAIResponse> =>
                    provider.chat({ ...legacyReq, responseFormat: jsonMode ? "json_object" : undefined });
                let res: LegacyAIResponse;
                try {
                    res = await call(true);
                } catch (err) {
                    const code = this.errorCode(err);
                    const structuredRetry =
                        Boolean(req.structuredSchema) &&
                        code !== "RATE_LIMITED" &&
                        code !== "QUOTA_EXCEEDED" &&
                        code !== "TIMEOUT" &&
                        code !== "INVALID_API_KEY";
                    if (!structuredRetry) throw err;
                    res = await call(false);
                }
                const latency = Date.now() - attemptStart;
                const usage = this.usageFrom(res);
                const structuredData = this.tryParseJson(res.content);

                // A structured task that came back as prose is a FAILED
                // attempt, not a result: record it honestly and let the next
                // candidate (one that honours JSON mode) take its turn.
                if (req.structuredSchema && !structuredData) {
                    // UNKNOWN_ERROR (retryable): one prose reply must not trip
                    // the non-retryable breaker, only a run of them should.
                    this.health.record(provider.id, { ok: false, latencyMs: latency, errorCode: "UNKNOWN_ERROR" });
                    errors.push(`${provider.id}:non_json_response`);
                    continue;
                }

                this.health.record(provider.id, { ok: true, latencyMs: latency });

                return {
                    provider: res.provider,
                    model: res.model,
                    content: res.content,
                    structuredData,
                    confidence: this.confidenceFrom(res.content),
                    latencyMs: latency,
                    tokenUsage: usage,
                    fallbackUsed: attempts > 1,
                    requestId,
                    timestamp: Date.now(),
                    validationStatus: "ok",
                    attempts,
                    errors: errors.length > 0 ? errors : undefined,
                    versions: {
                        routingPolicy: INTELLIGENCE_VERSION.routingPolicy,
                        providerRegistry: INTELLIGENCE_VERSION.providerRegistry,
                        promptTemplates: INTELLIGENCE_VERSION.promptTemplates,
                    },
                };
            } catch (err) {
                const latency = Date.now() - attemptStart;
                const code = this.errorCode(err);
                this.health.record(provider.id, { ok: false, latencyMs: latency, errorCode: code as never });
                errors.push(`${provider.id}:${code}`);
                if (isNonRetryable(code)) {
                    // Same provider will never accept this request; keep the
                    // attempt counter moving so other providers get a chance.
                    continue;
                }
            }
        }

        // ── Honest failure ──────────────────────────────────────────────────
        // No provider served the request. Content is empty, status is explicit,
        // and every policy version is still recorded for auditability.
        return {
            provider: "",
            model: "",
            content: "",
            latencyMs: Date.now() - started,
            tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false },
            fallbackUsed: attempts > 0,
            requestId,
            timestamp: Date.now(),
            validationStatus: "ai_unavailable",
            attempts,
            errors: errors.length > 0 ? errors : ["no_candidates"],
            versions: {
                routingPolicy: INTELLIGENCE_VERSION.routingPolicy,
                providerRegistry: INTELLIGENCE_VERSION.providerRegistry,
                promptTemplates: INTELLIGENCE_VERSION.promptTemplates,
            },
        };
    }

    private errorCode(err: unknown): string {
        if (typeof err === "object" && err !== null && "code" in err) {
            return String((err as { code?: unknown }).code);
        }
        const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        return isTimeout ? "TIMEOUT" : "UNKNOWN_ERROR";
    }

    private usageFrom(res: LegacyAIResponse) {
        const raw = res.raw as Record<string, unknown> | undefined;
        const usage = raw?.usage as Record<string, unknown> | undefined;
        const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
        const promptTokens = num(usage?.prompt_tokens) || num(usage?.input_tokens) || num(usage?.promptTokenCount);
        const completionTokens = num(usage?.completion_tokens) || num(usage?.output_tokens) || num(usage?.candidatesTokenCount);
        return {
            promptTokens,
            completionTokens,
            totalTokens: num(usage?.total_tokens) || promptTokens + completionTokens,
            reported: promptTokens > 0 || completionTokens > 0,
        };
    }

    private tryParseJson(content: string): Record<string, unknown> | undefined {
        if (!content) return undefined;
        try {
            const parsed = JSON.parse(content);
            return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : undefined;
            } catch {
            // Tolerate markdown-fenced JSON, a common model habit.
            const match = content.match(/\{[\s\S]*\}/);
            if (!match) return undefined;
            try {
                const parsed = JSON.parse(match[0]);
                return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : undefined;
            } catch {
                return undefined;
            }
        }
    }

    private confidenceFrom(content: string): number | undefined {
        if (!content) return undefined;
        // Models commonly emit "confidence": 87 or "confidence": "0.87".
        const m = content.match(/"confidence"\s*:\s*"?(\d+(?:\.\d+)?)"?/i);
        if (!m) return undefined;
        const v = Number(m[1]);
        if (!Number.isFinite(v)) return undefined;
        return v <= 1 ? v : v / 100;
    }

    /** Model catalog across every adapter (admin providers page). */
    async getAllModels(): Promise<Array<{ provider: string; models: Array<{ id: string; name: string; free: boolean }> }>> {
        const out: Array<{ provider: string; models: Array<{ id: string; name: string; free: boolean }> }> = [];
        for (const [id, provider] of this.adapters) {
            const models = await provider.getModels().catch(() => []);
            out.push({
                provider: id,
                models: models.map((m) => ({ id: m.id, name: m.name, free: m.free })),
            });
        }
        return out;
    }

    /** Health snapshots for the admin monitor. */
    healthSnapshots() {
        return this.health.snapshotAll();
    }
}

let sharedRouter: UnifiedLLMRouter | null = null;

export function getUnifiedRouter(): UnifiedLLMRouter {
    if (!sharedRouter) sharedRouter = new UnifiedLLMRouter();
    return sharedRouter;
}

export function resetUnifiedRouter(): void {
    sharedRouter = null;
}
