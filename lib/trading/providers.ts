import type { MarketCandle, MarketQuote, SupportedSymbol } from "@/lib/market-data/types";
import { SUPPORTED_SYMBOL_LIST } from "@/lib/market-data/market-truth";
import { fetchCandles, fetchCandlesWithProvider } from "@/lib/market-data/normalizer";
import { fetchMarketSnapshot, marketDataStream } from "@/lib/market-data/market-truth";
import { calculateExposure, calculateMargin } from "./risk";
import { isPaperTradingEnabled } from "./feature-flags";
import type { PaperTradingSession } from "@/lib/strategy-engine/paper";
import type { Order, Position } from "@/lib/strategy-engine/types";
import type {
    BrokerAdapter,
    ExecutionProvider,
    MarketDataProvider,
    PlaceOrderRequest,
    ModifyOrderRequest,
    OrderMutationRequest,
    PositionMutationRequest,
    ProviderResult,
    TradingAccount,
    TradingOrder,
    TradingPosition,
} from "./contracts";

const unavailable = <T>(reason: string): ProviderResult<T> => ({ status: "UNAVAILABLE", reason });
/** A capability disabled by configuration — distinct from "temporarily unavailable". */
const blocked = <T = never>(reason: string): ProviderResult<T> => ({ status: "BLOCKED", reason });
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const supportedSymbol = (symbol: string): symbol is SupportedSymbol =>
    SUPPORTED_SYMBOL_LIST.includes(symbol.toUpperCase() as SupportedSymbol);

export const algoVaultMarketDataProvider: MarketDataProvider = {
    id: "ALGOVAULT_MARKET_DATA",
    async getQuote(symbol) {
        if (!supportedSymbol(symbol)) return { status: "UNAVAILABLE", reason: "Unsupported market symbol." };
        try {
            const snapshot = await fetchMarketSnapshot(symbol.toUpperCase(), "M5");
            if (!snapshot) return unavailable("Market quote unavailable.");
            if (snapshot.freshnessStatus !== "fresh") return { status: "STALE", reason: "Market quote is stale." };
            return { status: "AVAILABLE", value: {
                symbol: snapshot.symbol,
                bid: snapshot.bid,
                ask: snapshot.ask,
                spread: snapshot.spread,
                timestamp: snapshot.timestamp,
            } };
        } catch {
            return unavailable("Market quote provider failed.");
        }
    },
    async getCandles(symbol, timeframe) {
        if (!supportedSymbol(symbol)) return { status: "UNAVAILABLE", reason: "Unsupported market symbol." };
        const result = await fetchCandlesWithProvider(symbol.toUpperCase() as SupportedSymbol, timeframe);
        return result.candles.length
            ? { status: "AVAILABLE", value: result.candles }
            : unavailable("Candles unavailable.");
    },
    async getHistoricalData(symbol, timeframe, range) {
        if (!supportedSymbol(symbol)) return { status: "UNAVAILABLE", reason: "Unsupported market symbol." };
        const candles = await fetchCandles(symbol.toUpperCase() as SupportedSymbol, timeframe, range);
        return candles.length ? { status: "AVAILABLE", value: candles } : unavailable("Historical candles unavailable.");
    },
    subscribeRealtime(symbol, timeframe, onUpdate) {
        if (!supportedSymbol(symbol)) {
            return { status: "UNAVAILABLE", reason: "Unsupported market symbol.", unsubscribe: () => undefined };
        }
        let active = true;
        const unsubscribe = marketDataStream.subscribe(symbol, timeframe, (snapshot) => {
            if (!active || !snapshot || snapshot.freshnessStatus !== "fresh") return;
            onUpdate({
                symbol: snapshot.symbol,
                bid: snapshot.bid,
                ask: snapshot.ask,
                spread: snapshot.spread,
                timestamp: snapshot.timestamp,
            });
        });
        return { status: "SUBSCRIBED", unsubscribe: () => { active = false; unsubscribe(); } };
    },
};

/**
 * Simulator adapter over the canonical PaperTradingSession. No independent
 * balances, order engine, or position store is created here.
 */
export class SimulatorExecutionProvider implements ExecutionProvider {
    readonly id = "SIMULATOR" as const;

    constructor(
        private readonly sessionFor: (userId: string, accountId: string) => PaperTradingSession | null,
        private readonly clock: () => number = () => Date.now(),
    ) {}

    async placeOrder(request: PlaceOrderRequest): Promise<ProviderResult<TradingOrder>> {
        const session = this.ownedSession(request.userId, request.accountId);
        if (!isPaperTradingEnabled()) return { status: "BLOCKED", reason: "Paper trading is disabled." };
        if (!session) return unavailable("Simulator account is unavailable or not owned.");
        const intent = { ...request.intent, accountId: request.accountId, provider: "SIMULATOR" as const };
        const result = session.placeOrder(intent);
        return { status: "AVAILABLE", value: normalizeOrder(result.order, request.accountId) };
    }

    async cancelOrder(request: OrderMutationRequest): Promise<ProviderResult<TradingOrder>> {
        const session = this.ownedSession(request.userId, request.accountId);
        if (!isPaperTradingEnabled()) return { status: "BLOCKED", reason: "Paper trading is disabled." };
        if (!session) return unavailable("Simulator account is unavailable or not owned.");
        const cancelled = session.getEngine().cancelOrder(request.orderId);
        return cancelled
            ? { status: "AVAILABLE", value: normalizeOrder(cancelled, request.accountId) }
            : unavailable("Order could not be cancelled.");
    }

    async modifyOrder(request: ModifyOrderRequest): Promise<ProviderResult<TradingOrder>> {
        const session = this.ownedSession(request.userId, request.accountId);
        if (!isPaperTradingEnabled()) return { status: "BLOCKED", reason: "Paper trading is disabled." };
        if (!session) return unavailable("Simulator account is unavailable or not owned.");
        const updated = session.getEngine().modifyOrder(request.orderId, {
            ...(request.price !== undefined ? { price: request.price } : {}),
            ...(request.stopLoss !== undefined ? { stopLoss: request.stopLoss ?? undefined } : {}),
            ...(request.takeProfit !== undefined ? { takeProfit: request.takeProfit ?? undefined } : {}),
        });
        return updated ? { status: "AVAILABLE", value: normalizeOrder(updated, request.accountId) } : unavailable("Order is not modifiable.");
    }

    async closePosition(request: PositionMutationRequest): Promise<ProviderResult<TradingPosition>> {
        const session = this.ownedSession(request.userId, request.accountId);
        if (!isPaperTradingEnabled()) return { status: "BLOCKED", reason: "Paper trading is disabled." };
        if (!session) return unavailable("Simulator account is unavailable or not owned.");
        const position = session.closePosition(request.positionId);
        if (!position) return unavailable("Position could not be closed; quote may be stale or position unavailable.");
        return { status: "AVAILABLE", value: normalizePosition(position, request.accountId, this.clock(), session.getAccount().leverage) };
    }

    async modifyPosition(request: PositionMutationRequest & { stopLoss?: number | null; takeProfit?: number | null }): Promise<ProviderResult<TradingPosition>> {
        const session = this.ownedSession(request.userId, request.accountId);
        if (!isPaperTradingEnabled()) return { status: "BLOCKED", reason: "Paper trading is disabled." };
        if (!session) return unavailable("Simulator account is unavailable or not owned.");
        const changed = session.getEngine().modifyPosition(request.positionId, request.stopLoss, request.takeProfit);
        return changed ? { status: "AVAILABLE", value: normalizePosition(changed, request.accountId, this.clock(), session.getAccount().leverage) } : unavailable("Position is not modifiable.");
    }

    async getOrders(userId: string, accountId: string): Promise<ProviderResult<TradingOrder[]>> {
        const session = this.ownedSession(userId, accountId);
        return session
            ? { status: "AVAILABLE", value: session.getOrders().map((order) => normalizeOrder(order, accountId)) }
            : unavailable("Simulator account is unavailable or not owned.");
    }

    async getPositions(userId: string, accountId: string): Promise<ProviderResult<TradingPosition[]>> {
        const session = this.ownedSession(userId, accountId);
        return session
            ? { status: "AVAILABLE", value: session.getPositions().map((position) => normalizePosition(position, accountId, this.clock(), session.getAccount().leverage)) }
            : unavailable("Simulator account is unavailable or not owned.");
    }

    async getAccount(userId: string, accountId: string): Promise<ProviderResult<TradingAccount>> {
        const session = this.ownedSession(userId, accountId);
        if (!session) return unavailable("Simulator account is unavailable or not owned.");
        const account = session.getAccount();
        const state = account.status === "ACTIVE" || account.status === "SUSPENDED" || account.status === "CLOSED" ? account.status : "UNKNOWN";
        return { status: "AVAILABLE", value: {
            accountId: account.id,
            userId: account.userId ?? userId,
            mode: account.mode ?? "SIMULATOR",
            provider: account.provider ?? "SIMULATOR",
            status: state,
            currency: account.currency ?? null,
            balance: finite(account.balance),
            equity: finite(account.equity),
            margin: finite(account.usedMargin),
            freeMargin: finite(account.availableMargin),
            leverage: finite(account.leverage),
            createdAt: finite(account.createdAt),
            updatedAt: finite(account.updatedAt),
        } };
    }

    private ownedSession(userId: string, accountId: string): PaperTradingSession | null {
        if (!userId || !accountId) return null;
        // The injected resolver is the server-side ownership boundary and must
        // return null for callers who do not own the account.
        const session = this.sessionFor(userId, accountId);
        return session?.accountId === accountId ? session : null;
    }
}

function normalizeOrder(order: Order, accountId: string): TradingOrder {
    return {
        orderId: order.id,
        accountId,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        requestedPrice: finite(order.price),
        executionPrice: order.filledQuantity > 0 ? order.avgFillPrice : null,
        stopLoss: finite(order.stopLoss),
        takeProfit: finite(order.takeProfit),
        status: order.status,
        createdAt: order.createdAt,
        submittedAt: order.submittedAt ?? null,
        filledAt: order.filledAt ?? null,
        cancelledAt: order.cancelledAt ?? null,
        provider: "SIMULATOR",
        executionId: order.fills.length ? order.id : null,
        clientOrderId: order.clientOrderId ?? null,
    };
}

function normalizePosition(position: Position, accountId: string, now: number, leverage?: number): TradingPosition {
    const target = position.targets.find((item) => item.id === "tp1" && item.price > 0);
    return {
        positionId: position.id,
        accountId,
        symbol: position.symbol,
        side: position.side,
        quantity: position.remainingQuantity,
        entryPrice: position.entryPrice,
        currentPrice: position.currentPrice,
        stopLoss: Number.isFinite(position.stopLoss) ? position.stopLoss : null,
        takeProfit: target?.price ?? null,
        unrealizedPnL: position.unrealizedPnL,
        realizedPnL: position.realizedPnL,
        margin: leverage && leverage > 0 ? calculateMargin(position.currentPrice, position.remainingQuantity, position.symbol, leverage) : null,
        exposure: calculateExposure(position.currentPrice, position.remainingQuantity, position.symbol),
        openedAt: position.openedAt,
        updatedAt: position.updatedAt || now,
        provider: "SIMULATOR",
    };
}

/** Future provider intentionally cannot authenticate or execute today. */
export class DisabledBrokerAdapter implements BrokerAdapter {
    async authenticate() { return blocked("Broker connections are disabled."); }
    async getAccount() { return blocked<TradingAccount>("Broker connections are disabled."); }
    async getPositions() { return blocked<TradingPosition[]>("Broker connections are disabled."); }
    async getOrders() { return blocked<TradingOrder[]>("Broker connections are disabled."); }
    async placeOrder() { return blocked("Broker connections are disabled."); }
    async modifyOrder() { return blocked("Broker connections are disabled."); }
    async cancelOrder() { return blocked("Broker connections are disabled."); }
    async closePosition() { return blocked("Broker connections are disabled."); }
}

/** Statically safe historical adapter; realtime subscription remains explicit unavailable. */
export const historicalMarketDataProvider: MarketDataProvider = {
    ...algoVaultMarketDataProvider,
    id: "ALGOVAULT_HISTORICAL",
    async getQuote(symbol) {
        if (!supportedSymbol(symbol)) return { status: "UNAVAILABLE", reason: "Unsupported market symbol." };
        const candles = await fetchCandles(symbol.toUpperCase() as SupportedSymbol, "M1");
        const candle = candles.at(-1);
        if (!candle || !Number.isFinite(candle.close) || candle.close <= 0) return unavailable("No candle-derived quote is available.");
        if (Date.now() - candle.timestamp > 120_000) return { status: "STALE", reason: "The latest historical candle is stale as a quote." };
        return { status: "AVAILABLE", value: { symbol: symbol.toUpperCase(), bid: candle.close, ask: candle.close, spread: 0, timestamp: candle.timestamp } };
    },
    async getCandles(symbol, timeframe) {
        if (!supportedSymbol(symbol)) return { status: "UNAVAILABLE", reason: "Unsupported market symbol." };
        const result = await fetchCandlesWithProvider(symbol.toUpperCase() as SupportedSymbol, timeframe);
        return result.candles.length ? { status: "AVAILABLE", value: result.candles } : unavailable("Historical candles unavailable.");
    },
    async getHistoricalData(symbol, timeframe, range) {
        if (!supportedSymbol(symbol)) return { status: "UNAVAILABLE", reason: "Unsupported market symbol." };
        const candles = await fetchCandles(symbol.toUpperCase() as SupportedSymbol, timeframe, range);
        return candles.length ? { status: "AVAILABLE", value: candles } : unavailable("Historical candles unavailable.");
    },
    subscribeRealtime() {
        return { status: "UNAVAILABLE", reason: "Historical data provider does not subscribe to realtime updates.", unsubscribe: () => undefined };
    },
};

export type { MarketDataProvider, MarketCandle, MarketQuote };
