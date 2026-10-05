/**
 * AlgoVault Strategy Engine (Phase 4) — the ONE execution core.
 *
 * The engine consumes market events and produces decisions through shared,
 * deterministic functions:
 *
 *   evaluateEntry (decisions) → evaluateRisk (risk) → computeStops/sizing
 *   → OrderIntent → ExecutionAdapter → Order → Position → Account → Analytics
 *
 * It contains NO environment branches: backtest, replay and paper drive it
 * with the same events, only the adapter (how orders fill) differs.
 *
 * Bar pipeline (identical in every environment, mirrors Strategy Lab exactly):
 *
 *   0. day rollover (daily P&L, trade counter, cooldown reset)
 *   1. materialize deferred entries (next_bar_open) + working limit/stop fills
 *   2. mark-to-market → equity snapshot (pre-exit, as Strategy Lab does)
 *   3. drawdown kill → close all
 *   4. intrabar exits (stop → targets → trailing), newest position first
 *   5. end-of-data → close all
 *   6. daily-loss kill → close all
 *   7. entry evaluation (shared decisions) → risk check → signal/defer/fill
 *
 * No look-ahead: only candles/features with timestamp ≤ the current bar are
 * ever read; a next-bar-open entry is planned from the actual fill price of
 * the next bar, never from its future range.
 */

import { computeFeatures, type CandleFeatures } from "@/lib/strategy-lab/features";
import type { MarketCandle, Timeframe } from "@/lib/market-data/types";
import type { EquityPoint, ExecutionModel, ExitReason, Strategy } from "@/lib/strategy-lab/types";
import { applyRealized, createAccount, dayKey, markAccount, rollDay } from "./account";
import { evaluateEntry, type EntryEvaluation, type SeriesMap } from "./decisions";
import {
    closePositionAt,
    computeStops,
    markPosition,
    openSimPosition,
    processPositionBar,
    resetPositionIds,
    sizePosition,
    simSymbolSpec,
    type ExecutionCostConfig,
    type PositionAction,
    type SimPosition,
    type SimSymbolSpec,
} from "./simulation";
import { evaluateRisk, riskLimitsFromStrategy, tradeRiskPct, type RiskCheckInput } from "./risk";
import { buildDecisionTrace, TraceBuffer } from "./trace";
import type {
    AccountState,
    DecisionTrace,
    ExecutionAdapter,
    ExecutionEnvironment,
    Order,
    OrderIntent,
    RiskLimits,
    RiskVerdict,
} from "./types";

export interface StrategyEngineOptions {
    strategy: Strategy;
    symbol: string;
    timeframe: Timeframe;
    adapter: ExecutionAdapter;
    account?: AccountState;
    environment: ExecutionEnvironment;
    spec?: SimSymbolSpec;
    costs?: ExecutionCostConfig;
    gapAware?: boolean;
    executionModel?: ExecutionModel;
    /** Precomputed regime labels per bar (backtest stride sampling). */
    regimeByBar?: string[];
    riskLimits?: RiskLimits;
    debug?: boolean;
    /** Max retained decision traces. */
    traceLimit?: number;
    /** Start balance when the engine creates its own account. */
    initialBalance?: number;
    /** Set false for manual-only sessions (replay/paper without a strategy). */
    autoStrategy?: boolean;
}

/**
 * Placeholder definition for manual-only sessions (no strategy attached).
 * With `autoStrategy: false` its conditions are never evaluated.
 */
export function createManualOnlyStrategy(symbol: string, timeframe: Timeframe): Strategy {
    return {
        id: `manual-only-${symbol}`,
        name: "Manual trading",
        description: "No strategy attached — manual orders only.",
        asset: symbol as Strategy["asset"],
        direction: "long",
        timeframes: { macro: timeframe, structure: timeframe, setup: timeframe, entry: timeframe },
        regimeFilter: [],
        entryRules: [],
        confirmationRules: [],
        stopLoss: { mode: "atr", atrMultiple: 1.5, levelOffset: 0, useSwing: false },
        takeProfit: { mode: "r", r1: 2, r2: 3, r3: 4, fixedDistance: 0, partialCloses: [], moveBeAfterTp1: false, lockAfterTp2: false, trailingEnabled: false, trailingStopAtr: 1.5 },
        risk: { mode: "fixed_lot", riskPercent: 1, fixedLot: 0.01, maxPositions: 10, dailyLossLimitPct: 0, maxDrawdownPct: 0 },
        filters: { sessions: [], daysOfWeek: [], volatilityMinAtrPct: 0, volatilityMaxAtrPct: 0, maxTradesPerDay: 1000, cooldownCandles: 0 },
        executionModel: "next_bar_open",
        costs: { spreadPips: 0, commissionPerLot: 0, slippagePips: 0 },
        sourcePatternId: null,
        whyp: { discovered: "", conditionsSelected: "", occurrenceFrequency: "", historicalPerformance: "", weaknesses: "", poorRegimes: "", generatedByProvider: "system" },
        version: "1.0.0",
        created: 0,
        updated: 0,
    };
}

export interface EngineBarResult {
    index: number;
    timestamp: number;
    equityPoint: EquityPoint;
    evaluation: EntryEvaluation | null;
    risk: RiskVerdict | null;
    actions: Array<{ positionId: string; actions: PositionAction[] }>;
    opened: SimPosition[];
    closed: SimPosition[];
    trace?: DecisionTrace;
}

/** A confirmed entry signal waiting for its fill bar (next_bar_open). */
export interface PendingEntry {
    side: "BUY" | "SELL";
    atr: number;
    session: string;
    regime: string;
    signalIndex: number;
    evaluation: EntryEvaluation;
}

interface PositionInput {
    strategy: Strategy;
    spec: SimSymbolSpec;
    costs: ExecutionCostConfig;
    gapAware: boolean;
    prevClose: number | null;
    atr: number;
    barIndex: number;
    timestamp: number;
}

export class StrategyEngine {
    readonly strategy: Strategy;
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly environment: ExecutionEnvironment;
    readonly spec: SimSymbolSpec;
    readonly costs: ExecutionCostConfig;

    private readonly adapter: ExecutionAdapter;
    private readonly executionModel: ExecutionModel;
    private readonly gapAware: boolean;
    private readonly regimeByBar?: string[];
    private readonly limits: RiskLimits;
    private readonly debug: boolean;
    private readonly autoStrategy: boolean;
    private readonly traces: TraceBuffer;

    private candles: MarketCandle[] = [];
    private features: CandleFeatures[] = [];
    private seriesMap: SeriesMap = {};

    private positions: SimPosition[] = [];
    private closedPositions: SimPosition[] = [];
    private orders: Order[] = [];
    private accountState: AccountState;
    private pending: PendingEntry | null = null;

    private cooldownUntil = -1;
    private tradesToday = 0;
    private lastDayKey: string | null = null;
    private lastSignalAt: number | null = null;
    /** Index of the most recently processed bar — manual operations must use
     * this (never the end of a pre-loaded future series). */
    private currentIndex = -1;

    constructor(options: StrategyEngineOptions) {
        this.strategy = options.strategy;
        this.symbol = options.symbol;
        this.timeframe = options.timeframe;
        this.environment = options.environment;
        this.adapter = options.adapter;
        this.spec = options.spec ?? simSymbolSpec(options.symbol);
        this.costs = options.costs ?? {
            spreadPips: options.strategy.costs?.spreadPips ?? 0,
            slippagePips: options.strategy.costs?.slippagePips ?? 0,
            commissionPerLot: options.strategy.costs?.commissionPerLot ?? 0,
        };
        this.executionModel = options.executionModel ?? options.strategy.executionModel ?? "next_bar_open";
        this.gapAware = options.gapAware ?? true;
        this.regimeByBar = options.regimeByBar;
        this.limits = options.riskLimits ?? riskLimitsFromStrategy(options.strategy);
        this.debug = options.debug ?? false;
        this.autoStrategy = options.autoStrategy ?? true;
        this.traces = new TraceBuffer(options.traceLimit ?? 200);
        this.accountState =
            options.account ??
            createAccount({
                id: `acct-${options.symbol}`,
                environment: options.environment,
                balance: options.initialBalance ?? 10_000,
                now: 0,
            });
        resetPositionIds();
    }

    // ── Data feed ────────────────────────────────────────────────────────────

    /**
     * Load the causal series. Features are computed ONCE over the full series:
     * `computeFeatures` is causal (feature[i] depends only on candles[0..i]),
     * so precomputing never leaks future data — it is exactly what the
     * strategy may see at bar i.
     */
    loadSeries(candles: MarketCandle[], features?: CandleFeatures[]): void {
        this.candles = [...candles];
        this.features = features ?? computeFeatures(this.candles);
        this.seriesMap = { [this.timeframe]: { features: this.features, candles: this.candles } };
    }

    /** Append a newly closed candle (paper/live feed). */
    appendCandle(candle: MarketCandle): void {
        this.candles.push(candle);
        // Causal: recomputing over a bounded window only refreshes recent rows.
        const w = Math.min(this.candles.length, 1024);
        const offset = this.candles.length - w;
        const computed = computeFeatures(this.candles.slice(offset));
        const next = [...this.features];
        for (let i = 0; i < computed.length; i++) next[offset + i] = computed[i];
        this.features = next.slice(0, this.candles.length);
        this.seriesMap = { [this.timeframe]: { features: this.features, candles: this.candles } };
    }

    // ── Accessors ────────────────────────────────────────────────────────────

    getPositions(): SimPosition[] {
        return [...this.positions];
    }

    getClosedPositions(): SimPosition[] {
        return [...this.closedPositions];
    }

    getOrders(): Order[] {
        return [...this.orders];
    }

    getAccount(): AccountState {
        return this.accountState;
    }

    /** Replace the canonical account (deposits/withdrawals/halt from hosts). */
    replaceAccount(next: AccountState): void {
        this.accountState = next;
    }

    getTraces(): DecisionTrace[] {
        return this.traces.all();
    }

    getVisibleCandles(): MarketCandle[] {
        return [...this.candles];
    }

    getFeatures(): CandleFeatures[] {
        return [...this.features];
    }

    getPending(): PendingEntry | null {
        return this.pending;
    }

    // ── Main pipeline ────────────────────────────────────────────────────────

    /** Process the close of the candle at `index`. */
    onCandleClose(index: number): EngineBarResult {
        const bar = this.candles[index];
        if (!bar) throw new Error(`StrategyEngine: no candle at index ${index}`);
        if (index !== this.currentIndex + 1) {
            throw new Error(`StrategyEngine: bars must be processed sequentially (expected ${this.currentIndex + 1}, got ${index})`);
        }
        this.currentIndex = index;

        this.adapter.setBar?.(bar);

        const opened: SimPosition[] = [];
        const closed: SimPosition[] = [];
        const actions: EngineBarResult["actions"] = [];

        // ── 0. Day rollover ──
        const key = dayKey(bar.timestamp);
        if (this.lastDayKey !== key) {
            this.lastDayKey = key;
            this.tradesToday = 0;
            this.cooldownUntil = -1;
            this.accountState = rollDay(this.accountState, bar.timestamp);
        }

        // ── 1a. Materialize deferred (next-bar-open) entries ──
        if (this.pending) {
            const plan = this.pending;
            const fillPrice = this.adapter.entryPrice?.(plan.side) ?? null;
            this.pending = null;
            if (fillPrice !== null) {
                const pos = this.submitStrategyEntry(plan, fillPrice, bar, index);
                if (pos) opened.push(pos);
            }
        }

        // ── 1b. Working limit/stop orders vs this bar ──
        if (this.adapter.onBar) {
            for (const report of this.adapter.onBar(bar)) {
                this.trackOrder(report.order);
                if (report.filled && !report.order.positionId) {
                    const pos = this.positionFromFilledOrder(report.order, bar, index);
                    if (pos) opened.push(pos);
                }
            }
        }

        // ── 2. Mark-to-market → equity snapshot (pre-exit, Strategy Lab parity) ──
        for (const pos of this.positions) markPosition(pos, bar.close, bar);
        this.accountState = this.markTo(bar.close, bar.timestamp);
        const equityPoint: EquityPoint = {
            time: bar.timestamp,
            balance: Number(this.accountState.balance.toFixed(2)),
            equity: Number(this.accountState.equity.toFixed(2)),
            drawdownPct: Number(this.accountState.drawdownPct.toFixed(2)),
            drawdownAbs: Number(this.accountState.drawdownAbs.toFixed(2)),
        };

        let skipEntry = false;

        // ── 3. Drawdown kill switch ──
        if (
            this.strategy.risk.maxDrawdownPct > 0 &&
            this.accountState.peakEquity > 0 &&
            this.accountState.drawdownPct >= this.strategy.risk.maxDrawdownPct
        ) {
            closed.push(...this.closeAllPositions("drawdown_limit", bar, index, actions));
            skipEntry = true;
        }

        // ── 4. Intrabar exits (newest first — Strategy Lab parity) ──
        const input = this.positionInput(bar, index);
        for (let p = this.positions.length - 1; p >= 0; p--) {
            const pos = this.positions[p];
            const acts = processPositionBar(pos, bar, input);
            if (acts.length > 0) actions.push({ positionId: pos.id, actions: acts });
            markPosition(pos, bar.close, bar);
            if (pos.status === "closed") {
                this.finalizePosition(pos);
                closed.push(pos);
                this.positions.splice(p, 1);
            }
        }

        // ── 5. End of data ──
        if (index === this.candles.length - 1) {
            closed.push(...this.closeAllPositions("end_of_data", bar, index, actions));
        }

        // ── 6. Daily loss kill ──
        if (
            this.strategy.risk.dailyLossLimitPct > 0 &&
            this.accountState.balance > 0 &&
            this.accountState.dailyPnL < -((this.accountState.balance * this.strategy.risk.dailyLossLimitPct) / 100)
        ) {
            closed.push(...this.closeAllPositions("daily_loss_limit", bar, index, actions));
            skipEntry = true;
        }

        // ── 7. Entry evaluation ──
        let evaluation: EntryEvaluation | null = null;
        let risk: RiskVerdict | null = null;
        let trace: DecisionTrace | undefined;

        if (this.autoStrategy && !skipEntry && !this.accountState.halted && !this.pending) {
            evaluation = evaluateEntry({
                strategy: this.strategy,
                seriesMap: this.seriesMap,
                index,
                regimeByBar: this.regimeByBar,
                state: {
                    openPositions: this.positions.length,
                    cooldownUntil: this.cooldownUntil,
                    tradesToday: this.tradesToday,
                },
            });

            if (evaluation.fired) {
                const side: "BUY" | "SELL" = this.strategy.direction === "long" ? "BUY" : "SELL";
                // Risk estimate uses ONLY the signal bar (ATR / level distance) —
                // never the next bar's open. No look-ahead in any decision.
                const riskDistance = this.estimateRiskDistance(evaluation.atr);
                const quantity = sizePosition({
                    strategy: this.strategy,
                    balance: this.accountState.balance,
                    riskPrice: riskDistance,
                    spec: this.spec,
                });

                const intent: OrderIntent = {
                    side,
                    type: "MARKET",
                    quantity,
                    reason: "strategy_entry",
                    source: "strategy",
                    strategyId: this.strategy.id,
                    strategyVersion: this.strategy.version,
                    submittedAt: bar.timestamp,
                };

                risk = evaluateRisk(
                    this.limits,
                    this.riskInput(intent, index, evaluation, riskDistance)
                );

                trace = buildDecisionTrace({
                    environment: this.environment,
                    symbol: this.symbol,
                    timeframe: this.timeframe,
                    strategy: this.strategy,
                    timestamp: bar.timestamp,
                    evaluation,
                    risk,
                    decision: risk.allowed && quantity > 0 ? (side === "BUY" ? "LONG" : "SHORT") : "NONE",
                    order: risk.allowed && quantity > 0 ? { type: "MARKET", side, quantity } : undefined,
                    note: quantity <= 0 ? "Position size below instrument minimum" : undefined,
                });
                if (this.debug) this.traces.push(trace);

                if (risk.allowed && quantity > 0) {
                    this.tradesToday += 1;
                    this.cooldownUntil = index + this.strategy.filters.cooldownCandles;
                    this.lastSignalAt = bar.timestamp;
                    const entry: PendingEntry = {
                        side,
                        atr: evaluation.atr,
                        session: evaluation.session,
                        regime: evaluation.regime,
                        signalIndex: index,
                        evaluation,
                    };

                    if (this.executionModel === "same_bar_close") {
                        const price = this.adapter.entryPrice?.(side) ?? bar.close;
                        const pos = this.submitStrategyEntry(entry, price, bar, index);
                        if (pos) opened.push(pos);
                    } else {
                        this.pending = entry;
                    }
                }
            } else if (this.debug) {
                trace = buildDecisionTrace({
                    environment: this.environment,
                    symbol: this.symbol,
                    timeframe: this.timeframe,
                    strategy: this.strategy,
                    timestamp: bar.timestamp,
                    evaluation,
                    risk: { allowed: true, reasons: [], checks: [] },
                    decision: "NONE",
                    note: evaluation.blockedBy ?? "no_signal",
                });
                this.traces.push(trace);
            }
        }

        return { index, timestamp: bar.timestamp, equityPoint, evaluation, risk, actions, opened, closed, trace };
    }

    // ── Entry helpers ────────────────────────────────────────────────────────

    /**
     * Stop distance used for the pre-fill risk estimate. Depends only on the
     * strategy configuration and the signal bar's ATR — never on future bars.
     */
    private estimateRiskDistance(atr: number): number {
        const sl = this.strategy.stopLoss;
        const distance = sl.mode === "atr" ? Math.abs(sl.atrMultiple * atr) : Math.abs(sl.levelOffset);
        return Number.isFinite(distance) ? distance : 0;
    }

    private riskInput(
        intent: OrderIntent,
        index: number,
        evaluation: EntryEvaluation,
        riskDistance: number
    ): RiskCheckInput {
        const equity = this.accountState.equity || this.accountState.balance;
        const quantity = intent.quantity;
        return {
            intent,
            account: this.accountState,
            openPositions: this.positions.length,
            exposure: this.accountState.exposure,
            equity,
            session: evaluation.session as RiskCheckInput["session"],
            dataTimestamp: this.candles[index].timestamp,
            now: this.candles[index].timestamp,
            riskPct:
                riskDistance > 0 && quantity > 0
                    ? tradeRiskPct({
                          stopDistance: riskDistance,
                          quantity,
                          contractSize: this.spec.contractSize,
                          equity,
                      })
                    : undefined,
        };
    }

    private submitStrategyEntry(
        plan: PendingEntry,
        fillPrice: number,
        bar: MarketCandle,
        index: number
    ): SimPosition | null {
        const planStops = computeStops(this.strategy, fillPrice, plan.atr, plan.side === "BUY", this.spec.digits);
        if (planStops.riskPrice <= 0) return null;
        const quantity = sizePosition({
            strategy: this.strategy,
            balance: this.accountState.balance,
            riskPrice: planStops.riskPrice,
            spec: this.spec,
        });
        if (quantity <= 0) return null;

        const intent: OrderIntent = {
            side: plan.side,
            type: "MARKET",
            quantity,
            reason: "strategy_entry",
            source: "strategy",
            strategyId: this.strategy.id,
            strategyVersion: this.strategy.version,
            submittedAt: bar.timestamp,
        };
        const report = this.adapter.submit(intent);
        this.trackOrder(report.order);
        if (!report.filled || report.order.filledQuantity <= 0) return null;

        const pos = openSimPosition({
            strategy: this.strategy,
            symbol: this.symbol,
            side: plan.side,
            entryPrice: report.order.avgFillPrice,
            atr: plan.atr,
            balance: this.accountState.balance,
            spec: this.spec,
            costs: this.costs,
            timestamp: bar.timestamp,
            barIndex: index,
            session: plan.session,
            regime: plan.regime,
            plan: planStops,
            forcedVolume: report.order.filledQuantity,
            source: "strategy",
        });
        if (pos) {
            pos.meta = { signalIndex: plan.signalIndex };
            this.positions.push(pos);
        }
        return pos;
    }

    private positionFromFilledOrder(order: Order, bar: MarketCandle, index: number): SimPosition | null {
        if (order.status !== "FILLED") return null;
        const pos = openSimPosition({
            strategy: this.strategy,
            symbol: this.symbol,
            side: order.side,
            entryPrice: order.avgFillPrice,
            atr: this.atrAt(index),
            balance: this.accountState.balance,
            spec: this.spec,
            costs: this.costs,
            timestamp: bar.timestamp,
            barIndex: index,
            session: this.features[index]?.session ?? "unknown",
            regime: this.regimeByBar?.[index] ?? "transitional",
            forcedVolume: order.filledQuantity,
            manual: { sl: order.stopLoss, tp: order.takeProfit },
            source: order.source === "strategy" ? "strategy" : "manual",
        });
        if (pos) {
            pos.meta = { orderId: order.id };
            order.positionId = pos.id;
            this.positions.push(pos);
        }
        return pos;
    }

    // ── Manual / external orders (replay + paper trading UI) ────────────────

    placeOrder(intent: OrderIntent): { order: Order; position: SimPosition | null } {
        const bar = this.currentIndex >= 0 ? this.candles[this.currentIndex] : null;
        const report = this.adapter.submit({ ...intent, submittedAt: intent.submittedAt ?? this.adapter.now() });
        this.trackOrder(report.order);

        let position: SimPosition | null = null;
        if (!intent.reduceOnly && report.filled && report.order.status === "FILLED" && bar) {
            position = this.positionFromFilledOrder(report.order, bar, this.currentIndex);
        }
        return { order: report.order, position };
    }

    /** Close an open position at market (manual close / risk action). */
    closePosition(positionId: string, reason: ExitReason): SimPosition | null {
        const idx = this.positions.findIndex((p) => p.id === positionId);
        if (idx === -1 || this.currentIndex < 0) return null;
        const bar = this.candles[this.currentIndex];
        const index = this.currentIndex;
        const pos = this.positions[idx];
        const closeSide: "BUY" | "SELL" = pos.side === "LONG" ? "SELL" : "BUY";
        const price = this.adapter.exitPrice?.(closeSide) ?? bar.close;
        closePositionAt(pos, price, reason, this.positionInput(bar, index), bar);
        this.finalizePosition(pos);
        this.positions.splice(idx, 1);
        return pos;
    }

    /** Flatten everything (session close, kill switch, manual). */
    closeAll(reason: ExitReason): SimPosition[] {
        if (this.currentIndex < 0) return [];
        const bar = this.candles[this.currentIndex];
        return this.closeAllPositions(reason, bar, this.currentIndex, []);
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private positionInput(bar: MarketCandle, index: number): PositionInput {
        return {
            strategy: this.strategy,
            spec: this.spec,
            costs: this.costs,
            gapAware: this.gapAware,
            prevClose: index > 0 ? this.candles[index - 1].close : null,
            atr: this.atrAt(index),
            barIndex: index,
            timestamp: bar.timestamp,
        };
    }

    private atrAt(index: number): number {
        const f = this.features[index];
        if (f) return f.atr;
        const bar = this.candles[index];
        return bar ? bar.high - bar.low : 0;
    }

    private closeAllPositions(
        reason: ExitReason,
        bar: MarketCandle,
        index: number,
        actions: EngineBarResult["actions"]
    ): SimPosition[] {
        const closed: SimPosition[] = [];
        const input = this.positionInput(bar, index);
        // Oldest first — Strategy Lab parity.
        while (this.positions.length > 0) {
            const pos = this.positions[0];
            const closeSide: "BUY" | "SELL" = pos.side === "LONG" ? "SELL" : "BUY";
            const price = this.adapter.exitPrice?.(closeSide) ?? bar.close;
            const acts = closePositionAt(pos, price, reason, input, bar);
            if (acts.length > 0) actions.push({ positionId: pos.id, actions: acts });
            this.finalizePosition(pos);
            closed.push(pos);
            this.positions.shift();
        }
        return closed;
    }

    private finalizePosition(pos: SimPosition): void {
        const at = pos.closedAt ?? pos.updatedAt;
        this.closedPositions.push(pos);
        this.accountState = applyRealized(this.accountState, pos.realizedPnL, at);
        this.accountState = this.markTo(pos.currentPrice, at);
    }

    private markTo(price: number, at: number): AccountState {
        return markAccount(
            this.accountState,
            {
                positions: this.positions,
                priceOf: () => price,
                contractSizes: { [this.symbol]: this.spec.contractSize },
            },
            at
        );
    }

    private trackOrder(order: Order): void {
        const idx = this.orders.findIndex((o) => o.id === order.id);
        if (idx === -1) this.orders.push(order);
        else this.orders[idx] = order;
    }
}
