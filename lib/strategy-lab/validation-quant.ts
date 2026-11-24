/**
 * Strategy Lab — quantitative validation on top of the existing backtest engine.
 *
 * This module adds NO new backtesting logic. It slices the supplied candles
 * into purged/embargoed folds and runs the canonical `backtestStrategy` once
 * per slice, then hands the out-of-sample trade returns to the quant layer for
 * DSR / composite assessment.
 *
 * Why purged folds: a strategy whose trades last several bars has labels that
 * overlap their neighbours. A plain K-fold would train on bars the test trade
 * actually saw. `labelSpan` must therefore describe the strategy's holding
 * period; the default of 1 is honest only for point labels and is recorded as
 * a limitation.
 */

import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { purgedKFold } from "@/lib/quant/validation/purged-cv";
import { runPurgedValidation, type PurgedValidationResult } from "@/lib/quant/validation/strategy-runner";
import { backtestStrategy } from "./backtest";
import type { BacktestConfig, BacktestResult, Strategy } from "./types";

export interface PurgedStrategyValidationInput {
    strategy: Strategy;
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    config: BacktestConfig;
    /** Chronologically sorted candles for the strategy's entry timeframe. */
    candles: MarketCandle[];
    /** Number of purged folds (≥ 2). */
    folds: number;
    /** Label span in bars (holding period). Default 1 = point labels. */
    labelSpan?: number;
    /** Embargo in bars after each test block. Default 0. */
    embargoSamples?: number;
    /** Configurations explored before this one was chosen (required for DSR). */
    trials?: number;
    trialSharpeVariance?: number;
    seed?: number;
}

export interface PurgedStrategyValidationResult extends PurgedValidationResult {
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    strategyId: string;
    foldResults: Array<{ index: number; train: BacktestResult; test: BacktestResult }>;
}

export function validateStrategyPurged(
    input: PurgedStrategyValidationInput,
): PurgedStrategyValidationResult | { available: false; reason: string } {
    const { strategy, symbol, timeframe, config, candles } = input;

    // The strategy engine needs enough bars to produce a signal at all. Require
    // a minimum so a "validation" over a stub dataset cannot report success.
    if (!Array.isArray(candles) || candles.length < 200) {
        return { available: false, reason: "At least 200 candles are required for purged validation." };
    }

    const split = purgedKFold(candles.length, input.folds, {
        labelSpan: input.labelSpan ?? 1,
        embargoSamples: input.embargoSamples ?? 0,
    });
    if (!split.available) {
        return { available: false, reason: split.reason };
    }

    const foldResults: Array<{ index: number; train: BacktestResult; test: BacktestResult }> = [];

    const result = runPurgedValidation({
        folds: split.folds,
        evaluate: (fold, index) => {
            const trainCandles = fold.train.map((i) => candles[i]);
            const testCandles = fold.test.map((i) => candles[i]);

            const run = (slice: MarketCandle[]): BacktestResult => {
                if (slice.length < 20) {
                    return emptySliceResult(strategy, symbol, config, slice);
                }
                return backtestStrategy(
                    strategy,
                    symbol,
                    { [timeframe]: slice },
                    config,
                    slice[0].timestamp,
                    slice[slice.length - 1].timestamp,
                );
            };

            const train = run(trainCandles);
            const test = run(testCandles);
            foldResults.push({ index, train, test });

            return {
                trainTrades: train.metrics.totalTrades,
                testTrades: test.metrics.totalTrades,
                testReturns: test.trades.map((t) => t.profitR),
                trainMetrics: train.metrics as unknown as Record<string, unknown>,
                testMetrics: test.metrics as unknown as Record<string, unknown>,
            };
        },
        trials: input.trials,
        trialSharpeVariance: input.trialSharpeVariance,
        seed: input.seed,
        parameters: {
            strategyId: strategy.id,
            symbol,
            timeframe,
            folds: input.folds,
            labelSpan: input.labelSpan ?? 1,
            embargoSamples: input.embargoSamples ?? 0,
            initialBalance: config.initialBalance,
            executionModel: config.executionModel,
        },
    });

    if ((input.labelSpan ?? 1) === 1) {
        result.limitations.push(
            "labelSpan=1 assumes point labels; if trades span multiple bars, set labelSpan to the holding period so overlapping labels are purged.",
        );
    }
    if (split.purgeCount === 0) {
        result.limitations.push("No observations were purged — folds are contiguous and labelSpan may be too small.");
    }

    return {
        ...result,
        symbol,
        timeframe,
        strategyId: strategy.id,
        foldResults,
    };
}

/** Honest empty result for a slice too small to evaluate. */
function emptySliceResult(
    strategy: Strategy,
    symbol: SupportedSymbol,
    config: BacktestConfig,
    slice: MarketCandle[],
): BacktestResult {
    const from = slice[0]?.timestamp ?? 0;
    const to = slice[slice.length - 1]?.timestamp ?? 0;
    const emptyMetrics = {
        totalTrades: 0, winningTrades: 0, losingTrades: 0, breakevenTrades: 0, winRate: 0,
        netProfit: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0, averageWin: 0, averageLoss: 0,
        expectancy: 0, expectancyR: 0, largestWin: 0, largestLoss: 0, maxDrawdownPct: 0,
        maxDrawdownAbs: 0, maxConsecutiveWins: 0, maxConsecutiveLosses: 0, averageTradeDurationMs: 0,
        returnPct: 0, finalBalance: config.initialBalance, sharpeLike: 0, recoveryFactor: 0,
        buyHoldReturnPct: 0, longTrades: 0, shortTrades: 0, longWinRate: 0, shortWinRate: 0,
    };
    return {
        id: `bt-${strategy.id}-${from}-${to}`,
        symbol,
        strategyId: strategy.id,
        strategyName: strategy.name,
        timeframe: strategy.timeframes.setup,
        generatedAt: Date.now(),
        config,
        metrics: emptyMetrics,
        trades: [],
        equity: [],
        coverage: {
            timeframe: strategy.timeframes.setup,
            availableBars: slice.length,
            requestedFrom: from,
            requestedTo: to,
            availableFrom: from,
            availableTo: to,
            fullyCoversRequest: true,
            spanDays: (to - from) / 86_400_000,
            source: "biquote",
            maxSourceBars: slice.length,
        },
        symbols: [symbol],
        diagnostics: { loopBars: slice.length, sessionBars: 0, regimeBars: 0, rules: [], blockingRuleIds: [] },
    };
}
