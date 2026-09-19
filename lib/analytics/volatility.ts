import { VolatilityData, MarketCandle } from "../market-data/types";

function calculateTrueRange(candle: MarketCandle, prevClose: number): number {
    const { high, low } = candle;
    return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

export function calculateATR(candles: MarketCandle[], period: number = 14): number {
    if (candles.length < period + 1) return 0;

    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
        trueRanges.push(calculateTrueRange(candles[i], candles[i - 1].close));
    }

    const recent = trueRanges.slice(-period);
    return recent.reduce((sum, tr) => sum + tr, 0) / recent.length;
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
