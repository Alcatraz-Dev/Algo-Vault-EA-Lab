import { MarketCandle } from "../../market-data/types";
import { NormalizedCandle, Timeframe, TIMEFRAMES } from "./types";

/**
 * Market Data Engine — normalized abstraction.
 * Reuses lib/market-data/normalizer and validation.
 */
export function normalizeCandle(raw: Partial<MarketCandle>, symbol?: string, tf?: Timeframe): NormalizedCandle {
  if (!raw || typeof raw.timestamp !== "number") {
    throw new Error("Market Data Engine: invalid candle — timestamp required");
  }
  return {
    timestamp: raw.timestamp,
    open: raw.open ?? 0,
    high: raw.high ?? raw.open ?? 0,
    low: raw.low ?? raw.open ?? 0,
    close: raw.close ?? raw.open ?? 0,
    volume: raw.volume,
    tickVolume: (raw as any).tickVolume,
    spread: (raw as any).spread,
    symbol,
    timeframe: tf && TIMEFRAMES.includes(tf) ? tf : undefined,
  };
}

export function validateCandleSeries(candles: NormalizedCandle[]): string[] {
  const issues: string[] = [];
  if (!candles || candles.length === 0) issues.push("No candles provided");
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    if (cur.timestamp <= prev.timestamp) issues.push(`Timestamp order error at index ${i}`);
    if (cur.high < Math.max(cur.open, cur.close)) issues.push(`Invalid high at ${i}`);
    if (cur.low > Math.min(cur.open, cur.close)) issues.push(`Invalid low at ${i}`);
    if (prev.high < cur.low || prev.low > cur.high) {
      // gap allowed — not an error
    }
  }
  return issues;
}

export function getTimeframeLabel(tf: Timeframe): string {
  return tf;
}
