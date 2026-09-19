import type { MarketCandle, MarketStructureEvent, LiquidityLevel, LiquiditySweep, VolatilityData, VWAPData, MarketRegime, Timeframe, Zone } from "../../../lib/market-data/types";

export type MarketContextStatus = "loading" | "ready" | "error" | "stale";

export interface MarketContext {
  symbol: string | null;
  exchange: string | null;
  timeframe: string | null;
  status: MarketContextStatus;
  error: string | null;
  currentPrice: number | null;
  timestamp: number | null;
  candlesByTimeframe: Partial<Record<Timeframe, MarketCandle[]>>;
  trend: {
    direction: "bullish" | "bearish" | "neutral";
    state: string;
  };
  marketRegime: {
    regime: MarketRegime;
    confidence: number;
    factors: string[];
  };
  marketStructure: {
    events: MarketStructureEvent[];
    bosCount: number;
    chochCount: number;
    overall: "bullish" | "bearish" | "neutral";
  };
  liquidity: {
    levels: LiquidityLevel[];
    sweeps: LiquiditySweep[];
  };
  volatility: VolatilityData;
  vwap: VWAPData;
  volume: {
    current: number;
    average: number;
    relative: number;
    state: "expanded" | "normal" | "contracted";
  };
  fvg: {
    count: number;
    direction: "bullish" | "bearish" | "neutral";
  };
  orderBlock: {
    count: number;
    direction: "bullish" | "bearish" | "neutral";
  };
  score: {
    total: number;
    bias: "bullish" | "bearish" | "neutral";
    confidence: "high" | "medium" | "low";
    components: Array<{
      name: string;
      value: number;
      direction: "bullish" | "bearish" | "neutral";
    }>;
  };
  mtfAlignment: Array<{
    timeframe: Timeframe;
    bias: "bullish" | "bearish" | "neutral";
    structure: string;
  }>;
  dataFetch: {
    provider: string;
    lastUpdate: number | null;
    candleCount: number;
    timeframes: string[];
    freshness: string;
  };
  aiContext: {
    sent: boolean;
    contextHash: string | null;
    lastSent: number | null;
  };
}

export interface AnalysisStage {
  name: string;
  status: "pending" | "running" | "complete" | "error";
  message: string;
  duration?: number;
}

export interface DebugInfo {
  stages: AnalysisStage[];
  symbolDetected: string | null;
  timeframeDetected: string | null;
  marketApi: string;
  marketApiStatus: number | null;
  candleCount: number;
  timeframesAvailable: string[];
  analyticsStatus: "ready" | "error" | "loading";
  aiStatus: "ready" | "error" | "loading" | "unavailable";
  requestLatency: number | null;
  errors: string[];
}

export interface AnalysisResult {
  marketContext: MarketContext;
  aiAnalysis: {
    summary: string;
    keyLevels: {
      support: Array<{ price: number; strength: string; source: string }>;
      resistance: Array<{ price: number; strength: string; source: string }>;
      liquidity: Array<{ price: number; side: string; strength: string }>;
      fvg: Array<{ price: number; direction: string; strength: string }>;
      orderBlock: Array<{ price: number; direction: string; strength: string }>;
    };
    scenarios: Array<{
      type: "bullish" | "bearish" | "neutral";
      description: string;
      invalidation: string;
      probability: string;
    }>;
    confluences: number;
    structureConfirmations: number;
    mtfAlignmentCount: number;
  } | null;
  error: string | null;
}

export interface LiveEvent {
  id: string;
  type: "bos" | "choch" | "liquidity_sweep" | "fvg_creation" | "fvg_mitigation" | "vwap_cross" | "mtf_alignment_change" | "volatility_regime_change" | "price_key_level";
  symbol: string;
  timeframe: string;
  price: number;
  previousPrice: number | null;
  timestamp: number;
  description: string;
  mtfBias?: "bullish" | "bearish" | "neutral";
}

export interface StrategyInput {
  source: "pine" | "tradingview" | "backtest" | "strategy-lab" | "manual";
  name: string;
  pineCode?: string;
  timeframe?: string;
  symbol?: string;
  parameters?: Record<string, number | string>;
}

export interface BacktestGrade {
  profitability: { status: "pass" | "fail" | "warning"; message: string };
  drawdown: { status: "pass" | "fail" | "warning"; message: string };
  tradeSample: { status: "pass" | "fail" | "warning"; message: string };
  consistency: { status: "pass" | "fail" | "warning"; message: string };
  riskAdjustedReturn: { status: "pass" | "fail" | "warning"; message: string };
  warnings: string[];
}
