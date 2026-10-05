import { MarketCandle } from "../market-data/types";
import { calculateATR } from "./volatility";
import {
    atrRuntime,
    bollingerRuntime,
    emaRuntime,
    rsiRuntime,
    smaRuntime,
} from "../market-core/indicators/primitives";
import { alignedIndicatorSeries } from "../market-core/indicators/engine";

/**
 * Deterministic technical indicator calculations over OHLCV candles.
 *
 * Phase 3: every formula here is a THIN ADAPTER over the ONE indicator
 * engine in `lib/market-core/indicators` — the same math the chart plots,
 * the backtester consumes and the AI reads. No second implementation of a
 * formula lives in this file; the legacy NaN-warmup array shape is kept at
 * the boundary so existing consumers do not change.
 *
 * Canonical semantics (v1.0.0, docs/market-intelligence-core.md):
 *  - core rows are `null` during warmup; this adapter maps null → NaN,
 *  - EMA seed = SMA of the first `period` values (MetaTrader/TradingView
 *    convention) instead of a bar-0 seeded transient.
 */

export type IndicatorValue = number | null;

/** Synthetic single-field candle for the value-level kernels. */
function valCandle(value: number): { timestamp: number; open: number; high: number; low: number; close: number; volume: number } {
    return { timestamp: 0, open: value, high: value, low: value, close: value, volume: 0 };
}

export function sma(values: number[], period: number): number[] {
    const runtime = smaRuntime(period);
    const state = runtime.initialState();
    return values.map((v) => runtime.step(state, valCandle(v)).value ?? Number.NaN);
}

export function ema(values: number[], period: number): number[] {
    const runtime = emaRuntime(period);
    const state = runtime.initialState();
    return values.map((v) => runtime.step(state, valCandle(v)).value ?? Number.NaN);
}

export function rsi(values: number[], period = 14): number[] {
    const runtime = rsiRuntime(period);
    const state = runtime.initialState();
    return values.map((v) => runtime.step(state, valCandle(v)).value ?? Number.NaN);
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
    // The signal EMA consumes only VALID macd values (NaN rows are skipped
    // by the core kernel) so it never seeds on placeholder zeros.
    const signal = ema(macdLine.map((v) => v), signalPeriod);
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
    const runtime = bollingerRuntime(period, stdDev);
    const state = runtime.initialState();
    const upper: number[] = [];
    const middle: number[] = [];
    const lower: number[] = [];
    for (const v of values) {
        const row = runtime.step(state, valCandle(v));
        upper.push(row.upper ?? Number.NaN);
        middle.push(row.middle ?? Number.NaN);
        lower.push(row.lower ?? Number.NaN);
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
    const runtime = atrRuntime(period);
    const state = runtime.initialState();
    return candles.map((c) => runtime.step(state, c).value);
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

/**
 * Latest session VWAP from the ONE indicator engine (UTC-day anchored).
 *
 * The previous implementation averaged the ENTIRE loaded history, so the
 * number depended on how much history happened to be loaded — not a VWAP.
 * Session anchoring matches the chart's VWAP line and lib/analytics/vwap.
 */
function calculateVWAPLatest(candles: MarketCandle[]): number | null {
    if (candles.length === 0) return null;
    const rows = alignedIndicatorSeries(candles, { id: "vwap" }, "value");
    for (let i = rows.length - 1; i >= 0; i--) {
        const v = rows[i];
        if (v !== null && Number.isFinite(v)) return v;
    }
    return null;
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