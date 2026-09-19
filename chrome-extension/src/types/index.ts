import type {
  ChartContext, ChartContextStatus, MarketSyncStatus,
  DetectedIndicator, DetectedDrawing, VisibleRange, Market,
} from "./chart-context";

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface ExtensionSettings {
  algovaultUrl: string;
  autoDetectTradingView: boolean;
  showOverlay: boolean;
  enableChartAnalysis: boolean;
  defaultRiskPercent: number;
  defaultTimeframe: string;
  confirmBeforeExecution: boolean;
  theme: "dark" | "light";
}

export type TradingViewContext = ChartContext;

export interface ChartAnalysis {
  market: string;
  trend: string;
  structure: string;
  liquidity: string;
  zones: string;
  fvg: string;
  momentum: string;
  mtfAlignment: string;
  summary: string;
}

export interface RiskCalculation {
  accountSize: number;
  riskPercent: number;
  riskAmount: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  stopDistance: number;
  rewardDistance: number;
  riskReward: number;
  lotSize: number;
}

export interface Signal {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  entry: string;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  timeframe: string;
  style: string;
  notes: string;
  status: string;
  createdAt: number;
}

export interface GatewayStatus {
  connected: boolean;
  accounts: GatewayAccount[];
  licenseValid: boolean;
}

export interface GatewayAccount {
  accountId: string;
  accountNumber: string;
  broker: string;
  server: string;
  balance: number;
  equity: number;
  currency: string;
}

export interface OrderTicket {
  symbol: string;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskPercent: number;
  volume: number;
  accountId: string;
}

export interface AISignal {
  id: string;
  symbol: string;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  timeframe: string;
  confidence: number;
  status: string;
  createdAt: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export type ViewMode =
  | "main"
  | "analysis"
  | "ai-copilot"
  | "risk"
  | "signal"
  | "execute"
  | "quick-order"
  | "signals-list"
  | "settings"
  | "strategy-intelligence"
  | "optimization-intelligence"
  | "diagnostics";

export interface ExtensionMessage {
  type: string;
  payload: Record<string, unknown>;
}

export type {
  MarketContext, AnalysisResult, DebugInfo, AnalysisStage, LiveEvent,
  StrategyInput, BacktestGrade, MarketContextStatus,
} from "./market-context";

export type {
  ChartContext, ChartContextStatus, MarketSyncStatus,
  DetectedIndicator, DetectedDrawing, VisibleRange, Market,
} from "./chart-context";
export {
  createEmptyChartContext, hasChartIdentity, chartIdentityChanged,
} from "./chart-context";

export interface MarketCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
export type Timeframe = "M1" | "M3" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1";
export interface MarketRegime {
  regime: string;
  confidence: number;
  factors: string[];
}
export interface VolatilityData {
  atr: number;
  atrPercent: number;
  state: "expanded" | "normal" | "contracted";
  rangeExpansion: number;
  lookbackPeriods: number;
}
export interface VWAPData {
  vwap: number;
  upperBand1: number;
  lowerBand1: number;
  upperBand2: number;
  lowerBand2: number;
  distance: number;
  distancePercent: number;
  period: string;
}
export interface MarketStructureEvent {
  id: string;
  type: "BOS" | "CHOCH" | "swing_high" | "swing_low";
  direction: "bullish" | "bearish";
  price: number;
  timestamp: number;
  timeframe: Timeframe;
  brokenLevel?: number;
}
export interface LiquidityLevel {
  id: string;
  type: string;
  price: number;
  side: "buy" | "sell";
  strength: string;
}
export interface LiquiditySweep {
  sweepPrice: number;
  level: number;
  side: "buy_side" | "sell_side";
  timestamp: number;
}
