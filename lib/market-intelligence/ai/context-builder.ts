/**
 * Context Builder — deterministic, selects relevant structured info.
 * Never sends raw full candle arrays; uses summaries.
 */

import { MarketIntelligenceContext } from "./types";
import { SmartMoneyEngine } from "../../smart-money/engine";
import { Timeframe } from "../types";

export function buildMarketIntelligenceContext(
  symbol: string,
  timeframe: Timeframe,
  timestamp: number,
  mode: "live" | "historical" | "replay" | "backtest",
  candles?: { timestamp: number; open: number; high: number; low: number; close: number }[],
  smartMoneyEvents?: any[],
  indicators?: any,
  backtestSummary?: any,
  limitations?: string[]
): MarketIntelligenceContext {
  const sm = smartMoneyEvents ?? [];
  return {
    symbol,
    timeframe,
    timestamp,
    mode,
    candles: candles ? candles.slice(-10).map((c) => ({ timestamp: c.timestamp, close: c.close })) : undefined,
    indicators,
    marketStructure: undefined,
    smartMoney: {
      events: sm.slice(-10).map((e: any) => ({ type: e.type ?? "unknown", direction: e.direction, timestamp: e.timestamp, price: e.price })),
      liquidity: undefined,
      fvgs: undefined,
      orderBlocks: undefined,
    },
    sessions: undefined,
    mtf: undefined,
    strategy: undefined,
    backtest: backtestSummary,
    dataQuality: { status: candles && candles.length > 20 ? "complete" : "incomplete", candleCount: candles?.length ?? 0, gaps: 0, volumeAvailable: false, spreadAvailable: false },
    limitations: limitations ?? [],
  };
}
