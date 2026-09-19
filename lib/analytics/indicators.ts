import { MarketCandle } from "../market-data/types";
import { calculateATR } from "./volatility";

/**
 * Deterministic technical indicator calculations over OHLCV candles.
 *
 * These are used to compute indicator values that the browser cannot expose
 * (TradingView renders indicator plots on canvas), so the chart context can be
 * enriched with REAL calculated values instead of asking the user to type them.
 */

export type IndicatorValue = number | null;

export function sma(values: number[], period: number): number[] {
    const out: number[] = new Array(values.length).fill(Number.NaN);
    if (period <= 0 || values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}

export function ema(values: number[], period: number): number[] {
    const out: number[] = new Array(values.length).fill(Number.NaN);
    if (period <= 0 || values.length === 0) return out;
    const k = 2 / (period + 1);
    let prev = values[0];
    out[0] = prev;
    for (let i = 1; i < values.length; i++) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}

export function rsi(values: number[], period = 14): number[] {
    const out: number[] = new Array(values.length).fill(Number.NaN);
    if (values.length <= period) return out;
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];
        if (change >= 0) avgGain += change;
        else avgLoss -= change;
    }
    avgGain /= period;
    avgLoss /= period;
    const first = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    out[period] = first;
    for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
}

export function macd(
    values: number[],
    fast = 12,
    slow = 26,
    signalPeriod = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
    const fastLine = ema(values, fast);
    const slowLine = ema(values, slow);
    const macdLine = fastLine.map((v, i) => {
        const s = slowLine[i];
        if (Number.isNaN(v) || Number.isNaN(s)) return Number.NaN;
        return v - s;
    });
    const signal = ema(macdLine.map((v) => (Number.isNaN(v) ? 0 : v)), signalPeriod);
    const histogram = macdLine.map((v, i) => {
        const s = signal[i];
        if (Number.isNaN(v) || Number.isNaN(s)) return Number.NaN;
        return v - s;
    });
    return { macd: macdLine, signal, histogram };
}

export function bollingerBands(
    values: number[],
    period = 20,
    stdDev = 2
): { upper: number[]; middle: number[]; lower: number[] } {
    const middle = sma(values, period);
    const upper: number[] = new Array(values.length).fill(Number.NaN);
    const lower: number[] = new Array(values.length).fill(Number.NaN);
    for (let i = period - 1; i < values.length; i++) {
        const slice = values.slice(i - period + 1, i + 1);
        const mean = middle[i];
        if (Number.isNaN(mean)) continue;
        const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
        const sd = Math.sqrt(variance);
        upper[i] = mean + stdDev * sd;
        lower[i] = mean - stdDev * sd;
    }
    return { upper, middle, lower };
}

export function supertrend(
    candles: MarketCandle[],
    period = 10,
    multiplier = 3
): { supertrend: (number | null)[]; direction: ("bullish" | "bearish")[] } {
    const atr = atrSeries(candles, period);
    const n = candles.length;
    const supertrendArr: (number | null)[] = new Array(n).fill(null);
    const direction: ("bullish" | "bearish")[] = new Array(n).fill("bullish");
    if (n < period + 1) return { supertrend: supertrendArr, direction };

    for (let i = period; i < n; i++) {
        const hl2 = (candles[i].high + candles[i].low) / 2;
        const a = atr[i];
        if (a == null || Number.isNaN(a)) continue;
        const upper = hl2 + multiplier * a;
        const lower = hl2 - multiplier * a;

        if (i === period) {
            supertrendArr[i] = candles[i].close <= upper ? upper : lower;
        } else {
            const prev = supertrendArr[i - 1];
            const prevDir = direction[i - 1];
            let next: number;
            let dir: "bullish" | "bearish";
            if (prevDir === "bullish") {
                next = Math.min(prev!, lower);
                dir = candles[i].close > next ? "bullish" : "bearish";
            } else {
                next = Math.max(prev!, upper);
                dir = candles[i].close < next ? "bearish" : "bullish";
            }
            supertrendArr[i] = next;
            direction[i] = dir;
        }
    }
    return { supertrend: supertrendArr, direction };
}

export function atrSeries(candles: MarketCandle[], period = 14): (number | null)[] {
    const n = candles.length;
    const out: (number | null)[] = new Array(n).fill(null);
    if (n < 2) return out;
    const trs: number[] = [];
    for (let i = 0; i < n; i++) {
        if (i === 0) {
            trs.push(candles[i].high - candles[i].low);
            continue;
        }
        const pc = candles[i - 1].close;
        const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - pc),
            Math.abs(candles[i].low - pc)
        );
        trs.push(tr);
    }
    let sum = 0;
    for (let i = 0; i < period; i++) sum += trs[i];
    out[period - 1] = sum / period;
    for (let i = period; i < n; i++) {
        out[i] = (out[i - 1]! * (period - 1) + trs[i]) / period;
    }
    return out;
}

export interface IndicatorSnapshot {
    ema20: IndicatorValue;
    ema50: IndicatorValue;
    ema200: IndicatorValue;
    sma20: IndicatorValue;
    sma50: IndicatorValue;
    rsi14: IndicatorValue;
    macd: IndicatorValue;
    macdSignal: IndicatorValue;
    macdHistogram: IndicatorValue;
    bbUpper20: IndicatorValue;
    bbMiddle20: IndicatorValue;
    bbLower20: IndicatorValue;
    vwap: IndicatorValue;
    atr14: IndicatorValue;
    supertrend: IndicatorValue;
    supertrendDirection: "bullish" | "bearish" | "neutral";
}

export function computeIndicatorSnapshot(candles: MarketCandle[]): IndicatorSnapshot {
    const closes = candles.map((c) => c.close);
    const last = closes.length - 1;
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const e200 = ema(closes, 200);
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const r14 = rsi(closes, 14);
    const m = macd(closes);
    const bb = bollingerBands(closes);
    const st = supertrend(candles);
    const atr = atrSeries(candles, 14);

    const sn = (arr: number[], idx: number): IndicatorValue =>
        idx >= 0 && idx < arr.length && !Number.isNaN(arr[idx]) ? arr[idx] : null;

    const lastSt = st.supertrend[last];
    const stDir = lastSt != null ? st.direction[last] : "neutral";

    return {
        ema20: sn(e20, last),
        ema50: sn(e50, last),
        ema200: sn(e200, last),
        sma20: sn(s20, last),
        sma50: sn(s50, last),
        rsi14: sn(r14, last),
        macd: sn(m.macd, last),
        macdSignal: sn(m.signal, last),
        macdHistogram: sn(m.histogram, last),
        bbUpper20: sn(bb.upper, last),
        bbMiddle20: sn(bb.middle, last),
        bbLower20: sn(bb.lower, last),
        vwap: calculateVWAPLatest(candles),
        atr14: atr[last],
        supertrend: lastSt,
        supertrendDirection: stDir,
    };
}

function calculateVWAPLatest(candles: MarketCandle[]): number | null {
    if (candles.length === 0) return null;
    let cumVol = 0;
    let cumPV = 0;
    for (const c of candles) {
        const typical = (c.high + c.low + c.close) / 3;
        const vol = c.volume ?? 1;
        cumPV += typical * vol;
        cumVol += vol;
    }
    if (cumVol === 0) return null;
    return cumPV / cumVol;
}

export function computeSeriesIndicator(
    type: string,
    candles: MarketCandle[],
    parameters: Array<{ key: string; value: string | number }>
): { value: IndicatorValue; series?: number[] } {
    const closes = candles.map((c) => c.close);
    const norm = type.toLowerCase().replace(/[^a-z0-9]/g, "");
    const p = (key: string, fallback: number): number => {
        const hit = parameters.find((x) => x.key.toLowerCase() === key);
        if (!hit) return fallback;
        const n = Number(hit.value);
        return Number.isFinite(n) ? n : fallback;
    };

    switch (norm) {
        case "ema":
            return { value: lastOf(ema(closes, p("length", 20))) };
        case "sma":
            return { value: lastOf(sma(closes, p("length", 20))) };
        case "rsi":
            return { value: lastOf(rsi(closes, p("length", 14))) };
        case "macd":
            return { value: lastOf(macd(closes, p("fast", 12) || 12, p("slow", 26) || 26, p("signal", 9) || 9).macd) };
        case "bollinger":
        case "bb":
            return { value: lastOf(bollingerBands(closes, p("length", 20) || 20, p("stddev", 2) || 2).middle) };
        case "vwap":
            return { value: calculateVWAPLatest(candles) };
        case "supertrend":
            return { value: lastNullable(supertrend(candles, p("length", 10) || 10, p("multiplier", 3) || 3).supertrend) };
        case "atr":
            return { value: lastNullable(atrSeries(candles, p("length", 14) || 14)) };
        default:
            return { value: null };
    }
}

function lastOf(arr: number[]): number | null {
    const v = arr[arr.length - 1];
    return v != null && !Number.isNaN(v) ? v : null;
}
function lastNullable(arr: (number | null)[]): number | null {
    const v = arr[arr.length - 1];
    return v != null && !Number.isNaN(v) ? v : null;
}

export { calculateATR };