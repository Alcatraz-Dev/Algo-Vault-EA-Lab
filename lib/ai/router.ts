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
import {
    assertFreeModelAllowed,
    KNOWN_FREE_MODELS,
    isModelConfirmedFree,
} from "./models";
import { isAbortError } from "./finish";
import { OpenRouterProvider } from "./providers/openrouter";
import { OpenCodeProvider } from "./providers/opencode";
import { BAIProvider } from "./providers/bai";
import { GeminiProvider } from "./providers/gemini";
import { BytezProvider } from "./providers/bytez";
import { CodeCraftProvider } from "./providers/codecraft";
import { OllamaProvider } from "./providers/ollama";
import { LocalStrategyAIProvider } from "./local";
import {
    AIRequestContext,
    AIModelPricingEntry,
    buildAIUsageEvent,
    extractTokenUsage,
} from "./usage-events";
import {
    getModelPricingEntry,
    setCatalogLoader,
} from "./catalog-snapshot";
import { evaluateBudgetSafely, recordAIUsageSafely } from "./runtime-guards";

/**
 * Provider id used for the local heuristic fallback in usage accounting. It
 * makes no external call, so it appears in the breakdown with a real cost of 0
 * rather than being invisible.
 */
const LOCAL_PROVIDER_ID = "local";

export class AIRouter {
    private providers: Map<string, AIProvider> = new Map();
    private localProvider: LocalStrategyAIProvider;
    /**
     * In-flight usage persistence promises. Kept so callers (and tests) can
     * await accounting without the AI request itself ever waiting on Firebase.
     */
    private pendingUsage: Promise<void>[] = [];

    constructor() {
        this.localProvider = new LocalStrategyAIProvider();

        // Register cloud providers
        const gemini = new GeminiProvider();
        const openrouter = new OpenRouterProvider();
        const opencode = new OpenCodeProvider();
        const codecraft = new CodeCraftProvider();
        const bai = new BAIProvider();
        const bytez = new BytezProvider();
        const ollama = new OllamaProvider();

        this.providers.set(gemini.id, gemini);
        this.providers.set(openrouter.id, openrouter);
        this.providers.set(opencode.id, opencode);
        this.providers.set(codecraft.id, codecraft);
        this.providers.set(bai.id, bai);
        this.providers.set(bytez.id, bytez);
        // Local inference is registered for explicit selection and catalog
        // discovery only. `autoSelectable = false` keeps it out of the automatic
        // cloud fallback chain in both this router and the unified router.
        this.providers.set(ollama.id, ollama);

        // The model catalog is the only source of pricing for cost estimation.
        // It is snapshotted in the background and read from memory, so no AI
        // request ever pays for a catalog fetch.
        setCatalogLoader(() => this.getAllModels());
    }

    /**
     * Resolve pricing knowledge for a model.
     *
     * Falls back to the existing free-marker policy when the model is absent
     * from the catalog snapshot (cold cache, or a provider whose catalog could
     * not be read). That fallback can only ever prove a model is FREE; it can
     * never produce a price, so a catalog miss degrades to "unknown cost" and
     * never to a fabricated number.
     */
    private resolvePricing(providerId: string, model: string): AIModelPricingEntry | undefined {
        const fromCatalog = getModelPricingEntry(providerId, model);
        if (fromCatalog) return fromCatalog;
        if (model && isModelConfirmedFree(model)) return { confirmedFree: true };
        return undefined;
    }

    /** Queue a usage event without blocking the AI response. Never throws. */
    private trackUsage(promise: Promise<void>): void {
        this.pendingUsage.push(promise);
        // Bounded: a long-lived server must not accumulate promises forever.
        if (this.pendingUsage.length > 256) {
            this.pendingUsage = this.pendingUsage.slice(-128);
        }
    }

    /**
     * Record one provider attempt.
     *
     * Token counts are read from the provider response the gateway already has
     * in hand (`AIResponse.raw`), which is why no provider file needs changing.
     */
    private recordAttempt(params: {
        providerId: string;
        model: string;
        raw?: unknown;
        latencyMs: number;
        status: "success" | "error";
        errorCode?: string;
        context?: AIRequestContext;
        forcedCostUsd?: number;
    }): void {
        try {
            const usage = extractTokenUsage(params.raw);
            const event = buildAIUsageEvent({
                provider: params.providerId,
                model: params.model,
                usage,
                pricing: this.resolvePricing(params.providerId, params.model),
                latencyMs: params.latencyMs,
                status: params.status,
                errorCode: params.errorCode,
                context: params.context,
                forcedCostUsd: params.forcedCostUsd,
            });
            this.trackUsage(recordAIUsageSafely(event));
        } catch {
            // Accounting must never be able to fail a request that succeeded.
        }
    }

    /**
     * Await all pending usage persistence.
     *
     * Exposed for tests and for graceful shutdown. The AI path never calls it.
     */
    async drainUsage(): Promise<void> {
        // Loops because a drain can enqueue follow-up writes (e.g. a refresh).
        let guard = 0;
        while (this.pendingUsage.length > 0 && guard++ < 50) {
            const batch = this.pendingUsage;
            this.pendingUsage = [];
            await Promise.allSettled(batch);
        }
    }

    getProvider(id: string): AIProvider | undefined {
        return this.providers.get(id.toLowerCase());
    }

    /**
     * Every registered provider, in registration order.
     *
     * Read-only introspection for admin reporting. It deliberately does NOT
     * filter by availability and does NOT apply the fallback order, so a health
     * view can show the accounts that are NOT usable instead of only the ones
     * that are.
     */
    getRegisteredProviders(): AIProvider[] {
        return Array.from(this.providers.values());
    }

    async getAvailableProviders(): Promise<AIProvider[]> {
        return this.getAvailableCloudProviders();
    }

    private async getAvailableCloudProviders(preferredProviderId?: string): Promise<AIProvider[]> {
        const result: AIProvider[] = [];
        const baseOrder = [
            this.providers.get("gemini"),
            this.providers.get("openrouter"),
            this.providers.get("opencode"),
            this.providers.get("codecraft"),
            this.providers.get("bai"),
            this.providers.get("bytez"),
        ].filter((provider): provider is AIProvider => Boolean(provider && provider.autoSelectable !== false));

        let providers = baseOrder;
        if (preferredProviderId) {
            const pref = this.providers.get(preferredProviderId.toLowerCase());
            if (pref) {
                providers = [pref, ...baseOrder.filter((p) => p?.id !== pref.id)];
            }
        }

        for (const provider of providers) {
            if (provider && await provider.isAvailable()) {
                result.push(provider);
            }
        }
        return result;
    }

    async getAllModels(): Promise<AIModel[]> {
        const models: AIModel[] = [];
        for (const provider of Array.from(this.providers.values())) {
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
     * (Gemini -> OpenRouter -> OpenCode -> CodeCraft -> B.AI -> Bytez -> Local Heuristic).
     * CodeCraft participates whenever CODECRAFT_API_KEY is configured and is
     * served only from its own discovered model catalog, so it never inherits
     * another provider's model id. Bytez participates whenever BYTEZ_API_KEY
     * is configured: under AI_FREE_ONLY=true (the default) only its `*-free`
     * models are served, and
     * when a paid budget is allowed it may use its full discovered catalog.
     * Each provider resolves the effective model against its own catalog, so a
     * quota failure on one provider no longer cascades into the next provider
     * being handed an unsupported model.
     */
    async chat(request: AIChatRequest, context?: AIRequestContext): Promise<AIResponse> {
        const mode = request.mode ?? "auto";
        if (mode !== "auto" && mode !== "strict") {
            throw {
                code: "INVALID_REQUEST",
                provider: "gateway",
                message: `Unsupported provider mode "${String(mode)}". Use "auto" or "strict".`,
            } satisfies AIProviderError;
        }

        const providerId = request.provider?.trim().toLowerCase();
        if (mode === "strict" && !providerId) {
            throw {
                code: "INVALID_REQUEST",
                provider: "gateway",
                message: "Strict provider mode requires an explicit provider.",
            } satisfies AIProviderError;
        }

        const localRequest = providerId === "ollama" || providerId === "local-heuristic";

        // Enforce hard free-only check if model specified. `request.provider` is
        // passed through so a provider-scoped metered opt-in (e.g.
        // CODECRAFT_ALLOW_METERED) can relax the guard for that provider ONLY.
        // A local model is not a cloud model and is exempt from the cloud price
        // policy. A request with no explicit provider is still checked strictly.
        //
        // A provider that resolves the effective model against its own live
        // catalog before dispatch (`verifiesModelPricing`) owns this decision:
        // its free ids carry no suffix this router could trust, and asking it
        // here would force an upstream catalog fetch for every call, mutating a
        // shared cache mid-request. Such a provider either verifies the model or
        // refuses the request — it never dispatches an unverified one.
        const selectedProvider = providerId ? this.providers.get(providerId) : undefined;
        const providerVerifiesPricing = selectedProvider?.verifiesModelPricing === true;
        if (request.model && !localRequest && !providerVerifiesPricing) {
            try {
                assertFreeModelAllowed(request.model, undefined, request.provider);
            } catch (err) {
                throw {
                    code: "PAID_MODEL_BLOCKED",
                    provider: providerId || "gateway",
                    message: err instanceof Error ? err.message : String(err),
                } satisfies AIProviderError;
            }
        }

        const available = await this.getAvailableCloudProviders(providerId);
        const explicitLocal = providerId === "ollama" || providerId === "local-heuristic";
        const candidateOrder = mode === "strict" || explicitLocal
            ? available.filter((provider) => provider.id === providerId)
            : available;

        const lastErrors: AIProviderError[] = [];

        if (candidateOrder.length === 0 && mode === "strict") {
            throw {
                code: "PROVIDER_UNAVAILABLE",
                provider: providerId || "gateway",
                message: `Provider "${providerId}" is not available.`,
            } satisfies AIProviderError;
        }

        // Automatic mode with an explicitly selected provider still falls back
        // (existing behaviour), but the degradation must be visible: without
        // this entry an unavailable local model would look like a normal answer
        // from a different engine.
        if (candidateOrder.length === 0 && providerId) {
            lastErrors.push({
                code: "PROVIDER_UNAVAILABLE",
                provider: providerId,
                message: `Provider "${providerId}" is not available; the request was not sent to it.`,
            });
        }

        let attempts = 0;
        const maxAttempts = Math.min(AIConfig.maxAttempts, candidateOrder.length);
        const budgetBlockedProviders: string[] = [];
        let budgetBlockedReason = "";

        for (const provider of candidateOrder) {
            if (attempts >= maxAttempts) break;

            // ── Budget gate ────────────────────────────────────────────────
            // Runs BEFORE the attempt counter and BEFORE any provider call, for
            // three reasons:
            //  1. Enforcement is pre-flight: a budget is never discovered to be
            //     exceeded only after the tokens have been spent.
            //  2. A blocked provider must NOT consume an attempt slot. If it
            //     did, AI_MAX_PROVIDER_ATTEMPTS=1 plus a blocked first provider
            //     would silently prevent the next (affordable) provider from
            //     ever running.
            //  3. Re-evaluated for every candidate, so the GLOBAL limit is
            //     re-derived on each attempt. That is what makes the global
            //     budget unbypassable through fallback: switching provider
            //     cannot lower the global total, and cannot skip its check.
            // The loop visits each provider once and the attempt counter is
            // capped by maxAttempts, so there is no path to an infinite loop.
            // Local inference has no provider cost. A cloud budget must never
            // block or shape local usage.
            const budget = provider.isLocal
                ? { decision: "ALLOW" as const, reason: "" }
                : await evaluateBudgetSafely({
                      provider: provider.id,
                      model: request.model,
                      userId: context?.userId,
                      source: context?.source,
                      sourceId: context?.sourceId,
                  });
            if (budget.decision === "BLOCK") {
                budgetBlockedProviders.push(provider.id);
                if (!budgetBlockedReason) budgetBlockedReason = budget.reason;
                console.warn(
                    `[AI] Budget blocked provider=${provider.id} decision=BLOCK reason=${budget.reason}`,
                );
                lastErrors.push({
                    code: "AI_BUDGET_EXCEEDED",
                    provider: provider.id,
                    message: budget.reason,
                });
                // Recorded so the admin UI can show blocked requests. Zero cost
                // is a fact here: no provider was ever contacted.
                this.recordAttempt({
                    providerId: provider.id,
                    model: request.model ?? "",
                    latencyMs: 0,
                    status: "error",
                    errorCode: "AI_BUDGET_EXCEEDED",
                    context,
                    forcedCostUsd: 0,
                });
                continue;
            }
            if (budget.decision === "WARN") {
                console.warn(`[AI] Approaching AI budget limit: provider=${provider.id} reason=${budget.reason}`);
            }

            attempts++;
            const attemptStartedAt = Date.now();

            try {
                console.log(`[AI] Attempt ${attempts}/${maxAttempts}: provider=${provider.id}`);
                const res = await provider.chat(request);
                this.recordAttempt({
                    providerId: provider.id,
                    model: res.model,
                    raw: res.raw,
                    latencyMs: Date.now() - attemptStartedAt,
                    status: "success",
                    context,
                    // Local inference is free by construction, not by an
                    // estimated price.
                    forcedCostUsd: provider.isLocal ? 0 : undefined,
                });
                // Provider-to-provider fallback must stay observable: without
                // this, a failed attempt (e.g. CodeCraft 401 -> next provider
                // succeeds) is only visible in a server log and disappears from
                // the response the type says carries `fallbackErrors`.
                const enriched = lastErrors.length > 0
                    ? { ...res, fallbackErrors: [...lastErrors, ...(res.fallbackErrors ?? [])] }
                    : res;
                enriched.requestedProvider = request.provider;
                enriched.requestedModel = request.model;
                return enriched;
            } catch (err: unknown) {
                const isAbort = isAbortError(err);
                const provErr = isAbort
                    ? { code: "TIMEOUT" as const, provider: provider.id, message: `${provider.id} request timed out after ${AIConfig.timeoutMs}ms.` }
                    : (err && typeof err === "object" && "code" in err)
                        ? (err as AIProviderError)
                        : { code: "UNKNOWN_ERROR" as const, provider: provider.id, message: String(err) };

                this.recordAttempt({
                    providerId: provider.id,
                    model: request.model || provErr.provider,
                    latencyMs: Date.now() - attemptStartedAt,
                    status: "error",
                    errorCode: provErr.code,
                    context,
                });

                console.warn(`[AI] Fallback triggered: provider=${provider.id} error=${provErr.code} message=${provErr.message}`);
                lastErrors.push(provErr);
            }
        }

        // Strict mode never falls back. Returning the provider's own error is
        // the only honest outcome when the selected provider cannot serve.
        if (mode === "strict") {
            const last = lastErrors[lastErrors.length - 1];
            if (last) throw last;
            throw {
                code: "PROVIDER_UNAVAILABLE",
                provider: providerId || "gateway",
                message: `Provider "${providerId}" did not serve the request.`,
            } satisfies AIProviderError;
        }

        // If no cloud free providers succeeded or were available, check local fallback strategy provider.
        // An explicit Ollama request may fall back to the deterministic local
        // heuristic, but never to a cloud provider.
        console.log("[AI] Utilizing local heuristic free AI provider fallback.");
        const fallbackStartedAt = Date.now();
        const fallback = await this.localProvider.chat(request);

        // The local heuristic makes no external call, so its cost is 0 by
        // measurement rather than by assumption.
        this.recordAttempt({
            providerId: LOCAL_PROVIDER_ID,
            model: fallback.model,
            latencyMs: Date.now() - fallbackStartedAt,
            status: "success",
            context,
            forcedCostUsd: 0,
        });

        const enriched: AIResponse = lastErrors.length > 0
            ? { ...fallback, fallbackErrors: lastErrors }
            : fallback;
        enriched.requestedProvider = request.provider;
        enriched.requestedModel = request.model;

        // When every candidate was refused by the budget, the caller gets a
        // clear, structured signal. The local heuristic is returned rather than
        // a thrown error because it is free and offline: it is not a way to
        // spend past a budget, it is the pre-existing graceful degradation path.
        // Model selection is not altered by any of this.
        if (budgetBlockedProviders.length > 0 && budgetBlockedProviders.length === candidateOrder.length) {
            console.warn(
                `[AI] AI_BUDGET_EXCEEDED: every candidate provider was budget-blocked ` +
                `(${budgetBlockedProviders.join(", ")}). reason=${budgetBlockedReason}`,
            );
            enriched.budgetBlocked = {
                reason: budgetBlockedReason || "AI budget exceeded.",
                providers: budgetBlockedProviders,
            };
        }

        return enriched;
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

    async generateText(prompt: string, systemPrompt?: string, context?: AIRequestContext): Promise<string> {
        const res = await this.chat({
            messages: [{ role: "user", content: prompt }],
            systemPrompt,
        }, context);
        return res.content;
    }

    async chatCompletion(messages: ChatMessageInput[], systemPrompt?: string, context?: AIRequestContext): Promise<string> {
        const res = await this.chat({
            messages,
            systemPrompt,
        }, context);
        return res.content;
    }

    async generateStructured<T>(prompt: string, schemaDescription?: string, systemPrompt?: string, context?: AIRequestContext): Promise<T> {
        const fullPrompt = `${prompt}\n\nStrict JSON Format required matching: ${schemaDescription || "{}"}`;
        const res = await this.chat({
            messages: [{ role: "user", content: fullPrompt }],
            systemPrompt: systemPrompt || "You are a helpful JSON generator. Return ONLY a single valid JSON object without markdown formatting.",
            responseFormat: "json_object",
        }, context);

        const cleaned = res.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        const candidate = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
        return JSON.parse(candidate) as T;
    }
}

export const defaultRouter = new AIRouter();
