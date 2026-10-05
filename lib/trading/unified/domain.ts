/**
 * Provider-neutral trading domain (Unified Trading Service).
 *
 * These types are the ONLY vocabulary the Pro Terminal, the chart, the AI
 * surfaces, signals, bots and future TradingView/AlgoVault-broker channels are
 * allowed to speak. Nothing here mentions MT5, cTrader or a broker login:
 * provider differences live behind `TradingProviderAdapter`.
 *
 * This module is pure and dependency-free so both server routes and client
 * components can import the types without pulling in the admin SDK.
 */

// ─── Providers and environments ──────────────────────────────────────────────

export const TRADING_PROVIDERS = ["MT5", "MT4", "CTRADER", "ALGOVAULT_BROKER"] as const;
export type TradingProvider = (typeof TRADING_PROVIDERS)[number];

export type TradingEnvironment = "DEMO" | "LIVE";

/** Explicit execution order kinds, independent of any broker's enum. */
export type TradingOrderKind = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";

export type TradingSide = "BUY" | "SELL";

export type TradingOrderState =
    | "PENDING"
    | "SUBMITTED"
    | "FILLED"
    | "PARTIALLY_FILLED"
    | "CANCELLED"
    | "REJECTED"
    | "EXPIRED"
    | "UNKNOWN";

/**
 * Connection lifecycle. The terminal renders this verbatim; a value is never
 * optimistically upgraded by the client.
 */
export type TradingConnectionState =
    | "DISCONNECTED"
    | "CONNECTING"
    | "CONNECTED"
    | "DEGRADED"
    | "STALE"
    | "ERROR"
    | "DISCONNECTING";

/** What the platform is willing to do with this connection right now. */
export type TradingProviderStatus = "ONLINE" | "STALE" | "OFFLINE" | "BLOCKED" | "UNKNOWN";

// ─── Account ─────────────────────────────────────────────────────────────────

export interface TradingBalance {
    balance: number | null;
    currency: string | null;
}

export interface TradingEquity {
    equity: number | null;
    floatingPnl: number | null;
}

export interface TradingMargin {
    margin: number | null;
    freeMargin: number | null;
    marginLevel: number | null;
    leverage: number | null;
}

export interface TradingAccountMetrics {
    balance: number | null;
    equity: number | null;
    margin: number | null;
    freeMargin: number | null;
    marginLevel: number | null;
    floatingPnl: number | null;
    positionsCount: number | null;
    ordersCount: number | null;
    /** Reported currency; never defaulted to USD when the provider is silent. */
    currency: string | null;
    /** Epoch ms of the provider heartbeat that produced these numbers. */
    updatedAt: number | null;
}

/** Volume constraints the provider enforces; sourced from the provider, not guessed. */
export interface TradingSymbolSpec {
    symbol: string;
    minVolume: number | null;
    maxVolume: number | null;
    volumeStep: number | null;
    digits: number | null;
    tradeMode?: string | null;
}

export interface TradingSymbol {
    symbol: string;
    provider: TradingProvider;
    description: string | null;
    digits: number | null;
    minVolume: number | null;
    maxVolume: number | null;
    volumeStep: number | null;
    /** Raw provider trade-mode string, normalized only by the adapter. */
    tradeMode: string | null;
}

export interface TradingAccount {
    id: string;
    userId: string;
    provider: TradingProvider;
    environment: TradingEnvironment;
    /** Provider-side login/handle. Never a credential. */
    externalAccountId: string | null;
    brokerName: string | null;
    serverName: string | null;
    currency: string | null;
    leverage: number | null;
    connection: TradingConnectionState;
    providerStatus: TradingProviderStatus;
    metrics: TradingAccountMetrics;
    connectedAt: number | null;
    lastHeartbeatAt: number | null;
    lastSyncAt: number | null;
    connectionError: TradingError | null;
    /** Provider version string when reported (EA version / API version). */
    gatewayVersion: string | null;
}

/** Provider-neutral account read used by the terminal header. */
export interface TradingConnection {
    accountId: string;
    userId: string;
    provider: TradingProvider;
    environment: TradingEnvironment;
    state: TradingConnectionState;
    providerStatus: TradingProviderStatus;
    lastHeartbeatAt: number | null;
    lastSyncAt: number | null;
    brokerName: string | null;
    serverName: string | null;
    externalAccountId: string | null;
    error: TradingError | null;
}

// ─── Market data ─────────────────────────────────────────────────────────────

export interface TradingQuote {
    symbol: string;
    provider: TradingProvider;
    bid: number;
    ask: number;
    spread: number | null;
    timestamp: number;
    /** false when the tick is older than the provider's freshness window. */
    fresh: boolean;
}

export interface TradingCandle {
    symbol: string;
    provider: TradingProvider;
    timeframe: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
}

// ─── Execution objects ───────────────────────────────────────────────────────

export interface TradingPosition {
    id: string;
    accountId: string;
    provider: TradingProvider;
    symbol: string;
    side: TradingSide;
    /** Lots. */
    volume: number;
    entryPrice: number;
    currentPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    profit: number | null;
    swap: number | null;
    commission: number | null;
    openedAt: number | null;
    magicNumber: number | null;
    comment: string | null;
    /** Provider reference (MT5 position ticket); may equal `id`. */
    providerRef: string | null;
}

export interface TradingOrder {
    id: string;
    accountId: string;
    provider: TradingProvider;
    symbol: string;
    kind: TradingOrderKind;
    side: TradingSide;
    volume: number;
    price: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    state: TradingOrderState;
    createdAt: number | null;
    filledAt: number | null;
    magicNumber: number | null;
    comment: string | null;
    providerRef: string | null;
}

export interface TradingDeal {
    id: string;
    accountId: string;
    provider: TradingProvider;
    symbol: string;
    orderId: string | null;
    side: TradingSide;
    volume: number;
    price: number;
    profit: number | null;
    commission: number | null;
    swap: number | null;
    timestamp: number;
    comment: string | null;
}

export interface TradingHistory {
    deals: TradingDeal[];
    orders: TradingOrder[];
    /** True when the provider truncated the result (older history not read). */
    truncated: boolean;
}

// ─── Execution requests / results ────────────────────────────────────────────

export type TradingExecutionType =
    | "PLACE_ORDER"
    | "MODIFY_POSITION"
    | "CLOSE_POSITION"
    | "PARTIAL_CLOSE"
    | "CANCEL_ORDER";

export interface TradingExecutionRequest {
    /** Client-minted idempotency key. Reuse MUST return the first result. */
    clientRequestId: string;
    correlationId: string;
    userId: string;
    accountId: string;
    provider: TradingProvider;
    environment: TradingEnvironment;
    executionType: TradingExecutionType;
    symbol?: string;
    side?: TradingSide;
    /** Lots, for entries and for absolute partial closes. */
    volume?: number;
    /** 0–100, for percentage partial closes. */
    percentage?: number;
    kind?: TradingOrderKind;
    price?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
    positionId?: string;
    orderId?: string;
    /** Free-form origin marker (terminal, ai, signal, bot, tradingview). */
    source?: string;
    timestamp: number;
}

export type TradingExecutionStatus =
    | "ACCEPTED"
    | "SUCCEEDED"
    | "REJECTED"
    | "DUPLICATE"
    | "FAILED";

export interface TradingExecutionResult {
    clientRequestId: string;
    correlationId: string;
    accountId: string;
    provider: TradingProvider;
    environment: TradingEnvironment;
    executionType: TradingExecutionType;
    status: TradingExecutionStatus;
    /** Provider reference (MT5 ticket / deal id) once execution is confirmed. */
    providerRef: string | null;
    filledVolume: number | null;
    filledPrice: number | null;
    order: TradingOrder | null;
    position: TradingPosition | null;
    error: TradingError | null;
    /** True when this result was replayed from a prior identical request. */
    duplicate: boolean;
    createdAt: number;
    completedAt: number | null;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export type TradingErrorCode =
    | "ACCOUNT_NOT_CONNECTED"
    | "ACCOUNT_NOT_FOUND"
    | "PROVIDER_UNAVAILABLE"
    | "PROVIDER_STALE"
    | "INVALID_SYMBOL"
    | "INVALID_VOLUME"
    | "INSUFFICIENT_MARGIN"
    | "MARKET_CLOSED"
    | "ORDER_REJECTED"
    | "EXECUTION_TIMEOUT"
    | "DUPLICATE_REQUEST"
    | "PERMISSION_DENIED"
    | "LIVE_EXECUTION_DISABLED"
    | "RISK_REJECTED"
    | "UNKNOWN_PROVIDER_ERROR"
    | "INVALID_REQUEST"
    | "UNSUPPORTED_OPERATION"
    | "PROVIDER_NOT_CONFIGURED"
    | "TRADING_DISABLED";

export interface TradingError {
    code: TradingErrorCode;
    message: string;
    /** Normalized code from the provider, e.g. an MT5 retcode name. */
    providerCode?: string | null;
    /** Numeric provider retcode; diagnostics only, never the contract. */
    providerRetcode?: number | null;
    retryable: boolean;
    at: number;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export type TradingAuditAction =
    | "ACCOUNT_LISTED"
    | "ACCOUNT_STATUS_READ"
    | "CONNECTION_REJECTED"
    | "EXECUTION_REQUESTED"
    | "EXECUTION_ACCEPTED"
    | "EXECUTION_SUCCEEDED"
    | "EXECUTION_REJECTED"
    | "EXECUTION_DUPLICATE"
    | "EXECUTION_FAILED";

export interface TradingAuditEvent {
    eventId: string;
    userId: string;
    accountId: string | null;
    provider: TradingProvider | null;
    environment: TradingEnvironment | null;
    clientRequestId: string | null;
    correlationId: string | null;
    action: TradingAuditAction;
    symbol: string | null;
    volume: number | null;
    requestStatus: TradingExecutionStatus | null;
    providerStatus: TradingProviderStatus | null;
    result: TradingExecutionStatus | null;
    errorCode: TradingErrorCode | null;
    source: string | null;
    timestamp: number;
}