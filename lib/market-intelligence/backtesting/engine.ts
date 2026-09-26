import { BacktestConfig, BacktestResult, BacktestTrade } from "../types";

/**
 * Backtesting Engine — real architecture, honest limitations.
 *
 * Principles:
 * - No future-data leakage.
 * - Deterministic entry/exit rules only.
 * - Every metric must come from executed trades.
 * - If historical candles unavailable, expose limitation instead of fake stats.
 */
export function runBacktest(config: BacktestConfig, candles: { timestamp: number; open: number; high: number; low: number; close: number; volume?: number }[]): BacktestResult {
  const limitations: string[] = [];

  if (!candles || candles.length < 2) {
    limitations.push("Insufficient candle data for backtest.");
    return {
      config,
      trades: [],
      equityCurve: [],
      metrics: { totalTrades: 0 },
      dataSource: config.symbol + "/" + config.timeframe,
      limitations,
    };
  }

  // Real execution requires a strategy definition; Phase 1 exposes only the pipeline.
  // Actual trade generation will integrate with lib/strategy-lab when rules are defined.
  limitations.push("Backtest execution requires a defined strategy with entry/exit conditions.");
  limitations.push("Spread / commission / slippage applied only when configured and available.");

  return {
    config,
    trades: [],
    equityCurve: candles.map((c) => ({ timestamp: c.timestamp, equity: config.initialBalance })),
    metrics: {
      totalTrades: 0,
      netProfit: 0,
      profitFactor: undefined,
      winRate: undefined,
      maxDrawdown: undefined,
    },
    dataSource: config.symbol + "/" + config.timeframe,
    limitations,
  };
}

export function replayCandleProgression(candles: { timestamp: number; open: number; high: number; low: number; close: number }[], index: number): typeof candles {
  // Replay must never reveal future candles.
  return candles.slice(0, index + 1);
}
