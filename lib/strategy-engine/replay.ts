/**
 * Market Replay (Phase 4) — a professional replay environment built ON the
 * canonical engine (never a separate fake implementation).
 *
 *   • Progressive candle reveal — future candles are physically hidden
 *   • Play / Pause / Step forward / Step back / Seek / Speed
 *   • Smart Money events come from the EXISTING ReplayEngine
 *     (lib/market-intelligence/backtesting/replay), evaluated only on visible
 *     candles — no future leakage.
 *   • The SAME strategy engine, indicators, execution model, risk engine and
 *     accounting as backtesting: replay trades on identical data must match
 *     the backtest decision-for-decision.
 *   • Manual trading: market/limit/stop orders, SL/TP, close, modify.
 *
 * Step-back semantics: state is rebuilt deterministically by re-running bars
 * 0..target through a fresh engine and re-applying recorded manual actions —
 * no serialized snapshots to drift.
 */

import { ReplayEngine } from "@/lib/market-intelligence/backtesting/replay";
import type { MarketCandle, Timeframe } from "@/lib/market-data/types";
import type { ExitReason, Strategy } from "@/lib/strategy-lab/types";
import { createManualOnlyStrategy, StrategyEngine } from "./engine";
import { SimulationAdapter } from "./adapters";
import { simSymbolSpec, type ExecutionCostConfig, type SimPosition } from "./simulation";
import type {
    AccountState,
    DecisionTrace,
    Order,
    OrderIntent,
    Position,
} from "./types";

export interface ReplaySessionOptions {
    symbol: string;
    timeframe: Timeframe;
    /** Full historical dataset. Never revealed past the cursor. */
    candles: MarketCandle[];
    /** Optional strategy executed by the canonical engine. */
    strategy?: Strategy;
    initialBalance?: number;
    costs?: ExecutionCostConfig;
    executionModel?: Strategy["executionModel"];
    /** Start index (default 0). */
    startAt?: number;
    /** Attach the existing SMC ReplayEngine for progressive events. */
    withSmartMoney?: boolean;
    /** Keep decision traces for the debug panel. */
    debug?: boolean;
    gapAware?: boolean;
}

export interface ReplayFrame {
    index: number;
    /** ONLY candles with index ≤ cursor. */
    visibleCandles: MarketCandle[];
    /** SMC events computed only from visible candles (existing engine). */
    smartMoneyEvents: unknown[];
    account: AccountState | null;
    positions: Position[];
    closedTrades: SimPosition[];
    orders: Order[];
    lastTrace?: DecisionTrace;
    total: number;
    atEnd: boolean;
}

interface ManualAction {
    atIndex: number;
    kind: "order" | "close";
    intent?: OrderIntent;
    positionId?: string;
    reason?: string;
}

export class ReplaySession {
    readonly symbol: string;
    readonly timeframe: Timeframe;
    readonly total: number;

    private readonly candles: MarketCandle[];
    private readonly options: ReplaySessionOptions;
    private readonly smc: ReplayEngine | null;
    private readonly manualActions: ManualAction[] = [];

    private cursor = -1;
    private engine: StrategyEngine | null = null;
    private playing = false;
    private speed = 1;

    constructor(options: ReplaySessionOptions) {
        this.options = options;
        this.symbol = options.symbol;
        this.timeframe = options.timeframe;
        this.candles = [...options.candles];
        this.total = this.candles.length;
        this.smc = options.withSmartMoney === false
            ? null
            : new ReplayEngine(this.candles, options.timeframe);
        this.cursor = (options.startAt ?? 0) - 1;
    }

    // ── Transport controls ───────────────────────────────────────────────────

    play(): void {
        this.playing = true;
    }

    pause(): void {
        this.playing = false;
    }

    isPlaying(): boolean {
        return this.playing;
    }

    setSpeed(multiplier: number): void {
        this.speed = Math.max(0.25, Math.min(1000, multiplier));
    }

    getSpeed(): number {
        return this.speed;
    }

    getIndex(): number {
        return this.cursor;
    }

    atEnd(): boolean {
        return this.cursor >= this.total - 1;
    }

    // ── Stepping ─────────────────────────────────────────────────────────────

    /** Reveal the next candle. Returns the frame, or null at the end. */
    stepForward(): ReplayFrame | null {
        if (this.atEnd()) {
            this.playing = false;
            return null;
        }
        const next = this.cursor + 1;
        this.advanceTo(next);
        return this.frame();
    }

    /** Hide the latest candle and restore engine state to the previous bar. */
    stepBack(): ReplayFrame | null {
        if (this.cursor < 0) return null;
        this.advanceTo(this.cursor - 1);
        return this.frame();
    }

    /** Jump to an index (forward = incremental, backward = deterministic rebuild). */
    seek(index: number): ReplayFrame {
        const target = Math.max(-1, Math.min(this.total - 1, index));
        this.advanceTo(target);
        return this.frame();
    }

    private advanceTo(target: number): void {
        if (target < this.cursor) {
            // Backward: rebuild deterministically from bar 0.
            this.rebuild(target);
            return;
        }
        while (this.cursor < target) {
            const next = this.cursor + 1;
            this.ensureEngine();
            this.engine!.onCandleClose(next);
            this.cursor = next;
            this.applyManualActionsAt(this.cursor);
        }
    }

    /**
     * Deterministic rebuild: fresh engine, bars 0..target, manual actions
     * re-applied in chronological order. Yields byte-identical state.
     */
    private rebuild(target: number): void {
        this.engine = null;
        this.cursor = -1;
        if (target < 0) return;
        this.ensureEngine();
        for (let i = 0; i <= target; i++) {
            this.engine!.onCandleClose(i);
            this.cursor = i;
            this.applyManualActionsAt(i, true);
        }
    }

    private ensureEngine(): void {
        if (this.engine) return;
        const o = this.options;
        const strategy = o.strategy ?? createManualOnlyStrategy(o.symbol, o.timeframe);
        this.engine = new StrategyEngine({
            strategy,
            autoStrategy: !!o.strategy,
            symbol: o.symbol,
            timeframe: o.timeframe,
            environment: "replay",
            adapter: new SimulationAdapter({
                symbol: o.symbol,
                executionModel: o.executionModel ?? o.strategy?.executionModel ?? "next_bar_open",
                environment: "replay",
                spreadPips: o.costs?.spreadPips ?? 0,
                slippagePips: o.costs?.slippagePips ?? 0,
                commissionPerLot: o.costs?.commissionPerLot ?? 0,
                spec: simSymbolSpec(o.symbol),
            }),
            costs: o.costs,
            spec: simSymbolSpec(o.symbol),
            initialBalance: o.initialBalance ?? 10_000,
            debug: o.debug ?? false,
            gapAware: o.gapAware,
        });
        this.engine.loadSeries(this.candles);
    }

    private applyManualActionsAt(index: number, duringRebuild = false): void {
        if (!this.engine) return;
        for (const action of this.manualActions) {
            if (action.atIndex !== index) continue;
            if (action.kind === "order" && action.intent) {
                this.engine.placeOrder(action.intent);
            } else if (action.kind === "close" && action.positionId) {
                this.engine.closePosition(action.positionId, (action.reason ?? "mandatory_exit") as ExitReason);
            }
        }
        void duringRebuild;
    }

    // ── Manual trading (recorded + replayed on rebuild) ─────────────────────

    placeOrder(intent: OrderIntent): { order: Order; position: SimPosition | null } | null {
        if (!this.engine || this.cursor < 0) return null;
        const result = this.engine.placeOrder({ ...intent, source: intent.source ?? "manual" });
        this.manualActions.push({ atIndex: this.cursor, kind: "order", intent });
        return result;
    }

    closePosition(positionId: string, reason: "mandatory_exit" | "end_of_data" = "mandatory_exit"): SimPosition | null {
        if (!this.engine) return null;
        const result = this.engine.closePosition(positionId, reason);
        if (result) {
            this.manualActions.push({ atIndex: this.cursor, kind: "close", positionId, reason });
        }
        return result;
    }

    // ── Frames / state ───────────────────────────────────────────────────────

    /** ONLY revealed candles (index ≤ cursor). Future candles stay hidden. */
    visibleCandles(): MarketCandle[] {
        if (this.cursor < 0) return [];
        return this.candles.slice(0, this.cursor + 1);
    }

    /** Never exposed — guard for hosts that might be tempted. */
    hasHiddenCandles(): boolean {
        return this.cursor < this.total - 1;
    }

    smartMoneyEvents(): unknown[] {
        if (!this.smc || this.cursor < 0) return [];
        const state = this.smc.seek(this.cursor);
        return state.events ?? [];
    }

    frame(): ReplayFrame {
        const engine = this.engine;
        return {
            index: this.cursor,
            visibleCandles: this.visibleCandles(),
            smartMoneyEvents: this.smartMoneyEvents(),
            account: engine ? engine.getAccount() : null,
            positions: engine ? engine.getPositions() : [],
            closedTrades: engine ? engine.getClosedPositions() : [],
            orders: engine ? engine.getOrders() : [],
            lastTrace: engine ? engine.getTraces()[engine.getTraces().length - 1] : undefined,
            total: this.total,
            atEnd: this.atEnd(),
        };
    }

    reset(): void {
        this.engine = null;
        this.cursor = (this.options.startAt ?? 0) - 1;
        this.playing = false;
    }
}
