/**
 * TradingView Account & Execution Bridge Types
 *
 * Strict capability contracts for:
 *   - Account & Broker detection (safe metadata only, zero credentials)
 *   - Normalized account states
 *   - TradingViewExecutionAdapter interface
 *   - Trade ticket validation and Risk Guard
 *   - Positions and pending orders monitoring
 *   - Execution lifecycle states (real confirmations only, no fake execution)
 *   - Trade receipts and AlgoVault Journal sync
 *   - Execution audit logging
 */

export type AccountMode = "PAPER" | "LIVE" | "DEMO" | "UNKNOWN";

export type AccountState =
  | "NOT_CONNECTED"
  | "CONNECTED"
  | "ACCOUNT_DETECTED"
  | "TRADING_ENABLED"
  | "READ_ONLY"
  | "LIMITED"
  | "EXECUTION_UNAVAILABLE"
  | "AUTHENTICATION_REQUIRED"
  | "ERROR";

export interface TradingViewPosition {
  id: string;
  symbol: string;
  side: "BUY" | "SELL" | "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  unrealizedPnl: number | null;
  realizedPnl?: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  status: "OPEN" | "CLOSED";
  openTime: number | null;
  broker: string | null;
  accountId: string | null;
  canModify: boolean;
  canClose: boolean;
}

export interface TradingViewPendingOrder {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "STOP" | "MARKET";
  quantity: number;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  status: "PENDING" | "SUBMITTED" | "CANCELLED" | "REJECTED";
  timestamp: number;
  broker: string | null;
  accountId: string | null;
  canModify: boolean;
  canCancel: boolean;
}

export interface TradingViewAccountInfo {
  connectionStatus: "CONNECTED" | "DISCONNECTED" | "CONNECTING" | "ERROR";
  accountState: AccountState;
  broker: string | null;
  accountId: string | null; // Safe masked representation (e.g. ••••1234)
  accountType: string | null;
  mode: AccountMode;
  currency: string | null;
  balance: number | null;
  equity: number | null;
  buyingPower: number | null;
  marginUsed: number | null;
  marginFree: number | null;
  marginLevel: number | null;
  tradingPermissions: string[];
  tradingEnabled: boolean;
  supportedOrderTypes: Array<"market" | "limit" | "stop">;
  supportedActions: Array<
    | "market_buy"
    | "market_sell"
    | "limit_buy"
    | "limit_sell"
    | "stop_buy"
    | "stop_sell"
    | "cancel_order"
    | "modify_order"
    | "close_position"
  >;
  openPositions: TradingViewPosition[];
  pendingOrders: TradingViewPendingOrder[];
  lastSyncTimestamp: number;
  source: "tradingview-dom" | "tradingview-widget" | "gateway" | "unavailable";
  unsupportedReason: string | null;
}

export type ExecutionLifecycleStatus =
  | "PREPARING"
  | "SUBMITTING"
  | "ACCEPTED"
  | "REJECTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "UNAVAILABLE"
  | "UNKNOWN";

export interface NormalizedOrderIntent {
  requestId: string; // Unique idempotency ID
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP";
  quantity: number;
  price?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  accountId?: string | null;
  broker?: string | null;
  mode: AccountMode;
  strategyId?: string | null;
  strategyName?: string | null;
  setupId?: string | null;
  analysisId?: string | null;
  timeframe?: string | null;
  riskContext?: RiskCheckResult | null;
}

export interface OrderValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  blockedReason?: string | null;
}

export interface RiskCheckResult {
  accountMode: AccountMode;
  orderSize: number;
  estimatedExposure: number | null;
  stopDistance: number | null;
  riskAmount: number | null;
  potentialRiskReward: number | null;
  missingRiskData: string[];
  riskCalculable: boolean;
  brokerRestrictions: string[];
  notes?: string | null;
}

export interface ExecutionResult {
  requestId: string;
  status: ExecutionLifecycleStatus;
  orderId: string | null;
  executionPrice: number | null;
  filledQuantity: number | null;
  timestamp: number;
  error?: string | null;
  rawStatusText?: string | null;
  mode: AccountMode;
  broker: string | null;
  receipt?: TradeReceipt | null;
}

export interface TradeReceipt {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  broker: string;
  accountReference: string;
  executionPrice: number;
  timestamp: number;
  mode: AccountMode;
  strategyName?: string | null;
  setupId?: string | null;
  analysisId?: string | null;
  journalSynced: boolean;
  journalEntryId?: string | null;
}

export interface ExecutionAuditRecord {
  id: string;
  requestId: string;
  userId: string;
  accountReference: string;
  broker: string;
  mode: AccountMode;
  symbol: string;
  action: string;
  orderType: string;
  quantity: number;
  price: number | null;
  timestamp: number;
  result: ExecutionLifecycleStatus;
  orderId?: string | null;
  errorCode?: string | null;
  strategyId?: string | null;
  setupId?: string | null;
}

export interface JournalSyncPayload {
  symbol: string;
  direction: "BUY" | "SELL";
  quantity: number;
  entry: number;
  stop?: number | null;
  target?: number | null;
  broker: string;
  accountReference: string;
  mode: AccountMode;
  strategy?: string | null;
  setup?: string | null;
  aiAnalysis?: string | null;
  marketContext?: string | null;
  timeframe?: string | null;
  timestamp: number;
  executionStatus: string;
  exitPrice?: number | null;
  exitTime?: number | null;
  pnl?: number | null;
  notes?: string | null;
}

export function createEmptyAccountInfo(): TradingViewAccountInfo {
  return {
    connectionStatus: "DISCONNECTED",
    accountState: "NOT_CONNECTED",
    broker: null,
    accountId: null,
    accountType: null,
    mode: "UNKNOWN",
    currency: null,
    balance: null,
    equity: null,
    buyingPower: null,
    marginUsed: null,
    marginFree: null,
    marginLevel: null,
    tradingPermissions: [],
    tradingEnabled: false,
    supportedOrderTypes: [],
    supportedActions: [],
    openPositions: [],
    pendingOrders: [],
    lastSyncTimestamp: Date.now(),
    source: "unavailable",
    unsupportedReason: "No active trading account detected",
  };
}
