import type { SymbolInfo, TimeframeInfo, BarState } from "./types";

interface CandleLike {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/* ──────────── Pine built-in functions ──────────── */

function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    out[i] = sum / period;
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function wma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - period + 1 + j] * (period - j);
    out[i] = sum / denom;
  }
  return out;
}

function rma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  let avg = 0;
  for (let i = 0; i < period; i++) avg += values[i];
  avg /= period;
  out[period - 1] = avg;
  for (let i = period; i < values.length; i++) {
    avg = (avg * (period - 1) + values[i]) / period;
    out[i] = avg;
  }
  return out;
}

function rsi(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) avgGain += change; else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function macd(closes: number[], fastLen: number, slowLen: number, signalLen: number): [number[], number[], number[]] {
  const fastEma = ema(closes, fastLen);
  const slowEma = ema(closes, slowLen);
  const macdLine = closes.map((_, i) => isNaN(fastEma[i]) || isNaN(slowEma[i]) ? NaN : fastEma[i] - slowEma[i]);
  const validMacd = macdLine.filter(v => !isNaN(v));
  const signalLine = ema(validMacd, signalLen);
  // Align signal back
  const signal: number[] = new Array(closes.length).fill(NaN);
  const startIdx = closes.length - validMacd.length;
  for (let i = 0; i < signalLine.length; i++) {
    signal[startIdx + i] = signalLine[i];
  }
  const histogram = macdLine.map((v, i) => isNaN(v) || isNaN(signal[i]) ? NaN : v - signal[i]);
  return [macdLine, signal, histogram];
}

function atr(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const tr: number[] = new Array(closes.length).fill(NaN);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < closes.length; i++) {
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  return rma(tr, period);
}

function adx(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const len = closes.length;
  const plusDM = new Array(len).fill(0);
  const minusDM = new Array(len).fill(0);
  const tr: number[] = new Array(len).fill(0);

  for (let i = 1; i < len; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }

  const smoothTR = rma(tr, period);
  const smoothPlusDM = rma(plusDM as number[], period);
  const smoothMinusDM = rma(minusDM as number[], period);
  const diPlus = smoothTR.map((v, i) => v === 0 ? 0 : (smoothPlusDM[i] / v) * 100);
  const diMinus = smoothTR.map((v, i) => v === 0 ? 0 : (smoothMinusDM[i] / v) * 100);
  const dx = diPlus.map((v, i) => {
    const sum = v + diMinus[i];
    return sum === 0 ? 0 : (Math.abs(v - diMinus[i]) / sum) * 100;
  });
  return rma(dx, period);
}

function stoch(closes: number[], highs: number[], lows: number[], period: number): [number[], number[]] {
  const k: number[] = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > highest) highest = highs[j];
      if (lows[j] < lowest) lowest = lows[j];
    }
    k[i] = highest === lowest ? 50 : ((closes[i] - lowest) / (highest - lowest)) * 100;
  }
  const d = sma(k.map(v => isNaN(v) ? 0 : v), 3);
  return [k, d];
}

function highest(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] > max) max = values[j];
    out[i] = max;
  }
  return out;
}

function lowest(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] < min) min = values[j];
    out[i] = min;
  }
  return out;
}

function crossover(a: number[], b: number[]): boolean[] {
  const out: boolean[] = new Array(a.length).fill(false);
  for (let i = 1; i < a.length; i++) {
    out[i] = a[i - 1] <= b[i - 1] && a[i] > b[i];
  }
  return out;
}

function crossunder(a: number[], b: number[]): boolean[] {
  const out: boolean[] = new Array(a.length).fill(false);
  for (let i = 1; i < a.length; i++) {
    out[i] = a[i - 1] >= b[i - 1] && a[i] < b[i];
  }
  return out;
}

function change(values: number[], len = 1): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = len; i < values.length; i++) {
    out[i] = values[i] - values[i - len];
  }
  return out;
}

function barssince(cond: boolean[]): number {
  let count = 0;
  for (let i = cond.length - 1; i >= 0; i--) {
    if (cond[i]) return count;
    count++;
  }
  return count;
}

function valuewhen(cond: boolean[], source: number[], nth: number): number[] {
  const out: number[] = new Array(source.length).fill(NaN);
  const occurrences: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (cond[i]) occurrences.push(i);
    if (occurrences.length > nth) {
      out[i] = source[occurrences[occurrences.length - 1 - nth]];
    }
  }
  return out;
}

function pivothigh(highs: number[], leftLen: number, rightLen: number): (number | null)[] {
  const out: (number | null)[] = new Array(highs.length).fill(null);
  for (let i = rightLen; i < highs.length - leftLen; i++) {
    let isPivot = true;
    for (let j = 1; j <= rightLen; j++) {
      if (highs[i] < highs[i - j]) { isPivot = false; break; }
    }
    if (isPivot) {
      for (let j = 1; j <= leftLen; j++) {
        if (highs[i] < highs[i + j]) { isPivot = false; break; }
      }
    }
    if (isPivot) out[i] = highs[i];
  }
  return out;
}

function pivotlow(lows: number[], leftLen: number, rightLen: number): (number | null)[] {
  const out: (number | null)[] = new Array(lows.length).fill(null);
  for (let i = rightLen; i < lows.length - leftLen; i++) {
    let isPivot = true;
    for (let j = 1; j <= rightLen; j++) {
      if (lows[i] > lows[i - j]) { isPivot = false; break; }
    }
    if (isPivot) {
      for (let j = 1; j <= leftLen; j++) {
        if (lows[i] > lows[i + j]) { isPivot = false; break; }
      }
    }
    if (isPivot) out[i] = lows[i];
  }
  return out;
}

function bb(closes: number[], period: number, mult: number): [number[], number[], number[]] {
  const basis = sma(closes, period);
  const upper: number[] = new Array(closes.length).fill(NaN);
  const lower: number[] = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - basis[i]) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = basis[i] + mult * sd;
    lower[i] = basis[i] - mult * sd;
  }
  return [basis, upper, lower];
}

function cci(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const tpSma = sma(tp, period);
  const out: number[] = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += Math.abs(tp[j] - tpSma[i]);
    const md = sum / period;
    out[i] = md === 0 ? 0 : (tp[i] - tpSma[i]) / (0.015 * md);
  }
  return out;
}

function psar(highs: number[], lows: number[], start = 0.02, inc = 0.02, max = 0.2): number[] {
  const len = highs.length;
  const out: number[] = new Array(len).fill(NaN);
  if (len < 2) return out;

  let isLong = highs[1] > highs[0];
  let af = start;
  let ep = isLong ? highs[0] : lows[0];
  let sar = isLong ? lows[0] : highs[0];

  for (let i = 1; i < len; i++) {
    sar = sar + af * (ep - sar);
    if (isLong) {
      if (lows[i] < sar) { isLong = false; sar = ep; af = start; ep = lows[i]; }
      else { if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + inc, max); } }
    } else {
      if (highs[i] > sar) { isLong = true; sar = ep; af = start; ep = highs[i]; }
      else { if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + inc, max); } }
    }
    out[i] = sar;
  }
  return out;
}

function vwap(highs: number[], lows: number[], closes: number[], volumes: number[]): number[] {
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const out: number[] = new Array(closes.length).fill(NaN);
  let cumVol = 0;
  let cumTP = 0;
  for (let i = 0; i < closes.length; i++) {
    cumVol += volumes[i];
    cumTP += tp[i] * volumes[i];
    out[i] = cumVol === 0 ? tp[i] : cumTP / cumVol;
  }
  return out;
}

function obv(closes: number[], volumes: number[]): number[] {
  const out: number[] = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) out[i] = out[i - 1] + volumes[i];
    else if (closes[i] < closes[i - 1]) out[i] = out[i - 1] - volumes[i];
    else out[i] = out[i - 1];
  }
  return out;
}

function mfi(highs: number[], lows: number[], closes: number[], volumes: number[], period: number): number[] {
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const mf = tp.map((v, i) => v * volumes[i]);
  const out: number[] = new Array(closes.length).fill(NaN);
  for (let i = period; i < closes.length; i++) {
    let posMf = 0;
    let negMf = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1]) posMf += mf[j];
      else negMf += mf[j];
    }
    const ratio = negMf === 0 ? 100 : posMf / negMf;
    out[i] = 100 - 100 / (1 + ratio);
  }
  return out;
}

function roc(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i++) {
    out[i] = values[i - period] === 0 ? 0 : ((values[i] - values[i - period]) / values[i - period]) * 100;
  }
  return out;
}

function momentum(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] - values[i - period];
  }
  return out;
}

function vwma(values: number[], volumes: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sumPV = 0;
    let sumV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumPV += values[j] * volumes[j];
      sumV += volumes[j];
    }
    out[i] = sumV === 0 ? NaN : sumPV / sumV;
  }
  return out;
}

/**
 * Keltner Channels — exponential midline (EMA of typical price) with ATR-scaled
 * bands. Classic volatility envelope: mid = EMA(hlc3, len), bands ± mult·ATR(len).
 */
function keltner(highs: number[], lows: number[], closes: number[], period: number, mult: number): [number[], number[], number[]] {
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const mid = ema(tp, period);
  const range = atr(highs, lows, closes, period);
  const upper = mid.map((m, i) => (isNaN(m) || isNaN(range[i]) ? NaN : m + mult * range[i]));
  const lower = mid.map((m, i) => (isNaN(m) || isNaN(range[i]) ? NaN : m - mult * range[i]));
  return [mid, upper, lower];
}

/**
 * Donchian Channels — N-bar highest high / lowest low envelope (the mechanical
 * basis of the Turtle breakout system). Returns [upper, lower, mid].
 */
function donchian(highs: number[], lows: number[], period: number): [number[], number[], number[]] {
  const upper = highest(highs, period);
  const lower = lowest(lows, period);
  const mid = upper.map((u, i) => (isNaN(u) || isNaN(lower[i]) ? NaN : (u + lower[i]) / 2));
  return [upper, lower, mid];
}

/**
 * Supertrend — ATR trailing band that flips under price in uptrends and above
 * price in downtrends. Deterministic recurrence:
 *   basicUpper = hl2 + factor·ATR, basicLower = hl2 − factor·ATR
 *   finalUpper[i] = (basicUpper[i] < finalUpper[i−1] || close[i−1] > finalUpper[i−1]) ? basicUpper[i] : finalUpper[i−1]
 *   finalLower mirrored; trend flips when close crosses the opposite band.
 * Returns [line, direction] with direction +1 (long) / −1 (short) per bar.
 */
function supertrend(highs: number[], lows: number[], closes: number[], period: number, factor: number): [number[], number[]] {
  const len = closes.length;
  const line: number[] = new Array(len).fill(NaN);
  const dir: number[] = new Array(len).fill(1);
  if (len === 0) return [line, dir];
  const atrVals = atr(highs, lows, closes, period);
  let trend = 1;
  let finalUpper = NaN;
  let finalLower = NaN;
  for (let i = 0; i < len; i++) {
    const hl2v = (highs[i] + lows[i]) / 2;
    if (isNaN(atrVals[i])) {
      line[i] = NaN;
      dir[i] = 1;
      continue;
    }
    const basicUpper = hl2v + factor * atrVals[i];
    const basicLower = hl2v - factor * atrVals[i];
    const prevClose = closes[i - 1];
    finalUpper = isNaN(finalUpper) || (basicUpper < finalUpper || (prevClose !== undefined && prevClose > finalUpper)) ? basicUpper : finalUpper;
    finalLower = isNaN(finalLower) || (basicLower > finalLower || (prevClose !== undefined && prevClose < finalLower)) ? basicLower : finalLower;
    if (trend === 1 && closes[i] < finalLower) {
      trend = -1;
    } else if (trend === -1 && closes[i] > finalUpper) {
      trend = 1;
    }
    line[i] = trend === 1 ? finalLower : finalUpper;
    dir[i] = trend;
  }
  return [line, dir];
}

/**
 * Williams %R — stochastic-style position of close within the N-bar high/low
 * range, inverted to [−100, 0]: %R = −100·(HH − close)/(HH − LL).
 */
function willr(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const hh = highest(highs, period);
  const ll = lowest(lows, period);
  const out: number[] = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    const range = hh[i] - ll[i];
    out[i] = range === 0 || isNaN(range) ? NaN : (-100 * (hh[i] - closes[i])) / range;
  }
  return out;
}

/**
 * Linear regression value — least-squares fit over the last `period` bars,
 * evaluated at the bar `offset` back from the current bar (Pine's ta.linreg
 * with offset=0 returns the fitted value at the current bar).
 */
function linreg(values: number[], period: number, offset = 0): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let j = 0; j < period; j++) {
      const x = j;
      const y = values[i - period + 1 + j];
      sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
    }
    const denom = period * sumXX - sumX * sumX;
    const slope = denom === 0 ? 0 : (period * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / period;
    const xEval = period - 1 - offset;
    out[i] = intercept + slope * xEval;
  }
  return out;
}

/**
 * Heikin-Ashi candles — smoothed OHLC built from a recurring open:
 *   haClose = (o+h+l+c)/4, haOpen = (prevHaOpen + prevHaClose)/2
 * Returns [haOpen, haHigh, haLow, haClose].
 */
function heikinashi(opens: number[], highs: number[], lows: number[], closes: number[]): [number[], number[], number[], number[]] {
  const len = closes.length;
  const haO: number[] = new Array(len).fill(NaN);
  const haH: number[] = new Array(len).fill(NaN);
  const haL: number[] = new Array(len).fill(NaN);
  const haC: number[] = new Array(len).fill(NaN);
  for (let i = 0; i < len; i++) {
    haC[i] = (opens[i] + highs[i] + lows[i] + closes[i]) / 4;
    haO[i] = i === 0 ? (opens[0] + closes[0]) / 2 : (haO[i - 1] + haC[i - 1]) / 2;
    haH[i] = Math.max(highs[i], haO[i], haC[i]);
    haL[i] = Math.min(lows[i], haO[i], haC[i]);
  }
  return [haO, haH, haL, haC];
}

/**
 * VWAP with standard-deviation bands over the cumulative session volume —
 * the volume-weighted analogue of Bollinger Bands.
 */
function vwapBands(highs: number[], lows: number[], closes: number[], volumes: number[], mult: number): [number[], number[], number[]] {
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const out: number[] = new Array(closes.length).fill(NaN);
  const upper: number[] = new Array(closes.length).fill(NaN);
  const lower: number[] = new Array(closes.length).fill(NaN);
  let cumV = 0, cumPV = 0, cumP2V = 0;
  for (let i = 0; i < closes.length; i++) {
    const v = volumes[i] > 0 ? volumes[i] : 1;
    cumV += v; cumPV += tp[i] * v; cumP2V += tp[i] * tp[i] * v;
    const mean = cumPV / cumV;
    const variance = Math.max(0, cumP2V / cumV - mean * mean);
    out[i] = mean;
    const sd = Math.sqrt(variance);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return [out, upper, lower];
}

/**
 * Classic floor-trader pivots from the previous UTC day:
 *   P = (H+L+C)/3, R1 = 2P−L, S1 = 2P−H, R2 = P+(H−L), S2 = P−(H−L)
 * Current-day bars carry the previous day's levels forward; no prior day → NaN.
 */
function classicPivotsFrom(highs: number[], lows: number[], closes: number[], times: number[], variant: "classic" | "fibonacci"): [number[], number[], number[], number[], number[]] {
  const len = closes.length;
  const P: number[] = new Array(len).fill(NaN);
  const R1: number[] = new Array(len).fill(NaN);
  const R2: number[] = new Array(len).fill(NaN);
  const S1: number[] = new Array(len).fill(NaN);
  const S2: number[] = new Array(len).fill(NaN);
  let day = "";
  let prevH = NaN, prevL = NaN, prevC = NaN;
  for (let i = 0; i < len; i++) {
    const d = new Date(times[i]).toISOString().slice(0, 10);
    if (d !== day) {
      if (!isNaN(prevH) && !isNaN(prevL) && !isNaN(prevC)) {
        const range = prevH - prevL;
        P[i] = (prevH + prevL + prevC) / 3;
        R1[i] = variant === "classic" ? 2 * (P[i] as number) - prevL : (P[i] as number) + 0.382 * range;
        R2[i] = variant === "classic" ? (P[i] as number) + range : (P[i] as number) + 0.618 * range;
        S1[i] = variant === "classic" ? 2 * (P[i] as number) - prevH : (P[i] as number) - 0.382 * range;
        S2[i] = variant === "classic" ? (P[i] as number) - range : (P[i] as number) - 0.6 * range;
      }
      day = d;
    } else if (!isNaN(P[i - 1] ?? NaN)) {
      P[i] = P[i - 1]; R1[i] = R1[i - 1]; R2[i] = R2[i - 1]; S1[i] = S1[i - 1]; S2[i] = S2[i - 1];
    }
    prevH = highs[i]; prevL = lows[i]; prevC = closes[i];
  }
  return [P, R1, R2, S1, S2];
}

function classicPivots(highs: number[], lows: number[], closes: number[], times: number[] = []): [number[], number[], number[], number[], number[]] {
  return classicPivotsFrom(highs, lows, closes, times, "classic");
}

function fibPivots(highs: number[], lows: number[], closes: number[], times: number[] = []): [number[], number[], number[], number[], number[]] {
  return classicPivotsFrom(highs, lows, closes, times, "fibonacci");
}

/**
 * Fisher Transform — Gaussian-normalises price position via
 * x = 2·((value − minN)/(maxN − minN) − 0.5) then y = ½·ln((1+x)/(1−x)),
 * y1 smoothed. Turns price into a near-Gaussian oscillator with sharp turns
 * at extremes. Clamped to |x| ≤ 0.999 to keep the log finite.
 */
function fisherTransform(highs: number[], lows: number[], period: number): [number[], number[]] {
  const len = highs.length;
  const fisher: number[] = new Array(len).fill(NaN);
  const trigger: number[] = new Array(len).fill(NaN);
  const mid = highs.map((h, i) => (h + lows[i]) / 2);
  let value1Prev = 0;
  let fishPrev = 0;
  for (let i = 0; i < len; i++) {
    if (i < period - 1) continue;
    let maxH = -Infinity;
    let minL = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (mid[j] > maxH) maxH = mid[j];
      if (mid[j] < minL) minL = mid[j];
    }
    const range = maxH - minL;
    const ratio = range <= 0 ? 0.5 : (mid[i] - minL) / range;
    // Ehlers' smoothing: 0.33·2·(ratio − 0.5) + 0.67·prev, clamped to ±0.999
    // so the log stays finite; then fish = ½·ln((1+v)/(1−v)) + ½·prevFish.
    let v = 0.66 * (ratio - 0.5) + 0.67 * value1Prev;
    v = Math.max(-0.999, Math.min(0.999, v));
    value1Prev = v;
    const fish = 0.5 * Math.log((1 + v) / (1 - v)) + 0.5 * fishPrev;
    trigger[i] = fishPrev;
    fisher[i] = fish;
    fishPrev = fish;
  }
  return [fisher, trigger];
}

/**
 * Chaikin Money Flow — accumulation/distribution volume over a window:
 * CMF = Σ(((C−L)−(H−C))/(H−L)·V) / ΣV. Zero-line crosses mark flow regime
 * changes; ±0.25 is the classic strong-flow threshold.
 */
function cmf(highs: number[], lows: number[], closes: number[], volumes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  const mfm = closes.map((c, i) => {
    const range = highs[i] - lows[i];
    return range === 0 ? 0 : ((c - lows[i]) - (highs[i] - c)) / range;
  });
  const mfv = mfm.map((m, i) => m * volumes[i]);
  for (let i = period - 1; i < closes.length; i++) {
    let sumMfv = 0;
    let sumV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumMfv += mfv[j];
      sumV += volumes[j];
    }
    out[i] = sumV === 0 ? 0 : sumMfv / sumV;
  }
  return out;
}

/**
 * Population standard deviation over a rolling window (the basis of
 * Bollinger's σ bands).
 */
function stdev(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (values[j] - mean) ** 2;
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

function hma(values: number[], period: number): number[] {
  const halfWma = wma(values, Math.floor(period / 2));
  const fullWma = wma(values, period);
  const diff = halfWma.map((v, i) => isNaN(v) || isNaN(fullWma[i]) ? NaN : 2 * v - fullWma[i]);
  const sqrtPeriod = Math.max(1, Math.floor(Math.sqrt(period)));
  return wma(diff.map(v => isNaN(v) ? 0 : v), sqrtPeriod);
}

/* ──────────── Math functions ──────────── */

const mathAbs = Math.abs;
const mathMax = Math.max;
const mathMin = Math.min;
const mathRound = Math.round;
const mathFloor = Math.floor;
const mathCeil = Math.ceil;
const mathSqrt = Math.sqrt;
const mathPow = Math.pow;
const mathLog = Math.log;
const mathExp = Math.exp;
const mathCos = Math.cos;
const mathSin = Math.sin;
const mathTan = Math.tan;
const mathAcos = Math.acos;
const mathAsin = Math.asin;
const mathAtan = Math.atan;
const mathAtan2 = Math.atan2;
const mathRandom = Math.random;

/* ──────────── Array functions ──────────── */

function arrayNewFloat(size: number, initialVal = 0): number[] { return new Array(size).fill(initialVal); }
function arrayNewInt(size: number, initialVal = 0): number[] { return new Array(size).fill(initialVal); }
function arrayNewBool(size: number, initialVal = false): boolean[] { return new Array(size).fill(initialVal); }
function arrayPush<T>(arr: T[], val: T): void { arr.push(val); }
function arrayPop<T>(arr: T[]): T | undefined { return arr.pop(); }
function arrayShift<T>(arr: T[]): T | undefined { return arr.shift(); }
function arrayUnshift<T>(arr: T[], val: T): void { arr.unshift(val); }
function arrayGet<T>(arr: T[], index: number): T { return arr[index]; }
function arraySet<T>(arr: T[], index: number, val: T): void { arr[index] = val; }
function arraySize(arr: unknown[]): number { return arr.length; }
function arrayClear(arr: unknown[]): void { arr.length = 0; }
function arrayMax(arr: number[]): number { return Math.max(...arr); }
function arrayMin(arr: number[]): number { return Math.min(...arr); }
function arraySum(arr: number[]): number { return arr.reduce((a, b) => a + b, 0); }

/* ──────────── Color functions ──────────── */

function colorRGB(r: number, g: number, b: number, a = 1): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

function colorNew(colorStr: string, transp: number): string {
  // Simple transparency overlay
  return colorStr;
}

/* ──────────── Built-in constants ──────────── */

function barIndex(): number { return 0; } // Will be overridden per-bar
function barIndexArray(len: number): number[] { return Array.from({ length: len }, (_, i) => i); }
function closeArray(candles: CandleLike[]): number[] { return candles.map(c => c.close); }
function openArray(candles: CandleLike[]): number[] { return candles.map(c => c.open); }
function highArray(candles: CandleLike[]): number[] { return candles.map(c => c.high); }
function lowArray(candles: CandleLike[]): number[] { return candles.map(c => c.low); }
function volumeArray(candles: CandleLike[]): number[] { return candles.map(c => c.volume); }
function hl2(candles: CandleLike[]): number[] { return candles.map(c => (c.high + c.low) / 2); }
function hlc3(candles: CandleLike[]): number[] { return candles.map(c => (c.high + c.low + c.close) / 3); }
function ohlc4(candles: CandleLike[]): number[] { return candles.map(c => (c.open + c.high + c.low + c.close) / 4); }
function tr(highs: number[], lows: number[], closes: number[]): number[] {
  const out: number[] = new Array(highs.length).fill(0);
  out[0] = highs[0] - lows[0];
  for (let i = 1; i < highs.length; i++) {
    out[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  return out;
}

export const TA = {
  sma, ema, wma, rma, rsi, macd, atr, adx, stoch,
  highest, lowest, crossover, crossunder,
  change, barssince, valuewhen, pivothigh, pivotlow,
  bb, cci, psar, vwap, obv, mfi, roc, momentum, vwma, hma,
  keltner, donchian, supertrend, willr, linreg,
  heikinashi, vwapBands, classicPivots, fibPivots, fisherTransform, stdev, cmf,
};

export const MATH = {
  abs: mathAbs, max: mathMax, min: mathMin, round: mathRound,
  floor: mathFloor, ceil: mathCeil, sqrt: mathSqrt, pow: mathPow,
  log: mathLog, exp: mathExp, cos: mathCos, sin: mathSin, tan: mathTan,
  acos: mathAcos, asin: mathAsin, atan: mathAtan, atan2: mathAtan2,
  random: mathRandom,
};

export const ARRAY = {
  new_float: arrayNewFloat, new_int: arrayNewInt, new_bool: arrayNewBool,
  push: arrayPush, pop: arrayPop, shift: arrayShift, unshift: arrayUnshift,
  get: arrayGet, set: arraySet, size: arraySize, clear: arrayClear,
  max: arrayMax, min: arrayMin, sum: arraySum,
};

export const COLOR = { rgb: colorRGB, new: colorNew };

export function getDefaultSymbolInfo(symbol: string): SymbolInfo {
  const clean = symbol.replace(/^(FX:|XAU:|INDEX:)/, "");
  return {
    ticker: clean,
    tickerid: symbol,
    mintick: 0.0001,
    pointvalue: 1,
    currency: "USD",
    prefix: "",
    description: clean,
  };
}

export function getDefaultTimeframeInfo(period: string): TimeframeInfo {
  const lower = period.toLowerCase();
  const isIntraday = lower.includes("m") || lower.includes("h") || lower === "1";
  const isDaily = lower === "d" || lower === "1d" || lower === "daily";
  const isWeekly = lower === "w" || lower === "1w" || lower === "weekly";
  const isMonthly = lower === "m" || lower === "1m" && !lower.startsWith("1min") || lower === "monthly";
  const multiplier = parseInt(period) || 1;
  return { period, multiplier, isintraday: isIntraday, isdaily: isDaily, isweekly: isWeekly, ismonthly: isMonthly };
}

export function getDefaultBarState(barIndex: number, totalBars: number): BarState {
  return {
    isfirst: barIndex === 0,
    islast: barIndex === totalBars - 1,
    isconfirmed: true,
    isrealtime: false,
    ishistory: true,
    isnew: barIndex === 0,
  };
}
