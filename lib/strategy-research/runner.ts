// ─────────────────────────────────────────────────────────────────────────────
// Candidate evaluation runner.
//
// Every number produced here comes from the EXISTING deterministic engines:
//   • backtestStrategy      (lib/strategy-lab/backtest.ts)
//   • validateStrategy      (lib/strategy-lab/validation.ts — OOS + walk-forward)
//   • runMonteCarlo         (lib/market-intelligence/research/monte-carlo)
//   • computeRobustness     (lib/strategy-lab/robustness.ts)
// This module only sequences them and packages the evidence. The AI layer is
// never consulted and no metrics are invented.
// ─────────────────────────────────────────────────────────────────────────────

import type { BacktestResult, DataBundle } from "@/lib/strategy-lab/types";
import { backtestStrategy, defaultBacktestConfig } from "@/lib/strategy-lab/backtest";
import { validateStrategy } from "@/lib/strategy-lab/validation";
import { computeRobustness } from "@/lib/strategy-lab/robustness";
import { runMonteCarlo } from "@/lib/market-intelligence/research/monte-carlo/runner";
import type { BacktestConfig, Strategy } from "@/lib/strategy-lab/types";
import { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { CandidateEvaluation, ResearchMissionSpec } from "./types";

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

const MONTE_CARLO_SIMULATIONS = 1000;

/** Full deterministic evaluation of one compiled candidate. */
export function evaluateCandidate(
    candidateId: string,
    strategy: Strategy,
    ctx: CandidateRunContext
): { evaluation: CandidateEvaluation | null; errors: string[] } {
    const errors: string[] = [];
    const hierarchy = strategy.timeframes;
    const byTF = candlesByTimeframe(ctx.bundle, hierarchy);
    const setupCandles = byTF[hierarchy.setup] ?? [];

    if (setupCandles.length < 60) {
        return {
            evaluation: null,
            errors: [`Insufficient historical data on ${hierarchy.setup} (${setupCandles.length} bars).`],
        };
    }

    const config = researchBacktestConfig(ctx.spec, strategy);
    const from = setupCandles[0].timestamp;
    const to = setupCandles[setupCandles.length - 1].timestamp;

    // 1. Deterministic backtest over the full available window.
    let backtestResult: BacktestResult | null = null;
    try {
        backtestResult = backtestStrategy(strategy, ctx.market, byTF, config, from, to);
    } catch (err) {
        errors.push(err instanceof Error ? err.message : "Backtest engine failure.");
    }

    // 2. OOS + walk-forward validation on the setup timeframe series.
    let validation: CandidateEvaluation["validation"] = null;
    if (backtestResult) {
        try {
            const splitIndex = Math.floor(setupCandles.length * 0.6);
            const inSampleRange = { from: setupCandles[0].timestamp, to: setupCandles[splitIndex - 1].timestamp };
            const outOfSampleRange = {
                from: setupCandles[splitIndex].timestamp,
                to: setupCandles[setupCandles.length - 1].timestamp,
            };
            const outcome = validateStrategy(
                strategy,
                ctx.market,
                hierarchy.setup,
                config,
                setupCandles,
                inSampleRange,
                outOfSampleRange,
                {
                    enabled: ctx.spec.requireWalkForward && setupCandles.length > 500,
                    trainMonths: 1,
                    testMonths: 1,
                },
                from,
                to
            );
            validation = {
                outcome,
                oosRequired: ctx.spec.requireOOS,
                walkForwardRequired: ctx.spec.requireWalkForward,
            };
        } catch (err) {
            errors.push(err instanceof Error ? err.message : "Validation engine failure.");
        }
    }

    // 3. Monte Carlo robustness — the existing deterministic runner resamples
    //    the candidate's ACTUAL per-trade net PnL (never synthetic outcomes).
    let monteCarlo: CandidateEvaluation["monteCarlo"] = null;
    if (backtestResult) {
        const sourceTrades = backtestResult.trades.map((t) => ({
            netPnL: t.profit,
            durationMs: t.durationMs,
        }));
        const mc = runMonteCarlo(sourceTrades, {
            seed: seedFromString(candidateId),
            simulations: MONTE_CARLO_SIMULATIONS,
            method: "bootstrap",
            maxSimulations: 5000,
        });
        monteCarlo = {
            summary: {
                seed: mc.seed,
                simulations: mc.simulationsCompleted,
                sourceTradeCount: mc.sourceTradeCount,
                drawdownP95: mc.drawdownP95 ?? null,
                returnP5: mc.returnP5 ?? null,
                profitProbability: mc.profitProbability ?? null,
                limitations: [...(mc.limitations ?? [])],
            },
            required: ctx.spec.requireMonteCarlo,
        };
    }

    // 4. Robustness score from the existing aggregator.
    const robustness = backtestResult
        ? computeRobustness(backtestResult.metrics, validation?.outcome ?? null, null)
        : null;

    return {
        evaluation: {
            backtest: backtestResult
                ? { metrics: backtestResult.metrics, config, executedAt: Date.now() }
                : null,
            validation,
            monteCarlo,
            robustness,
        },
        errors,
    };
}
