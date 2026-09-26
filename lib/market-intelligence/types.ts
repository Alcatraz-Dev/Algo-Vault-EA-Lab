import { MarketCandle } from "../market-data/types";

export const TIMEFRAMES = ["M1", "M3", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export interface NormalizedCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  tickVolume?: number;
  spread?: number;
  symbol?: string;
  timeframe?: Timeframe;
}

export interface ChartWorkspaceState {
  symbol: string;
  timeframe: Timeframe;
  layout: "1" | "2h" | "2v" | "4" | "6";
  syncSymbol: boolean;
  syncTimeframe: boolean;
  syncCrosshair: boolean;
  syncDrawings: boolean;
  activeIndicators: string[];
}

export interface SmartMoneyEvent {
  id: string;
  type:
    | "SWING_HIGH"
    | "SWING_LOW"
    | "HH"
    | "HL"
    | "LH"
    | "LL"
    | "BOS"
    | "CHOCH"
    | "MSS"
    | "LIQUIDITY"
    | "LIQUIDITY_SWEEP"
    | "FVG"
    | "ORDER_BLOCK"
    | "BREAKER"
    | "MITIGATION"
    | "SESSION_LEVEL";
  direction?: "bullish" | "bearish" | "neutral";
  timeframe: Timeframe;
  timestamp: number;
  price?: number;
  priceHigh?: number;
  priceLow?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  status?: "active" | "partially_filled" | "filled" | "invalidated" | "mitigated" | "broken";
  source: "calculated";
  metadata?: Record<string, unknown>;
}

export interface LiquidityZone {
  id: string;
  side: "buy_side" | "sell_side";
  price: number;
  source:
    | "equal_high"
    | "equal_low"
    | "previous_high"
    | "previous_low"
    | "session_high"
    | "session_low"
    | "day_high"
    | "day_low"
    | "week_high"
    | "week_low"
    | "swing_high"
    | "swing_low";
  timeframe: Timeframe;
  createdAt: number;
  status: "active" | "swept" | "invalidated";
}

export interface FVGZone {
  id: string;
  direction: "bullish" | "bearish";
  timeframe: Timeframe;
  top: number;
  bottom: number;
  createdAt: number;
  age: number;
  fillPercent: number;
  status: "active" | "partially_filled" | "filled" | "invalidated";
  consequentEncroachment?: number;
}

export interface OrderBlock {
  id: string;
  direction: "bullish" | "bearish";
  timeframe: Timeframe;
  top: number;
  bottom: number;
  createdAt: number;
  status: "active" | "mitigated" | "invalidated" | "broken";
  sourceEventId?: string;
}

export interface MarketStructureState {
  trend: "bullish" | "bearish" | "range" | "unknown";
  internalTrend: "bullish" | "bearish" | "range" | "unknown";
  lastEvent?: SmartMoneyEvent;
  lastSwingHigh?: number;
  lastSwingLow?: number;
  higherHighs: number;
  higherLows: number;
  lowerHighs: number;
  lowerLows: number;
}

export type Mode = "historical" | "replay" | "live";

export interface BacktestConfig {
  symbol: string;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  initialBalance: number;
  spread?: number;
  commission?: number;
  slippage?: number;
  positionSizeMode: "percent" | "fixed";
  positionSizeValue: number;
  maxPositions: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  equityCurve: { timestamp: number; equity: number }[];
  metrics?: {
    netProfit?: number;
    profitFactor?: number;
    winRate?: number;
    maxDrawdown?: number;
    totalTrades: number;
  };
  dataSource: string;
  limitations: string[];
}

export interface BacktestTrade {
  entryTime: number;
  exitTime?: number;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  profit?: number;
  status: "open" | "closed";
}
