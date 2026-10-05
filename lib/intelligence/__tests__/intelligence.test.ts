/**
 * Unified Intelligence Fabric — offline unit tests.
 *
 * Repo jiti-runner convention (see lib/performance-arena/__tests__): exported
 * async runner, tiny check helper, process.exit(1) on failure. Fully offline:
 * provider API keys are scrubbed from the environment so every cloud provider
 * is deterministically unavailable; deterministic fakes stand in for adapters;
 * the shared health tracker is reset between scenarios.
 *
 * Covers: flags, financial-safety language, provider registry, market-context
 * compression + fail-closed gates, circuit breaker, router fallback + honest
 * AI_UNAVAILABLE + paid gating, Jev parsing/derivation, the decision
 * orchestrator (incl. RISK ENGINE ALWAYS WINS), and the research/challenge
 * bridges.
 */

import type { AIProvider, AIChatRequest, AIResponse as LegacyAIResponse, AIModel } from "@/lib/ai/types";
import { UnifiedLLMRouter, resetUnifiedRouter } from "@/lib/intelligence/router";
import { ProviderHealthTracker, getSharedHealthTracker, resetSharedHealthTracker } from "@/lib/intelligence/health";
import { runJevValidation, parseJevPayload, deriveAnswer, JEV_QUESTIONS } from "@/lib/intelligence/jev";
import { orchestrateDecision, deterministicLean } from "@/lib/intelligence/orchestrator";
import { buildMarketIntelligenceContext, marketContextUsableForAI } from "@/lib/intelligence/market-context";
import { checkFinancialLanguage, sanitizeFinancialLanguage, FINANCIAL_TONE_CLAUSE } from "@/lib/intelligence/safety";
import { getProviderRegistry, getProviderDescriptor } from "@/lib/intelligence/provider-registry";
import {
    isUnifiedIntelligenceEnabled,
    isJevEnabled,
    intelligenceFlagSnapshot,
} from "@/lib/intelligence/flags";
import {
    runResearchAssessment,
    parseResearchAssessment,
    type ResearchCandidateSnapshot,
} from "@/lib/intelligence/research-bridge";
import {
    runChallengeReview,
    buildChallengeReviewInput,
    parseChallengeReview,
} from "@/lib/intelligence/challenge-bridge";
import type { AIRequest } from "@/lib/intelligence/types";

// ── Harness ──────────────────────────────────────────────────────────────────

export async function runIntelligenceTests(): Promise<boolean> {
    let passed = true;
    let count = 0;
    const check = (cond: boolean, label: string) => {
        count += 1;
        if (cond) console.log(`  PASS: ${label}`);
        else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };
    const section = (title: string) => console.log(`\n--- ${title} ---`);

    // Deterministic environment: no provider credentials, default flags.
    const SCRUB = [
        "GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENCODE_API_KEY", "BAI_API_KEY",
        "BYTEZ_API_KEY", "CODECRAFT_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY",
        "MISTRAL_API_KEY", "ANTHROPIC_API_KEY", "JEV_API_URL", "JEV_API_KEY",
        "CODECRAFT_ALLOW_METERED", "AI_JEV_POLICY", "AI_MAX_PROVIDER_ATTEMPTS",
        "AI_HEALTH_OPEN_AFTER_FAILURES", "AI_HEALTH_COOLDOWN_MS",
        "UNIFIED_AI_INTELLIGENCE", "JEV_DECISION_ENGINE", "FREE_LLM_ROUTER",
        "MULTI_MODEL_ROUTING", "AI_CHALLENGE_REVIEW", "AI_STRATEGY_RESEARCH",
        "AI_PRO_SCALPING_INTELLIGENCE", "AI_INTELLIGENCE_AUDIT",
        "AI_PROVIDER_GEMINI_DISABLED", "AI_PROVIDER_CLAUDE_DISABLED",
    ];
    const saved = new Map<string, string | undefined>();
    for (const k of SCRUB) {
        saved.set(k, process.env[k]);
        delete process.env[k];
    }

    try {
        // ── Flags ────────────────────────────────────────────────────────────
        section("Feature flags");
        check(isUnifiedIntelligenceEnabled() === true, "unified intelligence defaults ON");
        check(isJevEnabled() === true, "jev defaults ON");
        const snap = intelligenceFlagSnapshot();
        check(Object.keys(snap).length >= 8 && snap.unified === true, "flag snapshot exposes every switch");

        process.env.UNIFIED_AI_INTELLIGENCE = "false";
        check(isUnifiedIntelligenceEnabled() === false, "master kill switch disables the fabric");
        check(isJevEnabled() === false, "master kill switch disables jev");
        delete process.env.UNIFIED_AI_INTELLIGENCE;

        // ── Financial-safety language ────────────────────────────────────────
        section("Financial safety language");
        const bad = checkFinancialLanguage("This setup offers guaranteed profit with zero risk.");
        check(!bad.safe, "guaranteed-profit language is flagged");
        const sanitized = sanitizeFinancialLanguage("This setup offers guaranteed profit with zero risk.");
        check(checkFinancialLanguage(sanitized).safe, "sanitizer removes banned claims");
        check(checkFinancialLanguage("Structure is bullish; risk remains if invalidation breaks.").safe, "factual language passes");
        check(FINANCIAL_TONE_CLAUSE.length > 20, "tone clause is non-trivial");

        // ── Provider registry ────────────────────────────────────────────────
        section("Provider registry");
        const registry = getProviderRegistry();
        check(registry.length >= 10, `registry carries the free-LLM ecosystem (${registry.length} entries)`);
        const ids = registry.map((e) => e.id);
        check(new Set(ids).size === ids.length, "registry ids are unique");
        check(ids.includes("groq") && ids.includes("cerebras") && ids.includes("mistral"), "new free providers registered");
        const claude = getProviderDescriptor("claude");
        check(!!claude && claude.costClass === "paid" && claude.verified === false, "claude is registered as optional premium, NOT endpoint-verified");
        check(registry.every((e) => !e.apiKeyEnvVar || /^[A-Z0-9_]+$/.test(e.apiKeyEnvVar)), "registry stores env-var NAMES, never key values");

        process.env.AI_PROVIDER_GEMINI_DISABLED = "1";
        check(getProviderDescriptor("gemini")?.enabled === false, "per-provider kill switch (AI_PROVIDER_*_DISABLED) works");
        delete process.env.AI_PROVIDER_GEMINI_DISABLED;
        check(getProviderDescriptor("gemini")?.enabled === true, "kill switch restores provider");

        delete process.env.ANTHROPIC_API_KEY;
        check(getProviderDescriptor("claude")?.credentialsConfigured === false, "credential detection reads env PRESENCE only");
        process.env.ANTHROPIC_API_KEY = "dummy";
        check(getProviderDescriptor("claude")?.credentialsConfigured === true, "credential detection reflects configured key");
        delete process.env.ANTHROPIC_API_KEY;

        // ── Market context ───────────────────────────────────────────────────
        section("MarketIntelligenceContext");
        const ctx = bullCtx();
        check(ctx.schema === "mic-1" && ctx.symbol === "XAUUSD", "context carries schema + symbol");
        check(ctx.structure?.bias === "bullish" && ctx.htf?.bias === "bullish", "structure + HTF compressed");
        check(ctx.liquidity?.sweeps === 1 && ctx.fvg?.active === 1 && ctx.orderBlocks?.active === 1, "liquidity/FVG/OB counts compressed");
        check(ctx.volatility?.atr === 2.4 && ctx.dataQuality?.status === "fresh", "volatility + freshness derived");
        const staleCtx = buildMarketIntelligenceContext({ ...baseInput(), dataAgeMs: 400_000 });
        check(staleCtx.dataQuality?.status === "stale", "old data marked stale");
        check(!marketContextUsableForAI(staleCtx).ok, "stale facts are refused for AI (fail-closed)");
        check(!marketContextUsableForAI({ ...ctx, symbol: "" }).ok, "missing symbol refused");
        check(!marketContextUsableForAI({ ...ctx, dataAgeMs: undefined }, { expectFresh: true }).ok, "fresh-required mode refuses unknown freshness");
        const emptyZones = buildMarketIntelligenceContext({ ...baseInput(), FVG: [{ status: "invalidated" }] });
        check(emptyZones.fvg?.active === 0, "invalidated zones are not counted active");

        // ── Circuit breaker ──────────────────────────────────────────────────
        section("Provider health / circuit breaker");
        let clock = 1_000_000;
        const tracker = new ProviderHealthTracker({ openAfterConsecutiveFailures: 3, cooldownMs: 30_000, now: () => clock });
        check(tracker.canAttempt("p") === true, "closed circuit allows attempts");
        for (let i = 0; i < 3; i++) tracker.record("p", { ok: false, latencyMs: 10, errorCode: "PROVIDER_UNAVAILABLE" });
        check(tracker.snapshot("p").circuitState === "open", "3 consecutive failures open the circuit");
        check(tracker.canAttempt("p") === false, "open circuit blocks attempts (no retry storms)");
        clock += 29_999;
        check(tracker.canAttempt("p") === false, "cooldown not elapsed → still blocked");
        clock += 1;
        const probeAllowed = tracker.canAttempt("p");
        const secondProbe = tracker.canAttempt("p");
        check(probeAllowed === true && secondProbe === false, "half_open grants exactly one probe");
        tracker.record("p", { ok: true, latencyMs: 5 });
        check(tracker.snapshot("p").circuitState === "closed", "successful probe closes the circuit");
        tracker.record("q", { ok: false, latencyMs: 1, errorCode: "INVALID_API_KEY" });
        check(tracker.snapshot("q").circuitState === "open", "non-retryable auth error trips breaker immediately");
        const rl = new ProviderHealthTracker({ now: () => clock });
        rl.record("r", { ok: false, latencyMs: 1, errorCode: "RATE_LIMITED" });
        check(rl.snapshot("r").rateLimitErrors === 1, "rate-limit errors are tracked separately");

        // ── Router ───────────────────────────────────────────────────────────
        section("UnifiedLLMRouter");
        resetSharedHealthTracker();
        resetUnifiedRouter();

        // 1. All external providers disabled → honest AI_UNAVAILABLE (no
        //    fabrication); deterministic features continue upstream of the router.
        const soloRouter = UnifiedLLMRouter.forTest([]);
        const soloRes = await soloRouter.execute(baseReq(), { source: "system" });
        check(soloRes.validationStatus === "ai_unavailable" && soloRes.content === "" && soloRes.provider === "", "with zero providers the router returns honest AI_UNAVAILABLE, never fabricated content");

        // 2. Fallback: first adapter fails, second serves.
        const fallbackRouter = UnifiedLLMRouter.forTest([
            fakeProvider("fake-a", { behavior: "throw_rate" }),
            fakeProvider("fake-b", { behavior: "ok" }),
        ]);
        const fb = await fallbackRouter.execute(baseReq(), { source: "system" });
        check(fb.validationStatus === "ok" && fb.provider === "fake-b", "failed provider is skipped and fallback serves");
        check(fb.fallbackUsed === true && fb.attempts === 2, "fallback is recorded (attempts=2, fallbackUsed)");
        check((fb.errors ?? []).some((e) => e.startsWith("fake-a:")), "failed attempt surfaces sanitized error code");
        check(fb.tokenUsage.promptTokens === 12 && fb.tokenUsage.totalTokens === 46 && fb.tokenUsage.reported, "token usage extracted from provider raw payload");

        // 3. Honest failure: nothing can serve → AI_UNAVAILABLE, never fabricated.
        const deadRouter = UnifiedLLMRouter.forTest([
            fakeProvider("dead-a", { behavior: "throw_rate" }),
            fakeProvider("dead-b", { behavior: "throw_auth" }),
        ]);
        const dead = await deadRouter.execute(baseReq(), { source: "system" });
        check(dead.validationStatus === "ai_unavailable" && dead.content === "" && dead.provider === "", "all-fail returns honest AI_UNAVAILABLE with empty content");
        check((dead.errors ?? []).includes("no_candidates") === false && (dead.errors ?? []).length >= 2, "observed provider errors are surfaced");

        // 4. Paid policy gate: claude is optional premium, never mandatory.
        const paidRouter = UnifiedLLMRouter.forTest([fakeProvider("claude", { behavior: "ok" })]);
        const denied = await paidRouter.execute({ ...baseReq(), userTier: "free" }, { source: "system" });
        check(denied.validationStatus === "ai_unavailable", "paid provider is hard-gated for free tier (claude optional)");
        const allowed = await paidRouter.execute({ ...baseReq(), userTier: "admin", allowPaidFallback: true }, { source: "system" });
        check(allowed.validationStatus === "ok" && allowed.provider === "claude", "paid provider serves when policy explicitly allows");

        // 5. Circuit breaker integration: repeated failures exclude a provider.
        const breakerRouter = UnifiedLLMRouter.forTest([fakeProvider("flaky", { behavior: "throw_rate" })]);
        for (let i = 0; i < 3; i++) await breakerRouter.execute(baseReq(), { source: "system" });
        const snaps = breakerRouter.healthSnapshots().find((s) => s.provider === "flaky");
        check(snaps?.circuitState === "open", "repeated failures open the router's breaker for that provider");

        // ── Jev ──────────────────────────────────────────────────────────────
        section("Jev validation layer");
        const parsed = parseJevPayload(
            { decision: "BUY", confidence: 87, answers: [{ id: "structure_aligned", answer: "yes", confidence: 0.9 }], reasoning_summary: "Aligned." },
            "stub", "m1",
        );
        check(parsed !== null && parsed.decision === "BUY" && parsed.answers.length === 1, "valid Jev payload parses");
        check(parseJevPayload({ decision: "MAYBE", confidence: 50 }, "p", "m") === null, "invalid decision enum rejected");
        check(parseJevPayload({ decision: "BUY", confidence: 150 }, "p", "m") === null, "out-of-range confidence rejected");
        check(parseJevPayload("free-form text" as unknown, "p", "m") === null, "free-form text rejected — structured only");

        const qStructure = JEV_QUESTIONS.find((q) => q.id === "structure_aligned")!;
        const qVol = JEV_QUESTIONS.find((q) => q.id === "volatility_ok")!;
        const qFvg = JEV_QUESTIONS.find((q) => q.id === "fvg_valid")!;
        const aBuy = deriveAnswer(qStructure, ctx, "BUY");
        const aSell = deriveAnswer(qStructure, ctx, "SELL");
        const aVol = deriveAnswer(qVol, ctx, "BUY");
        const aFvg = deriveAnswer(qFvg, ctx, "BUY");
        check(aBuy?.answer === "yes" && aSell?.answer === "no", "structure question answers deterministically per direction");
        check(aVol?.answer === "yes", "normal volatility accepted");
        check(aFvg?.answer === "yes", "active FVG accepted");

        // Offline: no dedicated endpoint, LLM path returns non-Jev JSON → honest UNAVAILABLE.
        const offJev = await runJevValidation({ ctx, direction: "BUY" });
        check(offJev.validationStatus === "UNAVAILABLE" && offJev.decision === "HOLD" && offJev.confidence === 0, "without a Jev provider the result is honest UNAVAILABLE/HOLD/0");

        // ── Orchestrator ─────────────────────────────────────────────────────
        section("Decision orchestrator");
        resetSharedHealthTracker();
        resetUnifiedRouter();

        // 0. Missing facts → INVALID.
        const invalid = await orchestrateDecision({ ctx: { ...ctx, symbol: "" }, proposedDirection: "BUY", skipLLM: true });
        check(invalid.state === "INVALID" && invalid.validationStatus === "INVALID", "missing market facts → INVALID");

        // 1. All AI unavailable → AI_UNAVAILABLE, deterministic HOLD, no fabrication.
        const unavailable = await orchestrateDecision({
            ctx, proposedDirection: "BUY", skipLLM: true,
            evaluateRisk: () => ({ approved: true, code: "OK" }),
        });
        check(unavailable.state === "AI_UNAVAILABLE" && unavailable.validationStatus === "AI_UNAVAILABLE", "AI-unavailable pipeline reports AI_UNAVAILABLE");
        check(unavailable.direction === "HOLD" && unavailable.confidence === 0, "AI-unavailable decision is HOLD/0 — nothing fabricated");
        check(unavailable.risk?.approved === true, "risk PASS still evaluated and recorded");

        // 2. RISK ENGINE ALWAYS WINS: Jev BUY + risk FAIL → BLOCKED.
        const restoreFetch = stubJevEndpoint();
        try {
            const blocked = await orchestrateDecision({
                ctx, proposedDirection: "BUY", skipLLM: true,
                evaluateRisk: () => ({ approved: false, code: "MAX_DAILY_LOSS", reason: "daily loss limit reached" }),
            });
            check(blocked.state === "BLOCKED" && blocked.validationStatus === "RISK_BLOCKED", "risk FAIL → BLOCKED even with Jev agreement");
            check(blocked.jev?.decision === "BUY", "Jev opinion is recorded for audit, not applied");
            check(blocked.rationale.includes("risk engine"), "rationale names the risk engine as the blocker");

            // 3. Jev agrees + risk PASS → READY/VALIDATED.
            const ready = await orchestrateDecision({
                ctx, proposedDirection: "BUY", skipLLM: true,
                evaluateRisk: () => ({ approved: true, code: "OK" }),
            });
            check(ready.state === "READY" && ready.validationStatus === "VALIDATED", "Jev agreement + risk PASS → READY/VALIDATED");
            check(ready.direction === "BUY" && ready.confidence >= 65, "direction/confidence composed from deterministic + Jev");
            check(ready.factors.some((f) => f.source === "risk" && f.value.startsWith("PASS")), "risk PASS is an explicit factor");
            check(ready.versions.decisionPolicy === "dp-1", "decision is versioned");
        } finally {
            restoreFetch();
            delete process.env.JEV_API_URL;
            delete process.env.JEV_API_KEY;
        }

        // ── Research bridge ──────────────────────────────────────────────────
        section("Strategy research bridge");
        const goodAssessment = parseResearchAssessment({ verdict: "Evidence is internally consistent.", strengths: ["Stable WF"], concerns: [], nextChecks: [] });
        check(goodAssessment !== null && goodAssessment.strengths.length === 1, "research assessment parser validates");
        check(parseResearchAssessment({ strengths: [] }) === null, "research parser requires a verdict");

        process.env.AI_STRATEGY_RESEARCH = "false";
        const disabledRes = await runResearchAssessment(researchSnapshot());
        check(disabledRes.validationStatus === "DISABLED", "AI_STRATEGY_RESEARCH=false disables the assessment");
        delete process.env.AI_STRATEGY_RESEARCH;

        const offlineRes = await runResearchAssessment(researchSnapshot(), { userId: "u1" });
        check(offlineRes.validationStatus === "AI_UNAVAILABLE" && !offlineRes.verdict, "without providers the assessment fails honestly (no fabricated analysis)");

        // ── Challenge bridge ─────────────────────────────────────────────────
        section("Challenge review bridge");
        const reviewInput = buildChallengeReviewInput({
            attempt: { id: "att1", definitionKey: "arena-10k", status: "ACTIVE" },
            metrics: { totalReturnPct: 4.2, currentDrawdownPct: 1.8, totalTrades: 31, winRatePct: 54.8 },
            guardian: [{ id: "i1", title: "Drawdown discipline", severity: "info", message: "DD well under limit." }],
            requirements: [{ label: "Profit target", current: 4.2, target: 10, met: false }],
            recentEvents: [{ type: "RULE_BREACH", severity: "BREACH" }, { type: "TRADE_CLOSED", severity: "info" }],
        });
        check(reviewInput.metrics.totalReturnPct === 4.2, "review input projects deterministic metrics");
        check(reviewInput.recentRuleEvents.length === 1 && reviewInput.recentRuleEvents[0].type === "RULE_BREACH", "only RULE_* events become rule telemetry");

        process.env.AI_CHALLENGE_REVIEW = "false";
        const disabledReview = await runChallengeReview(reviewInput);
        check(disabledReview.validationStatus === "DISABLED" && disabledReview.ruleCompliance.length === 1, "AI_CHALLENGE_REVIEW=false keeps deterministic compliance lines");
        delete process.env.AI_CHALLENGE_REVIEW;

        const goodReview = parseChallengeReview({ narrative: "Discipline held under drawdown.", focusAreas: ["Reduce size after losses"] });
        check(goodReview !== null && goodReview.focusAreas.length === 1, "challenge review parser validates");
        check(parseChallengeReview({ focusAreas: [] }) === null, "challenge parser requires a narrative");
    } finally {
        for (const [k, v] of saved) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        resetSharedHealthTracker();
        resetUnifiedRouter();
    }

    console.log(`\n[intelligence] ${count} checks`);
    return passed;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function baseInput() {
    return {
        symbol: "XAUUSD",
        timeframe: "M5",
        timestamp: Date.now(),
        dataAgeMs: 4_000,
        marketStructure: "bullish",
        higherTimeframeContext: { bias: "bullish", timeframe: "H4" },
        liquidity: { sweeps: [{}], levels: [] },
        FVG: [{ status: "active", direction: "bullish" }],
        orderBlocks: [{ status: "active" }],
        volatility: { atr: 2.4, state: "normal" },
    };
}

function bullCtx() {
    return buildMarketIntelligenceContext(baseInput());
}

function baseReq(): AIRequest {
    return {
        task: "SIGNAL_EXPLANATION",
        messages: [{ role: "user", content: "fixture prompt" }],
        preferredModels: ["fixture-model"],
        maxTokens: 64,
    };
}

function researchSnapshot(): ResearchCandidateSnapshot {
    return {
        id: "cand-1",
        name: "Gold OB retest",
        market: "XAUUSD",
        timeframe: "M15",
        direction: "long",
        concepts: ["order_blocks"],
        lifecycle: "survivor",
        rejectedReason: null,
        backtest: { totalTrades: 120, winRatePct: 54.2, profitFactor: 1.6, maxDrawdownPct: 8.1, expectancyR: 0.32 },
        oos: { verdict: "pass", degradationPct: 12.5, stable: true },
        walkForward: { windows: 6, stable: true, stabilityScore: 0.78 },
        monteCarlo: { simulations: 1000, profitProbabilityPct: 84.2, drawdownP95Pct: 11.3 },
        score: { total: 72, verdict: "acceptable", factors: { profitFactor: 70, drawdown: 80 } },
        warnings: ["WARNING: thin sample in Q3"],
    };
}

/**
 * Deterministic stand-in for a legacy gateway provider. `getModels` returns an
 * empty catalog, which the router treats as "serves any requested model".
 */
function fakeProvider(
    id: string,
    opts: { behavior: "ok" | "throw_rate" | "throw_auth"; content?: string },
): AIProvider {
    return {
        id,
        name: id,
        isAvailable: () => true,
        getModels: async (): Promise<AIModel[]> => [],
        chat: async (_request: AIChatRequest): Promise<LegacyAIResponse> => {
            if (opts.behavior === "throw_rate") throw { code: "RATE_LIMITED" };
            if (opts.behavior === "throw_auth") throw { code: "INVALID_API_KEY" };
            return {
                success: true,
                provider: id,
                model: "fixture-model",
                content: opts.content ?? "fixture content",
                raw: { usage: { prompt_tokens: 12, completion_tokens: 34 } },
            };
        },
        describeStrategy: async () => {
            throw new Error("not implemented in fixture");
        },
        summarizeAnalysis: async () => {
            throw new Error("not implemented in fixture");
        },
    } as AIProvider;
}

/**
 * Point the Jev dedicated-endpoint path at a stubbed fetch returning a valid
 * Jev payload. Returns a restore function.
 */
function stubJevEndpoint(): () => void {
    const realFetch = globalThis.fetch;
    process.env.JEV_API_URL = "http://jev.invalid/validate";
    process.env.JEV_API_KEY = "test-key";
    globalThis.fetch = (async () =>
        new Response(
            JSON.stringify({
                // Real POST /v1/systemone envelope (verified against the live
                // endpoint): { code, data.result.answers } with typed answers.
                code: 0,
                message: "ok",
                data: {
                    result: {
                        answers: {
                            decision: {
                                type: "choice",
                                choice: "BUY",
                                probabilities: { BUY: 0.9, SELL: 0.05, HOLD: 0.05 },
                                confidence: 0.9,
                            },
                            evidence_strength: {
                                type: "score",
                                score: 3.4,
                                legend: { "0": "Very weak", "1": "Weak", "2": "Moderate", "3": "Strong", "4": "Very strong" },
                                probabilities: { "0": 0, "1": 0, "2": 0.1, "3": 0.8, "4": 0.1 },
                                confidence: 0.86,
                            },
                            structure_aligned: { type: "noul", noul: 0.94 },
                            htf_aligned: { type: "noul", noul: 0.9 },
                            liquidity_swept: { type: "noul", noul: 0.82 },
                            fvg_valid: { type: "noul", noul: 0.86 },
                            ob_valid: { type: "noul", noul: 0.8 },
                            volatility_ok: { type: "noul", noul: 0.78 },
                            regime_compatible: { type: "noul", noul: 0.75 },
                            internally_consistent: { type: "noul", noul: 0.9 },
                            quality: { type: "noul", noul: 0.83 },
                        },
                        usage: { input_tokens: 612, output_tokens: 96 },
                        elapsedMs: 140,
                    },
                    creditsUsed: 1,
                },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;
    return () => {
        globalThis.fetch = realFetch;
    };
}
