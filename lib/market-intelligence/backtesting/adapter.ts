/**
 * Backtesting Adapter — connects Smart Money events to strategy evaluation.
 *
 * Every context contains only data available at timestamp T.
 * No future candles. No future events.
 */

import { MarketCandle } from "../../market-data/types";
import { SmartMoneyEvent, BacktestConfig, BacktestResult, Timeframe } from "../types";
import { SmartMoneyEngine } from "../smart-money/engine";

export interface BacktestContext {
  timestamp: number;
  candles: MarketCandle[]; // only candles up to timestamp
  smartMoneyEvents: SmartMoneyEvent[]; // only events with timestamp <= current
  positions: { direction: "long" | "short"; entryTime: number; quantity: number; entryPrice: number; stopLoss?: number; takeProfit?: number }[];
  accountBalance: number;
  initialBalance: number;
  mode: "historical" | "replay" | "live";
}

export interface DataQualityReport {
  symbol: string;
  timeframe: Timeframe;
  start: number;
  end: number;
  candleCount: number;
  source: string;
  timezone: string;
  volumeAvailable: boolean;
  spreadAvailable: boolean;
  tickDataAvailable: boolean;
  gaps: number;
  duplicateTimestamps: number;
  invalidOhlc: number;
  status: "complete" | "incomplete" | "insufficient";
}

export function validateDataset(candles: MarketCandle[], symbol: string, tf: Timeframe, start?: number, end?: number): DataQualityReport {
  const issues: { gap?: number; duplicate?: number; invalid?: number } = {};
  let gaps = 0;
  let duplicates = 0;
  let invalid = 0;

  if (!candles || candles.length < 2) {
    return {
      symbol,
      timeframe: tf,
      start: start ?? candles[0]?.timestamp ?? 0,
      end: end ?? candles[candles.length - 1]?.timestamp ?? 0,
      candleCount: candles?.length ?? 0,
      source: "unknown",
      timezone: "UTC",
      volumeAvailable: candles?.some((c) => c.volume !== undefined) ?? false,
      spreadAvailable: false,
      tickDataAvailable: false,
      gaps,
      duplicateTimestamps: duplicates,
      invalidOhlc: invalid,
      status: candles?.length < 10 ? "insufficient" : "incomplete",
    };
  }

  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const timestamps = sorted.map((c) => c.timestamp);
  const set = new Set(timestamps);
  duplicates = timestamps.length - set.size;

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (typeof c.open !== "number" || typeof c.high !== "number" || typeof c.low !== "number" || typeof c.close !== "number" || typeof c.timestamp !== "number") {
      invalid++;
    }
    if (c.high < c.low || c.open > c.high || c.low > c.high || c.close < c.low || c.close > c.high) {
      invalid++;
    }
    if (i > 0 && sorted[i].timestamp !== sorted[i - 1].timestamp + (sorted[i - 1].timestamp - sorted[i - 2]?.timestamp ?? 0)) {
      // approximate gap detection
      // for simplicity: check large jumps
    }
  }

  // Approximate gaps: large timestamp jumps
  const avgInterval = sorted.length > 1 ? (sorted[sorted.length - 1].timestamp - sorted[0].timestamp) / (sorted.length - 1) : 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].timestamp - sorted[i - 1].timestamp > avgInterval * 3) {
      gaps++;
    }
  }

  return {
    symbol,
    timeframe: tf,
    start: sorted[0].timestamp,
    end: sorted[sorted.length - 1].timestamp,
    candleCount: sorted.length,
    source: "dataset",
    timezone: "UTC",
    volumeAvailable: sorted.some((c) => typeof c.volume === "number"),
    spreadAvailable: false,
    tickDataAvailable: false,
    gaps,
    duplicateTimestamps: duplicates,
    invalidOhlc: invalid,
    status: sorted.length < 20 ? "incomplete" : "complete",
  };
}

/**
 * Build a BacktestContext at timestamp T using only candles <= T.
 */
export function buildBacktestContext(
  candles: MarketCandle[],
  tf: Timeframe,
  timestamp: number,
  positions: BacktestContext["positions"],
  accountBalance: number,
  initialBalance: number,
  mode: "historical" | "replay" | "live"
): BacktestContext {
  const available = candles.filter((c) => c.timestamp <= timestamp);
  const smartMoneyEngine = new SmartMoneyEngine({ mode });
  const result = smartMoneyEngine.run(available, tf, mode);
  return {
    timestamp,
    candles: available,
    smartMoneyEvents: result.events,
    positions,
    accountBalance,
    initialBalance,
    mode,
  };
}
