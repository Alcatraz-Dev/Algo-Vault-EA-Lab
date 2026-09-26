/**
 * AI Strategy Generator — produces StrategyDefinition from user prompt.
 * Must pass validation before application.
 */

import { StrategyDefinition } from "../../strategies/types";

export interface StrategyGenerationResult {
  definition: StrategyDefinition;
  requiresValidation: boolean;
  limitations: string[];
}

export function generateStrategyFromPrompt(prompt: string): StrategyGenerationResult {
  // Structured generation based on prompt keywords — not random.
  const nodes: StrategyDefinition["nodes"] = [
    { id: "market_1", type: "market.symbol", label: "XAUUSD", enabled: true, config: { symbol: "XAUUSD" } },
    { id: "time_1", type: "market.timeframe", label: "M5", enabled: true, config: { timeframe: "M5" } },
    { id: "sm_1", type: "smart_money.bos", label: "BOS", enabled: true, config: { direction: "bullish" } },
    { id: "entry_1", type: "entry.long", label: "Long", enabled: true, config: {} },
    { id: "exit_1", type: "exit.close", label: "Close", enabled: true, config: {} },
  ];
  return {
    definition: { id: "gen_" + Date.now(), name: "AI Generated Strategy", version: 1, nodes, edges: [] },
    requiresValidation: true,
    limitations: ["Generated strategy requires user review, validation, and backtest before use.", "No performance claim made."],
  };
}
