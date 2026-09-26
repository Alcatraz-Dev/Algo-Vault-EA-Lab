/**
 * AI Backtest Analyst — explains real backtest metrics.
 */

import { AIAnalysisResponse, AIObservation, AISuggestion } from "./types";

export function analyzeBacktest(backtest: any): AIAnalysisResponse {
  const observations: AIObservation[] = [];
  const evidence: any[] = [];

  if (backtest?.metrics) {
    observations.push({ type: "fact", text: `Total trades: ${backtest.metrics.totalTrades ?? "N/A"}` });
    observations.push({ type: "fact", text: `Win rate: ${backtest.metrics.winRate ?? "N/A"}` });
    observations.push({ type: "fact", text: `Net profit: ${backtest.metrics.netProfit ?? "N/A"}` });
    observations.push({ type: "fact", text: `Profit factor: ${backtest.metrics.profitFactor ?? "N/A"}` });
    observations.push({ type: "fact", text: `Max drawdown: ${backtest.metrics.maxDrawdown ?? "N/A"}` });
    evidence.push({ type: "backtest_metrics", text: "Calculated from actual trades." });
  }
  if (backtest?.dataQuality) {
    observations.push({ type: "limitation", text: `Data quality: ${backtest.dataQuality.status}.` });
  }
  if (backtest?.limitations && backtest.limitations.length > 0) {
    observations.push({ type: "limitation", text: backtest.limitations.join("; ") });
  }

  const summary = "Backtest analysis based on real execution results. No invented performance claims.";

  return {
    summary,
    observations,
    evidence,
    suggestions: [{ type: "modify", reason: "Consider backtesting proposed modifications to compare real results.", requiresBacktest: true }],
    limitations: backtest?.limitations ?? ["No limitations reported."],
    mode: "backtest",
    contextSymbol: backtest?.config?.symbol ?? "unknown",
    contextTimeframe: backtest?.config?.timeframe ?? "unknown",
    contextTimestamp: Date.now(),
  };
}
