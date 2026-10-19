import { MarketCandle } from "@/lib/market-data/types";
import { rsi as rsiSeries } from "@/lib/analytics/indicators";

// ─────────────────────────────────────────────────────────────────────────────
// Indicator library. Every series is causal: value[i] only uses candles 0..i.
// Warm-up bars hold NaN, and `indicatorRowAt` reports them as null so a rule
// that depends on an unready indicator evaluates to false (no trade).
// ─────────────────────────────────────────────────────────────────────────────

export type IndicatorFamily =
    | "Price"
    | "Moving averages"
    | "Momentum"
    | "Trend strength"
    | "Volatility"
    | "Channels"
    | "Candle"
    | "Smart money";

export interface IndicatorDef {
    key: string;
    label: string;
    family: IndicatorFamily;
    description: string;
    /** Default comparison value when a condition is created from this indicator. */
    defaultValue?: number;
    /** Default comparison series. When set, the default condition compares two series. */
    defaultCompareTo?: string;
}

const DEFS = [
    // Price
    { key: "close", label: "Close", family: "Price", description: "Last closed candle price.", defaultCompareTo: "ema_20" },
    { key: "open", label: "Open", family: "Price", description: "Candle open price.", defaultCompareTo: "close" },
    { key: "high", label: "High", family: "Price", description: "Candle high price.", defaultCompareTo: "close" },
    { key: "low", label: "Low", family: "Price", description: "Candle low price.", defaultCompareTo: "close" },

    // Moving averages
    { key: "sma_5", label: "SMA 5", family: "Moving averages", description: "Simple moving average of closes, 5 bars.", defaultCompareTo: "close" },
    { key: "sma_10", label: "SMA 10", family: "Moving averages", description: "Simple moving average, 10 bars.", defaultCompareTo: "close" },
    { key: "sma_20", label: "SMA 20", family: "Moving averages", description: "Simple moving average, 20 bars.", defaultCompareTo: "close" },
    { key: "sma_50", label: "SMA 50", family: "Moving averages", description: "Simple moving average, 50 bars.", defaultCompareTo: "close" },
    { key: "sma_100", label: "SMA 100", family: "Moving averages", description: "Simple moving average, 100 bars.", defaultCompareTo: "close" },
    { key: "sma_200", label: "SMA 200", family: "Moving averages", description: "Simple moving average, 200 bars.", defaultCompareTo: "close" },
    { key: "ema_5", label: "EMA 5", family: "Moving averages", description: "Exponential moving average, 5 bars.", defaultCompareTo: "close" },
    { key: "ema_9", label: "EMA 9", family: "Moving averages", description: "Exponential moving average, 9 bars.", defaultCompareTo: "close" },
    { key: "ema_10", label: "EMA 10", family: "Moving averages", description: "Exponential moving average, 10 bars.", defaultCompareTo: "close" },
    { key: "ema_12", label: "EMA 12", family: "Moving averages", description: "Exponential moving average, 12 bars.", defaultCompareTo: "close" },
    { key: "ema_20", label: "EMA 20", family: "Moving averages", description: "Exponential moving average, 20 bars.", defaultCompareTo: "close" },
    { key: "ema_21", label: "EMA 21", family: "Moving averages", description: "Exponential moving average, 21 bars.", defaultCompareTo: "close" },
    { key: "ema_26", label: "EMA 26", family: "Moving averages", description: "Exponential moving average, 26 bars.", defaultCompareTo: "close" },
    { key: "ema_50", label: "EMA 50", family: "Moving averages", description: "Exponential moving average, 50 bars.", defaultCompareTo: "close" },
    { key: "ema_100", label: "EMA 100", family: "Moving averages", description: "Exponential moving average, 100 bars.", defaultCompareTo: "close" },
    { key: "ema_200", label: "EMA 200", family: "Moving averages", description: "Exponential moving average, 200 bars.", defaultCompareTo: "close" },
    { key: "ema_34", label: "EMA 34", family: "Moving averages", description: "Exponential moving average, 34 bars.", defaultCompareTo: "close" },
    { key: "ema_55", label: "EMA 55", family: "Moving averages", description: "Exponential moving average, 55 bars.", defaultCompareTo: "close" },
    { key: "wma_20", label: "WMA 20", family: "Moving averages", description: "Linearly weighted moving average, 20 bars. Reacts faster than SMA.", defaultCompareTo: "close" },

    // Momentum
    { key: "rsi_2", label: "RSI 2", family: "Momentum", description: "Wilder RSI, 2 bars. Fast, for pullbacks.", defaultValue: 50 },
    { key: "rsi_7", label: "RSI 7", family: "Momentum", description: "Wilder RSI, 7 bars.", defaultValue: 50 },
    { key: "rsi_14", label: "RSI 14", family: "Momentum", description: "Wilder RSI, 14 bars. 0–100.", defaultValue: 50 },
    { key: "rsi_21", label: "RSI 21", family: "Momentum", description: "Wilder RSI, 21 bars.", defaultValue: 50 },
    { key: "macd_line", label: "MACD line", family: "Momentum", description: "EMA12 minus EMA26.", defaultCompareTo: "macd_signal" },
    { key: "macd_signal", label: "MACD signal", family: "Momentum", description: "EMA9 of the MACD line.", defaultCompareTo: "macd_line" },
    { key: "macd_hist", label: "MACD histogram", family: "Momentum", description: "MACD line minus signal.", defaultValue: 0 },
    { key: "stoch_k_14", label: "Stoch %K 14", family: "Momentum", description: "Stochastic oscillator %K, 14 bars. 0–100.", defaultCompareTo: "stoch_d_14" },
    { key: "stoch_d_14", label: "Stoch %D 14", family: "Momentum", description: "3-bar SMA of %K.", defaultCompareTo: "stoch_k_14" },
    { key: "willr_14", label: "Williams %R 14", family: "Momentum", description: "Williams %R, 14 bars. -100 to 0.", defaultValue: -50 },
    { key: "roc_10", label: "ROC 10", family: "Momentum", description: "Rate of change over 10 bars, percent.", defaultValue: 0 },
    { key: "roc_20", label: "ROC 20", family: "Momentum", description: "Rate of change over 20 bars, percent.", defaultValue: 0 },
    { key: "cci_20", label: "CCI 20", family: "Momentum", description: "Commodity channel index, 20 bars.", defaultValue: 0 },
    { key: "momentum_10", label: "Momentum 10", family: "Momentum", description: "Price change over 10 bars, in price units (close minus close 10 bars ago).", defaultValue: 0 },

    // Trend strength
    { key: "adx_14", label: "ADX 14", family: "Trend strength", description: "Average directional index, 14 bars. Trend strength, not direction.", defaultValue: 25 },
    { key: "plus_di_14", label: "+DI 14", family: "Trend strength", description: "Positive directional indicator, 14 bars.", defaultCompareTo: "minus_di_14" },
    { key: "minus_di_14", label: "-DI 14", family: "Trend strength", description: "Negative directional indicator, 14 bars.", defaultCompareTo: "plus_di_14" },

    // Volatility
    { key: "bb_upper_20", label: "Bollinger upper 20", family: "Volatility", description: "SMA20 + 2 standard deviations.", defaultCompareTo: "close" },
    { key: "bb_lower_20", label: "Bollinger lower 20", family: "Volatility", description: "SMA20 - 2 standard deviations.", defaultCompareTo: "close" },
    { key: "bb_width_20", label: "Bollinger width 20", family: "Volatility", description: "Band width as percent of the middle band.", defaultValue: 2 },
    { key: "bb_percent_b_20", label: "Bollinger %B 20", family: "Volatility", description: "Close position inside the Bollinger bands: 0 at the lower band, 1 at the upper band.", defaultValue: 0.5 },
    { key: "atr_14", label: "ATR 14", family: "Volatility", description: "Average true range (Wilder), 14 bars, in price units.", defaultValue: 0 },
    { key: "atr_pct_14", label: "ATR % 14", family: "Volatility", description: "ATR 14 as percent of the close.", defaultValue: 0 },
    { key: "keltner_upper_20", label: "Keltner upper 20", family: "Volatility", description: "EMA 20 plus 2 × ATR 14.", defaultCompareTo: "close" },
    { key: "keltner_lower_20", label: "Keltner lower 20", family: "Volatility", description: "EMA 20 minus 2 × ATR 14.", defaultCompareTo: "close" },

    // Channels
    { key: "donchian_high_20", label: "Donchian high 20", family: "Channels", description: "Highest high of the previous 20 bars (excludes current bar).", defaultCompareTo: "close" },
    { key: "donchian_low_20", label: "Donchian low 20", family: "Channels", description: "Lowest low of the previous 20 bars (excludes current bar).", defaultCompareTo: "close" },
    { key: "donchian_high_55", label: "Donchian high 55", family: "Channels", description: "Highest high of the previous 55 bars (excludes current bar).", defaultCompareTo: "close" },
    { key: "donchian_low_55", label: "Donchian low 55", family: "Channels", description: "Lowest low of the previous 55 bars (excludes current bar).", defaultCompareTo: "close" },

    // Candle
    { key: "candle_body_pct", label: "Candle body %", family: "Candle", description: "Size of the candle body as percent of its high-low range. High values mean a decisive candle.", defaultValue: 50 },

    // Smart money concepts: mechanical, candle-only definitions (not broker/session dependent).
    { key: "premium_discount_20", label: "Premium / discount (20)", family: "Smart money", description: "Close position in the prior 20 completed candles' high-low range; 0=discount, 50=midpoint, 100=premium.", defaultValue: 50 },
    { key: "buy_side_sweep_20", label: "Buy-side sweep (20)", family: "Smart money", description: "Current high exceeds the prior 20-bar high and closes back below that level; 1=true, 0=false.", defaultValue: 0 },
    { key: "sell_side_sweep_20", label: "Sell-side sweep (20)", family: "Smart money", description: "Current low breaks the prior 20-bar low and closes back above that level; 1=true, 0=false.", defaultValue: 0 },
    { key: "bullish_fvg_3", label: "Bullish FVG (3-candle)", family: "Smart money", description: "Third candle low is above the first candle high; 1 on formation, otherwise 0.", defaultValue: 0 },
    { key: "bearish_fvg_3", label: "Bearish FVG (3-candle)", family: "Smart money", description: "Third candle high is below the first candle low; 1 on formation, otherwise 0.", defaultValue: 0 },
    { key: "swing_high_3", label: "Confirmed swing high (3)", family: "Smart money", description: "Last confirmed 3-left/3-right pivot high; only available after three right-side candles close.", defaultCompareTo: "close" },
    { key: "swing_low_3", label: "Confirmed swing low (3)", family: "Smart money", description: "Last confirmed 3-left/3-right pivot low; only available after three right-side candles close.", defaultCompareTo: "close" },
    { key: "body_atr_14", label: "Candle body / ATR 14", family: "Smart money", description: "Absolute candle body divided by Wilder ATR(14), for measuring displacement.", defaultValue: 1 },
    { key: "bullish_displacement_14", label: "Bullish displacement", family: "Smart money", description: "Bull candle body is at least 1 ATR and at least 70% of its range; 1=true, 0=false.", defaultValue: 1 },
    { key: "bearish_displacement_14", label: "Bearish displacement", family: "Smart money", description: "Bear candle body is at least 1 ATR and at least 70% of its range; 1=true, 0=false.", defaultValue: 1 },
    { key: "bullish_fvg_retest_3", label: "Bullish FVG retest", family: "Smart money", description: "Candle overlaps the most recent bullish 3-candle FVG after its formation; 1=true, 0=false.", defaultValue: 1 },
    { key: "bearish_fvg_retest_3", label: "Bearish FVG retest", family: "Smart money", description: "Candle overlaps the most recent bearish 3-candle FVG after its formation; 1=true, 0=false.", defaultValue: 1 },
] as const satisfies readonly IndicatorDef[];

export type IndicatorKey = (typeof DEFS)[number]["key"];

export const INDICATOR_DEFS: readonly IndicatorDef[] = DEFS;

const INDICATOR_KEY_SET = new Set<string>(DEFS.map((d) => d.key));
const DEF_BY_KEY = new Map<string, IndicatorDef>(DEFS.map((d) => [d.key, d]));

export const INDICATOR_FAMILIES: readonly IndicatorFamily[] = [
    "Price",
    "Moving averages",
    "Momentum",
    "Trend strength",
    "Volatility",
    "Channels",
    "Candle",
    "Smart money",
];

export function isIndicatorKey(value: string): value is IndicatorKey {
    return INDICATOR_KEY_SET.has(value);
}

export function indicatorDef(key: string): IndicatorDef | undefined {
    return DEF_BY_KEY.get(key);
}

export const INDICATOR_OPERATORS = [
    { value: "gt", label: "is above" },
    { value: "gte", label: "is at or above" },
    { value: "lt", label: "is below" },
    { value: "lte", label: "is at or below" },
    { value: "crosses_above", label: "crosses above" },
    { value: "crosses_below", label: "crosses below" },
    { value: "rising", label: "is rising" },
    { value: "falling", label: "is falling" },
] as const;

export type IndicatorOperator = (typeof INDICATOR_OPERATORS)[number]["value"];

export function isIndicatorOperator(value: string): value is IndicatorOperator {
    return INDICATOR_OPERATORS.some((o) => o.value === value);
}

/** Default operator, value and comparison series for a freshly added condition. */
export function defaultConditionFor(key: string): {
    operator: IndicatorOperator;
    value: number;
    compareTo?: string;
} {
    const def = indicatorDef(key);
    if (def?.defaultCompareTo) {
        return { operator: "gt", value: 0, compareTo: def.defaultCompareTo };
    }
    return { operator: "gt", value: def?.defaultValue ?? 0 };
}

/** Human-readable sentence, e.g. "EMA 20 is above Close" or "RSI 14 crosses below 30". */
export function describeIndicatorCondition(input: {
    indicator: string;
    operator: string;
    value?: number;
    compareTo?: string;
}): string {
    const lhs = indicatorDef(input.indicator)?.label ?? input.indicator;
    const opLabel = INDICATOR_OPERATORS.find((o) => o.value === input.operator)?.label ?? input.operator;
    if (input.operator === "rising" || input.operator === "falling") return `${lhs} ${opLabel}`;
    const rhs = input.compareTo
        ? indicatorDef(input.compareTo)?.label ?? input.compareTo
        : String(input.value ?? 0);
    return `${lhs} ${opLabel} ${rhs}`;
}

// ── Series math ─────────────────────────────────────────────────────────────

function filled(n: number): number[] {
    return new Array<number>(n).fill(Number.NaN);
}

function finiteOrNaN(v: number): number {
    return Number.isFinite(v) ? v : Number.NaN;
}

/** Simple moving average. Any NaN inside the window yields NaN. */
function sma(src: number[], period: number): number[] {
    const out = filled(src.length);
    let sum = 0;
    let bad = 0;
    for (let i = 0; i < src.length; i++) {
        const v = src[i];
        if (Number.isFinite(v)) sum += v;
        else bad++;
        if (i >= period) {
            const old = src[i - period];
            if (Number.isFinite(old)) sum -= old;
            else bad--;
        }
        if (i >= period - 1 && bad === 0) out[i] = sum / period;
    }
    return out;
}

/**
 * Exponential moving average seeded with the SMA of the first `period` values
 * after the first finite value. Assumes the series is finite from its first
 * valid index onward.
 */
function ema(src: number[], period: number): number[] {
    const out = filled(src.length);
    const start = src.findIndex((v) => Number.isFinite(v));
    if (start < 0 || src.length - start < period) return out;
    const k = 2 / (period + 1);
    let prev = 0;
    for (let j = start; j < start + period; j++) prev += src[j];
    prev /= period;
    out[start + period - 1] = prev;
    for (let i = start + period; i < src.length; i++) {
        prev = src[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}

function highestHigh(high: number[], i: number, period: number): number {
    let max = Number.NEGATIVE_INFINITY;
    for (let j = i - period + 1; j <= i; j++) max = Math.max(max, high[j]);
    return max;
}

function lowestLow(low: number[], i: number, period: number): number {
    let min = Number.POSITIVE_INFINITY;
    for (let j = i - period + 1; j <= i; j++) min = Math.min(min, low[j]);
    return min;
}

function stochasticK(high: number[], low: number[], close: number[], period: number): number[] {
    const out = filled(close.length);
    for (let i = period - 1; i < close.length; i++) {
        const hh = highestHigh(high, i, period);
        const ll = lowestLow(low, i, period);
        out[i] = hh === ll ? 50 : ((close[i] - ll) / (hh - ll)) * 100;
    }
    return out;
}

function williamsR(high: number[], low: number[], close: number[], period: number): number[] {
    const out = filled(close.length);
    for (let i = period - 1; i < close.length; i++) {
        const hh = highestHigh(high, i, period);
        const ll = lowestLow(low, i, period);
        out[i] = hh === ll ? -50 : ((hh - close[i]) / (hh - ll)) * -100;
    }
    return out;
}

function rateOfChange(close: number[], period: number): number[] {
    const out = filled(close.length);
    for (let i = period; i < close.length; i++) {
        const base = close[i - period];
        out[i] = base === 0 ? 0 : ((close[i] - base) / base) * 100;
    }
    return out;
}

function cci(high: number[], low: number[], close: number[], period: number): number[] {
    const out = filled(close.length);
    const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
    const mean = sma(tp, period);
    for (let i = period - 1; i < tp.length; i++) {
        let dev = 0;
        for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - mean[i]);
        dev /= period;
        out[i] = dev === 0 ? 0 : (tp[i] - mean[i]) / (0.015 * dev);
    }
    return out;
}

/** Wilder-smoothed ADX with +DI / -DI. */
function directionalSystem(
    high: number[],
    low: number[],
    close: number[],
    period: number,
): { plusDi: number[]; minusDi: number[]; adx: number[] } {
    const n = close.length;
    const plusDi = filled(n);
    const minusDi = filled(n);
    const adx = filled(n);
    if (n < period * 2 + 1) return { plusDi, minusDi, adx };

    const tr = filled(n);
    const pdm = filled(n);
    const mdm = filled(n);
    for (let i = 1; i < n; i++) {
        const up = high[i] - high[i - 1];
        const down = low[i - 1] - low[i];
        pdm[i] = up > down && up > 0 ? up : 0;
        mdm[i] = down > up && down > 0 ? down : 0;
        tr[i] = Math.max(
            high[i] - low[i],
            Math.abs(high[i] - close[i - 1]),
            Math.abs(low[i] - close[i - 1]),
        );
    }

    let sTr = 0;
    let sPdm = 0;
    let sMdm = 0;
    for (let i = 1; i <= period; i++) {
        sTr += tr[i];
        sPdm += pdm[i];
        sMdm += mdm[i];
    }
    const dx = filled(n);
    const setDx = (i: number) => {
        plusDi[i] = sTr === 0 ? 0 : (100 * sPdm) / sTr;
        minusDi[i] = sTr === 0 ? 0 : (100 * sMdm) / sTr;
        const sum = plusDi[i] + minusDi[i];
        dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDi[i] - minusDi[i])) / sum;
    };
    setDx(period);
    for (let i = period + 1; i < n; i++) {
        sTr = sTr - sTr / period + tr[i];
        sPdm = sPdm - sPdm / period + pdm[i];
        sMdm = sMdm - sMdm / period + mdm[i];
        setDx(i);
    }

    // ADX: first value is the mean of DX over the next `period` bars, then Wilder.
    let adxPrev = 0;
    for (let i = period; i < period * 2; i++) adxPrev += dx[i];
    adxPrev /= period;
    adx[period * 2 - 1] = adxPrev;
    for (let i = period * 2; i < n; i++) {
        adxPrev = (adxPrev * (period - 1) + dx[i]) / period;
        adx[i] = adxPrev;
    }
    return { plusDi, minusDi, adx };
}

function bollinger(close: number[], period: number, mult: number) {
    const mid = sma(close, period);
    const upper = filled(close.length);
    const lower = filled(close.length);
    const width = filled(close.length);
    for (let i = period - 1; i < close.length; i++) {
        let varSum = 0;
        for (let j = i - period + 1; j <= i; j++) varSum += (close[j] - mid[i]) ** 2;
        const sd = Math.sqrt(varSum / period);
        upper[i] = mid[i] + mult * sd;
        lower[i] = mid[i] - mult * sd;
        width[i] = mid[i] === 0 ? 0 : ((upper[i] - lower[i]) / mid[i]) * 100;
    }
    return { upper, lower, width };
}

/** Highest high / lowest low of the previous `period` bars, excluding the current bar. */
function donchian(high: number[], low: number[], period: number) {
    const hi = filled(high.length);
    const lo = filled(high.length);
    for (let i = period; i < high.length; i++) {
        hi[i] = highestHigh(high, i - 1, period);
        lo[i] = lowestLow(low, i - 1, period);
    }
    return { hi, lo };
}

/** Linearly weighted moving average: the newest bar has the largest weight. */
function wma(src: number[], period: number): number[] {
    const out = filled(src.length);
    const denom = (period * (period + 1)) / 2;
    for (let i = period - 1; i < src.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += src[i - period + 1 + j] * (j + 1);
        out[i] = sum / denom;
    }
    return out;
}

/** Wilder-smoothed average true range. */
function atr(high: number[], low: number[], close: number[], period: number): number[] {
    const n = close.length;
    const out = filled(n);
    if (n < period) return out;
    const tr = filled(n);
    tr[0] = high[0] - low[0];
    for (let i = 1; i < n; i++) {
        tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    }
    let prev = 0;
    for (let i = 0; i < period; i++) prev += tr[i];
    prev /= period;
    out[period - 1] = prev;
    for (let i = period; i < n; i++) {
        prev = (prev * (period - 1) + tr[i]) / period;
        out[i] = prev;
    }
    return out;
}

/**
 * Computes every library series for a candle array. Each array has the same
 * length as `candles`; warm-up positions are NaN.
 */
export function buildIndicatorSeries(candles: MarketCandle[]): Record<string, number[]> {
    const open = candles.map((c) => c.open);
    const high = candles.map((c) => c.high);
    const low = candles.map((c) => c.low);
    const close = candles.map((c) => c.close);

    const series: Record<string, number[]> = { close, open, high, low };

    for (const p of [5, 10, 20, 50, 100, 200]) series[`sma_${p}`] = sma(close, p);
    for (const p of [5, 9, 10, 12, 20, 21, 26, 34, 50, 55, 100, 200]) series[`ema_${p}`] = ema(close, p);
    series.wma_20 = wma(close, 20);
    series.momentum_10 = close.map((c, i) => (i < 10 ? Number.NaN : c - close[i - 10]));
    series.candle_body_pct = close.map((c, i) => {
        const range = high[i] - low[i];
        return range <= 0 ? 0 : (Math.abs(c - open[i]) / range) * 100;
    });

    for (const p of [2, 7, 14, 21]) {
        series[`rsi_${p}`] = rsiSeries(close, p).map(finiteOrNaN);
    }

    const ema12 = ema(close, 12);
    const ema26 = ema(close, 26);
    const macdLine = close.map((_, i) =>
        Number.isFinite(ema12[i]) && Number.isFinite(ema26[i]) ? ema12[i] - ema26[i] : Number.NaN,
    );
    const macdSignal = ema(macdLine, 9);
    series.macd_line = macdLine;
    series.macd_signal = macdSignal;
    series.macd_hist = macdLine.map((v, i) => v - macdSignal[i]);

    const stochK = stochasticK(high, low, close, 14);
    series.stoch_k_14 = stochK;
    series.stoch_d_14 = sma(stochK, 3);
    series.willr_14 = williamsR(high, low, close, 14);
    series.roc_10 = rateOfChange(close, 10);
    series.roc_20 = rateOfChange(close, 20);
    series.cci_20 = cci(high, low, close, 20);

    const dmi = directionalSystem(high, low, close, 14);
    series.adx_14 = dmi.adx;
    series.plus_di_14 = dmi.plusDi;
    series.minus_di_14 = dmi.minusDi;

    const bb = bollinger(close, 20, 2);
    series.bb_upper_20 = bb.upper;
    series.bb_lower_20 = bb.lower;
    series.bb_width_20 = bb.width;
    series.bb_percent_b_20 = close.map((c, i) => {
        const u = bb.upper[i];
        const l = bb.lower[i];
        return u === l ? Number.NaN : (c - l) / (u - l);
    });

    const atr14 = atr(high, low, close, 14);
    series.atr_14 = atr14;
    series.atr_pct_14 = close.map((c, i) => finiteOrNaN((atr14[i] / c) * 100));
    series.keltner_upper_20 = series.ema_20.map((m, i) => m + 2 * atr14[i]);
    series.keltner_lower_20 = series.ema_20.map((m, i) => m - 2 * atr14[i]);

    const d20 = donchian(high, low, 20);
    series.donchian_high_20 = d20.hi;
    series.donchian_low_20 = d20.lo;
    const d55 = donchian(high, low, 55);
    series.donchian_high_55 = d55.hi;
    series.donchian_low_55 = d55.lo;

    const d20Prior = donchian(high, low, 20);
    series.premium_discount_20 = close.map((c, i) => {
        const top = d20Prior.hi[i];
        const bottom = d20Prior.lo[i];
        return !Number.isFinite(top) || !Number.isFinite(bottom) || top === bottom
            ? Number.NaN
            : ((c - bottom) / (top - bottom)) * 100;
    });
    series.buy_side_sweep_20 = close.map((c, i) =>
        Number.isFinite(d20Prior.hi[i]) && high[i] > d20Prior.hi[i] && c < d20Prior.hi[i] ? 1 : 0,
    );
    series.sell_side_sweep_20 = close.map((c, i) =>
        Number.isFinite(d20Prior.lo[i]) && low[i] < d20Prior.lo[i] && c > d20Prior.lo[i] ? 1 : 0,
    );
    series.bullish_fvg_3 = close.map((_, i) => i >= 2 && low[i] > high[i - 2] ? 1 : 0);
    series.bearish_fvg_3 = close.map((_, i) => i >= 2 && high[i] < low[i - 2] ? 1 : 0);
    const swingHigh = filled(close.length);
    const swingLow = filled(close.length);
    for (let i = 2 * 3; i < close.length; i++) {
        const pivot = i - 3;
        let isHigh = true;
        let isLow = true;
        for (let j = pivot - 3; j <= pivot + 3; j++) {
            if (j === pivot) continue;
            if (high[j] >= high[pivot]) isHigh = false;
            if (low[j] <= low[pivot]) isLow = false;
        }
        swingHigh[i] = isHigh ? high[pivot] : (i > 0 ? swingHigh[i - 1] : Number.NaN);
        swingLow[i] = isLow ? low[pivot] : (i > 0 ? swingLow[i - 1] : Number.NaN);
    }
    series.swing_high_3 = swingHigh;
    series.swing_low_3 = swingLow;

    const bullishFvgRetest = filled(close.length).fill(0);
    const bearishFvgRetest = filled(close.length).fill(0);
    let bullishGap: { low: number; high: number; formedAt: number } | null = null;
    let bearishGap: { low: number; high: number; formedAt: number } | null = null;
    for (let i = 2; i < close.length; i++) {
        if (series.bullish_fvg_3[i] === 1) bullishGap = { low: high[i - 2], high: low[i], formedAt: i };
        else if (bullishGap && i > bullishGap.formedAt && low[i] <= bullishGap.high && high[i] >= bullishGap.low) {
            bullishFvgRetest[i] = 1;
            bullishGap = null;
        }
        if (series.bearish_fvg_3[i] === 1) bearishGap = { low: high[i], high: low[i - 2], formedAt: i };
        else if (bearishGap && i > bearishGap.formedAt && high[i] >= bearishGap.low && low[i] <= bearishGap.high) {
            bearishFvgRetest[i] = 1;
            bearishGap = null;
        }
    }
    series.bullish_fvg_retest_3 = bullishFvgRetest;
    series.bearish_fvg_retest_3 = bearishFvgRetest;
    series.body_atr_14 = close.map((c, i) => finiteOrNaN(Math.abs(c - open[i]) / atr14[i]));
    series.bullish_displacement_14 = close.map((c, i) =>
        c > open[i] && Number.isFinite(atr14[i]) && c - open[i] >= atr14[i] &&
        high[i] - low[i] > 0 && (c - open[i]) / (high[i] - low[i]) >= 0.7 ? 1 : 0,
    );
    series.bearish_displacement_14 = close.map((c, i) =>
        c < open[i] && Number.isFinite(atr14[i]) && open[i] - c >= atr14[i] &&
        high[i] - low[i] > 0 && (open[i] - c) / (high[i] - low[i]) >= 0.7 ? 1 : 0,
    );

    return series;
}

/** One bar of the library: every key mapped to its value, or null during warm-up. */
export function indicatorRowAt(series: Record<string, number[]>, index: number): Record<string, number | null> {
    const row: Record<string, number | null> = {};
    for (const def of DEFS) {
        const v = series[def.key]?.[index];
        row[def.key] = v !== undefined && Number.isFinite(v) ? v : null;
    }
    return row;
}
