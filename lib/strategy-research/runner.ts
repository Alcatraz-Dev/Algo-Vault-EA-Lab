// ─────────────────────────────────────────────────────────────────────────────
// Candidate evaluation runner.
//
// Every number produced here comes from the EXISTING deterministic engines:
//   • backtestStrategy      (lib/strategy-lab/backtest.ts)
//   • validateStrategy      (lib/strategy-lab/validation.ts — OOS + walk-forward)
//   • runMonteCarlo         (lib/market-intelligence/research/monte-carlo/runner)
//   • computeRobustness     (lib/strategy-lab/robustness.ts)
// This module only sequences them and packages the evidence. The AI layer is
// never consulted and no metrics are invented.
//
// The pipeline is split into granular steps so the orchestrator can persist
// stage-by-stage progression (backtest → OOS/walk-forward → Monte Carlo →
// execution variation) across durable work units, and so every step can charge
// the mission's research budget honestly.
// ─────────────────────────────────────────────────────────────────────────────

import type { BacktestConfig, BacktestResult, BacktestTrade, DataBundle } from "@/lib/strategy-lab/types";
import { backtestStrategy, defaultBacktestConfig } from "@/lib/strategy-lab/backtest";
import { validateStrategy } from "@/lib/strategy-lab/validation";
import { computeRobustness } from "@/lib/strategy-lab/robustness";
import { runMonteCarlo } from "@/lib/market-intelligence/research/monte-carlo/runner";
import type { Strategy } from "@/lib/strategy-lab/types";
import { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import {
    CandidateEvaluation,
    ExecutionVariation,
    ResearchMissionSpec,
    TradeDistribution,
} from "./types";

// Deterministic seed from a string (mission/candidate ids) — reproducible runs.
export function seedFromString(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h % 2147483646) + 1;
}

const RISK_PROFILE_CONFIG: Record<
    ResearchMissionSpec["riskProfile"],
    { riskPercent: number; dailyLossLimitPct: number; maxDrawdownPct: number }
> = {
    conservative: { riskPercent: 0.5, dailyLossLimitPct: 2, maxDrawdownPct: 15 },
    moderate: { riskPercent: 1, dailyLossLimitPct: 3, maxDrawdownPct: 20 },
    aggressive: { riskPercent: 1.5, dailyLossLimitPct: 4, maxDrawdownPct: 25 },
};

export function researchBacktestConfig(spec: ResearchMissionSpec, strategy: Strategy): BacktestConfig {
    const base = defaultBacktestConfig();
    const profile = RISK_PROFILE_CONFIG[spec.riskProfile];
    return {
        ...base,
        riskPercent: profile.riskPercent,
        dailyLossLimitPct: profile.dailyLossLimitPct,
        maxDrawdownPct: profile.maxDrawdownPct,
        maxPositions: strategy.risk.maxPositions > 0 ? strategy.risk.maxPositions : base.maxPositions,
        executionModel: strategy.executionModel,
        spreadPips: strategy.costs.spreadPips > 0 ? strategy.costs.spreadPips : base.spreadPips,
        commissionPerLot: strategy.costs.commissionPerLot,
        slippagePips: strategy.costs.slippagePips,
    };
}

function candlesByTimeframe(
    bundle: DataBundle,
    hierarchy: Strategy["timeframes"]
): Partial<Record<Timeframe, MarketCandle[]>> {
    const byTF: Partial<Record<Timeframe, MarketCandle[]>> = {};
    for (const tf of new Set([hierarchy.macro, hierarchy.structure, hierarchy.setup, hierarchy.entry])) {
        const candles = bundle.candles[tf];
        if (Array.isArray(candles) && candles.length > 0) byTF[tf] = candles;
    }
    return byTF;
}

export interface CandidateRunContext {
    market: SupportedSymbol;
    bundle: DataBundle;
    spec: ResearchMissionSpec;
}

/** Resolved, reusable inputs for the staged pipeline. */
export interface PreparedRun {
    byTF: Partial<Record<Timeframe, MarketCandle[]>>;
    setupCandles: MarketCandle[];
    config: BacktestConfig;
    from: number;
    to: number;
}

/**
 * Prepares run inputs or fails closed with an explicit reason.
 * Never fabricates data: fewer than 60 setup bars = INSUFFICIENT_DATA.
 */
export function prepareRun(
    strategy: Strategy,
    ctx: CandidateRunContext
): { prepared: PreparedRun | null; errors: string[] } {
    const hierarchy = strategy.timeframes;
    const byTF = candlesByTimeframe(ctx.bundle, hierarchy);
    const setupCandles = byTF[hierarchy.setup] ?? [];
    if (setupCandles.length < 60) {
        return {
            prepared: null,
            errors: [`Insufficient historical data on ${hierarchy.setup} (${setupCandles.length} bars).`],
        };
    }
    const config = researchBacktestConfig(ctx.spec, strategy);
    const from = setupCandles[0].timestamp;
    const to = setupCandles[setupCandles.length - 1].timestamp;
    return { prepared: { byTF, setupCandles, config, from, to }, errors: [] };
}

// ── Trade distribution evidence (deterministic, from real trades) ────────────

export function computeTradeDistribution(trades: BacktestTrade[]): TradeDistribution | null {
    if (trades.length === 0) return null;

    const monthPnl = new Map<string, number>();
    const regimePnl = new Map<string, number>();
    let longPnl = 0;
    let shortPnl = 0;

    for (const t of trades) {
        const d = new Date(t.openedAt);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        monthPnl.set(key, (monthPnl.get(key) ?? 0) + t.profit);
        regimePnl.set(t.regime || "unknown", (regimePnl.get(t.regime || "unknown") ?? 0) + t.profit);
        if (t.direction === "BUY") longPnl += t.profit;
        else shortPnl += t.profit;
    }

    const positiveMonths = [...monthPnl.values()].filter((v) => v > 0).length;
    const totalPositive = [...monthPnl.values()].reduce((s, v) => s + Math.max(0, v), 0);
    const topMonth = Math.max(0, ...monthPnl.values());
    const totalRegimePositive = [...regimePnl.values()].reduce((s, v) => s + Math.max(0, v), 0);
    const topRegime = Math.max(0, ...regimePnl.values());
    const totalAbsPnl = Math.abs(longPnl) + Math.abs(shortPnl) || 1;

    return {
        monthsCovered: monthPnl.size,
        topMonthSharePct: totalPositive > 0 ? Math.round((topMonth / totalPositive) * 100) : 100,
        topRegimeSharePct: totalRegimePositive > 0 ? Math.round((topRegime / totalRegimePositive) * 100) : 100,
        profitableMonthShare: monthPnl.size > 0 ? Number((positiveMonths / monthPnl.size).toFixed(2)) : 0,
        longSharePct: Math.round((Math.abs(longPnl) / totalAbsPnl) * 100),
    };
}

// ── Stage 1: deterministic backtest ──────────────────────────────────────────

export interface BacktestStepResult {
    backtest: NonNullable<CandidateEvaluation["backtest"]> | null;
    /** The full engine result — the caller persists it via Strategy Lab storage. */
    fullResult: BacktestResult | null;
    /** Backtests consumed (0 or 1). */
    backtestsUsed: number;
    errors: string[];
}

export function runBacktestStep(
    candidateId: string,
    strategy: Strategy,
    ctx: CandidateRunContext,
    prepared: PreparedRun
): BacktestStepResult {
    const errors: string[] = [];
    try {
        const result = backtestStrategy(
            strategy,
            ctx.market,
            prepared.byTF,
            prepared.config,
            prepared.from,
            prepared.to
        );
        return {
            backtest: {
                backtestId: null,
                metrics: result.metrics,
                config: prepared.config,
                executedAt: Date.now(),
                distribution: computeTradeDistribution(result.trades),
                window: {
                    from: prepared.from,
                    to: prepared.to,
                    bars: prepared.setupCandles.length,
                    dataSource: ctx.bundle.dataSource?.kind,
                },
            },
            fullResult: result,
            backtestsUsed: 1,
            errors,
        };
    } catch (err) {
        errors.push(err instanceof Error ? err.message : "Backtest engine failure.");
        return { backtest: null, fullResult: null, backtestsUsed: 0, errors };
    }
}

// ── Stage 2: OOS + walk-forward validation ───────────────────────────────────

/** Conservative upper bound of backtests `validateStrategy` will run. */
export function estimateValidationBacktests(
    from: number,
    to: number,
    walkForwardEnabled: boolean
): number {
    if (!walkForwardEnabled) return 2; // in-sample + out-of-sample
    const stepMs = 30 * 24 * 3600_000; // 1-month test step (train+test window slides monthly)
    const windows = Math.max(0, Math.floor((to - from) / stepMs) - 1);
    return 2 + windows * 2;
}

export interface ValidationStepResult {
    validation: CandidateEvaluation["validation"] | null;
    backtestsUsed: number;
    errors: string[];
}

export function runValidationStep(
    strategy: Strategy,
    ctx: CandidateRunContext,
    prepared: PreparedRun
): ValidationStepResult {
    const errors: string[] = [];
    const hierarchy = strategy.timeframes;
    const candles = prepared.setupCandles;
    try {
        const splitIndex = Math.floor(candles.length * 0.6);
        const inSampleRange = { from: candles[0].timestamp, to: candles[splitIndex - 1].timestamp };
        const outOfSampleRange = { from: candles[splitIndex].timestamp, to: candles[candles.length - 1].timestamp };
        const wfEnabled = ctx.spec.requireWalkForward && candles.length > 500;
        const outcome = validateStrategy(
            strategy,
            ctx.market,
            hierarchy.setup,
            prepared.config,
            candles,
            inSampleRange,
            outOfSampleRange,
            { enabled: wfEnabled, trainMonths: 1, testMonths: 1 },
            prepared.from,
            prepared.to
        );
        return {
            validation: {
                outcome,
                oosRequired: ctx.spec.requireOOS,
                walkForwardRequired: ctx.spec.requireWalkForward,
            },
            backtestsUsed: estimateValidationBacktests(prepared.from, prepared.to, wfEnabled),
            errors,
        };
    } catch (err) {
        errors.push(err instanceof Error ? err.message : "Validation engine failure.");
        return { validation: null, backtestsUsed: 0, errors };
    }
}

// ── Stage 3: Monte Carlo robustness ──────────────────────────────────────────

const MONTE_CARLO_SIMULATIONS = 1000;

export interface MonteCarloStepResult {
    monteCarlo: CandidateEvaluation["monteCarlo"] | null;
    errors: string[];
}

/**
 * Resamples the candidate's ACTUAL per-trade net PnL from the persisted
 * backtest result (never synthetic outcomes, no re-simulation).
 */
export function runMonteCarloStep(
    candidateId: string,
    trades: BacktestTrade[],
    spec: ResearchMissionSpec
): MonteCarloStepResult {
    try {
        const sourceTrades = trades.map((t) => ({ netPnL: t.profit, durationMs: t.durationMs }));
        if (sourceTrades.length < 2) {
            return {
                monteCarlo: {
                    summary: {
                        seed: seedFromString(candidateId),
                        simulations: 0,
                        sourceTradeCount: sourceTrades.length,
                        drawdownP95: null,
                        returnP5: null,
                        profitProbability: null,
                        limitations: ["Fewer than 2 source trades — Monte Carlo resampling is meaningless."],
                    },
                    required: spec.requireMonteCarlo,
                },
                errors: [],
            };
        }
        const mc = runMonteCarlo(sourceTrades, {
            seed: seedFromString(candidateId),
            simulations: MONTE_CARLO_SIMULATIONS,
            method: "bootstrap",
            maxSimulations: 5000,
        });
        return {
            monteCarlo: {
                summary: {
                    seed: mc.seed,
                    simulations: mc.simulationsCompleted,
                    sourceTradeCount: mc.sourceTradeCount,
                    drawdownP95: mc.drawdownP95 ?? null,
                    returnP5: mc.returnP5 ?? null,
                    profitProbability: mc.profitProbability ?? null,
                    limitations: [...(mc.limitations ?? [])],
                },
                required: spec.requireMonteCarlo,
            },
            errors: [],
        };
    } catch (err) {
        return { monteCarlo: null, errors: [err instanceof Error ? err.message : "Monte Carlo failure."] };
    }
}

// ── Stage 4: execution-assumption variation ──────────────────────────────────

export interface ExecutionVariationStepResult {
    executionVariation: ExecutionVariation | null;
    backtestsUsed: number;
    errors: string[];
}

/**
 * Runs the same strategy under doubled spread and doubled slippage using the
 * EXISTING backtest engine — an honest execution-assumption sensitivity test.
 */
export function runExecutionVariationStep(
    strategy: Strategy,
    ctx: CandidateRunContext,
    prepared: PreparedRun
): ExecutionVariationStepResult {
    const errors: string[] = [];
    let backtestsUsed = 0;
    try {
        const base = backtestStrategy(
            strategy,
            ctx.market,
            prepared.byTF,
            prepared.config,
            prepared.from,
            prepared.to
        );
        backtestsUsed += 1;
        const spreadConfig = { ...prepared.config, spreadPips: prepared.config.spreadPips * 2 };
        const slippageConfig = { ...prepared.config, slippagePips: prepared.config.slippagePips * 2 };
        const spreadRun = backtestStrategy(strategy, ctx.market, prepared.byTF, spreadConfig, prepared.from, prepared.to);
        backtestsUsed += 1;
        const slippageRun = backtestStrategy(
            strategy,
            ctx.market,
            prepared.byTF,
            slippageConfig,
            prepared.from,
            prepared.to
        );
        backtestsUsed += 1;
        return {
            executionVariation: {
                baseNet: base.metrics.netProfit,
                spreadDoubledNet: spreadRun.metrics.netProfit,
                slippageDoubledNet: slippageRun.metrics.netProfit,
            },
            backtestsUsed,
            errors,
        };
    } catch (err) {
        errors.push(err instanceof Error ? err.message : "Execution variation failure.");
        return { executionVariation: null, backtestsUsed, errors };
    }
}

// ── Full evaluation (kept for tests + single-shot use) ───────────────────────

export interface FullEvaluationResult {
    evaluation: CandidateEvaluation | null;
    errors: string[];
    backtestsUsed: number;
}

/** Full deterministic evaluation of one compiled candidate in one call. */
export function evaluateCandidate(
    candidateId: string,
    strategy: Strategy,
    ctx: CandidateRunContext
): FullEvaluationResult {
    const errors: string[] = [];
    const { prepared, errors: prepErrors } = prepareRun(strategy, ctx);
    if (!prepared) return { evaluation: null, errors: prepErrors, backtestsUsed: 0 };

    let backtestsUsed = 0;

    const bt = runBacktestStep(candidateId, strategy, ctx, prepared);
    errors.push(...bt.errors);
    backtestsUsed += bt.backtestsUsed;

    let validation: CandidateEvaluation["validation"] = null;
    if (bt.backtest) {
        const v = runValidationStep(strategy, ctx, prepared);
        errors.push(...v.errors);
        validation = v.validation;
        backtestsUsed += v.backtestsUsed;
    }

    let monteCarlo: CandidateEvaluation["monteCarlo"] = null;
    if (bt.fullResult) {
        const mc = runMonteCarloStep(candidateId, bt.fullResult.trades, ctx.spec);
        errors.push(...mc.errors);
        monteCarlo = mc.monteCarlo;
    }

    let executionVariation: ExecutionVariation | null = null;
    if (bt.backtest) {
        const ev = runExecutionVariationStep(strategy, ctx, prepared);
        errors.push(...ev.errors);
        executionVariation = ev.executionVariation;
        backtestsUsed += ev.backtestsUsed;
    }

    const robustness = bt.backtest ? computeRobustness(bt.backtest.metrics, validation?.outcome ?? null, null) : null;

    if (!bt.backtest) {
        return { evaluation: null, errors, backtestsUsed };
    }

    return {
        evaluation: {
            backtest: bt.backtest,
            validation,
            monteCarlo,
            robustness,
            executionVariation,
        },
        errors,
        backtestsUsed,
    };
}
