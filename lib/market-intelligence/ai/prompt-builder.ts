/**
 * Prompt Builder — constructs structured prompts for AI modules.
 */

import { MarketIntelligenceContext } from "./types";

export function buildMarketAnalystPrompt(context: MarketIntelligenceContext): string {
  return `
System: You are a deterministic market intelligence assistant.
Context:
- Symbol: ${context.symbol}
- Timeframe: ${context.timeframe}
- Timestamp: ${context.timestamp}
- Mode: ${context.mode}
- Limitations: ${(context.limitations ?? []).join("; ") || "None reported"}
Evidence (structured events only):
${JSON.stringify(context.smartMoney?.events || [])}
Observations must be fact-based. No invented probabilities. No fabricated results.
`;
}

export function buildBacktestPrompt(context: any): string {
  return `
System: You explain backtest results using only actual metrics.
Backtest metrics:
${JSON.stringify(context?.metrics || {})}
Limitations: ${(context?.limitations ?? []).join("; ") || "None"}
Never invent statistics. Never claim profitability without actual results.
`;
}
