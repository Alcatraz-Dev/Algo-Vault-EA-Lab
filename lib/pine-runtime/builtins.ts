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
