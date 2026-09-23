/**
 * Deterministic TA indicators computed over real candle data.
 *
 * No randomness, no fabrications — every output is derived from the candles
 * provided to the node. Series are trimmed to the latest N values so node
 * records stay small.
 */

import { MarketCandle } from "@/lib/market-data/types";

export interface IndicatorResult {
    value: number | null;
    series: number[]; // trimmed to last 60 values
    extra?: Record<string, number | null>;
    note?: string;
}

const SERIES_KEEP = 60;

function closes(candles: MarketCandle[]): number[] {
    return candles.map((c) => Number(c.close));
}

function lastN(arr: number[]): number[] {
    return arr.slice(-SERIES_KEEP);
}

export function sma(candles: MarketCandle[], period: number): IndicatorResult {
    const c = closes(candles);
    const series: number[] = [];
    for (let i = period - 1; i < c.length; i++) {
        const window = c.slice(i - period + 1, i + 1);
        series.push(window.reduce((a, b) => a + b, 0) / period);
    }
    return { value: series.length ? series[series.length - 1] : null, series: lastN(series) };
}

export function ema(candles: MarketCandle[], period: number): IndicatorResult {
    const c = closes(candles);
    const k = 2 / (period + 1);
    const series: number[] = [];
    let prev: number | null = null;
    for (let i = 0; i < c.length; i++) {
        if (prev === null) {
            // seed with SMA of first `period` values
            const seed = c.slice(0, Math.min(period, i + 1)).reduce((a, b) => a + b, 0) / Math.min(period, i + 1);
            prev = seed;
        } else {
            prev = (c[i] - prev) * k + prev;
        }
        series.push(prev);
    }
    return { value: series.length ? series[series.length - 1] : null, series: lastN(series) };
}

export function rsi(candles: MarketCandle[], period: number): IndicatorResult {
    const c = closes(candles);
    if (c.length <= period) return { value: null, series: [], note: "Not enough candles." };
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = c[i] - c[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    const series: number[] = [avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss))];

    for (let i = period + 1; i < c.length; i++) {
        const diff = c[i] - c[i - 1];
        const gain = diff >= 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
        series.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
    }

    return { value: series.length ? series[series.length - 1] : null, series: lastN(series) };
}

export function macd(candles: MarketCandle[], fast = 12, slow = 26, signalPeriod = 9): IndicatorResult {
    const emaFast = ema(candles, fast).series;
    const emaSlow = ema(candles, slow).series;
    const length = Math.min(emaFast.length, emaSlow.length);
    const macdLine: number[] = [];
    for (let i = 0; i < length; i++) {
        macdLine.push(emaFast[i] - emaSlow[i]);
    }
    if (macdLine.length === 0) return { value: null, series: [] };

    const signalSeries: number[] = [];
    const k = 2 / (signalPeriod + 1);
    let prev: number | null = null;
    for (let i = 0; i < macdLine.length; i++) {
        if (prev === null) {
            const seedWindow = macdLine.slice(0, Math.min(signalPeriod, i + 1));
            prev = seedWindow.reduce((a, b) => a + b, 0) / Math.min(signalPeriod, i + 1);
        } else {
            prev = (macdLine[i] - prev) * k + prev;
        }
        signalSeries.push(prev);
    }
    const histogram = macdLine.map((v, i) => v - (signalSeries[i] ?? 0));

    return {
        value: macdLine[macdLine.length - 1],
        series: lastN(macdLine),
        extra: {
            signal: signalSeries[signalSeries.length - 1],
            histogram: histogram[histogram.length - 1],
        },
    };
}

export function atr(candles: MarketCandle[], period: number): IndicatorResult {
    if (candles.length < period + 1) return { value: null, series: [], note: "Not enough candles." };
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trs.push(tr);
    }
    const first = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const series: number[] = [first];
    for (let i = period; i < trs.length; i++) {
        series.push(((series[series.length - 1] * (period - 1)) + trs[i]) / period);
    }
    return { value: series.length ? series[series.length - 1] : null, series: lastN(series) };
}

export function bollinger(candles: MarketCandle[], period = 20, deviations = 2): IndicatorResult {
    const c = closes(candles);
    if (c.length < period) return { value: null, series: [], note: "Not enough candles." };
    const series: number[] = [];
    const upper: number[] = [];
    const lower: number[] = [];
    for (let i = period - 1; i < c.length; i++) {
        const window = c.slice(i - period + 1, i + 1);
        const mean = window.reduce((a, b) => a + b, 0) / period;
        const variance = window.reduce((a, b) => a + ((b - mean) ** 2), 0) / period;
        const std = Math.sqrt(variance);
        series.push(mean);
        upper.push(mean + (deviations * std));
        lower.push(mean - (deviations * std));
    }
    return {
        value: series[series.length - 1] ?? null,
        series: lastN(series),
        extra: {
            upper: upper[upper.length - 1] ?? null,
            lower: lower[lower.length - 1] ?? null,
            percentB: series[series.length - 1] !== undefined && upper[upper.length - 1] !== lower[lower.length - 1]
                ? (c[c.length - 1] - (lower[lower.length - 1] ?? 0)) / ((upper[upper.length - 1] ?? 1) - (lower[lower.length - 1] ?? 0))
                : null,
        },
    };
}

export function computeIndicator(type: string, candles: MarketCandle[], period: number): IndicatorResult {
    switch (type) {
        case "technical.sma": return sma(candles, period);
        case "technical.ema": return ema(candles, period);
        case "technical.rsi": return rsi(candles, period);
        case "technical.macd": return macd(candles, period);
        case "technical.atr": return atr(candles, period);
        case "technical.bollinger": return bollinger(candles, period);
        default: return { value: null, series: [], note: `Unknown indicator ${type}` };
    }
}