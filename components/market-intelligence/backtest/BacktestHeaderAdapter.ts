/**
 * Backtest Terminal Header Adapter — professional compact header.
 * Connects existing BacktestConfig, strategy, replay, and AI.
 */
import { BacktestConfig } from "../../types";

export interface BacktestHeaderInfo {
  strategyName?: string;
  symbol?: string;
  timeframe?: string;
  status?: "ready" | "running" | "completed" | "failed" | "insufficient_data" | "invalid_configuration";
  hasResults?: boolean;
  backtestId?: string;
}

export function describeBacktestStatus(status?: string): string {
  switch (status) {
    case "completed": return "Backtest completed.";
    case "running": return "Backtest running.";
    case "failed": return "Backtest execution failed.";
    case "insufficient_data": return "Insufficient historical data.";
    case "invalid_configuration": return "Invalid strategy or execution configuration.";
    default: return "Ready.";
  }
}
