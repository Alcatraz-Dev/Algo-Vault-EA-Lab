import { VolatilityData, MarketCandle } from "../market-data/types";
import { atrRuntime } from "../market-core/indicators/primitives";

/**
 * Deterministic technical indicator calculations over OHLCV candles.
 *
 * Phase 8: ATR is now a THIN ADAPTER over the ONE indicator kernel in
 * `lib/market-core/indicators/primitives` (`atrRuntime`), matching the pattern
 * already used in `lib/analytics/indicators.ts`. The previous local
 * implementation averaged the last `period` true ranges, which is NOT Wilder's
 * ATR — it ignored all history before the window, so it drifted from every
 * other ATR in the platform (market-core, Pine runtime, chart) and inflated
 * risk sizing, regime thresholds and SL distances.
 *
 * The exported signature and the `0` insufficient-data contract are unchanged,
 * so the ~20 consumer modules (ai-signals, ai/analysis, ai-trading-teams,
 * strategy-lab, scanner, market-regime, plugins runtime, API routes) need no
 * edits. Numeric output does change — that is the bug fix.
 */
export function calculateATR(candles: MarketCandle[], period: number = 14): number {
    if (candles.length < period + 1) return 0;

    const runtime = atrRuntime(period);
    const state = runtime.initialState();

    let last: number | null = null;
    for (const candle of candles) {
        const step = runtime.step(state, candle);
        if (step.value !== null && step.value !== undefined) last = step.value as number;
    }

    return last ?? 0;
}

export function analyzeVolatility(candles: MarketCandle[], period: number = 14): VolatilityData {
    if (candles.length < period + 1) {
        return {
            atr: 0,
            atrPercent: 0,
            state: "normal",
            rangeExpansion: 0,
            lookbackPeriods: candles.length,
        };
    }

    const atr = calculateATR(candles, period);
    const currentPrice = candles[candles.length - 1].close;
    const atrPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

    const recentRanges: number[] = [];
    for (let i = Math.max(1, candles.length - period); i < candles.length; i++) {
        recentRanges.push(candles[i].high - candles[i].low);
    }

    const currentRange = candles[candles.length - 1].high - candles[candles.length - 1].low;
    const avgRange = recentRanges.length > 0
        ? recentRanges.reduce((sum, r) => sum + r, 0) / recentRanges.length
        : currentRange;

    const rangeExpansion = avgRange > 0 ? ((currentRange - avgRange) / avgRange) * 100 : 0;

    let state: VolatilityData["state"] = "normal";
    if (atrPercent < 0.1) state = "low";
    else if (atrPercent < 0.3) state = "normal";
    else if (atrPercent < 0.6) state = "high";
    else state = "extreme";

    return {
        atr: Number(atr.toFixed(5)),
        atrPercent: Number(atrPercent.toFixed(3)),
        state,
        rangeExpansion: Number(rangeExpansion.toFixed(1)),
        lookbackPeriods: period,
    };
}

export function getVolatilityZones(candles: MarketCandle[], period: number = 20): { upper: number; lower: number; mid: number } {
    const recent = candles.slice(-period);
    if (recent.length === 0) return { upper: 0, lower: 0, mid: 0 };

    const closes = recent.map((c) => c.close);
    const avg = closes.reduce((sum, c) => sum + c, 0) / closes.length;
    const stdDev = Math.sqrt(closes.reduce((sum, c) => sum + Math.pow(c - avg, 2), 0) / closes.length);

    return {
        upper: avg + stdDev,
        lower: avg - stdDev,
        mid: avg,
    };
}
