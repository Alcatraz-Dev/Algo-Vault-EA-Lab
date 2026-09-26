import { BacktestConfig } from "../types";

/**
 * Strategy Engine Adapter — connects to existing Trading Studio / Strategy Lab.
 * Does NOT replace Trading Studio.
 */
export interface StrategyNode {
  id: string;
  type: "Market" | "Indicator" | "Structure" | "Liquidity" | "FVG" | "OrderBlock" | "Session" | "MTF" | "Condition" | "Entry" | "Exit" | "Risk";
  label: string;
}

export function describeStrategyForBacktest(strategyName?: string, config?: BacktestConfig): string {
  if (!config) return "No strategy configured. Build a strategy in Trading Studio to backtest.";
  return `Backtest adapter active for ${config.symbol} ${config.timeframe}. Strategy rules must be defined before deterministic results can be computed.`;
}
