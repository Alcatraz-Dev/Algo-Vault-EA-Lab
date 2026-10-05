/**
 * AlgoVault Strategy Engine — canonical types (Phase 4).
 *
 * ONE strategy schema, ONE execution core, many execution environments:
 *
 *                    STRATEGY DEFINITION
 *                           │
 *                    STRATEGY ENGINE
 *              ┌────────────┼────────────┐
 *           BACKTEST      REPLAY       PAPER ── LIVE
 *              └────────────┼────────────┘
 *                     EXECUTION ADAPTER
 *
 * The strategy never branches on `if paper / if live`: environment-specific
 * behavior lives in ExecutionAdapters. Signal → OrderIntent → Risk → Adapter
 * → Order → Position → Portfolio → Analytics is the canonical pipeline.
 */

import type { MarketCandle, MarketSession, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { CandleFeatures } from "@/lib/strategy-lab/features";
import type {
    BacktestConfig,
    BacktestMetrics,
    BacktestResult,
    BacktestTrade,
    EquityPoint,
    ExitReason,
    Strategy,
} from "@/lib/strategy-lab/types";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical strategy definition.
//
// Strategy Lab's `Strategy` is THE schema: rules, SL/TP, risk, filters,
// execution model, costs and a version string. No module may define a second
// executable strategy schema; node graphs / Pine / AI drafts are authoring
// layers that compile INTO this.
// ─────────────────────────────────────────────────────────────────────────────

export type StrategyDefinition = Strategy;

export type {
    BacktestConfig,
    BacktestMetrics,
    BacktestResult,
    BacktestTrade,
    EquityPoint,
    ExitReason,
    Strategy,
    SupportedSymbol,
    Timeframe,
};    /** Where a strategy is being executed. The strategy itself never sees this. */
export type ExecutionEnvironment = "backtest" | "replay" | "paper" | "live" | "chart";

// ─────────────────────────────────────────────────────────────────────────────
// Event model
// ─────────────────────────────────────────────────────────────────────────────

export type StrategyEventType =
    | "CANDLE_OPEN"
    | "CANDLE_UPDATE"
    | "CANDLE_CLOSE"
    | "TICK_UPDATE"
    | "MARKET_STATE_UPDATE"
    | "POSITION_UPDATE"
    | "ORDER_UPDATE";

export interface StrategyEventBase {
    type: StrategyEventType;
    symbol: string;
    timeframe: Timeframe;
    timestamp: number;
}

export interface CandleStrategyEvent extends StrategyEventBase {
    type: "CANDLE_OPEN" | "CANDLE_UPDATE" | "CANDLE_CLOSE";
    /** The candle being opened/updated/closed. Never a future candle. */
    candle: MarketCandle;
    /** Index of the candle inside the visible series. */
    index: number;
}

export interface TickStrategyEvent extends StrategyEventBase {
    type: "TICK_UPDATE";
    price: number;
    bid?: number;
    ask?: number;
}

export interface MarketStateStrategyEvent extends StrategyEventBase {
    type: "MARKET_STATE_UPDATE";
    /** e.g. session change, spread blow-out, feed reconnect. */
    state: "open" | "closed" | "halted" | "degraded";
    spread?: number;
    reason?: string;
}

export interface PositionStrategyEvent extends StrategyEventBase {
    type: "POSITION_UPDATE";
    positionId: string;
    change: "opened" | "modified" | "partially_closed" | "closed";
}

export interface OrderStrategyEvent extends StrategyEventBase {
    type: "ORDER_UPDATE";
    orderId: string;
    status: OrderStatus;
}

export type StrategyEvent =
    | CandleStrategyEvent
    | TickStrategyEvent
    | MarketStateStrategyEvent
    | PositionStrategyEvent
    | OrderStrategyEvent;

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";

export type OrderStatus =
    | "CREATED"
    | "SUBMITTED"
    | "OPEN"
    | "PARTIALLY_FILLED"
    | "FILLED"
    | "CANCELLED"
    | "REJECTED";

/** What the strategy wants. Never a fill. */
export interface OrderIntent {
    side: OrderSide;
    type: OrderType;
    quantity: number;
    /** Required for LIMIT/STOP. */
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    /** Why: entry | exit | manual | risk-reduction. */
    reason: string;
    source: "strategy" | "manual" | "risk";
    strategyId?: string;
    strategyVersion?: string;
    /** Close/reduce an existing position instead of opening one. */
    reduceOnly?: boolean;
    positionId?: string;
    clientOrderId?: string;
    accountId?: string;
    provider?: "SIMULATOR" | "CHALLENGE" | "DEMO_BROKER" | "BROKER" | "UNKNOWN";
    submittedAt?: number;
    stopLimitPrice?: number;
}

export interface ExecutionFill {
    price: number;
    quantity: number;
    timestamp: number;
    commission: number;
    slippageCost: number;
    spreadCost: number;
    /** Which side of the quote was used (bid/ask awareness). */
    liquidity: "ask" | "bid" | "open" | "close" | "limit";
}

/** What the environment produced. Fills come only from the adapter. */
export interface Order {
    id: string;
    clientOrderId?: string;
    accountId?: string;
    provider?: "SIMULATOR" | "CHALLENGE" | "DEMO_BROKER" | "BROKER" | "UNKNOWN";
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    status: OrderStatus;
    filledQuantity: number;
    avgFillPrice: number;
    fills: ExecutionFill[];
    reason: string;
    source: "strategy" | "manual" | "risk";
    strategyId?: string;
    strategyVersion?: string;
    positionId?: string;
    rejectReason?: string;
    createdAt: number;
    submittedAt?: number;
    filledAt?: number;
    cancelledAt?: number;
    updatedAt: number;
}

export interface ExecutionReport {
    order: Order;
    filled: boolean;
    fills: ExecutionFill[];
    message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Positions
// ─────────────────────────────────────────────────────────────────────────────

export type PositionSide = "LONG" | "SHORT";

export interface PositionTarget {
    id: "tp1" | "tp2" | "tp3";
    price: number;
    closePercent: number;
    hit: boolean;
}

/** Canonical position. Backtest, replay, paper and live all hold these. */
export interface Position {
    id: string;
    ticket: number;
    /** Optional provider boundary metadata; legacy simulations remain valid. */
    accountId?: string;
    provider?: "SIMULATOR" | "CHALLENGE" | "DEMO_BROKER" | "BROKER" | "UNKNOWN";
    symbol: string;
    side: PositionSide;
    quantity: number;
    remainingQuantity: number;
    entryPrice: number;
    currentPrice: number;
    stopLoss: number;
    targets: PositionTarget[];
    initialRisk: number; // price distance entry → initial stop
    realizedPnL: number;
    unrealizedPnL: number;
    openedAt: number;
    updatedAt: number;
    closedAt?: number;
    strategyId?: string;
    strategyVersion?: string;
    session: string;
    regime: string;
    status: "open" | "closed";
    /** Max adverse/favorable excursion observed while open (price units). */
    mae: number;
    mfe: number;
    trailingActive: boolean;
    entryCost: number;
    source: "strategy" | "manual";
    meta?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Account / portfolio
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountState {
    id: string;
    environment: ExecutionEnvironment;
    /** Explicit account boundary; optional for persisted/backtest compatibility. */
    userId?: string;
    mode?: "SIMULATOR" | "CHALLENGE" | "DEMO" | "LIVE";
    provider?: "SIMULATOR" | "CHALLENGE" | "DEMO_BROKER" | "BROKER" | "UNKNOWN";
    status?: "ACTIVE" | "SUSPENDED" | "CLOSED" | "UNKNOWN";
    currency?: string;
    leverage?: number;
    balance: number;
    equity: number;
    peakEquity: number;
    availableMargin: number;
    usedMargin: number;
    unrealizedPnL: number;
    realizedPnL: number;
    exposure: number;
    dailyPnL: number;
    dailyPnLDate: string;
    /** Balance baseline for the current daily P&L bucket. */
    dailyStartBalance?: number;
    drawdownAbs: number;
    drawdownPct: number;
    consecutiveLosses: number;
    halted: boolean;
    haltReason?: string;
    initialBalance: number;
    deposits: number;
    withdrawals: number;
    createdAt: number;
    updatedAt: number;
}

/** Read-only view handed to the strategy each step. */
export interface PortfolioSnapshot {
    balance: number;
    equity: number;
    availableMargin: number;
    usedMargin: number;
    unrealizedPnL: number;
    realizedPnL: number;
    exposure: number;
    drawdownPct: number;
    dailyPnL: number;
    openPositions: number;
    halted: boolean;
    haltReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy context (what a strategy is allowed to see)
// ─────────────────────────────────────────────────────────────────────────────

export interface SmartMoneyContext {
    structure: "bullish" | "bearish" | "range" | "neutral" | "unknown";
    bos: { direction: "bullish" | "bearish"; index: number } | null;
    choch: { direction: "bullish" | "bearish"; index: number } | null;
    fvgDirection: "bullish" | "bearish" | "neutral" | null;
    fvgBarsAgo: number | null;
    obDirection: "bullish" | "bearish" | "neutral" | null;
    lastSweep: { side: string; level: number; index: number } | null;
    /** Events already filtered to timestamp <= current (never future events). */
    events: Array<{ id: string; type: string; timestamp: number; price?: number }>;
}

export interface StrategyContext {
    environment: ExecutionEnvironment;
    market: {
        symbol: string;
        timeframe: Timeframe;
        /** The candle that just closed/updated — never a future candle. */
        candle: MarketCandle;
        index: number;
        /** Visible history, strictly timestamp <= current candle. */
        history: MarketCandle[];
        session: MarketSession;
        timestamp: number;
    };
    /** Causal indicator/features snapshot at the current candle. */
    indicators: CandleFeatures | null;
    smartMoney: SmartMoneyContext;
    portfolio: PortfolioSnapshot;
    risk: {
        maxRiskPerTrade: number;
        maxOpenPositions: number;
        openPositions: number;
        lastRiskCheck?: RiskVerdict;
    };
    state: {
        strategyId: string;
        strategyVersion: string;
        barsSinceLastEntry: number | null;
        lastSignalAt: number | null;
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskLimits {
    maxRiskPerTradePct?: number;
    maxDailyLossPct?: number;
    maxDrawdownPct?: number;
    maxOpenPositions?: number;
    maxExposure?: number;
    /** Maximum single-order quantity in instrument lots/contracts. */
    maxPositionSize?: number;
    maxConsecutiveLosses?: number;
    allowedSessions?: MarketSession[];
    /** Account-level kill switch. When true nothing may trade. */
    killSwitch?: boolean;
    /** Data older than this is stale → no trading (fail closed). */
    maxDataAgeMs?: number;
    /** Spread wider than this (price units) blocks new entries. */
    maxSpread?: number;
}

export interface RiskInput {
    intent?: OrderIntent;
    account: AccountState;
    openPositions: number;
    exposure: number;
    equity: number;
    /** Price distance entry → stop for the intended trade. */
    stopDistance?: number;
    session?: MarketSession;
    /** Market data timestamp vs engine clock. */
    dataTimestamp?: number;
    now?: number;
    spread?: number;
    price?: number;
}

export interface RiskVerdict {
    allowed: boolean;
    reasons: string[];
    checks: Array<{ name: string; passed: boolean; detail?: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution adapter (the ONLY place environment differences live)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionAdapter {
    readonly environment: ExecutionEnvironment;
    /** Submit an intent; the adapter decides whether/how it fills. */
    submit(intent: OrderIntent): ExecutionReport;
    cancel(orderId: string): boolean;
    /** Return authoritative order state if it has already been seen. */
    getOrder?(orderId: string): Order | null;
    /** Idempotency lookup prevents duplicate client IDs from reaching an adapter. */
    hasOrderId?(orderId: string): boolean;
    /** Replace an unfilled working order without changing its stable id. */
    modify?(orderId: string, patch: Partial<Pick<Order, "price" | "quantity" | "stopLoss" | "takeProfit">>): Order | null;
    workingOrders?(): Order[];
    /** Current market price for a side (bid/ask aware when available). */
    marketPrice(side: OrderSide): number | null;
    /**
     * Price a MARKET entry would fill at right now — used by the engine to
     * plan stops/sizing BEFORE submitting (plan from the actual fill price).
     */
    entryPrice(side: OrderSide): number | null;
    /** Price an open position would CLOSE at right now (opposite side quote). */
    exitPrice(side: OrderSide): number | null;
    now(): number;
    /** Bar-driven adapters (simulation/paper) receive each revealed bar. */
    setBar?(bar: MarketCandle): void;
    onBar?(bar: MarketCandle): ExecutionReport[];
    /** Optional residual costs when a fill price already embeds executable bid/ask. */
    positionOpenCosts?(): { spreadPips: number; commissionPerLot: number; slippagePips: number };
    positionCloseCosts?(): { spreadPips: number; commissionPerLot: number; slippagePips: number };
    /** Whether the adapter has a valid, fresh executable quote for this side. */
    canExecute?(side: OrderSide, now?: number): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision trace / debugging
// ─────────────────────────────────────────────────────────────────────────────

export interface TraceCondition {
    label: string;
    detail?: string;
    passed: boolean;
}

export interface DecisionTrace {
    id: string;
    timestamp: number;
    environment: ExecutionEnvironment;
    symbol: string;
    timeframe: Timeframe;
    strategyId: string;
    strategyVersion: string;
    conditions: TraceCondition[];
    risk: { checks: Array<{ name: string; passed: boolean; detail?: string }>; allowed: boolean };
    decision: "LONG" | "SHORT" | "NONE" | "EXIT";
    order?: { type: OrderType; side: OrderSide; quantity: number; price?: number };
    execution?: { status: OrderStatus; price?: number; message?: string };
    positionId?: string;
    note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Versioning & experiment records
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyVersionManifest {
    /** Structural fingerprint of the strategy (deterministic). */
    strategyVersion: string;
    /** Human-facing version string from the definition. */
    declaredVersion: string;
    indicatorVersions: Record<string, string>;
    smcVersion: string;
    executionModelVersion: string;
    engineVersion: string;
    costModelVersion: string;
}

export interface ExperimentRecord {
    experimentId: string;
    strategyId: string;
    strategyName: string;
    manifest: StrategyVersionManifest;
    dataset: {
        symbol: string;
        timeframe: Timeframe;
        from: number;
        to: number;
        bars: number;
        source: string;
    };
    config: BacktestConfig;
    parameters: Record<string, unknown>;
    results: {
        netProfit: number;
        winRate: number;
        profitFactor: number;
        maxDrawdownPct: number;
        totalTrades: number;
        returnPct: number;
    };
    createdAt: number;
    environment: ExecutionEnvironment;
    limitations: string[];
    assumptions: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────────────────────────────────────

/** Marker in MARKET coordinates (time + price) — never screen pixels. */
export interface StrategyMarker {
    id: string;
    time: number;
    price: number;
    kind: "entry" | "exit" | "stop_loss" | "take_profit" | "signal" | "position";
    side: OrderSide | "long" | "short";
    label: string;
    color: string;
    strategyId: string;
    strategyVersion?: string;
    status?: string;
    tradeId?: string;
}

export interface StrategyMarkerToggles {
    entries: boolean;
    exits: boolean;
    stopLoss: boolean;
    takeProfit: boolean;
    signals: boolean;
    conditions?: boolean;
}
