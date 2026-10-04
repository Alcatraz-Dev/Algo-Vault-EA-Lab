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
 *
 * CAPABILITY TRUTH (verified against the installed TradingView MCP client in
 * `lib/market-intelligence/providers/tradingview`):
 *   - The official TradingView MCP toolset mapped by AlgoVault is READ-ONLY
 *     (`READ_TOOLS_ONLY = true`): quotes, OHLCV, technicals, screener, news,
 *     fundamentals, filings, calendars, watchlists and alerts.
 *   - It exposes NO account, broker, order, position or execution tool.
 *   - Real order execution is provided by the AlgoVault MT5 Gateway
 *     (`/api/trading/orders` + `/api/trading/gateway/execution`), which is a
 *     genuinely separate, server-entitled integration.
 * Nothing in this module may ever claim a capability the sources above do not
 * provide — unknown values stay `null`, unknown states stay `UNKNOWN`.
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

/** Where a piece of account metadata actually came from (never synthesized). */
export type AccountDataSource = "tradingview-dom" | "tradingview-widget" | "gateway" | "server" | "unavailable";

export interface TradingViewConnectionInfo {
  /** The TradingView chart context stream (content-script heartbeat) is alive. */
  chartConnected: boolean;
  /** Epoch ms of the last chart context seen, or null when never seen. */
  chartLastSeenAt: number | null;
  /** Server-reported TradingView MCP connection state (real OAuth record). */
  mcpState: string | null;
  mcpAuthorized: boolean | null;
  /** Human-readable TradingView connection message from the server, if any. */
  mcpMessage: string | null;
}

/** Which data surfaces the connected integration can actually serve. */
export interface AccountDataAvailability {
  positions: boolean;
  pendingOrders: boolean;
  executionHistory: boolean;
  /** Populated when a surface is unavailable — never guessed. */
  reason: string | null;
}

export interface TradingViewPosition {
  id: string;
  symbol: string;
  side: "BUY" | "SELL" | "LONG" | "SHORT";
  quantity: number;
  entryPrice: number;
  /** Null when the source does not report a live mark price. */
  currentPrice: number | null;
  /** Null when P/L is not reported — never fabricated. */
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

/** One row of the real execution/order history reported by the gateway. */
export interface ExecutionHistoryEntry {
  requestId: string;
  symbol: string | null;
  side: string | null;
  orderType: string | null;
  quantity: number | null;
  price: number | null;
  status: string;
  orderId: string | null;
  errorMessage: string | null;
  createdAt: number | null;
  executedAt: number | null;
}

export interface TradingViewAccountInfo {
  connectionStatus: "CONNECTED" | "DISCONNECTED" | "CONNECTING" | "ERROR";
  accountState: AccountState;
  /** Detected broker name — only set when a source actually reported it. */
  broker: string | null;
  /** Internal account reference used for order routing (gateway id). */
  accountId: string | null;
  /** Safe masked representation for display (e.g. ••••1234). */
  accountIdMasked: string | null;
  accountType: string | null;
  mode: AccountMode;
  /** Which source established the account mode (null-safe: never inferred). */
  modeSource: AccountDataSource;
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
  executionHistory: ExecutionHistoryEntry[];
  tradingView: TradingViewConnectionInfo;
  dataAvailability: AccountDataAvailability;
  lastSyncTimestamp: number;
  source: AccountDataSource;
  unsupportedReason: string | null;
}

/* ── Execution capability detection ─────────────────────────────────── */

/** Instrument spec discovered from the connected venue (nulls = unknown). */
export interface ExecutionSpecification {
  minQuantity: number | null;
  quantityStep: number | null;
  pricePrecision: number | null;
}

export interface ExecutionCapabilitySet {
  /**
   * Always false: the installed TradingView MCP integration is read-only and
   * exposes no order/account/position tool. Kept as a field (not a constant)
   * so the UI renders the limitation from live detection, not a hard-coded
   * claim.
   */
  tradingViewMcpExecutionSupported: boolean;
  tradingViewMcpAccountSupported: boolean;
  /** True when the AlgoVault MT5 Gateway is connected and entitled. */
  gatewayExecutionSupported: boolean;
  gatewayPositionsSupported: boolean;
  gatewayOrderManagementSupported: boolean;
  supportedOrderTypes: Array<"MARKET" | "LIMIT" | "STOP">;
  supportedSides: Array<"BUY" | "SELL">;
  specification: ExecutionSpecification;
  limitations: string[];
  detectedAt: number;
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

export interface ExecutionStatusEvent {
  status: ExecutionLifecycleStatus;
  at: number;
  detail?: string | null;
}

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
  /** Reference price used for the math; null when no real price was available. */
  referencePrice: number | null;
  referencePriceSource: "intent" | "market" | "none";
  estimatedExposure: number | null;
  stopDistance: number | null;
  riskAmount: number | null;
  riskPercentage: number | null;
  potentialRiskReward: number | null;
  missingRiskData: string[];
  riskCalculable: boolean;
  brokerRestrictions: string[];
  notes?: string | null;
}

/** Exact wording required by the spec when risk math is impossible. */
export const RISK_NOT_CALCULABLE_MESSAGE =
  "Risk could not be calculated from available data.";

/** Exact wording required when an execution outcome cannot be confirmed. */
export const EXECUTION_UNCONFIRMED_MESSAGE =
  "Execution status could not be confirmed. Check TradingView before attempting another order.";

export interface ExecutionResult {
  requestId: string;
  status: ExecutionLifecycleStatus;
  orderId: string | null;
  /** Real reported execution price; null when the venue did not report one. */
  executionPrice: number | null;
  filledQuantity: number | null;
  timestamp: number;
  error?: string | null;
  rawStatusText?: string | null;
  mode: AccountMode;
  broker: string | null;
  /** Real MT5 ticket when the gateway reported one. */
  brokerTicket?: string | null;
  /** True when the outcome is uncertain — retries must be user-initiated. */
  uncertain?: boolean;
  /** True when the receipt may be shown (confirmed terminal state only). */
  confirmed?: boolean;
  statusTimeline: ExecutionStatusEvent[];
  receipt?: TradeReceipt | null;
}

export interface TradeReceipt {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  broker: string;
  accountReference: string;
  /** Null when the venue never reported a fill price (never faked). */
  executionPrice: number | null;
  timestamp: number;
  mode: AccountMode;
  brokerTicket?: string | null;
  strategyId?: string | null;
  strategyName?: string | null;
  setupId?: string | null;
  analysisId?: string | null;
  timeframe?: string | null;
  status: ExecutionLifecycleStatus;
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
  accountState?: AccountState | null;
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
  strategyId?: string | null;
  setup?: string | null;
  setupId?: string | null;
  aiAnalysis?: string | null;
  analysisId?: string | null;
  marketContext?: string | null;
  timeframe?: string | null;
  timestamp: number;
  executionStatus: string;
  orderId?: string | null;
  brokerTicket?: string | null;
  exitPrice?: number | null;
  exitTime?: number | null;
  pnl?: number | null;
  notes?: string | null;
}

/* ── AI Setup → trade preparation ───────────────────────────────────── */

export type PreparedTradeSource = "setup_radar" | "copilot" | "manual";

/** Trade draft produced by the intelligence layer. Never auto-executed. */
export interface PreparedTradeDraft {
  source: PreparedTradeSource;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP";
  quantity: number | null;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  timeframe: string | null;
  strategyId: string | null;
  strategyName: string | null;
  setupId: string | null;
  analysisId: string | null;
  riskContext: string | null;
  preparedAt: number;
}

/* ── TradingView page account signals (content-script probe) ────────── */

/**
 * What the TradingView page itself actually shows. Probed by the content
 * script in the TradingView document — never from the extension's own page.
 * Fields are null/false when the page does not expose them.
 */
export interface TradingViewPageAccountSignal {
  /** A TradingView document was probed (chart reachable). */
  pageReachable: boolean;
  /** TradingView Paper Trading UI was positively detected. */
  paperTrading: boolean;
  /** Broker label read from a real TradingView broker widget element. */
  brokerLabel: string | null;
  /** Explicit "live" badge found in the TradingView trading panel, if any. */
  liveBadge: boolean;
  detectedAt: number;
}

export function maskAccountId(accountId: string | null | undefined): string | null {
  if (!accountId) return null;
  const digits = String(accountId).replace(/\D/g, "");
  if (digits.length >= 4) return `••••${digits.slice(-4)}`;
  if (accountId.length <= 4) return `••••`;
  return `••••${accountId.slice(-4)}`;
}

export function createEmptyAccountInfo(): TradingViewAccountInfo {
  return {
    connectionStatus: "DISCONNECTED",
    accountState: "NOT_CONNECTED",
    broker: null,
    accountId: null,
    accountIdMasked: null,
    accountType: null,
    mode: "UNKNOWN",
    modeSource: "unavailable",
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
    executionHistory: [],
    tradingView: {
      chartConnected: false,
      chartLastSeenAt: null,
      mcpState: null,
      mcpAuthorized: null,
      mcpMessage: null,
    },
    dataAvailability: {
      positions: false,
      pendingOrders: false,
      executionHistory: false,
      reason: "No trading account connected.",
    },
    lastSyncTimestamp: Date.now(),
    source: "unavailable",
    unsupportedReason: "No active trading account detected",
  };
}
