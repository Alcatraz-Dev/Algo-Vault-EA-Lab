export interface MarketIntelligenceContext {
  symbol: string;
  timeframe: string;
  timestamp: number;
  mode: "live" | "historical" | "replay" | "backtest";
  candles?: { timestamp: number; close: number }[];
  indicators?: { name: string; value?: number; direction?: "bullish" | "bearish" | "neutral" }[];
  marketStructure?: { trend: string; lastEvent?: string; higherHighs: number; higherLows: number; lowerHighs: number; lowerLows: number };
  smartMoney?: {
    events: { type: string; direction?: string; timestamp: number; price?: number }[];
    liquidity?: { side: "buy_side" | "sell_side"; price: number; source: string; status: string }[];
    fvgs?: { direction: string; status: string; filledPercent?: number }[];
    orderBlocks?: { direction: string; status: string }[];
  };
  sessions?: { current: string; name: string; high?: number; low?: number; range?: number };
  mtf?: { timeframe: string; bias?: string; structure?: string }[];
  strategy?: { id: string; name: string; nodesCount?: number };
  backtest?: {
    status: string;
    totalTrades?: number;
    netProfit?: number;
    maxDrawdown?: number;
    winRate?: number;
    dataQuality?: { status: string; candleCount?: number; gaps?: number };
  };
  dataQuality?: { status: string; candleCount: number; gaps: number; volumeAvailable: boolean; spreadAvailable: boolean };
  limitations: string[];
}

export interface AIObservation {
  type: "fact" | "interpretation" | "limitation";
  text: string;
  sourceIds?: string[];
}

export interface AISuggestion {
  type: "modify" | "add" | "remove" | "explain";
  target?: string;
  reason: string;
  proposedChange?: string;
  requiresBacktest?: boolean;
}

export interface AIAnalysisResponse {
  summary: string;
  observations: AIObservation[];
  evidence: { type: string; id?: string; timestamp?: number; text?: string }[];
  suggestions?: AISuggestion[];
  limitations: string[];
  mode: string;
  contextSymbol: string;
  contextTimeframe: string;
  contextTimestamp: number;
}
