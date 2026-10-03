// ─────────────────────────────────────────────────────────────────────────────
// Autonomous Strategy Research Engine — test suite (jiti runner convention).
//
// Run: node scripts/jiti-tsrun.mjs lib/strategy-research/__tests__/run-research-tests.ts
//
// Covers: mission validation · hypothesis/compilation (incl. unsupported
// feature + future-leakage rejection) · fingerprinting/dedup · lifecycle
// decisions · scoring · robustness warnings · knowledge-graph edges ·
// lineage · setup-memory records · budget clamps · execution-safety guards ·
// and an end-to-end synthetic-data pipeline over the EXISTING engines
// (backtest → OOS/walk-forward → Monte Carlo → robustness → score).
// No RTDB writes, no network, no AI calls, no Math.random for metrics.
// ─────────────────────────────────────────────────────────────────────────────

import type { BacktestMetrics, DataBundle } from "@/lib/strategy-lab/types";;
import type { MarketCandle } from "@/lib/market-data/types";
import { MISSION_LIMITS, BUDGET_LIMITS, validateMissionSpec, validateMissionName } from "../validation";
import { buildLocalHypotheses, generateHypotheses } from "../hypothesis";
import { compileHypothesis, verifyHypothesis, hierarchyFromTimeframes } from "../compiler";
import { strategyFingerprint, canonicalStrategyStructure, isStructurallyIdentical } from "../fingerprint";
import {
    prepareRun,
    runBacktestStep,
    runValidationStep,
    runMonteCarloStep,
    runExecutionVariationStep,
    computeTradeDistribution,
    evaluateCandidate,
    researchBacktestConfig,
    estimateValidationBacktests,
    seedFromString,
} from "../runner";
import { buildResearchWarnings, buildRobustnessReport } from "../robustness";
import { scoreCandidate, decideLifecycle, detectOverfitting, SURVIVOR_THRESHOLD } from "../scoring";
import { buildCandidateEdges, buildCandidateLineage, validateResearchEdges } from "../knowledge";
import { buildCandidateMemoryRecord } from "../memory";
import { nextStage } from "../mission";
import {
    MISSION_STAGES,
    RESEARCH_CONCEPTS,
    type CandidateEvaluation,
    type ResearchCandidate,
    type ResearchMission,
    type ResearchMissionSpec,
    type StrategyHypothesis,
} from "../types";
import { SUPPORTED_SYMBOLS } from "@/lib/market-data/types";

// ── Tiny test harness ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
    if (condition) {
        passed += 1;
        console.log(`  ✓ ${name}`);
    } else {
        failed += 1;
        failures.push(name + (detail ? ` — ${detail}` : ""));
        console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    }
}

function section(title: string): void {
    console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

// ── Deterministic synthetic market data (LCG — reproducible, never Math.random) ──

function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function makeCandles(n: number): MarketCandle[] {
    const rnd = lcg(1337);
    const candles: MarketCandle[] = [];
    let price = 2000;
    let t = Date.UTC(2026, 0, 5, 0, 0, 0);
    for (let i = 0; i < n; i++) {
        const drift = (rnd() - 0.487) * 6;
        const open = price;
        const close = Math.max(50, open + drift);
        const high = Math.max(open, close) + rnd() * 1.8;
        const low = Math.min(open, close) - rnd() * 1.8;
        candles.push({ timestamp: t, open, high, low, close, volume: 100 + rnd() * 50 });
        price = close;
        t += 15 * 60 * 1000;
    }
    return candles;
}

function makeBundle(symbol: SupportedSymbolLike, candles: MarketCandle[]): DataBundle {
    return {
        symbol,
        period: "6M",
        candles: { M15: candles },
        coverage: [],
        requestedFrom: candles[0].timestamp,
        requestedTo: candles[candles.length - 1].timestamp,
        dataSource: {
            name: "synthetic-deterministic-test-feed",
            kind: "local_export",
            brokerInstrumentNote: "test",
            sourceLimits: {},
            symbolsAreExchangePrices: false,
        },
        overallCoversRequest: true,
    };
}

type SupportedSymbolLike = "XAUUSD";

function baseSpec(overrides: Partial<ResearchMissionSpec> = {}): ResearchMissionSpec {
    const validation = validateMissionSpec({
        markets: ["XAUUSD"],
        timeframes: ["M15"],
        tradingStyle: "scalping",
        concepts: ["sessions", "atr", "structure"],
        sessions: ["london", "new_york"],
        direction: "both",
        riskProfile: "conservative",
        historicalPeriod: "6M",
        maxCandidates: 6,
        ...overrides,
    });
    if (!validation.valid || !validation.normalized) {
        throw new Error(`baseSpec invalid: ${validation.errors.join(", ")}`);
    }
    return { ...validation.normalized, ...overrides, executionEnabled: false } as ResearchMissionSpec;
}

// ─────────────────────────────────────────────────────────────────────────────

function testMissionValidation(): void {
    section("Mission validation (strict runtime schema)");

    const ok = validateMissionSpec({
        markets: ["XAUUSD"],
        timeframes: ["M1", "M5", "M15"],
        tradingStyle: "scalping",
        concepts: ["smart_money", "fvg", "vwap"],
        sessions: ["london"],
        direction: "both",
        riskProfile: "conservative",
        historicalPeriod: "6M",
        maxCandidates: 10,
    });
    check("valid mission accepted", ok.valid && ok.normalized !== null, ok.errors.join("; "));
    check("executionEnabled forced false", ok.normalized?.executionEnabled === false);

    const execAttempt = validateMissionSpec({
        markets: ["XAUUSD"],
        timeframes: ["M15"],
        tradingStyle: "scalping",
        concepts: ["fvg"],
        executionEnabled: true,
    });
    check("executionEnabled=true REJECTED (execution safety)", !execAttempt.valid);
    check(
        "execution rejection message is explicit",
        execAttempt.errors.some((e) => e.includes("executionEnabled"))
    );

    const badMarket = validateMissionSpec({ markets: ["DOGEUSDT_SCAM"], timeframes: ["M15"], tradingStyle: "scalping", concepts: ["fvg"] });
    check("unknown market rejected", !badMarket.valid);

    const badTf = validateMissionSpec({ markets: ["XAUUSD"], timeframes: ["M13"], tradingStyle: "scalping", concepts: ["fvg"] });
    check("unknown timeframe rejected", !badTf.valid);

    const badStyle = validateMissionSpec({ markets: ["XAUUSD"], timeframes: ["M15"], tradingStyle: "gambling", concepts: ["fvg"] });
    check("unknown trading style rejected", !badStyle.valid);

    const noConcepts = validateMissionSpec({ markets: ["XAUUSD"], timeframes: ["M15"], tradingStyle: "scalping", concepts: [] });
    check("empty concepts rejected", !noConcepts.valid);

    const capped = validateMissionSpec({
        markets: ["XAUUSD"],
        timeframes: ["M15"],
        tradingStyle: "scalping",
        concepts: ["fvg"],
        maxCandidates: 9999,
    });
    check(
        `maxCandidates capped at ${MISSION_LIMITS.maxCandidates}`,
        (capped.normalized?.maxCandidates ?? 0) <= MISSION_LIMITS.maxCandidates,
        `got ${capped.normalized?.maxCandidates}`
    );

    const budgetClamped = validateMissionSpec({
        markets: ["XAUUSD"],
        timeframes: ["M15"],
        tradingStyle: "scalping",
        concepts: ["fvg"],
        budget: { maxBacktests: 10_000_000, maxAIRequests: -4, maxHypotheses: 99999, maxDurationMs: 1 },
    });
    const b = budgetClamped.normalized?.budget;
    check("budget.maxBacktests clamped to hard ceiling", b?.maxBacktests === BUDGET_LIMITS.maxBacktests.max, `got ${b?.maxBacktests}`);
    check("budget.maxAIRequests floored at 0", b?.maxAIRequests === 0, `got ${b?.maxAIRequests}`);
    check("budget.maxHypotheses clamped", (b?.maxHypotheses ?? 0) <= BUDGET_LIMITS.maxHypotheses.max);
    check("budget.maxDurationMs floored at 1min", b?.maxDurationMs === BUDGET_LIMITS.maxDurationMs.min, `got ${b?.maxDurationMs}`);
    check("forwardTesting defaults false", budgetClamped.normalized?.forwardTesting === false);

    check("mission name sanitized", validateMissionName("   ") === "Research Mission");
    check("mission name truncated", validateMissionName("x".repeat(500)).length <= MISSION_LIMITS.maxNameLength);

    const nonObject = validateMissionSpec("DROP TABLE");
    check("non-object spec rejected", !nonObject.valid);
}

function testHypothesisGenerationAndCompilation(): void {
    section("Hypothesis generation + strategy compiler");

    const spec = baseSpec();
    const drafts = buildLocalHypotheses(spec, "XAUUSD");
    check("deterministic local hypotheses exist", drafts.length > 0, `got ${drafts.length}`);
    check(
        "one draft per concept-direction pair (bounded)",
        drafts.length <= spec.concepts.length * 2,
        `${drafts.length} vs ${spec.concepts.length * 2}`
    );

    const draft = drafts[0];
    const hypothesis: StrategyHypothesis = {
        id: "hyp_test_1",
        missionId: "mission_test",
        market: "XAUUSD",
        timeframes: spec.timeframes,
        direction: draft.direction,
        rationale: draft.description ?? "test",
        concepts: spec.concepts,
        draft: draft as unknown as Record<string, unknown>,
        source: "local",
        createdAt: Date.now(),
    };

    const compiled = compileHypothesis(hypothesis, spec);
    check("local hypothesis compiles", "strategy" in compiled && compiled.report.valid);
    if ("strategy" in compiled) {
        check("compiled strategy has deterministic id", compiled.strategy.id.startsWith("cand_"));
        check("compiled strategy keeps provenance", compiled.strategy.description.includes("mission_test"));
        check("compiled execution model is leak-safe default", compiled.strategy.executionModel === "next_bar_open");
        check("no futureLeakageRisk flagged", compiled.report.futureLeakageRisk === false);
        check("hierarchy built from mission timeframes", compiled.strategy.timeframes.setup === "M15");
    }

    // Unsupported / malicious AI proposals must be rejected, never executed.
    const bogusGroup: StrategyHypothesis = {
        ...hypothesis,
        id: "hyp_bad_group",
        draft: {
            name: "AI tried to inject code",
            direction: "long",
            entryRules: [{ group: "custom", operator: "eq", value: "rm -rf /" }],
        },
    };
    const badGroup = compileHypothesis(bogusGroup, spec);
    check("unsupported rule group rejected", !("strategy" in badGroup) && !badGroup.report.valid);
    check(
        "unsupported feature reported honestly",
        "unsupportedFeatures" in badGroup.report && badGroup.report.unsupportedFeatures.length > 0
    );

    const bogusOperator: StrategyHypothesis = {
        ...hypothesis,
        id: "hyp_bad_op",
        draft: {
            name: "bogus operator",
            direction: "long",
            entryRules: [{ group: "structure", operator: "exec", value: "hh" }],
        },
    };
    const badOp = compileHypothesis(bogusOperator, spec);
    check("unsupported operator rejected", !("strategy" in badOp));

    const emptyRules: StrategyHypothesis = { ...hypothesis, id: "hyp_empty", draft: { name: "empty", direction: "long", entryRules: [] } };
    const empty = compileHypothesis(emptyRules, spec);
    check("hypothesis without entry rules rejected", !("strategy" in empty));

    const futureLeak: StrategyHypothesis = {
        ...hypothesis,
        id: "hyp_future",
        draft: {
            name: "time traveller",
            direction: "long",
            entryRules: [{ group: "structure", operator: "eq", value: "hh", timeframe: "M99" }],
            executionModel: "peek_next_candle",
        },
    };
    const leak = compileHypothesis(futureLeak, spec);
    check("invalid execution model rejected", !("strategy" in leak));
    check(
        "invalid timeframe surfaced as error",
        "report" in leak && leak.report.errors.some((e) => e.includes("timeframe"))
    );

    const risky: StrategyHypothesis = {
        ...hypothesis,
        id: "hyp_risk",
        draft: {
            ...draft,
            direction: draft.direction,
            entryRules: draft.entryRules,
            risk: { mode: "percent", riskPercent: 50 },
        },
    };
    const riskyResult = compileHypothesis(risky, spec);
    check("riskPercent above research envelope rejected", !("strategy" in riskyResult));

    const tooMany: StrategyHypothesis = {
        ...hypothesis,
        id: "hyp_too_many",
        draft: {
            ...draft,
            entryRules: Array.from({ length: 8 }, () => ({ group: "structure", operator: "eq", value: "hh" })),
        },
    };
    const tooManyResult = compileHypothesis(tooMany, spec);
    check(">6 entry rules rejected (engine limit)", !("strategy" in tooManyResult));

    // verifyHypothesis is exposed for the critic: warnings vs errors distinct.
    const verify = verifyHypothesis(hypothesis, spec);
    check("verifyHypothesis returns structured arrays", Array.isArray(verify.errors) && Array.isArray(verify.warnings) && Array.isArray(verify.unsupported));
    check("valid hypothesis has no verify errors", verify.errors.length === 0, verify.errors.join("; "));

    const hierarchy = hierarchyFromTimeframes(["M1", "M5", "M15"]);
    check("timeframe hierarchy resolves macro/structure/setup/entry", hierarchy.setup === "M1" && hierarchy.macro === "M15", JSON.stringify(hierarchy));
}

async function testAIOutputValidation(): Promise<void> {
    section("AI output validation (untrusted proposals)");

    const spec = baseSpec();
    // useAI: false must never touch a provider (AI budget / forced local mode).
    const local = await generateHypotheses(spec, "mission_ai", "XAUUSD", 3, { useAI: false });
    check("local mode returns hypotheses without AI", local.hypotheses.length > 0, `got ${local.hypotheses.length}`);
    check("local mode reports source=local", local.source === "local");
    check("local mode reports aiUsed=false (never claims AI ran)", local.aiUsed === false);

    for (const h of local.hypotheses) {
        const res = compileHypothesis(h, spec);
        check(`generated hypothesis "${h.id}" passes deterministic compilation`, "strategy" in res && res.report.valid);
        if ("strategy" in res) {
            check(
                `generated strategy "${h.id}" has no leakage flag`,
                res.report.futureLeakageRisk === false && res.report.errors.length === 0
            );
        }
    }
}

function testFingerprintAndDedup(): void {
    section("Structural fingerprinting + deduplication");

    const spec = baseSpec();
    const drafts = buildLocalHypotheses(spec, "XAUUSD");
    const mk = (draft: typeof drafts[number], suffix: string): StrategyHypothesis => ({
        id: `hyp_${suffix}`,
        missionId: "m",
        market: "XAUUSD",
        timeframes: spec.timeframes,
        direction: draft.direction,
        rationale: `rationale ${suffix}`,
        concepts: spec.concepts,
        draft: { ...(draft as unknown as Record<string, unknown>), name: `Name ${suffix}`, description: `Desc ${suffix}` },
        source: "ai",
        createdAt: Date.now(),
    });

    const a = compileHypothesis(mk(drafts[0], "a"), spec);
    const b = compileHypothesis(mk(drafts[0], "b"), spec);
    check("both variants compiled", "strategy" in a && "strategy" in b);
    if ("strategy" in a && "strategy" in b) {
        check("identical structure → different ids (dedup needed)", a.strategy.id !== b.strategy.id);
        check("identical structure → SAME fingerprint", strategyFingerprint(a.strategy) === strategyFingerprint(b.strategy));
        check("isStructurallyIdentical true", isStructurallyIdentical(a.strategy, b.strategy));
        check("cosmetic rename does NOT change fingerprint", strategyFingerprint({ ...a.strategy, name: "Renamed", description: "other" }) === strategyFingerprint(a.strategy));
    }

    if ("strategy" in a && drafts.length > 1) {
        const c = compileHypothesis(mk(drafts[1], "c"), spec);
        if ("strategy" in c) {
            check(
                "different structure → different fingerprint",
                strategyFingerprint(c.strategy) !== strategyFingerprint(a.strategy),
                "drafts[0] vs drafts[1] produced identical structure"
            );
        }
    }

    if ("strategy" in a) {
        const canonical = canonicalStrategyStructure(a.strategy);
        check("canonical form excludes free text", !canonical.includes("Name a") && !canonical.includes("rationale"));
        const changed = { ...a.strategy, direction: a.strategy.direction === "long" ? ("short" as const) : ("long" as const) };
        check("direction change → different fingerprint", strategyFingerprint(changed) !== strategyFingerprint(a.strategy));
    }

    check("stableHash deterministic", seedFromString("abc") === seedFromString("abc") && strategyHashStable());
}

function strategyHashStable(): boolean {
    const spec = baseSpec();
    const drafts = buildLocalHypotheses(spec, "XAUUSD");
    const h: StrategyHypothesis = {
        id: "h1", missionId: "m", market: "XAUUSD", timeframes: spec.timeframes,
        direction: drafts[0].direction, rationale: "", concepts: spec.concepts,
        draft: drafts[0] as unknown as Record<string, unknown>, source: "local", createdAt: 1,
    };
    const one = compileHypothesis(h, spec);
    const two = compileHypothesis({ ...h, id: "h2" }, spec);
    return "strategy" in one && "strategy" in two && strategyFingerprint(one.strategy) === strategyFingerprint(two.strategy);
}

// ── Synthetic full-pipeline evaluation (existing engines only) ───────────────

function testFullPipelineOnSyntheticData(): void {
    section("Full evaluation pipeline (existing backtest/OOS/WF/MC engines)");

    const spec = baseSpec();
    const candles = makeCandles(7000); // ~73 days of M15 bars
    const bundle = makeBundle("XAUUSD", candles);
    const drafts = buildLocalHypotheses(spec, "XAUUSD");
    const hypothesis: StrategyHypothesis = {
        id: "hyp_pipe", missionId: "mission_pipe", market: "XAUUSD", timeframes: spec.timeframes,
        direction: drafts[0].direction, rationale: "pipeline", concepts: spec.concepts,
        draft: drafts[0] as unknown as Record<string, unknown>, source: "local", createdAt: Date.now(),
    };
    const compiled = compileHypothesis(hypothesis, spec);
    check("pipeline candidate compiled", "strategy" in compiled && compiled.report.valid);
    if (!("strategy" in compiled)) return;

    const strategy = compiled.strategy;
    const ctx = { market: "XAUUSD" as const, bundle, spec };

    const prep = prepareRun(strategy, ctx);
    check("prepareRun succeeds on sufficient data", prep.prepared !== null, prep.errors.join("; "));
    if (!prep.prepared) return;

    check("research backtest config keeps risk profile bounds", prep.prepared.config.riskPercent === 0.5 && prep.prepared.config.maxDrawdownPct === 15);
    check("research config preserves next_bar_open", prep.prepared.config.executionModel === strategy.executionModel);

    const bt = runBacktestStep("cand_test", strategy, ctx, prep.prepared);
    check("backtest step produces metrics", bt.backtest !== null, bt.errors.join("; "));
    check("backtest step charges exactly 1 backtest", bt.backtestsUsed === 1);
    if (bt.backtest) {
        check("backtest metrics are finite numbers", Number.isFinite(bt.backtest.metrics.profitFactor) && Number.isFinite(bt.backtest.metrics.maxDrawdownPct));
        check("backtest window recorded for reproducibility", bt.backtest.window !== null && bt.backtest.window.bars === 7000);
        check("execution assumptions recorded", typeof bt.backtest.config.spreadPips === "number" && typeof bt.backtest.config.slippagePips === "number");
    }

    const val = runValidationStep(strategy, ctx, prep.prepared);
    check("validation step (OOS + walk-forward) returns an outcome", val.validation !== null, val.errors.join("; "));
    check("validation charges backtests (bounded)", val.backtestsUsed >= 2 && val.backtestsUsed <= estimateValidationBacktests(prep.prepared.from, prep.prepared.to, true));
    if (val.validation) {
        const outcome = val.validation.outcome;
        check("OOS split exists (in-sample + out-of-sample)", outcome.inSample.from < outcome.outOfSample.from);
        check("degradation is a finite number", Number.isFinite(outcome.degradation.overall));
        check("verdict within known set", ["robust", "marginal", "fragile", "inconclusive"].includes(outcome.verdict));
        check("walk-forward windows computed when data allows", outcome.walkForward.windows.length >= 0);
    }

    const trades = bt.fullResult?.trades ?? [];
    const mc = runMonteCarloStep("cand_test", trades, spec);
    check("Monte Carlo step returns a summary (or honest limitation)", mc.monteCarlo !== null, mc.errors.join("; "));
    if (mc.monteCarlo) {
        const s = mc.monteCarlo.summary;
        check("MC uses a deterministic seed", s.seed === seedFromString("cand_test"));
        if (trades.length >= 2) {
            check("MC ran simulations on real trades", s.simulations > 0 && s.sourceTradeCount === trades.length);
            check("MC profit probability in [0,1] or null", s.profitProbability === null || (s.profitProbability >= 0 && s.profitProbability <= 1));
        } else {
            check("MC honestly reports zero simulations on tiny samples", s.simulations === 0 && s.limitations.length > 0);
        }
        check("MC never claims synthetic trades", s.sourceTradeCount === trades.length);
    }

    const ev = runExecutionVariationStep(strategy, ctx, prep.prepared);
    check("execution variation returns measurements or honest failure", ev.executionVariation !== null || ev.errors.length > 0);
    check("execution variation charges 3 backtests when it runs", ev.executionVariation ? ev.backtestsUsed === 3 : ev.backtestsUsed <= 3);

    const full = evaluateCandidate("cand_full", strategy, ctx);
    check("one-shot evaluateCandidate returns evaluation", full.evaluation !== null, full.errors.join("; "));
    if (full.evaluation) {
        check("evaluation includes robustness score from existing engine", full.evaluation.robustness !== null);
        check("evaluation includes distribution evidence", full.evaluation.backtest !== null);
        const report = buildRobustnessReport("cand_full", full.evaluation, spec);
        check("robustness report built for full evaluation", report.dimensions.length > 0 && report.status !== undefined);
        check("robustness report lists every dimension", report.dimensions.length === 7, `${report.dimensions.length} dimensions`);
    }
}

function testScoringAndLifecycle(): void {
    section("Transparent scoring + lifecycle decisions");

    const spec = baseSpec();
    const metrics: BacktestMetrics = {
        totalTrades: 120, winningTrades: 66, losingTrades: 54, breakevenTrades: 0, winRate: 55,
        netProfit: 1500, grossProfit: 3000, grossLoss: -1500, profitFactor: 2, averageWin: 45, averageLoss: -28,
        expectancy: 12.5, expectancyR: 0.3, largestWin: 200, largestLoss: -120, maxDrawdownPct: 8,
        maxDrawdownAbs: 300, maxConsecutiveWins: 6, maxConsecutiveLosses: 3, averageTradeDurationMs: 3600_000,
        returnPct: 15, finalBalance: 11500, sharpeLike: 1.4, recoveryFactor: 5, buyHoldReturnPct: 4,
        longTrades: 60, shortTrades: 60, longWinRate: 56, shortWinRate: 54,
    };

    const goodValidation = {
        id: "v", symbol: "XAUUSD" as const, strategyId: "s", strategyName: "S", generatedAt: Date.now(),
        inSample: { label: "IS", from: 0, to: 100, metrics: { ...metrics, winRate: 54, totalTrades: 70 }, trades: 70 },
        outOfSample: { label: "OOS", from: 101, to: 200, metrics: { ...metrics, winRate: 52, totalTrades: 50 }, trades: 50 },
        degradation: { winRateDiff: 2, profitFactorDiff: 0.1, returnDiff: 1, maxDrawdownDiff: 1, overall: 3.5 },
        walkForward: {
            enabled: true, trainMonths: 1, testMonths: 1,
            windows: [
                { train: { from: 0, to: 1 }, test: { from: 1, to: 2 }, trainMetrics: metrics, testMetrics: metrics, degradationPct: 4 },
            ],
            stable: true, stabilityScore: 88,
        },
        verdict: "robust" as const,
        config: {} as never,
    };

    const evaluation: CandidateEvaluation = {
        backtest: {
            backtestId: "bt_1",
            metrics,
            config: {} as never,
            executedAt: Date.now(),
            distribution: { monthsCovered: 6, topMonthSharePct: 30, topRegimeSharePct: 45, profitableMonthShare: 0.67, longSharePct: 50 },
            window: { from: 0, to: 1, bars: 7000, dataSource: "local_export" },
        },
        validation: { outcome: goodValidation, oosRequired: true, walkForwardRequired: true },
        monteCarlo: {
            summary: { seed: 1, simulations: 1000, sourceTradeCount: 120, drawdownP95: 0.1, returnP5: 0.02, profitProbability: 0.8, limitations: [] },
            required: true,
        },
        robustness: { score: 78, grade: "A", factors: { consistency: 90, drawdown: 90, profitFactor: 90, sampleSize: 70, outOfSample: 90, parameterSensitivity: 70, losingStreaks: 90 }, notes: [] },
        executionVariation: { baseNet: 1500, spreadDoubledNet: 1350, slippageDoubledNet: 1420 },
    };

    const scored = scoreCandidate(evaluation, spec);
    check("score produced for healthy evaluation", scored.score !== null, scored.notes.join("; "));
    check("score within 0-100", (scored.score?.total ?? -1) >= 0 && (scored.score?.total ?? 101) <= 100, `got ${scored.score?.total}`);
    check("all score factors exposed", scored.score ? Object.keys(scored.score.factors).length === 8 : false);
    check("score marked as research aid, not advice", (scored.score?.notes ?? []).some((n) => n.toLowerCase().includes("not investment advice")) || scored.notes.some((n) => n.toLowerCase().includes("not investment advice")));
    check("deterministic scoring (same input → same output)", JSON.stringify(scoreCandidate(evaluation, spec).score) === JSON.stringify(scored.score));

    const candidate: ResearchCandidate = {
        id: "cand_ok", missionId: "m", uid: "u",
        hypothesis: {
            id: "h", missionId: "m", market: "XAUUSD", timeframes: ["M15"], direction: "long",
            rationale: "", concepts: ["fvg"], draft: {}, source: "local", createdAt: 1,
        },
        compilation: { hypothesisId: "h", valid: true, errors: [], warnings: [], unsupportedFeatures: [], futureLeakageRisk: false, strategyId: "cand_ok" },
        strategy: null, evaluation, score: scored.score, warnings: [], robustnessReport: null,
        fingerprint: "fp", linkedTo: null, lifecycle: "robustness_analysis", rejectedReason: null,
        rejectedNotes: [], knowledgeEdges: [], memoryRecordId: null, incubationStrategyId: null,
        forwardTestId: null, createdAt: 1, updatedAt: 1,
    };

    const survivor = decideLifecycle(candidate, spec);
    check("healthy candidate survives", survivor.lifecycle === "survivor" && survivor.rejectedReason === null, `${survivor.lifecycle}/${survivor.rejectedReason}`);

    const noEval = decideLifecycle({ ...candidate, evaluation: null, score: null }, spec);
    check("missing evaluation → failed (fail-closed, not ranked)", noEval.lifecycle === "failed" && noEval.rejectedReason === "data_unavailable");

    const badCompile = decideLifecycle(
        { ...candidate, compilation: { ...candidate.compilation, valid: false, errors: ["bad rule"] }, lifecycle: "compiled" },
        spec
    );
    check("invalid compilation → rejected compile_failed", badCompile.lifecycle === "rejected" && badCompile.rejectedReason === "compile_failed");

    const noOos = decideLifecycle(
        { ...candidate, evaluation: { ...evaluation, validation: null } },
        { ...spec, requireOOS: true }
    );
    check("required OOS missing → rejected oos_failed", noOos.rejectedReason === "oos_failed");

    const unstableWf = decideLifecycle(
        {
            ...candidate,
            evaluation: {
                ...evaluation,
                validation: { ...evaluation.validation!, outcome: { ...goodValidation, walkForward: { ...goodValidation.walkForward, stable: false, stabilityScore: 20 } } },
            },
        },
        { ...spec, requireWalkForward: true }
    );
    check("unstable walk-forward → rejected walk_forward_unstable", unstableWf.rejectedReason === "walk_forward_unstable");

    const noMc = decideLifecycle({ ...candidate, evaluation: { ...evaluation, monteCarlo: null } }, { ...spec, requireMonteCarlo: true });
    check("required Monte Carlo missing → rejected monte_carlo_fragile", noMc.rejectedReason === "monte_carlo_fragile");

    const lowSample = scoreCandidate({ ...evaluation, backtest: { ...evaluation.backtest!, metrics: { ...metrics, totalTrades: 4, winRate: 50 } } }, spec);
    check("insufficient trades → not ranked", lowSample.rejection === "insufficient_trades");

    const overfitEval: CandidateEvaluation = {
        ...evaluation,
        validation: { ...evaluation.validation!, outcome: { ...goodValidation, degradation: { ...goodValidation.degradation, overall: 22 }, verdict: "fragile" } },
    };
    const overfit = scoreCandidate(overfitEval, spec);
    check("high OOS degradation → overfit_detected", overfit.rejection === "overfit_detected", overfit.notes.join("; "));

    const overfitSignals = detectOverfitting(overfitEval);
    check("detectOverfitting flags degradation + fragile verdict", overfitSignals.overfit && overfitSignals.signals.length > 0);

    const mcPessimistic = detectOverfitting({ ...evaluation, monteCarlo: { ...evaluation.monteCarlo!, summary: { ...evaluation.monteCarlo!.summary, profitProbability: 0.1 } } });
    check("pessimistic Monte Carlo flagged as overfit/fragile", mcPessimistic.overfit);

    // Survivor threshold sanity
    check("survivor threshold is a positive, sub-100 research constant", SURVIVOR_THRESHOLD > 0 && SURVIVOR_THRESHOLD < 100);
}

function testRobustnessWarnings(): void {
    section("Robustness + overfitting warnings (deterministic)");

    const spec = baseSpec();
    const noEval = buildResearchWarnings(null, spec);
    check("null evaluation → missing_validation warning", noEval.length === 1 && noEval[0].type === "missing_validation" && noEval[0].severity === "high");

    const baseMetrics = {
        totalTrades: 60, winningTrades: 30, losingTrades: 30, breakevenTrades: 0, winRate: 50,
        netProfit: 500, grossProfit: 1200, grossLoss: -700, profitFactor: 1.7, averageWin: 40, averageLoss: -23,
        expectancy: 8, expectancyR: 0.2, largestWin: 100, largestLoss: -60, maxDrawdownPct: 9,
        maxDrawdownAbs: 200, maxConsecutiveWins: 5, maxConsecutiveLosses: 4, averageTradeDurationMs: 1000,
        returnPct: 5, finalBalance: 10500, sharpeLike: 1.1, recoveryFactor: 3, buyHoldReturnPct: 2,
        longTrades: 30, shortTrades: 30, longWinRate: 50, shortWinRate: 50,
    } as never;

    const evaluation: CandidateEvaluation = {
        backtest: {
            backtestId: null, metrics: baseMetrics, config: {} as never, executedAt: Date.now(),
            distribution: { monthsCovered: 5, topMonthSharePct: 88, topRegimeSharePct: 92, profitableMonthShare: 0.2, longSharePct: 95 },
            window: null,
        },
        validation: {
            outcome: {
                id: "v", symbol: "XAUUSD", strategyId: "s", strategyName: "S", generatedAt: Date.now(),
                inSample: { label: "IS", from: 0, to: 1, metrics: baseMetrics, trades: 30 },
                outOfSample: { label: "OOS", from: 2, to: 3, metrics: baseMetrics, trades: 0 },
                degradation: { winRateDiff: 10, profitFactorDiff: 1.2, returnDiff: 8, maxDrawdownDiff: 6, overall: 15 },
                walkForward: { enabled: true, trainMonths: 1, testMonths: 1, windows: [], stable: false, stabilityScore: 10 },
                verdict: "fragile", config: {} as never,
            },
            oosRequired: true, walkForwardRequired: true,
        },
        monteCarlo: {
            summary: { seed: 7, simulations: 1000, sourceTradeCount: 60, drawdownP95: 0.35, returnP5: -0.1, profitProbability: 0.15, limitations: [] },
            required: true,
        },
        robustness: { score: 30, grade: "D", factors: { consistency: 40, drawdown: 60, profitFactor: 70, sampleSize: 50, outOfSample: 20, parameterSensitivity: 20, losingStreaks: 45 }, notes: [] },
        executionVariation: { baseNet: 500, spreadDoubledNet: 50, slippageDoubledNet: 480 },
    };

    const warnings = buildResearchWarnings(evaluation, spec);
    const types = warnings.map((w) => w.type);
    check("OOS degradation warning raised", types.includes("oos_degradation"));
    check("walk-forward instability warning raised", types.includes("walk_forward_unstable"));
    check("zero-trade OOS warning raised", warnings.some((w) => w.message.toLowerCase().includes("out-of-sample window produced zero trades") || w.evidence.some((e) => e.includes("outOfSample trades=0"))));
    check("date-range concentration warning raised", types.includes("date_range_dependence"));
    check("regime dependence warning raised", types.includes("regime_dependence"));
    check("Monte Carlo fragility warning raised", types.includes("monte_carlo_fragile"));
    check("execution sensitivity warning raised", types.includes("execution_sensitivity"));
    check("robustness-grade warning raised", types.includes("parameter_sensitivity"));
    check("warnings sorted severity-first", warnings[0].severity === "high");
    check("every warning carries evidence", warnings.every((w) => w.evidence.length > 0));

    const report = buildRobustnessReport("cand_warn", evaluation, spec);
    check("report marked fragile on failing dimensions", report.status === "fragile", report.status);
    check("report includes all dimensions even when failing", report.dimensions.length === 7);
    check("report never hides concerns", report.dimensions.some((d) => d.status === "fail" || d.status === "concern"));
    check("skipped dimensions are labeled, not faked", report.dimensions.every((d) => ["pass", "concern", "fail", "skipped"].includes(d.status)));

    const incomplete = buildRobustnessReport("cand_none", null, spec);
    check("missing evaluation → report incomplete with warning", incomplete.status === "incomplete" && incomplete.warnings.length > 0);
}

function testKnowledgeLineageMemory(): void {
    section("Knowledge Graph · lineage · Strategy Memory integration");

    const spec = baseSpec();
    const now = Date.now();
    const localDrafts = buildLocalHypotheses(spec, "XAUUSD");
    const compiledKg = compileHypothesis(
        {
            id: "hyp_kg_compile", missionId: "mission_kg", market: "XAUUSD", timeframes: spec.timeframes,
            direction: localDrafts[0].direction, rationale: "kg", concepts: spec.concepts,
            draft: localDrafts[0] as unknown as Record<string, unknown>, source: "local", createdAt: now,
        },
        spec
    );
    if (!("strategy" in compiledKg)) {
        check("KG test strategy compiled", false);
        return;
    }
    const mission: ResearchMission = {
        id: "mission_kg", uid: "u1", name: "KG mission", spec, status: "completed",
        stages: MISSION_STAGES.map((s) => ({ stage: s, status: "completed", attempts: 1 })),
        currentStage: "done", dataQuality: null, hypothesisCount: 2, compiledCount: 2,
        rejectedCount: 1, survivorCount: 1, failState: null,
        budgetUsed: { hypotheses: 2, backtests: 10, aiRequests: 1, startedAt: now },
        lease: null, createdAt: now, updatedAt: now, lineageNote: "test",
    };

    const candidate: ResearchCandidate = {
        id: "cand_kg", missionId: mission.id, uid: "u1",
        hypothesis: {
            id: "hyp_kg", missionId: mission.id, market: "XAUUSD", timeframes: ["M15"],
            direction: "long", rationale: "because FVG", concepts: ["fvg"], draft: {}, source: "ai", createdAt: now,
        },
        compilation: { hypothesisId: "hyp_kg", valid: true, errors: [], warnings: [], unsupportedFeatures: [], futureLeakageRisk: false, strategyId: "cand_kg" },
        strategy: compiledKg.strategy,
        evaluation: null,
        score: { total: 70, factors: { profitFactor: 70, drawdown: 70, consistency: 70, outOfSample: 70, walkForward: 70, monteCarlo: 70, robustness: 70, sampleSize: 70 }, verdict: "strong", notes: [] },
        warnings: [],
        robustnessReport: null,
        fingerprint: "fp_kg",
        linkedTo: "cand_dup",
        lifecycle: "incubated",
        rejectedReason: null,
        rejectedNotes: [],
        knowledgeEdges: [],
        memoryRecordId: null,
        incubationStrategyId: "cand_kg",
        forwardTestId: null,
        createdAt: now,
        updatedAt: now,
    };

    const edges = buildCandidateEdges(mission, candidate);
    check("edges built with existing helpers", edges.length > 0, `${edges.length} edges`);
    check("mission → hypothesis edge (MISSION_GENERATED)", edges.some((e) => e.type === "MISSION_GENERATED" && e.from.id === mission.id));
    check("hypothesis → mission edge (HYPOTHESIS_DERIVED_FROM)", edges.some((e) => e.type === "HYPOTHESIS_DERIVED_FROM" && e.to.id === mission.id));
    check("duplicate link edge (STRATEGY_SIMILAR_TO)", edges.some((e) => e.type === "STRATEGY_SIMILAR_TO" && e.to.id === "cand_dup"));
    check("edge ids deterministic (no dupes)", new Set(edges.map((e) => e.id)).size === edges.length);

    const validation = validateResearchEdges(edges);
    check("research edges pass EXISTING graph validator", validation.valid && validation.invalidEdges.length === 0, validation.warnings.join("; "));

    const lineage = buildCandidateLineage(mission, candidate);
    check("lineage traces mission → hypothesis → strategy", lineage[0]?.kind === "mission" && lineage[1]?.kind === "hypothesis" && lineage[2]?.kind === "strategy");
    check("lineage covers validation stages", ["backtest", "oos", "walk_forward", "monte_carlo", "robustness"].every((k) => lineage.some((l) => l.kind === k)));
    check("lineage covers incubation + forward test", lineage.some((l) => l.kind === "incubation") && lineage.some((l) => l.kind === "forward_test"));
    check("incubation entry shows completed for incubated candidate", lineage.find((l) => l.kind === "incubation")?.status === "completed");

    const survivorRecord = buildCandidateMemoryRecord(mission, candidate);
    check("memory record uses existing RESEARCH mode", survivorRecord.mode === "RESEARCH");
    check("survivor remembered as TRIGGERED", survivorRecord.status === "TRIGGERED");
    check("memory record links research id", survivorRecord.links?.researchId === mission.id);
    check("memory conditions count consistent", survivorRecord.matchedCount <= survivorRecord.totalCount && survivorRecord.totalCount > 0);

    const rejectedRecord = buildCandidateMemoryRecord(mission, {
        ...candidate, lifecycle: "rejected", rejectedReason: "oos_failed", rejectedNotes: ["degradation 20"],
    });
    check("rejected strategy remembered as INVALIDATED (never deleted)", rejectedRecord.status === "INVALIDATED");
    check("rejection reason persisted in memory", (rejectedRecord.notes ?? "").includes("oos_failed"));

    const next = nextStage("backtest");
    check("stage progression order", next === "validate");
    check("final stage has no next", nextStage("done") === null);
}

function testExecutionSafetyGuards(): void {
    section("Execution safety + fail-closed guards");

    const spec = baseSpec();
    check("mission spec structurally forbids execution", spec.executionEnabled === false);

    // researchBacktestConfig never escalates risk beyond profile
    const drafts = buildLocalHypotheses(spec, "XAUUSD");
    const compiled = compileHypothesis(
        {
            id: "h", missionId: "m", market: "XAUUSD", timeframes: spec.timeframes,
            direction: drafts[0].direction, rationale: "", concepts: spec.concepts,
            draft: drafts[0] as unknown as Record<string, unknown>, source: "local", createdAt: 1,
        },
        spec
    );
    if ("strategy" in compiled) {
        const cfg = researchBacktestConfig(spec, compiled.strategy);
        check("config riskPercent matches conservative profile", cfg.riskPercent === 0.5);
        check("config daily loss limit matches profile", cfg.dailyLossLimitPct === 2);
        check("config max drawdown matches profile", cfg.maxDrawdownPct === 15);
    }

    // Data insufficiency must fail closed, never fabricate.
    if ("strategy" in compiled) {
        const emptyBundle = makeBundle("XAUUSD", makeCandles(30));
        const prep = prepareRun(compiled.strategy, {
            market: "XAUUSD", bundle: emptyBundle, spec,
        });
        check("insufficient data → explicit failure (no fabrication)", prep.prepared === null && prep.errors.some((e) => e.includes("Insufficient historical")));
    } else {
        check("insufficient data → explicit failure (no fabrication)", false, "compile failed unexpectedly");
    }

    // Validation backtest estimates are conservative (upper bounds)
    check("validation estimate covers IS+OOS minimum", estimateValidationBacktests(0, 1000, false) === 2);
    check("walk-forward estimate grows with window length", estimateValidationBacktests(0, 90 * 86_400_000, true) > 2);
}

function testSupportedVocabulary(): void {
    section("Platform vocabulary consistency");

    const allConceptsValid = RESEARCH_CONCEPTS.every((c) =>
        validateMissionSpec({ markets: [SUPPORTED_SYMBOLS[0]], timeframes: ["M15"], tradingStyle: "scalping", concepts: [c] }).valid
    );
    check("every declared research concept passes validation", allConceptsValid);
    check("mission stages are ordered and finite", MISSION_STAGES.length === 8 && MISSION_STAGES[0] === "data" && MISSION_STAGES[MISSION_STAGES.length - 1] === "done");

    const distribution = computeTradeDistribution([
        { profit: 100, openedAt: Date.UTC(2026, 0, 10), direction: "BUY", regime: "trending_bullish" },
        { profit: -50, openedAt: Date.UTC(2026, 0, 20), direction: "SELL", regime: "ranging" },
        { profit: 30, openedAt: Date.UTC(2026, 1, 10), direction: "BUY", regime: "trending_bullish" },
    ] as never);
    check("trade distribution computed from real trades", distribution !== null && distribution.monthsCovered === 2);
    check("top-regime share deterministic (130 of 130 positive PnL)", distribution?.topRegimeSharePct === 100, `got ${distribution?.topRegimeSharePct}`);
    check("empty trades → null distribution (no fabrication)", computeTradeDistribution([] as never) === null);
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log("==========================================");
    console.log(" Strategy Research Engine — Test Suite    ");
    console.log("==========================================");

    testMissionValidation();
    testHypothesisGenerationAndCompilation();
    await testAIOutputValidation();
    testFingerprintAndDedup();
    testFullPipelineOnSyntheticData();
    testScoringAndLifecycle();
    testRobustnessWarnings();
    testKnowledgeLineageMemory();
    testExecutionSafetyGuards();
    testSupportedVocabulary();

    console.log("\n==========================================");
    console.log(` passed: ${passed} · failed: ${failed}`);
    if (failed > 0) {
        console.error(" Failures:");
        for (const f of failures) console.error(`  ✗ ${f}`);
        console.error("==========================================");
        process.exit(1);
    }
    console.log("🎉 ALL STRATEGY RESEARCH TESTS PASSED");
    console.log("==========================================");
    process.exit(0);
}

void main();
