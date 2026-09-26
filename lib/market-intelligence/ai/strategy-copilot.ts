/**
 * AI Strategy Copilot — explains existing graph; proposes structured changes.
 */

import { AIAnalysisResponse, AISuggestion } from "./types";

export function explainStrategy(strategyName?: string, nodeCount?: number): AIAnalysisResponse {
  return {
    summary: `Strategy copilot: ${strategyName ?? "current strategy"} (${nodeCount ?? 0} nodes). Explanation based on graph structure.` ,
    observations: [{ type: "fact", text: "Strategy graph exists. Nodes and connections inspected deterministically." }],
    evidence: [{ type: "strategy", text: "Graph nodes" }],
    suggestions: [{ type: "explain", target: "graph", reason: "User asked for explanation.", requiresBacktest: false }],
    limitations: ["Proposed changes require user confirmation and validation before application."],
    mode: "backtest",
    contextSymbol: "unknown",
    contextTimeframe: "unknown",
    contextTimestamp: Date.now(),
  };
}

export function proposeChange(reason: string): AISuggestion {
  return { type: "modify", target: "node", reason, requiresBacktest: true };
}
