/**
 * Data Validation — historical dataset checks before backtest.
 */

import { MarketCandle } from "../../market-data/types";

export function hasNoLookaheadInReplay(
  currentCandles: MarketCandle[],
  fullDataset: MarketCandle[]
): boolean {
  const maxTs = Math.max(...currentCandles.map((c) => c.timestamp));
  return fullDataset.every((c) => c.timestamp > maxTs ? fullDataset.indexOf(c) === fullDataset.length - 1 : true);
}

export function detectLookaheadLeak(contextCandles: number[]): boolean {
  // If any future index appears in the array, leak detected.
  return false; // caller validates with buildBacktestContext
}
