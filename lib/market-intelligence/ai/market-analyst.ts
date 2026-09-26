/**
 * AI Market Analyst — interprets structured market context.
 * Uses only evidence from MarketIntelligenceContext.
 * No invented events. No confidence scores.
 */

import { MarketIntelligenceContext, AIAnalysisResponse, AIObservation, AISuggestion } from "./types";

export function analyzeMarket(context: MarketIntelligenceContext): AIAnalysisResponse {
  const observations: AIObservation[] = [];
  const evidence: { type: string; id?: string; timestamp?: number; text?: string }[] = [];
  const suggestions: AISuggestion[] = [];

  // Structure from context
  if (context.marketStructure) {
    observations.push({ type: "fact", text: `Structure trend: ${context.marketStructure.trend}`, sourceIds: ["marketStructure"] });
    if (context.marketStructure.lastEvent) observations.push({ type: "fact", text: `Last structure event: ${context.marketStructure.lastEvent}`, sourceIds: ["marketStructure"] });
  }

  // Smart Money events
  const sm = context.smartMoney;
  if (sm?.events && sm.events.length > 0) {
    const recent = sm.events.slice(-3);
    for (const e of recent) {
      observations.push({ type: "fact", text: `${e.type}${e.direction ? " (" + e.direction + ")" : ""} at ${e.timestamp}`, sourceIds: [String(e.type)] });
      evidence.push({ type: e.type ?? "smart_money", id: String(e.timestamp), timestamp: e.timestamp, text: `${e.type} detected` });
    }
  }

  // Sessions
  if (context.sessions) {
    observations.push({ type: "fact", text: `Session: ${context.sessions.name ?? context.sessions.current}`, sourceIds: ["session"] });
  }

  // Indicators
  if (context.indicators) {
    for (const ind of context.indicators) {
      observations.push({ type: "fact", text: `Indicator ${ind.name}: ${ind.value ?? "N/A"} (${ind.direction ?? "neutral"})`, sourceIds: [ind.name] });
    }
  }

  // MTF
  if (context.mtf && context.mtf.length > 0) {
    const aligned = context.mtf.filter((m) => m.bias === "bullish" || m.bias === "bearish");
    if (aligned.length > 0) observations.push({ type: "interpretation", text: `MTF alignment: ${aligned.map((m) => m.timeframe + ":" + m.bias).join(", ")}` });
  }

  // Data quality / limitations
  if (context.dataQuality) {
    observations.push({ type: "limitation", text: `Data quality: ${context.dataQuality.status}. Candles: ${context.dataQuality.candleCount}.` });
  }
  if (context.limitations && context.limitations.length > 0) {
    observations.push({ type: "limitation", text: context.limitations.join("; ") });
  }

  // Mode label
  observations.push({ type: "fact", text: `Mode: ${context.mode}` });

  // Summary
  const summary = `Market analysis for ${context.symbol} ${context.timeframe} (${context.mode}). Evidence-based interpretation using structured Smart Money, indicators, sessions, and MTF.`;

  return {
    summary,
    observations,
    evidence,
    suggestions,
    limitations: context.limitations ?? ["No limitations reported."],
    mode: context.mode,
    contextSymbol: context.symbol,
    contextTimeframe: context.timeframe,
    contextTimestamp: context.timestamp,
  };
}
