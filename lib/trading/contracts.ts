/**
 * Provider-neutral trading domain contracts.
 *
 * These are boundary types, not a second trading engine or persistence model.
 * Implementations adapt the existing Strategy Engine, Performance Arena,
 * market-data, and (later) broker systems to this shared surface.
 */

import type { MarketCandle, MarketQuote, Timeframe } from "@/lib/market-data/types";
import type { OrderIntent, OrderSide, OrderType, OrderStatus } from "@/lib/strategy-engine/types";
import type { ChallengeAttempt, ChallengeDefinition, ChallengeResult, VirtualAccount } from "@/lib/performance-arena/types";

export type AccountMode = "SIMULATOR" | "CHALLENGE" | "DEMO" | "LIVE";
export type AccountProvider = "SIMULATOR" | "CHALLENGE" | "DEMO_BROKER" | "BROKER" | "UNKNOWN";
export type AccountStatus = "ACTIVE" | "SUSPENDED" | "CLOSED" | "UNKNOWN";

/** A normalized view over the platform's existing account records. */
export interface TradingAccount {
    accountId: string;
    userId: string;
    mode: AccountMode;
    provider: AccountProvider;
    status: AccountStatus;
    currency: string | null;
    balance: number | null;
    equity: number | null;
    margin: number | null;
    freeMargin: number | null;
    leverage: number | null;
    createdAt: number | null;
    updatedAt: number | null;
}

export type TradingOrderType = OrderType | "STOP_LIMIT";
export type TradingOrderStatus = OrderStatus | "UNKNOWN";

/** Common lifecycle view; absent provider timestamps remain null. */
export interface TradingOrder {
    orderId: string;
    accountId: string;
    symbol: string;
    side: OrderSide;
    type: TradingOrderType;
    quantity: number;
    requestedPrice: number | null;
    executionPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    status: TradingOrderStatus;
    createdAt: number;
    submittedAt: number | null;
    filledAt: number | null;
    cancelledAt: number | null;
    provider: AccountProvider;
    executionId: string | null;
    clientOrderId: string | null;
}

export interface TradingPosition {
    positionId: string;
    accountId: string;
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    unrealizedPnL: number;
    realizedPnL: number;
    margin: number | null;
    exposure: number | null;
    openedAt: number;
    updatedAt: number;
    provider: AccountProvider;
}

export type ProviderUnavailableState = "UNKNOWN" | "STALE" | "UNAVAILABLE" | "BLOCKED";
export type ProviderResult<T> =
    | { status: "AVAILABLE"; value: T }
    | { status: ProviderUnavailableState; reason: string };

export interface PlaceOrderRequest {
    userId: string;
    accountId: string;
    intent: OrderIntent;
}

export interface ModifyOrderRequest {
    userId: string;
    accountId: string;
    orderId: string;
    price?: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
}

export interface OrderMutationRequest {
    userId: string;
    accountId: string;
    orderId: string;
}

export interface PositionMutationRequest {
    userId: string;
    accountId: string;
    positionId: string;
}

/**
 * The Pro Terminal depends on this capability surface, never on a simulator,
 * challenge service, gateway, or broker implementation.
 */
export interface ExecutionProvider {
    readonly id: AccountProvider;
    placeOrder(request: PlaceOrderRequest): Promise<ProviderResult<TradingOrder>>;
    cancelOrder(request: OrderMutationRequest): Promise<ProviderResult<TradingOrder>>;
    modifyOrder(request: ModifyOrderRequest): Promise<ProviderResult<TradingOrder>>;
    closePosition(request: PositionMutationRequest): Promise<ProviderResult<TradingPosition>>;
    modifyPosition(request: PositionMutationRequest & { stopLoss?: number | null; takeProfit?: number | null }): Promise<ProviderResult<TradingPosition>>;
    getOrders(userId: string, accountId: string): Promise<ProviderResult<TradingOrder[]>>;
    getPositions(userId: string, accountId: string): Promise<ProviderResult<TradingPosition[]>>;
    getAccount(userId: string, accountId: string): Promise<ProviderResult<TradingAccount>>;
}

export interface MarketDataSubscription {
    status: "SUBSCRIBED" | "UNAVAILABLE";
    unsubscribe: () => void;
    reason?: string;
}

export interface MarketDataProvider {
    readonly id: string;
    getQuote(symbol: string): Promise<ProviderResult<MarketQuote>>;
    getCandles(symbol: string, timeframe: Timeframe): Promise<ProviderResult<MarketCandle[]>>;
    getHistoricalData(symbol: string, timeframe: Timeframe, range?: { from?: number; to?: number }): Promise<ProviderResult<MarketCandle[]>>;
    subscribeRealtime(symbol: string, timeframe: Timeframe, onUpdate: (quote: MarketQuote) => void): MarketDataSubscription;
}

/** Broker ports only. No broker authentication or credentials are implemented. */
export interface BrokerAdapter {
    authenticate(): Promise<ProviderResult<void>>;
    getAccount(accountId: string): Promise<ProviderResult<TradingAccount>>;
    getPositions(accountId: string): Promise<ProviderResult<TradingPosition[]>>;
    getOrders(accountId: string): Promise<ProviderResult<TradingOrder[]>>;
    placeOrder(request: PlaceOrderRequest): Promise<ProviderResult<TradingOrder>>;
    modifyOrder(request: ModifyOrderRequest): Promise<ProviderResult<TradingOrder>>;
    cancelOrder(request: OrderMutationRequest): Promise<ProviderResult<TradingOrder>>;
    closePosition(request: PositionMutationRequest): Promise<ProviderResult<TradingPosition>>;
}

/**
 * Challenge remains the existing Performance Arena domain. These aliases make
 * its policy/account/evaluation records consumable at provider boundaries
 * without inventing duplicate template, attempt, or result schemas.
 */
export type ChallengeTemplate = ChallengeDefinition;
export type ChallengeAccount = VirtualAccount;
export type ChallengeEvaluation = ChallengeResult;
export type ChallengeState = ChallengeAttempt["status"] | "CREATED" | "VERIFICATION" | "FUNDED_FUTURE";

export interface TradingEvent {
    eventId: string;
    accountId: string;
    userId: string;
    type: "ORDER_CREATED" | "ORDER_SUBMITTED" | "ORDER_FILLED" | "ORDER_CANCELLED" | "POSITION_OPENED" | "POSITION_MODIFIED" | "POSITION_CLOSED" | "RISK_WARNING" | "DRAWDOWN_WARNING" | "CHALLENGE_PASSED" | "CHALLENGE_FAILED";
    timestamp: number;
    symbol?: string;
    orderId?: string;
    positionId?: string;
    metadata?: Record<string, unknown>;
}
