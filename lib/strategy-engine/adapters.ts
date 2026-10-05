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
        return roundPrice(price, this.spec.digits);
    }

    /**
     * A MARKET entry plans from the raw bar open/close (no rounding).
     * Side-independent on OHLC data: the spread is charged as a cash cost via
     * leg costs instead of shifting the planning price (documented simulation).
     */
    entryPrice(side: OrderSide): number | null {
        void side;
        if (!this.bar) return null;
        return this.executionModel === "next_bar_open" ? this.bar.open : this.bar.close;
    }

    /** Positions close at the bar close (mid); spread is charged as cash cost. */
    exitPrice(side: OrderSide): number | null {
        void side;
        return this.bar ? this.bar.close : null;
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

        if (!Number.isFinite(intent.quantity) || intent.quantity <= 0) {
            return this.reject(order, now, "Invalid quantity");
        }
        if ((intent.type === "LIMIT" || intent.type === "STOP") && (!intent.price || intent.price <= 0)) {
            return this.reject(order, now, `${intent.type} order requires a price`);
        }
        if (intent.type === "MARKET") {
            if (!this.bar) return this.reject(order, now, "No market data");
            // Manual orders execute at the CURRENT bar's close ("act now");
            // strategy entries follow the configured execution model.
            const price = intent.source === "manual"
                ? roundPrice(this.bar.close, this.spec.digits)
                : this.marketFillPrice(intent.side, this.bar);
            return this.fill(order, price, intent.quantity, this.bar.timestamp);
        }

        const submitted = transitionOrder(order, "SUBMITTED", now);
        const parked = transitionOrder(submitted.order, "OPEN", now);
        this.working.push({ ...parked.order, price: intent.price });
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
        return reports;
    }

    cancel(orderId: string): boolean {
        const idx = this.working.findIndex((o) => o.id === orderId);
        if (idx === -1) return false;
        const now = this.now();
        const next = transitionOrder(this.working[idx], "CANCELLED", now);
        if (next.error) return false;
        this.working.splice(idx, 1);
        return true;
    }

    workingOrders(): Order[] {
        return [...this.working];
    }

    protected marketFillPrice(side: OrderSide, bar: MarketCandle): number {
        const raw = this.executionModel === "next_bar_open" ? bar.open : bar.close;
        return roundPrice(raw, this.spec.digits);
    }

    protected fill(order: Order, price: number, quantity: number, timestamp: number): ExecutionReport {
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
            slippageCost: costs.slippage,
            spreadCost: costs.spread,
            // OHLC simulation: record which side of the (simulated) quote was
            // taken, or that the fill happened at the bar open.
            liquidity: this.executionModel === "next_bar_open" ? "open" : order.side === "BUY" ? "ask" : "bid",
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
    private readonly maxQuoteAgeMs: number;
    private readonly maxSpread: number;
    private readonly wallClock: () => number;

    constructor(options: PaperAdapterOptions & { wallClock?: () => number }) {
        super(options);
        this.maxQuoteAgeMs = options.maxQuoteAgeMs ?? 15_000;
        this.maxSpread = options.maxSpread ?? Number.POSITIVE_INFINITY;
        this.wallClock = options.wallClock ?? (() => Date.now());
    }

    /** Feed a real market quote (bid/ask) from the live data source. */
    setQuote(quote: PendingQuote): void {
        this.quote = quote;
    }

    quoteAgeMs(): number | null {
        if (!this.quote) return null;
        return Math.max(0, this.wallClock() - this.quote.timestamp);
    }

    isStale(): boolean {
        const age = this.quoteAgeMs();
        return age === null || age > this.maxQuoteAgeMs;
    }

    override marketPrice(side: OrderSide): number | null {
        if (!this.quote) return null;
        return side === "BUY" ? this.quote.ask : this.quote.bid;
    }

    override entryPrice(side?: OrderSide): number | null {
        if (this.isStale()) return null;
        return this.marketPrice(side ?? "BUY");
    }

    override exitPrice(side?: OrderSide): number | null {
        if (this.isStale()) return null;
        return this.marketPrice(side ?? "BUY");
    }

    override submit(intent: OrderIntent): ExecutionReport {
        const now = intent.submittedAt ?? this.wallClock();
        const order = createOrder(this.symbol, intent, now);

        if (this.isStale()) {
            return this.reject(order, now, "Stale market data — paper trading fails closed");
        }
        const quote = this.quote as PendingQuote;
        if (!Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) || quote.bid <= 0 || quote.ask <= 0) {
            return this.reject(order, now, "Invalid quote");
        }
        const spread = quote.ask - quote.bid;
        if (spread > this.maxSpread) {
            return this.reject(order, now, "Abnormal spread guard");
        }
        if (intent.type === "MARKET") {
            const price = roundPrice(intent.side === "BUY" ? quote.ask : quote.bid, this.spec.digits);
            return this.fill(order, price, intent.quantity, quote.timestamp);
        }
        return super.submit(intent);
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

    submit(intent: OrderIntent): ExecutionReport {
        const now = intent.submittedAt ?? this.now();
        const order = createOrder(this.symbol, intent, now);
        if (!this.gateway.isHealthy()) {
            const rejected = transitionOrder(
                transitionOrder(order, "SUBMITTED", now).order,
                "REJECTED",
                now,
                { rejectReason: "Live gateway unhealthy — failing closed" }
            );
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
            return { order: filled.order, filled: filled.order.status === "FILLED", fills: filled.order.fills };
        }
        const open = transitionOrder(submitted.order, "OPEN", now);
        return { order: open.order, filled: false, fills: [], message: "Accepted by gateway" };
    }

    cancel(orderId: string): boolean {
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
