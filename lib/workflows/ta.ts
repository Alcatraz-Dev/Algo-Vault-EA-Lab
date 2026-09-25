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
    extra?: Record<string, number | null | string>;
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

export function stoch(candles: MarketCandle[], period = 14): IndicatorResult {
    if (candles.length < period) return { value: null, series: [], note: "Not enough candles." };
    const kSeries: number[] = [];
    for (let i = period - 1; i < candles.length; i++) {
        const window = candles.slice(i - period + 1, i + 1);
        let high = -Infinity;
        let low = Infinity;
        for (const c of window) {
            if (Number(c.high) > high) high = Number(c.high);
            if (Number(c.low) < low) low = Number(c.low);
        }
        const close = Number(candles[i].close);
        // Flat window has no range — treat as neutral 50 rather than dividing by zero.
        if (high === low) { kSeries.push(50); continue; }
        kSeries.push(((close - low) / (high - low)) * 100);
    }
    if (kSeries.length === 0) return { value: null, series: [], note: "Not enough candles." };

    // %D = 3-period SMA of %K (standard default).
    const dPeriod = 3;
    const dSeries: number[] = [];
    for (let i = dPeriod - 1; i < kSeries.length; i++) {
        const window = kSeries.slice(i - dPeriod + 1, i + 1);
        dSeries.push(window.reduce((a, b) => a + b, 0) / dPeriod);
    }

    return {
        value: kSeries[kSeries.length - 1],
        series: lastN(kSeries),
        extra: { d: dSeries.length ? dSeries[dSeries.length - 1] : null },
        note: dSeries.length ? undefined : "Not enough candles for %D.",
    };
}

export function obv(candles: MarketCandle[]): IndicatorResult {
    if (candles.length < 2) return { value: null, series: [], note: "Not enough candles." };
    const series: number[] = [0];
    let level = 0;
    let sawVolume = false;
    for (let i = 1; i < candles.length; i++) {
        const volume = Number(candles[i].volume ?? 0);
        if (volume > 0) sawVolume = true;
        const close = Number(candles[i].close);
        const prevClose = Number(candles[i - 1].close);
        if (close > prevClose) level += volume;
        else if (close < prevClose) level -= volume;
        series.push(level);
    }
    if (!sawVolume) return { value: null, series: [], note: "Volume data is required for OBV." };
    const last = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : null;
    return {
        value: last,
        series: lastN(series),
        extra: { change: prev !== null ? last - prev : 0 },
    };
}

export function wma(candles: MarketCandle[], period: number): IndicatorResult {
    const c = closes(candles);
    if (c.length < period) return { value: null, series: [], note: "Not enough candles." };
    const series: number[] = [];
    const denom = (period * (period + 1)) / 2;
    for (let i = period - 1; i < c.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += c[i - period + 1 + j] * (j + 1);
        }
        series.push(sum / denom);
    }
    return { value: series.length ? series[series.length - 1] : null, series: lastN(series) };
}

export function hma(candles: MarketCandle[], period: number): IndicatorResult {
    const c = closes(candles);
    if (c.length < period) return { value: null, series: [], note: "Not enough candles." };
    const halfPeriod = Math.max(1, Math.floor(period / 2));
    const sqrtPeriod = Math.max(1, Math.floor(Math.sqrt(period)));

    const wmaHalf = wma(candles, halfPeriod).series;
    const wmaFull = wma(candles, period).series;
    const minLen = Math.min(wmaHalf.length, wmaFull.length);
    const rawHma: number[] = [];
    for (let i = 0; i < minLen; i++) {
        const hVal = wmaHalf[wmaHalf.length - minLen + i];
        const fVal = wmaFull[wmaFull.length - minLen + i];
        rawHma.push(2 * hVal - fVal);
    }

    const denom = (sqrtPeriod * (sqrtPeriod + 1)) / 2;
    const finalSeries: number[] = [];
    for (let i = sqrtPeriod - 1; i < rawHma.length; i++) {
        let sum = 0;
        for (let j = 0; j < sqrtPeriod; j++) {
            sum += rawHma[i - sqrtPeriod + 1 + j] * (j + 1);
        }
        finalSeries.push(sum / denom);
    }

    return { value: finalSeries.length ? finalSeries[finalSeries.length - 1] : null, series: lastN(finalSeries) };
}

export function supertrend(candles: MarketCandle[], period = 10, multiplier = 3): IndicatorResult {
    if (candles.length < period + 1) return { value: null, series: [], note: "Not enough candles." };
    const atrRes = atr(candles, period);
    if (!atrRes.series.length) return { value: null, series: [] };

    const offset = candles.length - atrRes.series.length;
    let trend = 1;
    let upperBand = 0;
    let lowerBand = 0;
    const stSeries: number[] = [];
    const trendSeries: number[] = [];

    for (let i = 0; i < atrRes.series.length; i++) {
        const candleIdx = offset + i;
        const c = candles[candleIdx];
        const prevC = candles[candleIdx - 1] || c;
        const median = (Number(c.high) + Number(c.low)) / 2;
        const atrVal = atrRes.series[i];

        const basicUpper = median + multiplier * atrVal;
        const basicLower = median - multiplier * atrVal;

        if (i === 0) {
            upperBand = basicUpper;
            lowerBand = basicLower;
        } else {
            upperBand = (basicUpper < upperBand || Number(prevC.close) > upperBand) ? basicUpper : upperBand;
            lowerBand = (basicLower > lowerBand || Number(prevC.close) < lowerBand) ? basicLower : lowerBand;
        }

        if (trend === 1 && Number(c.close) < lowerBand) {
            trend = -1;
        } else if (trend === -1 && Number(c.close) > upperBand) {
            trend = 1;
        }

        const stVal = trend === 1 ? lowerBand : upperBand;
        stSeries.push(stVal);
        trendSeries.push(trend);
    }

    const lastVal = stSeries[stSeries.length - 1] ?? null;
    const lastTrend = trendSeries[trendSeries.length - 1] ?? 1;

    return {
        value: lastVal,
        series: lastN(stSeries),
        extra: { trend: lastTrend, upper: upperBand, lower: lowerBand },
    };
}

export function keltner(candles: MarketCandle[], emaPeriod = 20, atrPeriod = 10, multiplier = 2): IndicatorResult {
    const emaRes = ema(candles, emaPeriod);
    const atrRes = atr(candles, atrPeriod);
    if (emaRes.value === null || atrRes.value === null) return { value: null, series: [] };

    const upper = emaRes.value + multiplier * atrRes.value;
    const lower = emaRes.value - multiplier * atrRes.value;

    return {
        value: emaRes.value,
        series: emaRes.series,
        extra: { upper, lower, middle: emaRes.value },
    };
}

export function donchian(candles: MarketCandle[], period = 20): IndicatorResult {
    if (candles.length < period) return { value: null, series: [], note: "Not enough candles." };
    const uppers: number[] = [];
    const lowers: number[] = [];
    const middles: number[] = [];

    for (let i = period - 1; i < candles.length; i++) {
        const window = candles.slice(i - period + 1, i + 1);
        let maxH = -Infinity;
        let minL = Infinity;
        for (const c of window) {
            if (Number(c.high) > maxH) maxH = Number(c.high);
            if (Number(c.low) < minL) minL = Number(c.low);
        }
        const mid = (maxH + minL) / 2;
        uppers.push(maxH);
        lowers.push(minL);
        middles.push(mid);
    }

    return {
        value: middles[middles.length - 1] ?? null,
        series: lastN(middles),
        extra: { upper: uppers[uppers.length - 1] ?? null, lower: lowers[lowers.length - 1] ?? null },
    };
}

export function stochRsi(candles: MarketCandle[], rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3): IndicatorResult {
    const rsiRes = rsi(candles, rsiPeriod);
    if (!rsiRes.series.length || rsiRes.series.length < stochPeriod) {
        return { value: null, series: [], note: "Not enough candles for Stoch RSI." };
    }

    const rsiVals = rsiRes.series;
    const stochK: number[] = [];
    for (let i = stochPeriod - 1; i < rsiVals.length; i++) {
        const window = rsiVals.slice(i - stochPeriod + 1, i + 1);
        const minRsi = Math.min(...window);
        const maxRsi = Math.max(...window);
        const curRsi = rsiVals[i];
        const k = maxRsi === minRsi ? 50 : ((curRsi - minRsi) / (maxRsi - minRsi)) * 100;
        stochK.push(k);
    }

    const kSmooth: number[] = [];
    for (let i = kPeriod - 1; i < stochK.length; i++) {
        const window = stochK.slice(i - kPeriod + 1, i + 1);
        kSmooth.push(window.reduce((a, b) => a + b, 0) / kPeriod);
    }

    const dSmooth: number[] = [];
    for (let i = dPeriod - 1; i < kSmooth.length; i++) {
        const window = kSmooth.slice(i - dPeriod + 1, i + 1);
        dSmooth.push(window.reduce((a, b) => a + b, 0) / dPeriod);
    }

    const lastK = kSmooth.length ? kSmooth[kSmooth.length - 1] : null;
    const lastD = dSmooth.length ? dSmooth[dSmooth.length - 1] : null;

    return { value: lastK, series: lastN(kSmooth), extra: { d: lastD } };
}

export function vwap(candles: MarketCandle[]): IndicatorResult {
    if (candles.length === 0) return { value: null, series: [] };
    let cumVol = 0;
    let cumTpVol = 0;
    const series: number[] = [];

    for (const c of candles) {
        const high = Number(c.high);
        const low = Number(c.low);
        const close = Number(c.close);
        const vol = Number(c.volume ?? 1);
        const tp = (high + low + close) / 3;

        cumTpVol += tp * vol;
        cumVol += vol;
        series.push(cumVol > 0 ? cumTpVol / cumVol : tp);
    }

    const lastVwap = series[series.length - 1] ?? null;
    return { value: lastVwap, series: lastN(series) };
}

export function adx(candles: MarketCandle[], period = 14): IndicatorResult {
    if (candles.length < period * 2) return { value: null, series: [], note: "Not enough candles for ADX." };

    const trs: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    for (let i = 1; i < candles.length; i++) {
        const h = Number(candles[i].high);
        const l = Number(candles[i].low);
        const prevH = Number(candles[i - 1].high);
        const prevL = Number(candles[i - 1].low);
        const prevC = Number(candles[i - 1].close);

        const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
        const upMove = h - prevH;
        const downMove = prevL - l;

        const pDm = (upMove > downMove && upMove > 0) ? upMove : 0;
        const mDm = (downMove > upMove && downMove > 0) ? downMove : 0;

        trs.push(tr);
        plusDMs.push(pDm);
        minusDMs.push(mDm);
    }

    let smoothTr = trs.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothPlusDm = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
    let smoothMinusDm = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

    const dxSeries: number[] = [];
    for (let i = period; i < trs.length; i++) {
        smoothTr = smoothTr - (smoothTr / period) + trs[i];
        smoothPlusDm = smoothPlusDm - (smoothPlusDm / period) + plusDMs[i];
        smoothMinusDm = smoothMinusDm - (smoothMinusDm / period) + minusDMs[i];

        const plusDI = smoothTr > 0 ? (smoothPlusDm / smoothTr) * 100 : 0;
        const minusDI = smoothTr > 0 ? (smoothMinusDm / smoothTr) * 100 : 0;
        const diSum = plusDI + minusDI;
        const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
        dxSeries.push(dx);
    }

    if (dxSeries.length < period) return { value: null, series: [] };

    let adxVal = dxSeries.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const adxSeries: number[] = [adxVal];

    for (let i = period; i < dxSeries.length; i++) {
        adxVal = ((adxVal * (period - 1)) + dxSeries[i]) / period;
        adxSeries.push(adxVal);
    }

    const lastAdx = adxSeries[adxSeries.length - 1] ?? null;
    const lastPlusDI = smoothTr > 0 ? (smoothPlusDm / smoothTr) * 100 : null;
    const lastMinusDI = smoothTr > 0 ? (smoothMinusDm / smoothTr) * 100 : null;

    return {
        value: lastAdx,
        series: lastN(adxSeries),
        extra: { plusDI: lastPlusDI, minusDI: lastMinusDI },
    };
}

export function psar(candles: MarketCandle[], step = 0.02, maxStep = 0.2): IndicatorResult {
    if (candles.length < 3) return { value: null, series: [], note: "Not enough candles for PSAR." };

    let isLong = Number(candles[1].close) > Number(candles[0].close);
    let sar = isLong ? Number(candles[0].low) : Number(candles[0].high);
    let ep = isLong ? Number(candles[0].high) : Number(candles[0].low);
    let af = step;

    const series: number[] = [];

    for (let i = 1; i < candles.length; i++) {
        const h = Number(candles[i].high);
        const l = Number(candles[i].low);

        sar = sar + af * (ep - sar);

        if (isLong) {
            sar = Math.min(sar, Number(candles[i - 1].low), i > 1 ? Number(candles[i - 2].low) : Number(candles[i - 1].low));
            if (l < sar) {
                isLong = false;
                sar = ep;
                ep = l;
                af = step;
            } else {
                if (h > ep) {
                    ep = h;
                    af = Math.min(af + step, maxStep);
                }
            }
        } else {
            sar = Math.max(sar, Number(candles[i - 1].high), i > 1 ? Number(candles[i - 2].high) : Number(candles[i - 1].high));
            if (h > sar) {
                isLong = true;
                sar = ep;
                ep = h;
                af = step;
            } else {
                if (l < ep) {
                    ep = l;
                    af = Math.min(af + step, maxStep);
                }
            }
        }
        series.push(sar);
    }

    return {
        value: series[series.length - 1] ?? null,
        series: lastN(series),
        extra: { trend: isLong ? 1 : -1 },
    };
}

export function cmf(candles: MarketCandle[], period = 20): IndicatorResult {
    if (candles.length < period) return { value: null, series: [], note: "Not enough candles for CMF." };

    const series: number[] = [];
    for (let i = period - 1; i < candles.length; i++) {
        const window = candles.slice(i - period + 1, i + 1);
        let mfvSum = 0;
        let volSum = 0;
        for (const c of window) {
            const h = Number(c.high);
            const l = Number(c.low);
            const cl = Number(c.close);
            const v = Number(c.volume ?? 1);

            const mfm = h === l ? 0 : ((cl - l) - (h - cl)) / (h - l);
            mfvSum += mfm * v;
            volSum += v;
        }
        series.push(volSum > 0 ? mfvSum / volSum : 0);
    }

    return { value: series[series.length - 1] ?? null, series: lastN(series) };
}

export function williamsR(candles: MarketCandle[], period = 14): IndicatorResult {
    if (candles.length < period) return { value: null, series: [], note: "Not enough candles." };
    const series: number[] = [];

    for (let i = period - 1; i < candles.length; i++) {
        const window = candles.slice(i - period + 1, i + 1);
        let maxH = -Infinity;
        let minL = Infinity;
        for (const c of window) {
            if (Number(c.high) > maxH) maxH = Number(c.high);
            if (Number(c.low) < minL) minL = Number(c.low);
        }
        const close = Number(candles[i].close);
        const r = maxH === minL ? -50 : ((maxH - close) / (maxH - minL)) * -100;
        series.push(r);
    }

    return { value: series[series.length - 1] ?? null, series: lastN(series) };
}

export function cci(candles: MarketCandle[], period = 20): IndicatorResult {
    if (candles.length < period) return { value: null, series: [], note: "Not enough candles." };

    const tps = candles.map((c) => (Number(c.high) + Number(c.low) + Number(c.close)) / 3);
    const series: number[] = [];

    for (let i = period - 1; i < tps.length; i++) {
        const window = tps.slice(i - period + 1, i + 1);
        const meanTp = window.reduce((a, b) => a + b, 0) / period;
        const meanDev = window.reduce((a, b) => a + Math.abs(b - meanTp), 0) / period;
        const curTp = tps[i];
        const val = meanDev === 0 ? 0 : (curTp - meanTp) / (0.015 * meanDev);
        series.push(val);
    }

    return { value: series[series.length - 1] ?? null, series: lastN(series) };
}

export function evaluateCustomFormula(formula: string, candles: MarketCandle[]): IndicatorResult {
    if (!formula.trim()) return { value: null, series: [], note: "Formula expression is empty." };
    if (candles.length < 5) return { value: null, series: [], note: "Not enough candles to evaluate formula." };

    try {
        const cleanForm = formula.trim();
        const smaMatch = cleanForm.match(/sma\((\d+)\)/i);
        const emaMatch = cleanForm.match(/ema\((\d+)\)/i);
        const rsiMatch = cleanForm.match(/rsi\((\d+)\)/i);
        const atrMatch = cleanForm.match(/atr\((\d+)\)/i);

        const smaPeriod = smaMatch ? Number(smaMatch[1]) : 20;
        const emaPeriod = emaMatch ? Number(emaMatch[1]) : 20;
        const rsiPeriod = rsiMatch ? Number(rsiMatch[1]) : 14;
        const atrPeriod = atrMatch ? Number(atrMatch[1]) : 14;

        const smaRes = sma(candles, smaPeriod);
        const emaRes = ema(candles, emaPeriod);
        const rsiRes = rsi(candles, rsiPeriod);
        const atrRes = atr(candles, atrPeriod);

        const close = Number(candles[candles.length - 1].close);
        const open = Number(candles[candles.length - 1].open);
        const high = Number(candles[candles.length - 1].high);
        const low = Number(candles[candles.length - 1].low);
        const volume = Number(candles[candles.length - 1].volume ?? 1);

        const cSlice = candles.slice(-20).map(c => Number(c.close));
        const meanC = cSlice.reduce((a, b) => a + b, 0) / cSlice.length;
        const stddevVal = Math.sqrt(cSlice.reduce((a, b) => a + (b - meanC) ** 2, 0) / cSlice.length);

        const expr = cleanForm
            .replace(/close/gi, String(close))
            .replace(/open/gi, String(open))
            .replace(/high/gi, String(high))
            .replace(/low/gi, String(low))
            .replace(/volume/gi, String(volume))
            .replace(/sma\(\d+\)/gi, String(smaRes.value ?? close))
            .replace(/ema\(\d+\)/gi, String(emaRes.value ?? close))
            .replace(/rsi\(\d+\)/gi, String(rsiRes.value ?? 50))
            .replace(/atr\(\d+\)/gi, String(atrRes.value ?? 1))
            .replace(/stddev\(\d+\)/gi, String(stddevVal || 1));

        const evalVal = Function(`"use strict"; return (${expr});`)();
        const numVal = Number(evalVal);

        if (!Number.isFinite(numVal)) {
            return { value: null, series: [], note: "Formula produced non-numeric result." };
        }

        return {
            value: numVal,
            series: [numVal],
            extra: { formula, evaluatedExpr: expr },
        };
    } catch (err: any) {
        return { value: null, series: [], note: `Formula syntax error: ${err.message}` };
    }
}

export function computeIndicator(type: string, candles: MarketCandle[], period: number, extraConfig?: Record<string, unknown>): IndicatorResult {
    switch (type) {
        case "technical.sma": return sma(candles, period);
        case "technical.ema": return ema(candles, period);
        case "technical.rsi": return rsi(candles, period);
        case "technical.macd": return macd(candles, Number(extraConfig?.fast) || 12, Number(extraConfig?.slow) || 26, period || 9);
        case "technical.atr": return atr(candles, period);
        case "technical.bollinger": return bollinger(candles, period, Number(extraConfig?.deviations) || 2);
        case "technical.stoch": return stoch(candles, period);
        case "technical.obv": return obv(candles);
        case "technical.wma": return wma(candles, period);
        case "technical.hma": return hma(candles, period);
        case "technical.supertrend": return supertrend(candles, period, Number(extraConfig?.multiplier) || 3);
        case "technical.keltner": return keltner(candles, Number(extraConfig?.emaPeriod) || 20, period || 10, Number(extraConfig?.multiplier) || 2);
        case "technical.donchian": return donchian(candles, period);
        case "technical.stoch_rsi": return stochRsi(candles, Number(extraConfig?.rsiPeriod) || 14, period || 14);
        case "technical.vwap": return vwap(candles);
        case "technical.adx": return adx(candles, period);
        case "technical.psar": return psar(candles, Number(extraConfig?.step) || 0.02, Number(extraConfig?.maxStep) || 0.2);
        case "technical.cmf": return cmf(candles, period);
        case "technical.williams_r": return williamsR(candles, period);
        case "technical.cci": return cci(candles, period);
        case "technical.custom_formula": return evaluateCustomFormula(String(extraConfig?.formula || ""), candles);
        default: return { value: null, series: [], note: `Unknown indicator ${type}` };
    }
}