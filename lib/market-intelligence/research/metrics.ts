/**
 * Metrics — normalizes existing backtest metrics for research.
 */

import { BacktestMetrics } from "../../strategy-lab/types";

export interface ResearchMetricSnapshot {
  totalTrades: number | null;
  winRate: number | null;
  netProfit: number | null;
  maxDrawdown: number | null;
  profitFactor: number | null;
  averageTrade: number | null;
  longTradeCount?: number | null;
  shortTradeCount?: number | null;
}

export function normalizeMetrics(metrics?: Partial<BacktestMetrics> | null): ResearchMetricSnapshot {
  if (!metrics) return { totalTrades: null, winRate: null, netProfit: null, maxDrawdown: null, profitFactor: null, averageTrade: null, longTradeCount: null, shortTradeCount: null };
  return {
    totalTrades: typeof metrics.totalTrades === "number" ? metrics.totalTrades : null,
    winRate: typeof metrics.winRate === "number" ? metrics.winRate : null,
    netProfit: typeof metrics.netProfit === "number" ? metrics.netProfit : null,
    maxDrawdown: typeof metrics.maxDrawdown === "number" ? metrics.maxDrawdown : null,
    profitFactor: typeof metrics.profitFactor === "number" ? metrics.profitFactor : null,
    averageTrade: typeof metrics.expectedPayoff === "number" ? metrics.expectedPayoff : null,
    longTradeCount: metrics.longTrades ?? null,
    shortTradeCount: metrics.shortTrades ?? null,
  };
}
