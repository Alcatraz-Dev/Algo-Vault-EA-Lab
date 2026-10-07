/**
 * In-memory `MockTradingProvider`.
 *
 * Exists so the Unified Trading Service (pipeline, idempotency, risk,
 * verification, audit) can be tested without a MetaTrader installation.
 *
 * TEST/DEV ONLY. `createTradingRegistry()` refuses to register it when
 * `NODE_ENV === "production"`, and `descriptor.operational` is false.
 */

import type {
    TradingAccount,
    TradingCandle,
    TradingConnection,
    TradingDeal,
    TradingEnvironment,
    TradingError,
    TradingExecutionResult,
    TradingExecutionType,
    TradingHistory,
    TradingOrder,
    TradingOrderKind,
    TradingOrderState,
    TradingPosition,
    TradingProvider,
    TradingProviderStatus,
    TradingQuote,
    TradingSide,
    TradingSymbol,
} from "./domain";
import { tradingError } from "./errors";
import type { AdapterExecutionInput, TradingProviderAdapter, TradingResult } from "./adapter";
import { planPartialClose } from "./volume";

/**
 * The mock is not a real trading provider; it is a test double. It is modelled
 * as a `TradingProvider` value so the registry can hold it alongside real
 * providers without widening the production enum.
 */
export const MOCK_PROVIDER = "MOCK" as unknown as TradingProvider;

/** Internal execution envelope shared by the mock's private handlers. */
type MockExecutionBase = {
    clientRequestId: string;
    correlationId: string;
    accountId: string;
    provider: TradingProvider;
    environment: TradingEnvironment;
    executionType: TradingExecutionType;
    createdAt: number;
    symbol?: string;
    side?: TradingSide;
    volume?: number | null;
    kind?: TradingOrderKind;
    price?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
};

type MockResultPartial = Omit<Partial<TradingExecutionResult>, "status"> &
    Pick<TradingExecutionResult, "status">;

/**
 * Narrows the internal base envelope to the public result shape, dropping the
 * request-only fields (symbol / side / volume / kind / price / sl / tp).
 */
function toResult(
    base: MockExecutionBase,
    partial: MockResultPartial,
    completedAt: number
): TradingExecutionResult {
    return {
        clientRequestId: base.clientRequestId,
        correlationId: base.correlationId,
        accountId: base.accountId,
        provider: base.provider,
        environment: base.environment,
        executionType: base.executionType,
        createdAt: base.createdAt,
        duplicate: false,
        providerRef: null,
        filledVolume: null,
        filledPrice: null,
        order: null,
        position: null,
        error: null,
        ...partial,
        completedAt,
    };
}

interface MockSymbolSpec {
    description: string;
    digits: number;
    minVolume: number;
    maxVolume: number;
    volumeStep: number;
}

const DEFAULT_SPEC: MockSymbolSpec = {
    description: "Mock symbol",
    digits: 5,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
};

interface MockAccountState {
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number | null;
    leverage: number;
    currency: string;
    brokerName: string;
    serverName: string;
    externalAccountId: string;
    connectedAt: number;
    lastHeartbeatAt: number;
    gatewayVersion: string;
}

export interface MockTradingProviderOptions {
    userId?: string;
    accountId?: string;
    environment?: TradingEnvironment;
    initialBalance?: number;
    symbols?: Record<string, Partial<MockSymbolSpec>>;
    clock?: () => number;
}

export class MockTradingProvider implements TradingProviderAdapter {
    readonly provider: TradingProvider = MOCK_PROVIDER;

    readonly descriptor = {
        provider: MOCK_PROVIDER,
        environments: ["DEMO", "LIVE"] as TradingEnvironment[],
        available: true,
        operational: false,
        label: "Mock Provider",
        note: "In-memory provider for automated tests. Never used in production.",
    };

    private readonly clock: () => number;
    private readonly accounts = new Map<string, MockAccountState>();
    private readonly specs = new Map<string, MockSymbolSpec>();
    private readonly positions = new Map<string, TradingPosition>();
    private readonly orders = new Map<string, TradingOrder>();
    private readonly deals = new Map<string, TradingDeal>();
    private readonly accountIdByUser = new Map<string, string>();
    private seq = 0;

    /**
     * Deterministic count of adapter executions.
     *
     * The execution-safety invariant of every idempotency test: after N
     * duplicate/concurrent/replayed requests sharing one idempotency key,
     * `executeCount` must be exactly 1 — never derived from HTTP responses.
     */
    executeCount = 0;

    /** Test controls. */
    connectionOverride: "ONLINE" | "STALE" | "OFFLINE" = "ONLINE";
    failNextExecutionWith: TradingError | null = null;
    heartbeatAgeMs = 0;

    constructor(private readonly options: MockTradingProviderOptions = {}) {
        this.clock = options.clock ?? (() => Date.now());
        const symbolTable = options.symbols ?? {
            EURUSD: { description: "Euro vs US Dollar", digits: 5 },
            XAUUSD: { description: "Gold vs US Dollar", digits: 2, minVolume: 0.01, volumeStep: 0.01 },
        };
        for (const [symbol, spec] of Object.entries(symbolTable)) {
            this.specs.set(symbol, { ...DEFAULT_SPEC, ...spec });
        }
        const userId = options.userId ?? "mock-user";
        const accountId = options.accountId ?? "mock-account";
        this.accountIdByUser.set(userId, accountId);
        this.seedAccount(accountId, options.environment ?? "DEMO", options.initialBalance ?? 10_000);
    }

    private seedAccount(accountId: string, environment: TradingEnvironment, balance: number): void {
        const now = this.clock();
        this.accounts.set(accountId, {
            balance,
            equity: balance,
            margin: 0,
            freeMargin: balance,
            marginLevel: null,
            leverage: 100,
            currency: "USD",
            brokerName: "Mock Broker",
            serverName: environment === "DEMO" ? "MockBroker-Demo" : "MockBroker-Live",
            externalAccountId: "MOCK-0001",
            connectedAt: now,
            lastHeartbeatAt: now,
            gatewayVersion: "mock-1.0.0",
        });
    }

    /** Registers an additional user → account binding (ownership tests). */
    grantAccount(
        userId: string,
        accountId: string,
        environment: TradingEnvironment = "DEMO",
        balance = 10_000
    ): void {
        this.accountIdByUser.set(userId, accountId);
        if (!this.accounts.has(accountId)) this.seedAccount(accountId, environment, balance);
    }

    revokeAccount(userId: string): void {
        this.accountIdByUser.delete(userId);
    }

    private nextId(prefix: string): string {
        this.seq += 1;
        return `${prefix}-${this.seq}`;
    }

    private ownedAccount(userId: string, accountId: string): MockAccountState | null {
        if (this.accountIdByUser.get(userId) !== accountId) return null;
        return this.accounts.get(accountId) ?? null;
    }

    private requireAccount(userId: string, accountId: string): TradingResult<MockAccountState> {
        const state = this.ownedAccount(userId, accountId);
        if (!state) {
            return {
                ok: false,
                error: tradingError("ACCOUNT_NOT_FOUND", "Account is not owned by this user."),
            };
        }
        return { ok: true, value: state };
    }

    private state(): TradingProviderStatus {
        return this.connectionOverride;
    }

    private heartbeat(state: MockAccountState): number {
        return this.connectionOverride === "OFFLINE" ? 0 : state.lastHeartbeatAt - this.heartbeatAgeMs;
    }

    private environmentOf(state: MockAccountState): TradingEnvironment {
        return state.serverName.endsWith("-Demo") ? "DEMO" : "LIVE";
    }

    private connectionOf(): TradingConnection["state"] {
        if (this.connectionOverride === "OFFLINE") return "DISCONNECTED";
        if (this.connectionOverride === "STALE" || this.heartbeatAgeMs > 120_000) return "STALE";
        if (this.heartbeatAgeMs > 45_000) return "DEGRADED";
        return "CONNECTED";
    }

    private quoteFor(symbol: string, bid: number): TradingQuote {
        const spec = this.specs.get(symbol) ?? DEFAULT_SPEC;
        const spread = Number(Math.max(spec.volumeStep, 10 ** -spec.digits).toFixed(spec.digits));
        return {
            symbol,
            provider: MOCK_PROVIDER,
            bid,
            ask: Number((bid + spread).toFixed(spec.digits)),
            spread,
            timestamp: this.clock(),
            fresh: this.connectionOverride !== "OFFLINE",
        };
    }

    // ── adapter surface ──────────────────────────────────────────────────────

    /** The mock test double owns whatever namespace it was seeded with. */
    matchesAccountId(accountId: string): boolean {
        return this.accounts.has(accountId);
    }

    async healthCheck(): Promise<TradingResult<{ status: TradingProviderStatus; checkedAt: number }>> {
        return { ok: true, value: { status: this.state(), checkedAt: this.clock() } };
    }

    async getConnectionStatus(
        userId: string,
        accountId: string
    ): Promise<TradingResult<TradingConnection>> {
        const owned = this.requireAccount(userId, accountId);
        if (!owned.ok) return owned;
        const state = owned.value;
        return {
            ok: true,
            value: {
                accountId,
                userId,
                provider: MOCK_PROVIDER,
                environment: this.environmentOf(state),
                state: this.connectionOf(),
                providerStatus: this.state(),
                lastHeartbeatAt: this.heartbeat(state) || null,
                lastSyncAt: this.clock(),
                brokerName: state.brokerName,
                serverName: state.serverName,
                externalAccountId: state.externalAccountId,
                error: null,
            },
        };
    }

    async getAccount(userId: string, accountId: string): Promise<TradingResult<TradingAccount>> {
        const owned = this.requireAccount(userId, accountId);
        if (!owned.ok) return owned;
        const state = owned.value;
        const floating = [...this.positions.values()].reduce((sum, p) => sum + (p.profit ?? 0), 0);
        return {
            ok: true,
            value: {
                id: accountId,
                userId,
                provider: MOCK_PROVIDER,
                environment: this.environmentOf(state),
                externalAccountId: state.externalAccountId,
                brokerName: state.brokerName,
                serverName: state.serverName,
                currency: state.currency,
                leverage: state.leverage,
                connection: this.connectionOf(),
                providerStatus: this.state(),
                metrics: {
                    balance: state.balance,
                    equity: state.equity + floating,
                    margin: state.margin,
                    freeMargin: state.freeMargin,
                    marginLevel: state.marginLevel,
                    floatingPnl: floating,
                    positionsCount: [...this.positions.values()].filter(
                        (p) => p.accountId === accountId
                    ).length,
                    ordersCount: [...this.orders.values()].filter(
                        (o) => o.accountId === accountId
                    ).length,
                    currency: state.currency,
                    updatedAt: this.heartbeat(state) || null,
                },
                connectedAt: state.connectedAt,
                lastHeartbeatAt: this.heartbeat(state) || null,
                lastSyncAt: this.clock(),
                connectionError: null,
                gatewayVersion: state.gatewayVersion,
            },
        };
    }

    async getPositions(userId: string, accountId: string): Promise<TradingResult<TradingPosition[]>> {
        const owned = this.requireAccount(userId, accountId);
        if (!owned.ok) return owned;
        return { ok: true, value: [...this.positions.values()].filter((p) => p.accountId === accountId) };
    }

    async getOrders(userId: string, accountId: string): Promise<TradingResult<TradingOrder[]>> {
        const owned = this.requireAccount(userId, accountId);
        if (!owned.ok) return owned;
        return { ok: true, value: [...this.orders.values()].filter((o) => o.accountId === accountId) };
    }

    async getDeals(userId: string, accountId: string, since = 0): Promise<TradingResult<TradingDeal[]>> {
        const owned = this.requireAccount(userId, accountId);
        if (!owned.ok) return owned;
        return {
            ok: true,
            value: [...this.deals.values()].filter(
                (d) => d.accountId === accountId && d.timestamp >= since
            ),
        };
    }

    async getHistory(
        userId: string,
        accountId: string,
        since = 0
    ): Promise<TradingResult<TradingHistory>> {
        const owned = this.requireAccount(userId, accountId);
        if (!owned.ok) return owned;
        return {
            ok: true,
            value: {
                deals: [...this.deals.values()].filter(
                    (d) => d.accountId === accountId && d.timestamp >= since
                ),
                orders: [...this.orders.values()].filter((o) => o.accountId === accountId),
                truncated: false,
            },
        };
    }

    async getSymbols(userId: string, accountId: string): Promise<TradingResult<TradingSymbol[]>> {
        const owned = this.requireAccount(userId, accountId);
        if (!owned.ok) return owned;
        return {
            ok: true,
            value: [...this.specs.entries()].map(([symbol, spec]) => ({
                symbol,
                provider: MOCK_PROVIDER,
                description: spec.description,
                digits: spec.digits,
                minVolume: spec.minVolume,
                maxVolume: spec.maxVolume,
                volumeStep: spec.volumeStep,
                tradeMode: "FULL",
            })),
        };
    }

    async getQuote(
        userId: string,
        accountId: string,
        symbol: string
    ): Promise<TradingResult<TradingQuote>> {
        const owned = this.requireAccount(userId, accountId);
        if (!owned.ok) return owned;
        const key = symbol.toUpperCase();
        const spec = this.specs.get(key);
        if (!spec) return { ok: false, error: tradingError("INVALID_SYMBOL", `Unknown symbol ${key}.`) };
        const base = [...this.positions.values()].find((p) => p.symbol === key)?.entryPrice ?? 1.1;
        return { ok: true, value: this.quoteFor(key, base) };
    }

    async getQuotes(
        userId: string,
        accountId: string,
        symbols: string[]
    ): Promise<TradingResult<TradingQuote[]>> {
        const results: TradingQuote[] = [];
        for (const symbol of symbols) {
            const quote = await this.getQuote(userId, accountId, symbol);
            if (!quote.ok) return quote;
            results.push(quote.value);
        }
        return { ok: true, value: results };
    }

    async getCandles(
        userId: string,
        accountId: string,
        symbol: string,
        timeframe: string
    ): Promise<TradingResult<TradingCandle[]>> {
        const owned = this.requireAccount(userId, accountId);
        if (!owned.ok) return owned;
        const key = symbol.toUpperCase();
        if (!this.specs.has(key)) {
            return { ok: false, error: tradingError("INVALID_SYMBOL", `Unknown symbol ${key}.`) };
        }
        const now = this.clock();
        const candles: TradingCandle[] = [];
        for (let i = 4; i >= 0; i -= 1) {
            const close = Number((1.1 + i * 0.0001).toFixed(5));
            candles.push({
                symbol: key,
                provider: MOCK_PROVIDER,
                timeframe,
                timestamp: now - i * 60_000,
                open: close - 0.00005,
                high: close + 0.0001,
                low: close - 0.0001,
                close,
                volume: 100 + i,
            });
        }
        return { ok: true, value: candles };
    }

    // ── execution ────────────────────────────────────────────────────────────

    async execute(input: AdapterExecutionInput): Promise<TradingResult<TradingExecutionResult>> {
        this.executeCount += 1;
        const request = input.request;
        const base: MockExecutionBase = {
            clientRequestId: request.clientRequestId,
            correlationId: request.correlationId,
            accountId: request.accountId,
            provider: this.provider,
            environment: request.environment,
            executionType: request.executionType,
            createdAt: this.clock(),
            symbol: request.symbol,
            side: request.side,
            volume: input.volume ?? request.volume ?? null,
            kind: request.kind,
            price: request.price,
            stopLoss: request.stopLoss,
            takeProfit: request.takeProfit,
        };
        const fail = (error: TradingError): TradingResult<TradingExecutionResult> => ({
            ok: true,
            value: toResult(base, { status: "REJECTED", error }, this.clock()),
        });

        if (this.connectionOverride === "OFFLINE") {
            return fail(tradingError("PROVIDER_UNAVAILABLE", "Mock provider is offline."));
        }
        if (this.connectionOverride === "STALE" || this.heartbeatAgeMs > 120_000) {
            return fail(tradingError("PROVIDER_STALE", "Mock provider heartbeat is stale."));
        }
        const owned = this.requireAccount(request.userId, request.accountId);
        if (!owned.ok) return fail(owned.error);
        if (this.failNextExecutionWith) {
            const injected = this.failNextExecutionWith;
            this.failNextExecutionWith = null;
            return fail(injected);
        }

        switch (request.executionType) {
            case "PLACE_ORDER":
                return this.placeOrder(base);
            case "MODIFY_POSITION":
                return this.modifyPosition(base, input.position?.id ?? null, request);
            case "CLOSE_POSITION":
                return this.closePosition(base, input.position?.id ?? null, null);
            case "PARTIAL_CLOSE":
                return this.closePosition(base, input.position?.id ?? null, request.percentage ?? null);
            case "CANCEL_ORDER":
                return this.cancelOrder(base, input.order?.id ?? null);
            default:
                return fail(
                    tradingError(
                        "UNSUPPORTED_OPERATION",
                        `Unsupported execution ${String(request.executionType)}.`
                    )
                );
        }
    }

    private placeOrder(base: MockExecutionBase): TradingResult<TradingExecutionResult> {
        const symbol = (base.symbol ?? "").toUpperCase();
        const spec = this.specs.get(symbol);
        if (!spec) {
            return { ok: true, value: toResult(base, { status: "REJECTED", error: tradingError("INVALID_SYMBOL", `Unknown symbol ${symbol}.`) }, this.clock()) };
        }
        const volume = base.volume ?? 0;
        if (!Number.isFinite(volume) || volume <= 0) {
            return {
                ok: true,
                value: toResult(
                    base,
                    { status: "REJECTED", error: tradingError("INVALID_VOLUME", "Volume must be greater than 0.") },
                    this.clock()
                ),
            };
        }
        if (volume < spec.minVolume - 1e-9) {
            return {
                ok: true,
                value: toResult(
                    base,
                    {
                        status: "REJECTED",
                        error: tradingError("INVALID_VOLUME", `Minimum volume is ${spec.minVolume}.`),
                    },
                    this.clock()
                ),
            };
        }
        const side = base.side ?? "BUY";
        const kind = base.kind ?? "MARKET";
        const now = this.clock();
        const ticket = this.nextId("MOCK-POS");
        const entry = kind === "MARKET" ? 1.1 : base.price ?? 1.1;

        const position: TradingPosition = {
            id: ticket,
            accountId: base.accountId,
            provider: MOCK_PROVIDER,
            symbol,
            side,
            volume,
            entryPrice: entry,
            currentPrice: entry,
            stopLoss: base.stopLoss ?? null,
            takeProfit: base.takeProfit ?? null,
            profit: 0,
            swap: 0,
            commission: 0,
            openedAt: now,
            magicNumber: 0,
            comment: "mock",
            providerRef: ticket,
        };
        // A pending order is NOT a position: only a filled market entry creates
        // one. Creating it here would fake open exposure.
        if (kind === "MARKET") this.positions.set(ticket, position);

        const order: TradingOrder = {
            id: ticket,
            accountId: base.accountId,
            provider: MOCK_PROVIDER,
            symbol,
            kind,
            side,
            volume,
            price: entry,
            stopLoss: base.stopLoss ?? null,
            takeProfit: base.takeProfit ?? null,
            state: kind === "MARKET" ? "FILLED" : "PENDING",
            createdAt: now,
            filledAt: kind === "MARKET" ? now : null,
            magicNumber: 0,
            comment: "mock",
            providerRef: ticket,
        };
        this.orders.set(ticket, order);

        if (kind === "MARKET") {
            const dealId = this.nextId("MOCK-DEAL");
            this.deals.set(dealId, {
                id: dealId,
                accountId: base.accountId,
                provider: MOCK_PROVIDER,
                symbol,
                orderId: ticket,
                side,
                volume,
                price: entry,
                profit: 0,
                commission: 0,
                swap: 0,
                timestamp: now,
                comment: "mock",
            });
        }

        return {
            ok: true,
            value: toResult(
                base,
                {
                    status: "SUCCEEDED",
                    providerRef: ticket,
                    filledVolume: volume,
                    filledPrice: entry,
                    order,
                    position: kind === "MARKET" ? position : null,
                },
                now
            ),
        };
    }

    private modifyPosition(
        base: MockExecutionBase,
        positionId: string | null,
        request: {
            position?: TradingPosition | null;
            stopLoss?: number | null;
            takeProfit?: number | null;
        }
    ): TradingResult<TradingExecutionResult> {
        const id = positionId ?? request.position?.id ?? null;
        const position = id ? this.positions.get(id) : null;
        if (!position) {
            return {
                ok: true,
                value: toResult(
                    base,
                    {
                        status: "REJECTED",
                        error: tradingError("ACCOUNT_NOT_FOUND", "Position not found on this provider."),
                    },
                    this.clock()
                ),
            };
        }
        const updated: TradingPosition = {
            ...position,
            stopLoss: request.stopLoss === undefined ? position.stopLoss : request.stopLoss,
            takeProfit: request.takeProfit === undefined ? position.takeProfit : request.takeProfit,
        };
        this.positions.set(position.id, updated);
        return {
            ok: true,
            value: toResult(
                base,
                { status: "SUCCEEDED", providerRef: updated.id, position: updated },
                this.clock()
            ),
        };
    }

    /**
     * Full or partial close.
     *
     * The partial branch closes a VOLUME. Realized profit is the P/L that the
     * closed volume earned; the remainder keeps its own floating P/L. No
     * synthetic negative trade is ever produced.
     */
    private closePosition(
        base: MockExecutionBase,
        positionId: string | null,
        percentage: number | null
    ): TradingResult<TradingExecutionResult> {
        const position = positionId ? this.positions.get(positionId) : null;
        if (!position) {
            return {
                ok: true,
                value: toResult(
                    base,
                    {
                        status: "REJECTED",
                        error: tradingError("ACCOUNT_NOT_FOUND", "Position not found on this provider."),
                    },
                    this.clock()
                ),
            };
        }
        const now = this.clock();
        const exitPrice = position.currentPrice ?? position.entryPrice;

        if (percentage === null) {
            const realized = position.profit ?? 0;
            const dealId = this.nextId("MOCK-DEAL");
            this.deals.set(dealId, {
                id: dealId,
                accountId: position.accountId,
                provider: MOCK_PROVIDER,
                symbol: position.symbol,
                orderId: position.id,
                side: position.side === "BUY" ? "SELL" : "BUY",
                volume: position.volume,
                price: exitPrice,
                profit: realized,
                commission: position.commission ?? 0,
                swap: position.swap ?? 0,
                timestamp: now,
                comment: "mock close",
            });
            this.positions.delete(position.id);
            this.applyBalance(position.accountId, realized);
            return {
                ok: true,
                value: toResult(
                    base,
                    {
                        status: "SUCCEEDED",
                        providerRef: position.id,
                        filledVolume: position.volume,
                        filledPrice: exitPrice,
                    },
                    now
                ),
            };
        }

        const spec = this.specs.get(position.symbol);
        let plan;
        try {
            plan = planPartialClose({
                openVolume: position.volume,
                percentage,
                spec: spec
                    ? {
                          symbol: position.symbol,
                          minVolume: spec.minVolume,
                          maxVolume: spec.maxVolume,
                          volumeStep: spec.volumeStep,
                          digits: spec.digits,
                      }
                    : null,
            });
        } catch (error) {
            return {
                ok: true,
                value: toResult(
                    base,
                    {
                        status: "REJECTED",
                        error: tradingError(
                            "INVALID_VOLUME",
                            error instanceof Error ? error.message : "Invalid partial close."
                        ),
                    },
                    now
                ),
            };
        }

        // Realized = the closed slice's share of the floating P/L. The
        // remainder keeps its own share; nothing is invented or negated.
        const openProfit = position.profit ?? 0;
        const realized = (openProfit * plan.closeVolume) / position.volume;

        const dealId = this.nextId("MOCK-DEAL");
        this.deals.set(dealId, {
            id: dealId,
            accountId: position.accountId,
            provider: MOCK_PROVIDER,
            symbol: position.symbol,
            orderId: position.id,
            side: position.side === "BUY" ? "SELL" : "BUY",
            volume: plan.closeVolume,
            price: exitPrice,
            profit: realized,
            commission: 0,
            swap: 0,
            timestamp: now,
            comment: `mock partial close ${plan.appliedPercentage}%`,
        });
        this.applyBalance(position.accountId, realized);

        const remaining: TradingPosition = {
            ...position,
            volume: plan.remainingVolume,
            profit: openProfit - realized,
        };
        if (plan.remainingVolume <= 0) this.positions.delete(position.id);
        else this.positions.set(remaining.id, remaining);

        return {
            ok: true,
            value: toResult(
                base,
                {
                    status: "SUCCEEDED",
                    providerRef: position.id,
                    filledVolume: plan.closeVolume,
                    filledPrice: exitPrice,
                    position: plan.remainingVolume > 0 ? remaining : null,
                },
                now
            ),
        };
    }

    private cancelOrder(
        base: MockExecutionBase,
        orderId: string | null
    ): TradingResult<TradingExecutionResult> {
        const order = orderId ? this.orders.get(orderId) : null;
        if (!order) {
            return {
                ok: true,
                value: toResult(
                    base,
                    {
                        status: "REJECTED",
                        error: tradingError("ACCOUNT_NOT_FOUND", "Order not found on this provider."),
                    },
                    this.clock()
                ),
            };
        }
        const cancelled: TradingOrder = { ...order, state: "CANCELLED" };
        this.orders.set(order.id, cancelled);
        return {
            ok: true,
            value: toResult(
                base,
                { status: "SUCCEEDED", providerRef: order.id, order: cancelled },
                this.clock()
            ),
        };
    }

    private applyBalance(accountId: string, realized: number): void {
        const state = this.accounts.get(accountId);
        if (!state) return;
        state.balance = Number((state.balance + realized).toFixed(2));
        state.equity = state.balance;
        state.freeMargin = Number((state.balance - state.margin).toFixed(2));
    }

    /** Test helper: seed an open position with an explicit floating P/L. */
    seedPosition(
        position: Omit<TradingPosition, "id" | "provider" | "accountId" | "providerRef"> & {
            accountId: string;
            id?: string;
        }
    ): TradingPosition {
        const id = position.id ?? this.nextId("MOCK-POS");
        const created: TradingPosition = { ...position, id, provider: MOCK_PROVIDER, providerRef: id };
        this.positions.set(id, created);
        if (!this.accounts.has(created.accountId)) this.seedAccount(created.accountId, "DEMO", 10_000);
        return created;
    }

    /** Test helper: force the next execution to fail with a normalized error. */
    failNext(error: TradingError): void {
        this.failNextExecutionWith = error;
    }

    dealList(): TradingDeal[] {
        return [...this.deals.values()];
    }
}

export type { TradingOrderState };