import { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { BacktestConfig, BacktestMetrics, ValidationOutcome, WalkForwardWindow } from "./types";
import { backtestStrategy } from "./backtest";

// ─────────────────────────────────────────────────────────────────────────────
// Out-of-sample validation + walk-forward.
//
// 1. Split the candles into two non-overlapping windows: in-sample (IS) and
//    out-of-sample (OOS). Backtest each.
// 2. Walk-forward: slide a train/test pair across the available data, backtest
//    each split, measure degradation from train → test.
// 3. Score the strategy's robustness from the degradation across all windows.
// ─────────────────────────────────────────────────────────────────────────────

function sliceCandles(
    candles: MarketCandle[],
    from: number,
    to: number
): MarketCandle[] {
    return candles.filter((c) => c.timestamp >= from && c.timestamp <= to);
}

function backtestSlice(
    strategy: { strategy: import("./types").Strategy; timeframe: Timeframe; config: BacktestConfig },
    slice: MarketCandle[]
): { metrics: BacktestMetrics; trades: number } {
    const { strategy: st, timeframe: tf, config } = strategy;
    const result = backtestStrategy(st, st.asset, { [tf]: slice }, config, slice[0]?.timestamp ?? 0, slice[slice.length - 1]?.timestamp ?? 0);
    return { metrics: result.metrics, trades: result.metrics.totalTrades };
}

function degradationMetrics(isMetrics: BacktestMetrics, oosMetrics: BacktestMetrics) {
    const winRateDiff = Number((isMetrics.winRate - oosMetrics.winRate).toFixed(2));
    const profitFactorDiff = Number((isMetrics.profitFactor - oosMetrics.profitFactor).toFixed(2));
    const returnDiff = Number((isMetrics.returnPct - oosMetrics.returnPct).toFixed(2));
    const maxDrawdownDiff = Number((oosMetrics.maxDrawdownPct - isMetrics.maxDrawdownPct).toFixed(2));

    const overall =
        Math.abs(winRateDiff) * 0.3 +
        Math.abs(profitFactorDiff) * 0.25 +
        Math.abs(returnDiff) * 0.15 +
        Math.max(0, maxDrawdownDiff) * 0.3;

    return {
        winRateDiff,
        profitFactorDiff,
        returnDiff,
        maxDrawdownDiff,
        overall: Number(overall.toFixed(2)),
    };
}

function verdictFromDegradation(overall: number, isWinRate: number, oosWinRate: number): ValidationOutcome["verdict"] {
    if (isWinRate < 20 || oosWinRate < 20) return "inconclusive";
    if (overall < 5) return "robust";
    if (overall < 12) return "marginal";
    return "fragile";
}

function runWalkForward(
    strategy: import("./types").Strategy,
    timeframe: Timeframe,
    config: BacktestConfig,
    candles: MarketCandle[],
    trainMonths: number,
    testMonths: number,
    from: number,
    to: number
): { windows: WalkForwardWindow[]; stable: boolean; stabilityScore: number } {
    const windows: WalkForwardWindow[] = [];
    const trainMs = trainMonths * 30 * 24 * 3600_000;
    const testMs = testMonths * 30 * 24 * 3600_000;
    const stepMs = testMs;

    let cursor = from;
    while (cursor + trainMs + testMs <= to) {
        const trainSlice = sliceCandles(candles, cursor, cursor + trainMs);
        const testSlice = sliceCandles(candles, cursor + trainMs, cursor + trainMs + testMs);

        if (trainSlice.length < 50 || testSlice.length < 20) { cursor += stepMs; continue; }

        const trainResult = backtestSlice({ strategy, timeframe, config }, trainSlice);
        const testResult = backtestSlice({ strategy, timeframe, config }, testSlice);
        const deg = degradationMetrics(trainResult.metrics, testResult.metrics);

        windows.push({
            train: { from: cursor, to: cursor + trainMs },
            test: { from: cursor + trainMs, to: cursor + trainMs + testMs },
            trainMetrics: trainResult.metrics,
            testMetrics: testResult.metrics,
            degradationPct: deg.overall,
        });

        cursor += stepMs;
    }

    if (windows.length === 0) return { windows: [], stable: false, stabilityScore: 0 };

    const avgDeg = windows.reduce((s, w) => s + w.degradationPct, 0) / windows.length;
    const stable = avgDeg < 12;
    const score = Math.max(0, Math.min(100, 100 - avgDeg * 5));

    return { windows, stable, stabilityScore: Number(score.toFixed(1)) };
}

export function validateStrategy(
    strategy: import("./types").Strategy,
    symbol: SupportedSymbol,
    timeframe: Timeframe,
    config: BacktestConfig,
    candles: MarketCandle[],
    inSampleRange: { from: number; to: number },
    outOfSampleRange: { from: number; to: number },
    walkForward: { enabled: boolean; trainMonths: number; testMonths: number },
    from: number,
    to: number
): ValidationOutcome {
    const allCandles = candles;
    const isSlice = sliceCandles(allCandles, inSampleRange.from, inSampleRange.to);
    const oosSlice = sliceCandles(allCandles, outOfSampleRange.from, outOfSampleRange.to);

    const isResult = isSlice.length > 0 ? backtestSlice({ strategy, timeframe, config }, isSlice) : null;
    const oosResult = oosSlice.length > 0 ? backtestSlice({ strategy, timeframe, config }, oosSlice) : null;

    const isMetrics = isResult?.metrics ?? null;
    const oosMetrics = oosResult?.metrics ?? null;

    const deg = isMetrics && oosMetrics
        ? degradationMetrics(isMetrics, oosMetrics)
        : { winRateDiff: 0, profitFactorDiff: 0, returnDiff: 0, maxDrawdownDiff: 0, overall: 0 };

    const wf = walkForward.enabled && candles.length > 500
        ? runWalkForward(strategy, timeframe, config, allCandles, walkForward.trainMonths, walkForward.testMonths, from, to)
        : { windows: [], stable: false, stabilityScore: 0 };

    const verdict = isMetrics && oosMetrics
        ? verdictFromDegradation(deg.overall, isMetrics.winRate, oosMetrics.winRate)
        : "inconclusive";

    const emptyMetrics = {
        totalTrades: 0, winningTrades: 0, losingTrades: 0, breakevenTrades: 0, winRate: 0,
        netProfit: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0, averageWin: 0, averageLoss: 0,
        expectancy: 0, expectancyR: 0, largestWin: 0, largestLoss: 0, maxDrawdownPct: 0,
        maxDrawdownAbs: 0, maxConsecutiveWins: 0, maxConsecutiveLosses: 0, averageTradeDurationMs: 0,
        returnPct: 0, finalBalance: config.initialBalance, sharpeLike: 0, recoveryFactor: 0,
        buyHoldReturnPct: 0, longTrades: 0, shortTrades: 0, longWinRate: 0, shortWinRate: 0,
    } as const;

    return {
        id: `val-${strategy.id}-${Date.now()}`,
        symbol,
        strategyId: strategy.id,
        strategyName: strategy.name,
        generatedAt: Date.now(),
        inSample: {
            label: "In-Sample",
            from: inSampleRange.from,
            to: inSampleRange.to,
            metrics: isMetrics ?? (emptyMetrics as BacktestMetrics),
            trades: isResult?.trades ?? 0,
        },
        outOfSample: {
            label: "Out-of-Sample",
            from: outOfSampleRange.from,
            to: outOfSampleRange.to,
            metrics: oosMetrics ?? (emptyMetrics as BacktestMetrics),
            trades: oosResult?.trades ?? 0,
        },
        degradation: deg,
        walkForward: {
            enabled: walkForward.enabled,
            trainMonths: walkForward.trainMonths,
            testMonths: walkForward.testMonths,
            windows: wf.windows,
            stable: wf.stable,
            stabilityScore: wf.stabilityScore,
        },
        verdict,
        config,
    };
}