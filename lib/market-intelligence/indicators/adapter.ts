import { MarketCandle } from "../../market-data/types";
import {
  sma, ema, rsi, macd, bollingerBands, atrSeries, supertrend,
  computeIndicatorSnapshot,
} from "../../analytics/indicators";
import { Timeframe } from "./types";

/**
 * Technical Analysis Engine — adapter over existing lib/analytics/indicators.
 * Every value comes from actual calculations; no simulated scores.
 */
export interface IndicatorConfig {
  name: string;
  params?: Record<string, number>;
  enabled: boolean;
}

export function calculateRSI(candles: MarketCandle[], period = 14): (number | null)[] {
  const closes = candles.map((c) => c.close);
  return rsi(closes, period);
}

export function calculateEMA(candles: MarketCandle[], period = 20): (number | null)[] {
  const closes = candles.map((c) => c.close);
  return ema(closes, period);
}

export function calculateMACD(candles: MarketCandle[], fast = 12, slow = 26, signal = 9) {
  const closes = candles.map((c) => c.close);
  return macd(closes, fast, slow, signal);
}

export function calculateATR(candles: MarketCandle[], period = 14): (number | null)[] {
  return atrSeries(candles, period);
}

export function calculateBollinger(candles: MarketCandle[], period = 20, stdDev = 2) {
  const closes = candles.map((c) => c.close);
  return bollingerBands(closes, period, stdDev);
}

export function calculateSupertrend(candles: MarketCandle[], period = 10, multiplier = 3) {
  return supertrend(candles, period, multiplier);
}

export function getSnapshot(candles: MarketCandle[]) {
  return computeIndicatorSnapshot(candles);
}
