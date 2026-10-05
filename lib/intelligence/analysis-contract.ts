/**
 * Canonical Intelligence Contract — structured AI output for trading analysis.
 * Every AI-generated trading analysis must satisfy this shape.
 * AI never becomes the source of truth for candles, prices, indicators, SM events,
 * historical results, backtest metrics, account balances, positions, orders,
 * execution state, or future prices.
 */

export type AITradeAction = "LONG" | "SHORT" | "WAIT" | "NO_TRADE";

export interface EvidenceItem {
  source: string;
  claim: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number; // 0..1
  timestamp?: number;
  dataFreshnessMs?: number;
}

export interface Scenario {
  scenario: string;
  probability?: number; // 0..1, optional — never fabricated if unknown
  outcome: "positive" | "negative" | "neutral";
  trigger: string;
  notes?: string[];
}

export interface Invalidation {
  price?: number;
  conditions: string[];
}

export interface RiskNote {
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  notes: string[];
  accountExposure?: string;
}

export interface AITradeAnalysis {
  action: AITradeAction;
  confidence: number; // 0..1, but must NEVER claim certainty
  marketContext: {
    symbol: string;
    timeframe: string;
    timestamp: number; // generated
    dataTimestamp: number; // underlying market fact timestamp
    session?: string;
    regime?: string;
    trend?: string;
    volatility?: string;
  };
  evidence: {
    bullish: EvidenceItem[];
    bearish: EvidenceItem[];
    neutral: EvidenceItem[];
  };
  confirmations: EvidenceItem[];
  invalidation: Invalidation;
  risk: RiskNote;
  scenarios: Scenario[];
  limitations: string[]; // must include stale-data / conflicting-signal / insufficient-data where true
  generatedAt: number;
  dataTimestamp: number;
  dataQuality?: { status: string; issues?: string[] };
  version: string;
}

export interface AIAnalysisRequest {
  symbol: string;
  timeframe: string;
  marketContext?: import("./types").MarketIntelligenceContext;
  setupMemory?: unknown;
  strategyContext?: unknown;
  positions?: unknown[];
  orders?: unknown[];
  account?: unknown;
  task: import("./types").AITask;
  userTier?: "free" | "pro" | "admin";
}
