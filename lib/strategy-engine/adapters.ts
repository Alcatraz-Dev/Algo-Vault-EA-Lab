/**
 * Execution adapters (Phase 4) — the ONLY place environment differences live.
 *
 *   Strategy Engine → OrderIntent → ExecutionAdapter → Order/Position
 *
 *   • SimulationAdapter — deterministic fills against OHLC bars. Used by BOTH
 *     backtest and replay (identical fill semantics: replay must not fake
 *     different execution than the backtest it reproduces).
 *   • PaperAdapter — real market quotes + virtual capital + realistic guards.
 *   • LiveAdapter — fails CLOSED: without fresh data/account connectivity it
 *     rejects every order.
 *
 * The strategy itself never contains `if paper / if live / if backtest`.
 */

import { legCosts, restingOrderFillPrice, roundPrice, simSymbolSpec, type SimSymbolSpec } from "./simulation";
import { applyFill, canTransition, createOrder, transitionOrder } from "./orders";
import type {
    ExecutionAdapter,
    ExecutionReport,
    Order,
    OrderIntent,
    OrderSide,
} from "./types";
import type { ExecutionModel } from "@/lib/strategy-lab/types";
import type { MarketCandle } from "@/lib/market-data/types";
import { isLiveTradingEnabled } from "@/lib/trading/feature-flags";

export interface SimulationAdapterOptions {
    symbol: string;
    executionModel: ExecutionModel;
    environment: "backtest" | "replay" | "paper" | "live" | "chart";
    spreadPips?: number;
    slippagePips?: number;
    commissionPerLot?: number;
    spec?: SimSymbolSpec;
    /** Engine clock (bar timestamps in simulation). */
    now?: () => number;
    gapAware?: boolean;
}

export interface PendingQuote {
    bid: number;
    ask: number;
    timestamp: number;
}

export class SimulationAdapter implements ExecutionAdapter {
    readonly environment: SimulationAdapterOptions["environment"];
    readonly symbol: string;
    readonly spec: SimSymbolSpec;
    protected readonly executionModel: ExecutionModel;
    protected readonly spreadPips: number;
    protected readonly slippagePips: number;
    protected readonly commissionPerLot: number;
    protected readonly gapAware: boolean;
    protected readonly clock: () => number;

    protected bar: MarketCandle | null = null;
    protected working: Order[] = [];
    protected readonly ordersSubmitted = new Set<string>();
    protected readonly orders = new Map<string, Order>();
    protected seq = 0;

    constructor(options: SimulationAdapterOptions) {
        this.environment = options.environment;
        this.symbol = options.symbol;
        this.executionModel = options.executionModel;
        this.spec = options.spec ?? simSymbolSpec(options.symbol);
        this.spreadPips = options.spreadPips ?? 0;
        this.slippagePips = options.slippagePips ?? 0;
        this.commissionPerLot = options.commissionPerLot ?? 0;
        this.gapAware = options.gapAware ?? true;
        this.clock = options.now ?? (() => this.bar?.timestamp ?? 0);
    }

    now(): number {
        return this.clock();
    }

    /** Drivers push every bar here before processing it. */
    setBar(bar: MarketCandle): void {
        this.bar = bar;
    }

    currentBar(): MarketCandle | null {
        return this.bar;
    }

    /**
     * Bid/ask simulation on OHLC data: the candle price is the mid; the quote
     * is widened by the configured spread (documented simulation).
     */
    marketPrice(side: OrderSide): number | null {
        if (!this.bar) return null;
        const mid = this.bar.close;
        const halfSpread = (this.spreadPips * this.spec.pipSize) / 2;
        const price = side === "BUY" ? mid + halfSpread : mid - halfSpread;
        return roundPrice(price, this.spec.digits, this.spec.tickSize);
    }

    /**
     * OHLC-only market entry plans at the bar mid. The full quoted spread is
     * allocated as half-spread cash cost on entry and exit (no double count).
     */
    entryPrice(side: OrderSide): number | null {
        void side;
        if (!this.bar) return null;
        const raw = this.executionModel === "next_bar_open" ? this.bar.open : this.bar.close;
        return roundPrice(raw, this.spec.digits, this.spec.tickSize);
    }

    /** Positions close at the bar close (mid); half the full spread is cash cost. */
    exitPrice(side: OrderSide): number | null {
        void side;
        return this.bar ? this.bar.close : null;
    }

    canExecute(side: OrderSide, now?: number): boolean {
        return this.bar !== null && !!side && (now === undefined || Number.isFinite(now));
    }

    positionOpenCosts(): { spreadPips: number; commissionPerLot: number; slippagePips: number } {
        return { spreadPips: this.spreadPips, commissionPerLot: this.commissionPerLot, slippagePips: this.slippagePips };
    }

    positionCloseCosts(): { spreadPips: number; commissionPerLot: number; slippagePips: number } {
        return { spreadPips: this.spreadPips, commissionPerLot: this.commissionPerLot, slippagePips: this.slippagePips };
    }

    /**
     * Submit an intent.
     *  • MARKET → fills immediately against the current bar
     *    (next_bar_open fills at the bar open, same_bar_close at its close).
     *  • LIMIT / STOP → parks as a working order, filled by `onBar`.
     */
    submit(intent: OrderIntent): ExecutionReport {
        const now = intent.submittedAt ?? this.now();
        const order = createOrder(this.symbol, intent, now);

        if (intent.clientOrderId && this.hasOrderId(intent.clientOrderId)) {
            return this.reject(order, now, "Duplicate client order id");
        }
        if (!Number.isFinite(intent.quantity) || intent.quantity <= 0) {
            return this.reject(order, now, "Invalid quantity");
        }
        if (intent.type === "STOP_LIMIT") {
            return this.reject(order, now, "STOP_LIMIT orders are not supported by this execution adapter");
        }
        if ((intent.type === "LIMIT" || intent.type === "STOP") && (!intent.price || intent.price <= 0)) {
            return this.reject(order, now, `${intent.type} order requires a price`);
        }
        if (intent.type === "MARKET") {
            if (!this.bar) return this.reject(order, now, "No market data");
            // Manual orders execute at the CURRENT bar's close ("act now");
            // strategy entries follow the configured execution model.
            const price = intent.source === "manual"
                ? roundPrice(this.bar.close, this.spec.digits, this.spec.tickSize)
                : this.marketFillPrice(intent.side, this.bar);
            const report = this.fill(order, price, intent.quantity, this.bar.timestamp);
            if (intent.clientOrderId) this.ordersSubmitted.add(intent.clientOrderId);
            this.rememberOrder(report.order);
            return report;
        }

        const submitted = transitionOrder(order, "SUBMITTED", now);
        const parked = transitionOrder(submitted.order, "OPEN", now);
        this.working.push({ ...parked.order, price: intent.price });
        if (intent.clientOrderId) this.ordersSubmitted.add(intent.clientOrderId);
        this.rememberOrder(parked.order);
        return { order: parked.order, filled: false, fills: [], message: "Working order parked" };
    }

    /** Evaluate parked LIMIT/STOP orders against the bar. */
    onBar(bar: MarketCandle): ExecutionReport[] {
        this.bar = bar;
        const reports: ExecutionReport[] = [];
        const remaining: Order[] = [];

        for (const order of this.working) {
            if (!order.price) continue;
            const fillPrice = restingOrderFillPrice(
                order.side,
                order.type as "LIMIT" | "STOP",
                order.price,
                bar,
                this.spec
            );
            if (fillPrice === null) {
                remaining.push(order);
                continue;
            }
            reports.push(this.fill(order, fillPrice, order.quantity - order.filledQuantity, bar.timestamp));
        }
        this.working = remaining;
        for (const report of reports) this.rememberOrder(report.order);
        return reports;
    }

    cancel(orderId: string): boolean {
        const idx = this.working.findIndex((o) => o.id === orderId || o.clientOrderId === orderId);
        if (idx === -1) return false;
        const now = this.now();
        const next = transitionOrder(this.working[idx], "CANCELLED", now);
        if (next.error) return false;
        this.working.splice(idx, 1);
        this.rememberOrder(next.order);
        return true;
    }

    modify(orderId: string, patch: Partial<Pick<Order, "price" | "quantity" | "stopLoss" | "takeProfit">>): Order | null {
        const idx = this.working.findIndex((o) => o.id === orderId || o.clientOrderId === orderId);
        if (idx < 0) return null;
        const current = this.working[idx];
        const nextQuantity = patch.quantity ?? current.quantity;
        if (!Number.isFinite(nextQuantity) || nextQuantity <= 0 || nextQuantity < current.filledQuantity) return null;
        if (patch.price !== undefined && (!Number.isFinite(patch.price) || patch.price <= 0)) return null;
        if (patch.stopLoss !== undefined && patch.stopLoss !== null && (!Number.isFinite(patch.stopLoss) || patch.stopLoss <= 0)) return null;
        if (patch.takeProfit !== undefined && patch.takeProfit !== null && (!Number.isFinite(patch.takeProfit) || patch.takeProfit <= 0)) return null;
        const updated: Order = {
            ...current,
            ...patch,
            updatedAt: this.now(),
        };
        this.working[idx] = updated;
        this.rememberOrder(updated);
        return updated;
    }

    getOrder(orderId: string): Order | null {
        return this.orders.get(orderId) ?? this.working.find((item) => item.id === orderId || item.clientOrderId === orderId) ?? null;
    }

    hasOrderId(orderId: string): boolean {
        return this.ordersSubmitted.has(orderId) || this.orders.has(orderId) || this.working.some((item) => item.id === orderId || item.clientOrderId === orderId);
    }

    workingOrders(): Order[] {
        return [...this.working];
    }

    protected rememberOrder(order: Order): void {
        this.orders.set(order.id, order);
        if (order.clientOrderId) this.orders.set(order.clientOrderId, order);
    }

    protected marketFillPrice(side: OrderSide, bar: MarketCandle): number {
        void side;
        const raw = this.executionModel === "next_bar_open" ? bar.open : bar.close;
        return roundPrice(raw, this.spec.digits, this.spec.tickSize);
    }

    protected fill(
        order: Order,
        price: number,
        quantity: number,
        timestamp: number,
        liquidityOverride?: "none"
    ): ExecutionReport {
        const costs = legCosts(quantity, this.spec, {
            spreadPips: this.spreadPips,
            slippagePips: this.slippagePips,
            commissionPerLot: this.commissionPerLot,
        });
        const result = applyFill(order, {
            price,
            quantity: Math.min(quantity, order.quantity - order.filledQuantity),
            timestamp,
            commission: 0, // commission + spread + slippage are charged on position close
            slippageCost: liquidityOverride === "none" ? 0 : costs.slippage,
            spreadCost: liquidityOverride === "none" ? 0 : costs.spread,
            // OHLC simulation: record which side of the (simulated) quote was
            // taken, or that the fill happened at the bar open.
            liquidity: liquidityOverride === "none" ? "close" : this.executionModel === "next_bar_open" ? "open" : order.side === "BUY" ? "ask" : "bid",
        });
        if (!result.changed) {
            return { order: result.order, filled: false, fills: [], message: result.error };
        }
        return { order: result.order, filled: result.order.status === "FILLED", fills: result.order.fills };
    }

    protected reject(order: Order, now: number, reason: string): ExecutionReport {
        const submitted = canTransition(order.status, "SUBMITTED")
            ? transitionOrder(order, "SUBMITTED", now)
            : { order, changed: true, error: undefined };
        const rejected = transitionOrder(submitted.order, "REJECTED", now, { rejectReason: reason });
        return { order: rejected.order, filled: false, fills: [], message: reason };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paper adapter — real quotes, virtual capital, fail-closed guards
// ─────────────────────────────────────────────────────────────────────────────

export interface PaperAdapterOptions extends SimulationAdapterOptions {
    /** Quotes older than this are STALE → orders are rejected (fail closed). */
    maxQuoteAgeMs?: number;
    /** Spread wider than this blocks new entries (abnormal spread guard). */
    maxSpread?: number;
}

export class PaperAdapter extends SimulationAdapter {
    private quote: PendingQuote | null = null;
    private readonly quoteAgeLimitMs: number;
    private readonly spreadLimit: number;
    private readonly wallClock: () => number;

    constructor(options: PaperAdapterOptions & { wallClock?: () => number }) {
        super(options);
        this.quoteAgeLimitMs = options.maxQuoteAgeMs ?? 15_000;
        this.spreadLimit = options.maxSpread ?? Number.POSITIVE_INFINITY;
        this.wallClock = options.wallClock ?? (() => Date.now());
    }

    /** Feed a real market quote (bid/ask) from the live data source. */
    setQuote(quote: PendingQuote): void {
        this.quote = quote;
    }

    override now(): number {
        return this.wallClock();
    }

    getQuoteAgeLimitMs(): number {
        return this.quoteAgeLimitMs;
    }

    getSpreadLimit(): number {
        return this.spreadLimit;
    }

    quoteAgeMs(): number | null {
        if (!this.quote) return null;
        return Math.max(0, this.wallClock() - this.quote.timestamp);
    }

    isStale(): boolean {
        const age = this.quoteAgeMs();
        return age === null || age > this.quoteAgeLimitMs;
    }

    override marketPrice(side: OrderSide): number | null {
        if (!this.quote || this.isStale()) return null;
        return side === "BUY" ? this.quote.ask : this.quote.bid;
    }

    override entryPrice(side: OrderSide): number | null {
        return this.canExecute(side) ? this.marketPrice(side) : null;
    }

    override exitPrice(side: OrderSide): number | null {
        return this.canExecute(side) ? this.marketPrice(side) : null;
    }

    override canExecute(side: OrderSide, now = this.wallClock()): boolean {
        if (!this.quote || this.isStale()) return false;
        const price = side === "BUY" ? this.quote.ask : this.quote.bid;
        return Number.isFinite(this.quote.bid) && Number.isFinite(this.quote.ask) &&
            this.quote.bid > 0 && this.quote.ask > 0 &&
            Number.isFinite(price) && price > 0 &&
            this.quote.ask >= this.quote.bid &&
            this.quote.ask - this.quote.bid <= this.spreadLimit &&
            now >= this.quote.timestamp && now - this.quote.timestamp <= this.quoteAgeLimitMs;
    }

    /** The real quote already embeds spread; do not charge synthetic spread again. */
    override positionOpenCosts(): { spreadPips: number; commissionPerLot: number; slippagePips: number } {
        return { spreadPips: 0, commissionPerLot: this.commissionPerLot, slippagePips: 0 };
    }

    override positionCloseCosts(): { spreadPips: number; commissionPerLot: number; slippagePips: number } {
        return { spreadPips: 0, commissionPerLot: this.commissionPerLot, slippagePips: 0 };
    }

    override submit(intent: OrderIntent): ExecutionReport {
        const now = intent.submittedAt ?? this.wallClock();
        const order = createOrder(this.symbol, intent, now);
        if (intent.clientOrderId && this.hasOrderId(intent.clientOrderId)) {
            return this.reject(order, now, "Duplicate client order id");
        }
        if (!Number.isFinite(intent.quantity) || intent.quantity <= 0) {
            return this.reject(order, now, "Invalid quantity");
        }
        if (intent.type === "STOP_LIMIT") {
            return this.reject(order, now, "STOP_LIMIT orders are not supported by this execution adapter");
        }
        if ((intent.type === "LIMIT" || intent.type === "STOP") && (!Number.isFinite(intent.price) || (intent.price ?? 0) <= 0)) {
            return this.reject(order, now, `${intent.type} order requires a valid price`);
        }
        // Intent timestamps are candle timestamps; freshness must use the
        // adapter's wall clock, which may be in a separate domain in replayed data.
        if (!this.quote || !this.canExecute(intent.side)) {
            return this.reject(order, now, this.isStale() ? "Stale market data — paper trading fails closed" : "Invalid quote or abnormal spread");
        }

        if (intent.type === "MARKET") {
            const price = roundPrice(intent.side === "BUY" ? this.quote.ask : this.quote.bid, this.spec.digits, this.spec.tickSize);
            const bracketError = this.invalidProtection(order, price);
            if (bracketError) return this.reject(order, now, bracketError);
            const report = this.fill(order, price, intent.quantity, this.quote.timestamp, "none");
            if (intent.clientOrderId) this.recordOrderId(intent.clientOrderId);
            this.rememberOrder(report.order);
            return report;
        }

        const submitted = transitionOrder(order, "SUBMITTED", now);
        const parked = transitionOrder(submitted.order, "OPEN", now);
        this.working.push({ ...parked.order, price: intent.price });
        if (intent.clientOrderId) this.recordOrderId(intent.clientOrderId);
        this.rememberOrder(parked.order);
        return { order: parked.order, filled: false, fills: [], message: "Working order parked" };
    }

    /** Remember a client order id so duplicate submissions are rejected idempotently. */
    protected recordOrderId(orderId: string): void {
        this.ordersSubmitted.add(orderId);
    }

    /** Resting paper orders trigger and fill only from a fresh real quote. */

    override onBar(bar: MarketCandle): ExecutionReport[] {
        this.setBar(bar);
        if (!this.quote || !this.canExecute("BUY")) return [];
        const reports: ExecutionReport[] = [];
        const remaining: Order[] = [];

        for (const order of this.working) {
            if (order.price === undefined) continue;
            const quotePrice = order.side === "BUY" ? this.quote.ask : this.quote.bid;
            const triggered = order.type === "LIMIT"
                ? (order.side === "BUY" ? quotePrice <= order.price : quotePrice >= order.price)
                : (order.side === "BUY" ? quotePrice >= order.price : quotePrice <= order.price);
            if (!triggered) {
                remaining.push(order);
                continue;
            }
            const price = roundPrice(quotePrice, this.spec.digits, this.spec.tickSize);
            const bracketError = this.invalidProtection(order, price);
            if (bracketError) {
                reports.push(this.reject(order, this.quote.timestamp, bracketError));
                continue;
            }
            reports.push(this.fill(order, price, order.quantity - order.filledQuantity, this.quote.timestamp, "none"));
        }
        this.working = remaining;
        for (const report of reports) this.rememberOrder(report.order);
        return reports;
    }

    private invalidProtection(order: Order, fillPrice: number): string | null {
        if (order.side === "BUY" && order.stopLoss !== undefined && order.stopLoss >= fillPrice) {
            return "Long stop loss must be below the executed fill price";
        }
        if (order.side === "BUY" && order.takeProfit !== undefined && order.takeProfit <= fillPrice) {
            return "Long take profit must be above the executed fill price";
        }
        if (order.side === "SELL" && order.stopLoss !== undefined && order.stopLoss <= fillPrice) {
            return "Short stop loss must be above the executed fill price";
        }
        if (order.side === "SELL" && order.takeProfit !== undefined && order.takeProfit >= fillPrice) {
            return "Short take profit must be below the executed fill price";
        }
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live adapter — fail closed
// ─────────────────────────────────────────────────────────────────────────────

export interface LiveGateway {
    /** Returns true only when the broker gateway is connected AND fresh. */
    isHealthy(): boolean;
    submit(order: Order): { accepted: boolean; reason?: string; filledPrice?: number };
}

/**
 * Live execution adapter. It NEVER guesses: without a healthy gateway and
 * fresh data every order is rejected (fail closed). Strategy code is unaware
 * of any of this — it just submits intents.
 */
export class LiveAdapter implements ExecutionAdapter {
    readonly environment = "live" as const;
    /** Client order ids acknowledged by the gateway, for idempotent rejection. */
    private readonly ordersSubmitted = new Set<string>();
    /** Last known gateway state per order id (and client order id). */
    private readonly orders = new Map<string, Order>();

    constructor(
        private readonly gateway: LiveGateway,
        private readonly symbol: string,
        private readonly clock: () => number = () => Date.now()
    ) {}

    now(): number {
        return this.clock();
    }

    marketPrice(): number | null {
        return null; // live prices come from the gateway feed, never fabricated
    }

    entryPrice(): number | null {
        return null; // live entries require the gateway feed — fail closed
    }

    exitPrice(): number | null {
        return null; // live exits route through protective orders — fail closed
    }

    canExecute(): boolean {
        return isLiveTradingEnabled() && this.gateway.isHealthy();
    }

    submit(intent: OrderIntent): ExecutionReport {
        const now = intent.submittedAt ?? this.now();
        const order = createOrder(this.symbol, intent, now);
        if (!isLiveTradingEnabled()) {
            const rejected = transitionOrder(transitionOrder(order, "SUBMITTED", now).order, "REJECTED", now, { rejectReason: "Live trading is disabled." });
            return { order: rejected.order, filled: false, fills: [], message: rejected.order.rejectReason };
        }
        if (!this.gateway.isHealthy()) {
            const rejected = transitionOrder(
                transitionOrder(order, "SUBMITTED", now).order,
                "REJECTED",
                now,
                { rejectReason: "Live gateway unhealthy — failing closed" }
            );
            return { order: rejected.order, filled: false, fills: [], message: rejected.order.rejectReason };
        }
        if (intent.clientOrderId && this.hasOrderId(intent.clientOrderId)) {
            const rejected = transitionOrder(transitionOrder(order, "SUBMITTED", now).order, "REJECTED", now, { rejectReason: "Duplicate client order id" });
            return { order: rejected.order, filled: false, fills: [], message: rejected.order.rejectReason };
        }
        if (intent.type === "STOP_LIMIT") {
            const rejected = transitionOrder(transitionOrder(order, "SUBMITTED", now).order, "REJECTED", now, { rejectReason: "STOP_LIMIT orders are unsupported." });
            return { order: rejected.order, filled: false, fills: [], message: rejected.order.rejectReason };
        }
        if (!Number.isFinite(intent.quantity) || intent.quantity <= 0) {
            const rejected = transitionOrder(transitionOrder(order, "SUBMITTED", now).order, "REJECTED", now, { rejectReason: "Invalid quantity" });
            return { order: rejected.order, filled: false, fills: [], message: rejected.order.rejectReason };
        }
        const submitted = transitionOrder(order, "SUBMITTED", now);
        const ack = this.gateway.submit(submitted.order);
        if (!ack.accepted) {
            const rejected = transitionOrder(submitted.order, "REJECTED", now, {
                rejectReason: ack.reason ?? "Rejected by gateway",
            });
            return { order: rejected.order, filled: false, fills: [], message: ack.reason };
        }
        if (ack.filledPrice && ack.filledPrice > 0) {
            const filled = applyFill(submitted.order, {
                price: ack.filledPrice,
                quantity: intent.quantity,
                timestamp: now,
                commission: 0,
                slippageCost: 0,
                spreadCost: 0,
                liquidity: intent.side === "BUY" ? "ask" : "bid",
            });
            if (intent.clientOrderId) this.ordersSubmitted.add(intent.clientOrderId);
            this.rememberOrder(filled.order);
            return { order: filled.order, filled: filled.order.status === "FILLED", fills: filled.order.fills };
        }
        const open = transitionOrder(submitted.order, "OPEN", now);
        if (intent.clientOrderId) this.ordersSubmitted.add(intent.clientOrderId);
        this.rememberOrder(open.order);
        return { order: open.order, filled: false, fills: [], message: "Accepted by gateway" };
    }

    getOrder(orderId: string): Order | null {
        return this.orders.get(orderId) ?? null;
    }

    hasOrderId(orderId: string): boolean {
        return this.ordersSubmitted.has(orderId) || this.orders.has(orderId);
    }

    private rememberOrder(order: Order): void {
        this.orders.set(order.id, order);
        if (order.clientOrderId) this.orders.set(order.clientOrderId, order);
    }

    cancel(orderId: string): boolean {
        if (!isLiveTradingEnabled()) return false;
        return this.gateway.submit({
            id: orderId,
            clientOrderId: orderId,
            symbol: this.symbol,
            side: "BUY",
            type: "MARKET",
            quantity: 0,
            status: "CANCELLED",
            filledQuantity: 0,
            avgFillPrice: 0,
            fills: [],
            reason: "cancel",
            source: "manual",
            createdAt: this.now(),
            updatedAt: this.now(),
        }).accepted;
    }
}
