/**
 * Indicator primitives — stateful kernels shared by every registered
 * indicator.
 *
 * Each kernel is a FOLD: `init()` → repeated `step()` calls, one candle per
 * call. The full-series computation and the realtime incremental update run
 * the exact same `step` code path, which is what makes incremental results
 * mathematically equivalent to a full recalculation (proved by tests).
 *
 * Conventions (see docs/market-intelligence-core.md):
 *  - Warmup values are `null` — never NaN, never a fabricated number.
 *  - EMA/WMA/MACD seed with an SMA of the first `period` values (the
 *    MetaTrader/TradingView convention) and are `null` before that.
 *  - ATR/RSI/ADX use Wilder smoothing seeded with an arithmetic mean.
 *  - Every step consumes exactly ONE candle and never looks ahead.
 */

import type { CoreCandle, IndicatorRuntime } from "../types";

// ── simple moving average ──────────────────────────────────────────────────

export interface SmaState {
    buf: number[];
    sum: number;
    period: number;
}

export function smaRuntime(period: number): IndicatorRuntime<SmaState> {
    return {
        initialState: () => ({ buf: [], sum: 0, period }),
        clone: (s) => ({ buf: s.buf.slice(), sum: s.sum, period: s.period }),
        step: (s, c) => {
            s.buf.push(c.close);
            s.sum += c.close;
            if (s.buf.length > s.period) s.sum -= s.buf.shift()!;
            const ready = s.buf.length === s.period;
            return { value: ready ? s.sum / s.period : null };
        },
    };
}

// ── exponential moving average (SMA-seeded, null until seeded) ─────────────

export interface EmaState {
    period: number;
    k: number;
    seed: number[];
    seedSum: number;
    value: number | null;
}

/**
 * EMA over an arbitrary (possibly null-carrying) input stream.
 * `read` extracts the input from a candle (close by default) or returns null
 * for derived streams (e.g. the MACD line feeding its signal EMA).
 */
export function emaRuntime(
    period: number,
    read: (c: CoreCandle) => number | null = (c) => c.close,
): IndicatorRuntime<EmaState> {
    return {
        initialState: () => emaInit(period),
        clone: (s) => emaClone(s),
        step: (s, c) => ({ value: emaValueStep(s, read(c)) }),
    };
}

export function emaInit(period: number): EmaState {
    return { period, k: 2 / (period + 1), seed: [], seedSum: 0, value: null };
}

export function emaClone(s: EmaState): EmaState {
    return { ...s, seed: s.seed.slice() };
}

/**
 * Fold one externally produced value (a derived line such as MACD) into an
 * EMA state. Nulls are skipped so a derived stream seeds on its own first
 * `period` valid values.
 */
export function emaValueStep(s: EmaState, v: number | null): number | null {
    if (v === null || !Number.isFinite(v)) return s.value;
    if (s.value === null) {
        s.seed.push(v);
        s.seedSum += v;
        if (s.seed.length > s.period) s.seedSum -= s.seed.shift()!;
        if (s.seed.length === s.period) s.value = s.seedSum / s.period;
        return s.value;
    }
    s.value = v * s.k + s.value * (1 - s.k);
    return s.value;
}

// ── weighted moving average ────────────────────────────────────────────────

export interface WmaState {
    buf: number[];
    period: number;
    denom: number;
}

export function wmaRuntime(period: number): IndicatorRuntime<WmaState> {
    const denom = (period * (period + 1)) / 2;
    return {
        initialState: () => ({ buf: [], period, denom }),
        clone: (s) => ({ buf: s.buf.slice(), period: s.period, denom: s.denom }),
        step: (s, c) => {
            s.buf.push(c.close);
            if (s.buf.length > s.period) s.buf.shift();
            if (s.buf.length < s.period) return { value: null };
            let acc = 0;
            for (let i = 0; i < s.buf.length; i++) acc += s.buf[i] * (i + 1);
            return { value: acc / s.denom };
        },
    };
}

// ── RSI (Wilder) ───────────────────────────────────────────────────────────

export interface RsiState {
    period: number;
    prevClose: number | null;
    count: number;
    avgGain: number;
    avgLoss: number;
    seedGain: number;
    seedLoss: number;
    value: number | null;
}

export function rsiRuntime(period: number): IndicatorRuntime<RsiState> {
    return {
        initialState: () => ({ period, prevClose: null, count: 0, avgGain: 0, avgLoss: 0, seedGain: 0, seedLoss: 0, value: null }),
        clone: (s) => ({ ...s }),
        step: (s, c) => {
            if (s.prevClose === null) {
                s.prevClose = c.close;
                return { value: null };
            }
            const change = c.close - s.prevClose;
            s.prevClose = c.close;
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? -change : 0;
            if (s.value === null) {
                s.seedGain += gain;
                s.seedLoss += loss;
                s.count += 1;
                if (s.count === s.period) {
                    s.avgGain = s.seedGain / s.period;
                    s.avgLoss = s.seedLoss / s.period;
                    s.value = s.avgLoss === 0 ? 100 : 100 - 100 / (1 + s.avgGain / s.avgLoss);
                }
                return { value: s.value };
            }
            s.avgGain = (s.avgGain * (s.period - 1) + gain) / s.period;
            s.avgLoss = (s.avgLoss * (s.period - 1) + loss) / s.period;
            s.value = s.avgLoss === 0 ? 100 : 100 - 100 / (1 + s.avgGain / s.avgLoss);
            return { value: s.value };
        },
    };
}

// ── ATR (Wilder) ───────────────────────────────────────────────────────────

export interface AtrState {
    period: number;
    prevClose: number | null;
    value: number | null;
    seedSum: number;
    seedCount: number;
}

export function trueRange(c: CoreCandle, prevClose: number): number {
    return Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose),
    );
}

export function atrRuntime(period: number): IndicatorRuntime<AtrState> {
    return {
        initialState: () => ({ period, prevClose: null, value: null, seedSum: 0, seedCount: 0 }),
        clone: (s) => ({ ...s }),
        step: (s, c) => {
            const tr = s.prevClose === null ? c.high - c.low : trueRange(c, s.prevClose);
            s.prevClose = c.close;
            if (s.value === null) {
                s.seedSum += tr;
                s.seedCount += 1;
                if (s.seedCount === s.period) s.value = s.seedSum / s.period;
                return { value: s.value };
            }
            s.value = (s.value * (s.period - 1) + tr) / s.period;
            return { value: s.value };
        },
    };
}

// ── Bollinger bands (SMA ± k·population stdev) ─────────────────────────────

export interface BbState {
    buf: number[];
    sum: number;
    sumSq: number;
    period: number;
    mult: number;
}

export function bollingerRuntime(period: number, mult: number): IndicatorRuntime<BbState> {
    return {
        initialState: () => ({ buf: [], sum: 0, sumSq: 0, period, mult }),
        clone: (s) => ({ buf: s.buf.slice(), sum: s.sum, sumSq: s.sumSq, period: s.period, mult: s.mult }),
        step: (s, c) => {
            s.buf.push(c.close);
            s.sum += c.close;
            s.sumSq += c.close * c.close;
            if (s.buf.length > s.period) {
                const out = s.buf.shift()!;
                s.sum -= out;
                s.sumSq -= out * out;
            }
            if (s.buf.length < s.period) return { upper: null, middle: null, lower: null };
            const mean = s.sum / s.period;
            const variance = Math.max(0, s.sumSq / s.period - mean * mean);
            const sd = Math.sqrt(variance);
            return { upper: mean + mult * sd, middle: mean, lower: mean - mult * sd };
        },
    };
}

// ── Stochastic (slow) ──────────────────────────────────────────────────────

export interface StochState {
    kPeriod: number;
    highs: number[];
    lows: number[];
    kSmooth: number;
    dSmooth: number;
    rawBuf: number[];
    rawSum: number;
    kBuf: number[];
    kSum: number;
}

export function stochasticRuntime(kPeriod: number, kSmooth: number, dSmooth: number): IndicatorRuntime<StochState> {
    return {
        initialState: () => ({ kPeriod, highs: [], lows: [], kSmooth, dSmooth, rawBuf: [], rawSum: 0, kBuf: [], kSum: 0 }),
        clone: (s) => ({ ...s, highs: s.highs.slice(), lows: s.lows.slice(), rawBuf: s.rawBuf.slice(), kBuf: s.kBuf.slice() }),
        step: (s, c) => {
            s.highs.push(c.high);
            s.lows.push(c.low);
            if (s.highs.length > s.kPeriod) {
                s.highs.shift();
                s.lows.shift();
            }
            if (s.highs.length < s.kPeriod) return { k: null, d: null };
            const hh = Math.max(...s.highs);
            const ll = Math.min(...s.lows);
            const range = hh - ll;
            const raw = range === 0 ? 50 : ((c.close - ll) / range) * 100;

            s.rawBuf.push(raw);
            s.rawSum += raw;
            if (s.rawBuf.length > s.kSmooth) s.rawSum -= s.rawBuf.shift()!;
            if (s.rawBuf.length < s.kSmooth) return { k: null, d: null };
            const k = s.rawSum / s.kSmooth;

            s.kBuf.push(k);
            s.kSum += k;
            if (s.kBuf.length > s.dSmooth) s.kSum -= s.kBuf.shift()!;
            const d = s.kBuf.length === s.dSmooth ? s.kSum / s.dSmooth : null;
            return { k, d };
        },
    };
}

// ── Awesome Oscillator ─────────────────────────────────────────────────────

export interface AoState {
    fast: SmaState;
    slow: SmaState;
}

function smaMedianRuntime(period: number): IndicatorRuntime<SmaState> {
    const inner = smaRuntime(period);
    return {
        initialState: () => inner.initialState(),
        clone: (s) => inner.clone(s),
        step: (s, c) => inner.step(s, { ...c, close: (c.high + c.low) / 2 }),
    };
}

export function awesomeRuntime(fast: number, slow: number): IndicatorRuntime<AoState> {
    const fastR = smaMedianRuntime(fast);
    const slowR = smaMedianRuntime(slow);
    return {
        initialState: () => ({ fast: fastR.initialState(), slow: slowR.initialState() }),
        clone: (s) => ({ fast: fastR.clone(s.fast), slow: slowR.clone(s.slow) }),
        step: (s, c) => {
            const f = fastR.step(s.fast, c).value;
            const sl = slowR.step(s.slow, c).value;
            return { value: f !== null && sl !== null ? f - sl : null };
        },
    };
}

// ── ADX / DI (Wilder) ──────────────────────────────────────────────────────

export interface AdxState {
    period: number;
    prevHigh: number | null;
    prevLow: number | null;
    prevClose: number | null;
    trSum: number;
    plusSum: number;
    minusSum: number;
    count: number;
    trSmooth: number | null;
    plusSmooth: number | null;
    minusSmooth: number | null;
    dxSum: number;
    dxCount: number;
    adx: number | null;
}

/**
 * ADX with Wilder smoothing (standard: DI available after `period` bars,
 * ADX available after `2 × period` bars).
 */
export function adxRuntime(period: number): IndicatorRuntime<AdxState> {
    return {
        initialState: () => ({
            period,
            prevHigh: null,
            prevLow: null,
            prevClose: null,
            trSum: 0,
            plusSum: 0,
            minusSum: 0,
            count: 0,
            trSmooth: null,
            plusSmooth: null,
            minusSmooth: null,
            dxSum: 0,
            dxCount: 0,
            adx: null,
        }),
        clone: (s) => ({ ...s }),
        step: (s, c) => {
            const empty = { adx: null, plusDI: null, minusDI: null };
            if (s.prevHigh === null || s.prevLow === null || s.prevClose === null) {
                s.prevHigh = c.high;
                s.prevLow = c.low;
                s.prevClose = c.close;
                return empty;
            }
            const tr = trueRange(c, s.prevClose);
            const upMove = c.high - s.prevHigh;
            const downMove = s.prevLow - c.low;
            const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
            const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;
            s.prevHigh = c.high;
            s.prevLow = c.low;
            s.prevClose = c.close;

            if (s.trSmooth === null) {
                // Seeding phase: accumulate the first `period` raw values.
                s.trSum += tr;
                s.plusSum += plusDm;
                s.minusSum += minusDm;
                s.count += 1;
                if (s.count < s.period) return empty;
                s.trSmooth = s.trSum;
                s.plusSmooth = s.plusSum;
                s.minusSmooth = s.minusSum;
            } else {
                s.trSmooth = s.trSmooth - s.trSmooth / s.period + tr;
                s.plusSmooth = s.plusSmooth! - s.plusSmooth! / s.period + plusDm;
                s.minusSmooth = s.minusSmooth! - s.minusSmooth! / s.period + minusDm;
            }

            const plusDI = s.trSmooth > 0 ? (100 * s.plusSmooth!) / s.trSmooth : 0;
            const minusDI = s.trSmooth > 0 ? (100 * s.minusSmooth!) / s.trSmooth : 0;
            const diSum = plusDI + minusDI;
            const dx = diSum > 0 ? (100 * Math.abs(plusDI - minusDI)) / diSum : 0;

            if (s.adx === null) {
                s.dxSum += dx;
                s.dxCount += 1;
                if (s.dxCount === s.period) s.adx = s.dxSum / s.period;
            } else {
                s.adx = (s.adx * (s.period - 1) + dx) / s.period;
            }
            return { adx: s.adx, plusDI, minusDI };
        },
    };
}

// ── OBV ────────────────────────────────────────────────────────────────────

export interface ObvState {
    value: number | null;
    prevClose: number | null;
    cumulativeVolume: number;
}

export function obvRuntime(): IndicatorRuntime<ObvState> {
    return {
        initialState: () => ({ value: null, prevClose: null, cumulativeVolume: 0 }),
        clone: (s) => ({ ...s }),
        step: (s, c) => {
            const vol = c.volume ?? 0;
            s.cumulativeVolume += vol;
            if (s.value === null) {
                s.value = 0;
                s.prevClose = c.close;
                return { value: s.cumulativeVolume > 0 ? s.value : null };
            }
            if (c.close > s.prevClose!) s.value += vol;
            else if (c.close < s.prevClose!) s.value -= vol;
            s.prevClose = c.close;
            return { value: s.cumulativeVolume > 0 ? s.value : null };
        },
    };
}

// ── VWAP (session anchored, UTC day) ───────────────────────────────────────

export interface VwapState {
    day: string;
    cumPV: number;
    cumV: number;
}

function utcDay(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);
}

export function vwapRuntime(): IndicatorRuntime<VwapState> {
    return {
        initialState: () => ({ day: "", cumPV: 0, cumV: 0 }),
        clone: (s) => ({ ...s }),
        step: (s, c) => {
            const day = utcDay(c.timestamp);
            if (day !== s.day) {
                s.day = day;
                s.cumPV = 0;
                s.cumV = 0;
            }
            const typical = (c.high + c.low + c.close) / 3;
            const vol = c.volume && c.volume > 0 ? c.volume : 1;
            s.cumPV += typical * vol;
            s.cumV += vol;
            return { value: s.cumV > 0 ? s.cumPV / s.cumV : null };
        },
    };
}
