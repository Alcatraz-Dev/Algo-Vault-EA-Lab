/**
 * Indicator definitions — the canonical registry of calculation + metadata.
 *
 * Every entry declares id, name, category, version, inputs, outputs, pane
 * placement and documentation, and produces structured
 * `IndicatorResult` rows (timestamp → named values) instead of pixels.
 *
 * Calculation rules (formulas, seeds, warmups) are documented in
 * docs/market-intelligence-core.md. Changing any rule requires bumping the
 * definition's `version` so historical research stays reproducible.
 */

import { indicatorRegistry } from "../registry";
import type { IndicatorDefinition, IndicatorRuntime, CoreCandle } from "../types";
import {
    adxRuntime,
    awesomeRuntime,
    atrRuntime,
    bollingerRuntime,
    emaClone,
    emaRuntime,
    emaValueStep,
    obvRuntime,
    rsiRuntime,
    smaRuntime,
    stochasticRuntime,
    vwapRuntime,
    wmaRuntime,
    type EmaState,
} from "./primitives";

const VERSION = "1.0.0";

/** Read a parameter with a hard fallback (defaults are also merged upstream). */
function num(params: Record<string, number>, key: string, fallback: number): number {
    const v = params?.[key];
    return Number.isFinite(v) ? (v as number) : fallback;
}

function periodOf(params: Record<string, number>, fallback = 20, key = "period"): number {
    return Math.max(1, Math.floor(num(params, key, fallback)));
}

/** Guard rails so a bad parameter can never hang or explode the fold. */
function bounded(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

// ── SMA ────────────────────────────────────────────────────────────────────

export const smaDefinition: IndicatorDefinition = {
    id: "sma",
    name: "Simple Moving Average",
    category: "trend",
    version: VERSION,
    pane: "price",
    overlayOnPrice: true,
    params: [{ key: "period", label: "Length", default: 20, min: 1, max: 500 }],
    outputs: [{ key: "value", label: "SMA", role: "line" }],
    warmup: (params) => periodOf(params),
    create: (params) => smaRuntime(periodOf(params)) as unknown as IndicatorRuntime<unknown>,
    docs: "Arithmetic mean of the last `period` closes. Null for the first period-1 candles.",
};

// ── EMA ────────────────────────────────────────────────────────────────────

export const emaDefinition: IndicatorDefinition = {
    id: "ema",
    name: "Exponential Moving Average",
    category: "trend",
    version: VERSION,
    pane: "price",
    overlayOnPrice: true,
    params: [{ key: "period", label: "Length", default: 20, min: 1, max: 500 }],
    outputs: [{ key: "value", label: "EMA", role: "line" }],
    warmup: (params) => periodOf(params),
    create: (params) => emaRuntime(periodOf(params)) as unknown as IndicatorRuntime<unknown>,
    docs: "SMA-seeded EMA (MetaTrader/TradingView convention): seeded with the mean of the first `period` closes, null before that.",
};

// ── WMA ────────────────────────────────────────────────────────────────────

export const wmaDefinition: IndicatorDefinition = {
    id: "wma",
    name: "Weighted Moving Average",
    category: "trend",
    version: VERSION,
    pane: "price",
    overlayOnPrice: true,
    params: [{ key: "period", label: "Length", default: 20, min: 1, max: 500 }],
    outputs: [{ key: "value", label: "WMA", role: "line" }],
    warmup: (params) => periodOf(params),
    create: (params) => wmaRuntime(periodOf(params)) as unknown as IndicatorRuntime<unknown>,
    docs: "Linearly weighted MA: newest close weighted `period`, oldest weighted 1.",
};

// ── VWAP ───────────────────────────────────────────────────────────────────

export const vwapDefinition: IndicatorDefinition = {
    id: "vwap",
    name: "VWAP (session)",
    category: "volume",
    version: VERSION,
    pane: "price",
    overlayOnPrice: true,
    params: [],
    outputs: [{ key: "value", label: "VWAP", role: "line" }],
    warmup: () => 1,
    create: () => vwapRuntime() as IndicatorRuntime<unknown>,
    docs: "Cumulative Σ(typical price × volume) / Σ(volume), reset at every UTC day boundary. Volume defaults to 1 when the feed carries none.",
};

// ── Bollinger Bands ────────────────────────────────────────────────────────

export const bollingerDefinition: IndicatorDefinition = {
    id: "bollinger",
    name: "Bollinger Bands",
    category: "bands",
    version: VERSION,
    pane: "price",
    overlayOnPrice: true,
    params: [
        { key: "period", label: "Length", default: 20, min: 2, max: 500 },
        { key: "mult", label: "Std dev", default: 2, min: 0.1, max: 10 },
    ],
    outputs: [
        { key: "upper", label: "Upper", role: "band_upper" },
        { key: "middle", label: "Basis", role: "band_middle" },
        { key: "lower", label: "Lower", role: "band_lower" },
    ],
    warmup: (params) => periodOf(params),
    create: (params) =>
        bollingerRuntime(periodOf(params), bounded(num(params, "mult", 2), 0.1, 10)) as unknown as IndicatorRuntime<unknown>,
    docs: "SMA(period) ± mult × population standard deviation of the last `period` closes.",
};

// ── RSI ────────────────────────────────────────────────────────────────────

export const rsiDefinition: IndicatorDefinition = {
    id: "rsi",
    name: "Relative Strength Index",
    category: "momentum",
    version: VERSION,
    pane: "pane",
    overlayOnPrice: false,
    params: [{ key: "period", label: "Length", default: 14, min: 2, max: 200 }],
    outputs: [{ key: "value", label: "RSI", role: "line" }],
    warmup: (params) => periodOf(params),
    create: (params) => rsiRuntime(periodOf(params)) as unknown as IndicatorRuntime<unknown>,
    docs: "Wilder RSI: seeded with the mean gain/loss of the first `period` changes, then smoothed (p-1)/p + change/p. 0–100.",
};

// ── MACD ───────────────────────────────────────────────────────────────────

interface MacdState {
    fast: EmaState;
    slow: EmaState;
    signalState: EmaState;
    macd: number | null;
}

export const macdDefinition: IndicatorDefinition<MacdState> = {
    id: "macd",
    name: "MACD",
    category: "momentum",
    version: VERSION,
    pane: "pane",
    overlayOnPrice: false,
    params: [
        { key: "fast", label: "Fast", default: 12, min: 1, max: 200 },
        { key: "slow", label: "Slow", default: 26, min: 2, max: 400 },
        { key: "signal", label: "Signal", default: 9, min: 1, max: 200 },
    ],
    outputs: [
        { key: "macd", label: "MACD", role: "line" },
        { key: "signal", label: "Signal", role: "line" },
        { key: "histogram", label: "Histogram", role: "histogram" },
    ],
    warmup: (params) => periodOf(params, 26, "slow") + periodOf(params, 9, "signal") - 1,
    create: (params) => {
        const fastPeriod = periodOf(params, 12, "fast");
        const slowPeriod = Math.max(periodOf(params, 26, "slow"), fastPeriod + 1);
        const signalPeriod = periodOf(params, 9, "signal");
        const fastR = emaRuntime(fastPeriod);
        const slowR = emaRuntime(slowPeriod);
        const signalRef = emaRuntime(signalPeriod);
        return {
            initialState: (): MacdState => ({
                fast: fastR.initialState(),
                slow: slowR.initialState(),
                signalState: signalRef.initialState(),
                macd: null,
            }),
            clone: (s): MacdState => ({
                fast: fastR.clone(s.fast),
                slow: slowR.clone(s.slow),
                signalState: emaClone(s.signalState),
                macd: s.macd,
            }),
            step: (s: MacdState, c: CoreCandle) => {
                const fv = fastR.step(s.fast, c).value;
                const sv = slowR.step(s.slow, c).value;
                s.macd = fv !== null && sv !== null ? fv - sv : null;
                const signal = emaValueStep(s.signalState, s.macd);
                return { macd: s.macd, signal, histogram: s.macd !== null && signal !== null ? s.macd - signal : null };
            },
        };
    },
    docs: "EMA(fast) − EMA(slow); signal = EMA of the MACD line seeded on its first `signal` valid values; histogram = MACD − signal.",
};

// ── Stochastic ─────────────────────────────────────────────────────────────

export const stochasticDefinition: IndicatorDefinition = {
    id: "stochastic",
    name: "Stochastic (slow)",
    category: "momentum",
    version: VERSION,
    pane: "pane",
    overlayOnPrice: false,
    params: [
        { key: "kPeriod", label: "%K length", default: 14, min: 1, max: 200 },
        { key: "kSmooth", label: "%K smoothing", default: 3, min: 1, max: 50 },
        { key: "dSmooth", label: "%D smoothing", default: 3, min: 1, max: 50 },
    ],
    outputs: [
        { key: "k", label: "%K", role: "line" },
        { key: "d", label: "%D", role: "line" },
    ],
    warmup: (params) => periodOf(params, 14, "kPeriod") + periodOf(params, 3, "kSmooth") - 1,
    create: (params) =>
        stochasticRuntime(
            periodOf(params, 14, "kPeriod"),
            periodOf(params, 3, "kSmooth"),
            periodOf(params, 3, "dSmooth"),
        ) as unknown as IndicatorRuntime<unknown>,
    docs: "Slow stochastic: raw %K over kPeriod, smoothed by SMA(kSmooth); %D = SMA(%K, dSmooth). Flat ranges report 50.",
};

// ── Awesome Oscillator ─────────────────────────────────────────────────────

export const awesomeDefinition: IndicatorDefinition = {
    id: "awesome",
    name: "Awesome Oscillator",
    category: "momentum",
    version: VERSION,
    pane: "pane",
    overlayOnPrice: false,
    params: [
        { key: "fast", label: "Fast", default: 5, min: 1, max: 200 },
        { key: "slow", label: "Slow", default: 34, min: 2, max: 400 },
    ],
    outputs: [{ key: "value", label: "AO", role: "histogram" }],
    warmup: (params) => periodOf(params, 34, "slow"),
    create: (params) =>
        awesomeRuntime(
            periodOf(params, 5, "fast"),
            Math.max(periodOf(params, 34, "slow"), periodOf(params, 5, "fast") + 1),
        ) as unknown as IndicatorRuntime<unknown>,
    docs: "SMA(median price, fast) − SMA(median price, slow); median price = (high+low)/2.",
};

// ── ATR ────────────────────────────────────────────────────────────────────

export const atrDefinition: IndicatorDefinition = {
    id: "atr",
    name: "Average True Range",
    category: "volatility",
    version: VERSION,
    pane: "pane",
    overlayOnPrice: false,
    params: [{ key: "period", label: "Length", default: 14, min: 1, max: 200 }],
    outputs: [{ key: "value", label: "ATR", role: "line" }],
    warmup: (params) => periodOf(params),
    create: (params) => atrRuntime(periodOf(params)) as unknown as IndicatorRuntime<unknown>,
    docs: "Wilder ATR: seeded with the mean of the first `period` true ranges, then (p-1)/p + TR/p.",
};

// ── ADX ────────────────────────────────────────────────────────────────────

export const adxDefinition: IndicatorDefinition = {
    id: "adx",
    name: "ADX / Directional Index",
    category: "trend",
    version: VERSION,
    pane: "pane",
    overlayOnPrice: false,
    params: [{ key: "period", label: "Length", default: 14, min: 2, max: 200 }],
    outputs: [
        { key: "adx", label: "ADX", role: "line" },
        { key: "plusDI", label: "+DI", role: "line" },
        { key: "minusDI", label: "−DI", role: "line" },
    ],
    warmup: (params) => periodOf(params) * 2,
    create: (params) => adxRuntime(periodOf(params)) as unknown as IndicatorRuntime<unknown>,
    docs: "Wilder ADX: DI after `period` bars, ADX line after 2×period bars. Trend strength 0–100.",
};

// ── OBV (volume) ───────────────────────────────────────────────────────────

export const obvDefinition: IndicatorDefinition = {
    id: "obv",
    name: "On-Balance Volume",
    category: "volume",
    version: VERSION,
    pane: "pane",
    overlayOnPrice: false,
    params: [],
    outputs: [{ key: "value", label: "OBV", role: "line" }],
    warmup: () => 1,
    create: () => obvRuntime() as IndicatorRuntime<unknown>,
    docs: "Cumulative volume signed by close direction. Null while the feed carries no volume at all.",
};

// ── registration ───────────────────────────────────────────────────────────

export const REGISTERED_INDICATORS: IndicatorDefinition[] = [
    smaDefinition,
    emaDefinition,
    wmaDefinition,
    vwapDefinition,
    bollingerDefinition,
    rsiDefinition,
    macdDefinition,
    stochasticDefinition,
    awesomeDefinition,
    atrDefinition,
    adxDefinition,
    obvDefinition,
];

let registered = false;

/** Register all built-in indicators exactly once (idempotent). */
export function registerBuiltinIndicators(): void {
    if (registered) return;
    registered = true;
    for (const def of REGISTERED_INDICATORS) {
        if (!indicatorRegistry.has(def.id)) indicatorRegistry.register(def);
    }
}

registerBuiltinIndicators();

/** Convenience: default parameter map for an indicator id. */
export function defaultParams(id: string): Record<string, number> {
    const def = indicatorRegistry.get(id);
    if (!def) return {};
    const out: Record<string, number> = {};
    for (const spec of def.params) out[spec.key] = spec.default;
    return out;
}
