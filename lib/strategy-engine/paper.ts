/**
 * Paper Trading (Phase 4).
 *
 *   REAL MARKET DATA + VIRTUAL CAPITAL + REALISTIC EXECUTION + REAL POSITIONS
 *
 * • Each paper account is ISOLATED — its own AccountState object, its own
 *   positions/orders/history. Paper balances are never mixed with live ones.
 * • The UI can always show `PAPER_TRADING_LABEL` — there is no code path in
 *   this module that can touch real money.
 * • Fail-closed guards: stale quotes, invalid quotes, abnormal spreads, kill
 *   switch and account halts all REJECT orders instead of guessing.
 * • Strategy decisions come from the same canonical engine as backtest/replay
 *   — only the fill environment (real quotes) differs.
 */

import type { MarketCandle, Timeframe } from "@/lib/market-data/types";
import type { Strategy } from "@/lib/strategy-lab/types";
import { PaperAdapter, type PendingQuote } from "./adapters";
import { createAccount, deposit as accountDeposit, withdraw as accountWithdraw, haltAccount, resumeAccount } from "./account";
import { createManualOnlyStrategy, StrategyEngine } from "./engine";
import { evaluateAccountHalt, riskLimitsFromStrategy } from "./risk";
import { simSymbolSpec, type ExecutionCostConfig, type SimPosition } from "./simulation";
import type {
    AccountState,
    DecisionTrace,
    Order,
    OrderIntent,
    Position,
    RiskLimits,
    RiskVerdict,
} from "./types";

/** Constant UI label — paper is always visually distinguishable from live. */
export const PAPER_TRADING_LABEL = "PAPER TRADING";

export interface PaperSessionOptions {
    accountId?: string;
    symbol: string;
    timeframe: Timeframe;
    initialBalance: number;
    strategy?: Strategy;
    costs?: ExecutionCostConfig;
    /** Quotes older than this are stale → orders are rejected. */
    maxQuoteAgeMs?: number;
    /** Abnormal spread guard (price units). */
    maxSpread?: number;
    riskLimits?: RiskLimits;
    debug?: boolean;
    wallClock?: () => number;
}

export interface PaperSessionStatus {
    mode: "paper";
    label: typeof PAPER_TRADING_LABEL;
    accountId: string;
    balance: number;
    equity: number;
    openPositions: number;
    halted: boolean;
    haltReason?: string;
    quoteStale: boolean;
    quoteAgeMs: number | null;
    killSwitch: boolean;
    strategyId: string | null;
}

export class PaperTradingSession {
    readonly mode = "paper" as const;
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly accountId: string;

    private readonly account: AccountState;
    private readonly adapter: PaperAdapter;
    private readonly engine: StrategyEngine;
    private readonly limits: RiskLimits;
    private killSwitch = false;
    private lastQuote: PendingQuote | null = null;

    constructor(options: PaperSessionOptions) {
        this.symbol = options.symbol;
        this.timeframe = options.timeframe;
        this.accountId = options.accountId ?? `paper-${options.symbol}-${Date.now().toString(36)}`;
        const now = options.wallClock ? options.wallClock() : Date.now();

        // Isolated virtual account — never shares state with any other session.
        this.account = createAccount({
            id: this.accountId,
            environment: "paper",
            balance: options.initialBalance,
            now,
        });

        this.limits = {
            ...(options.strategy ? riskLimitsFromStrategy(options.strategy) : {}),
            ...options.riskLimits,
        };

        this.adapter = new PaperAdapter({
            symbol: options.symbol,
            executionModel: options.strategy?.executionModel ?? "next_bar_open",
            environment: "paper",
            spreadPips: options.costs?.spreadPips ?? 0,
            slippagePips: options.costs?.slippagePips ?? 0,
            commissionPerLot: options.costs?.commissionPerLot ?? 0,
            spec: simSymbolSpec(options.symbol),
            maxQuoteAgeMs: options.maxQuoteAgeMs,
            maxSpread: options.maxSpread,
            wallClock: options.wallClock,
        });

        const strategy = options.strategy ?? createManualOnlyStrategy(options.symbol, options.timeframe);
        this.engine = new StrategyEngine({
            strategy,
            autoStrategy: !!options.strategy,
            symbol: options.symbol,
            timeframe: options.timeframe,
            environment: "paper",
            adapter: this.adapter,
            account: this.account,
            spec: simSymbolSpec(options.symbol),
            costs: options.costs,
            riskLimits: this.limits,
            debug: options.debug ?? false,
            initialBalance: options.initialBalance,
        });
    }

    // ── Real market data in ──────────────────────────────────────────────────

    /** Feed a real bid/ask quote from the live data source. */
    feedQuote(quote: PendingQuote): void {
        this.lastQuote = quote;
        this.adapter.setQuote(quote);
    }

    /** Feed a newly closed candle — the strategy evaluates on candle close. */
    feedCandle(candle: MarketCandle): void {
        this.engine.appendCandle(candle);
        const index = this.engine.getVisibleCandles().length - 1;
        this.engine.onCandleClose(index);
    }

    // ── Trading ──────────────────────────────────────────────────────────────

    /** Manual paper order (market/limit/stop, optional SL/TP). */
    placeOrder(intent: OrderIntent): { order: Order; position: SimPosition | null; rejected?: string } {
        const preRisk = this.preTradeRisk();
        if (!preRisk.allowed) {
            return { order: this.rejectedOrder(intent, preRisk.reasons.join("; ")), position: null, rejected: preRisk.reasons.join("; ") };
        }
        const result = this.engine.placeOrder({ ...intent, source: intent.source ?? "manual" });
        if (result.order.status === "REJECTED") {
            return { ...result, rejected: result.order.rejectReason };
        }
        return result;
    }

    closePosition(positionId: string): SimPosition | null {
        // Never fall back to a historical candle close when a real quote is
        // stale: defer the manual close until an executable quote is available.
        if (this.adapter.isStale()) return null;
        return this.engine.closePosition(positionId, "mandatory_exit");
    }

    // ── Account management (simulation capital only) ─────────────────────────

    deposit(amount: number): AccountState {
        return this.applyAccount(accountDeposit(this.engine.getAccount(), amount, this.now()));
    }

    withdraw(amount: number): AccountState {
        return this.applyAccount(accountWithdraw(this.engine.getAccount(), amount, this.now()));
    }

    halt(reason: string): AccountState {
        return this.applyAccount(haltAccount(this.engine.getAccount(), reason, this.now()));
    }

    resume(): AccountState {
        return this.applyAccount(resumeAccount(this.engine.getAccount(), this.now()));
    }

    /** Account-level kill switch: rejects every subsequent order. */
    engageKillSwitch(): void {
        this.killSwitch = true;
    }

    releaseKillSwitch(): void {
        this.killSwitch = false;
    }

    // ── State ────────────────────────────────────────────────────────────────

    getAccount(): AccountState {
        return this.engine.getAccount();
    }

    getPositions(): Position[] {
        return this.engine.getPositions();
    }

    getClosedTrades(): SimPosition[] {
        return this.engine.getClosedPositions();
    }

    getOrders(): Order[] {
        return this.engine.getOrders();
    }

    getTraces(): DecisionTrace[] {
        return this.engine.getTraces();
    }

    status(): PaperSessionStatus {
        const account = this.engine.getAccount();
        const age = this.adapter.quoteAgeMs();
        return {
            mode: "paper",
            label: PAPER_TRADING_LABEL,
            accountId: this.accountId,
            balance: account.balance,
            equity: account.equity,
            openPositions: this.engine.getPositions().length,
            halted: account.halted,
            haltReason: account.haltReason,
            quoteStale: this.adapter.isStale(),
            quoteAgeMs: age,
            killSwitch: this.killSwitch,
            strategyId: this.engine.getTraces()[0]?.strategyId ?? null,
        };
    }

    /** Current risk verdict (for the UI's live guard panel). */
    preTradeRisk(): RiskVerdict {
        const account = this.engine.getAccount();
        return evaluateAccountHalt(
            { ...this.limits, killSwitch: this.killSwitch, maxDataAgeMs: this.limits.maxDataAgeMs },
            account,
            this.engine.getPositions().length
        );
    }

    getEngine(): StrategyEngine {
        return this.engine;
    }

    // ── internals ────────────────────────────────────────────────────────────

    private applyAccount(next: AccountState): AccountState {
        // The engine owns the canonical account; external mutations are pushed in.
        this.engine.replaceAccount(next);
        return next;
    }

    private now(): number {
        return this.adapter.now() || Date.now();
    }

    private rejectedOrder(intent: OrderIntent, reason: string): Order {
        const now = this.now();
        return {
            id: `rej-${now.toString(36)}`,
            symbol: this.symbol,
            side: intent.side,
            type: intent.type,
            quantity: intent.quantity,
            price: intent.price,
            status: "REJECTED",
            filledQuantity: 0,
            avgFillPrice: 0,
            fills: [],
            reason: intent.reason,
            source: intent.source,
            rejectReason: reason,
            createdAt: now,
            updatedAt: now,
        };
    }
}
