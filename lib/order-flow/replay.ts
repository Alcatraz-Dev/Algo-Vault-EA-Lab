/**
 * Replay/backtest adapter — Order Flow at a historical boundary.
 *
 * Wraps the pure engines behind the replay discipline the backtesting system
 * already enforces (lib/market-intelligence/backtesting): the caller supplies
 * the full candle/trade history plus the replay index, and the adapter feeds
 * the engines ONLY the prefix up to that index. No engine sees future data.
 */

import type { Timeframe } from "@/lib/market-data/types";
import type { OrderFlowTrade } from "./types";
import { buildOrderFlowContext, type OrderFlowContextInput } from "./context-builder";
import type { ChartCandle } from "@/lib/chart-engine/candle";
import type { MarketCandle } from "@/lib/market-data/types";

export interface ReplayOrderFlowOptions {
    symbol: string;
    timeframe: Timeframe;
    /** Full historical series (oldest → newest). Never truncated by the caller. */
    candles: readonly (ChartCandle | MarketCandle)[];
    /** Full historical trade tape (optional). */
    trades?: readonly OrderFlowTrade[];
    /** Full historical L2 snapshots (optional). */
    l2Snapshots?: readonly L2Snapshot[];
    /** Flags/settings passthrough. */
    settings?: OrderFlowContextInput["settings"];
}

type L2Snapshot = import("./types").L2Snapshot;

/**
 * Order flow state as it existed AT `index` (inclusive). Deterministic:
 * calling with the same index always returns the same context, and the
 * context at index i is unaffected by any element after i.
 */
export function orderFlowAtBoundary(
    options: ReplayOrderFlowOptions,
    index: number,
): ReturnType<typeof buildOrderFlowContext> {
    const clamped = Math.max(0, Math.min(index, options.candles.length - 1));
    const boundaryTs = options.candles[clamped].timestamp;

    const candlesUpTo = options.candles.slice(0, clamped + 1);
    // Trades/snapshots are filtered by the candle boundary timestamp — the
    // context builder re-filters defensively as well.
    const tradesUpTo = (options.trades ?? []).filter((t) => t.timestamp <= boundaryTs);
    const l2UpTo = (options.l2Snapshots ?? []).filter((s) => s.timestamp <= boundaryTs);

    return buildOrderFlowContext({
        symbol: options.symbol,
        timeframe: options.timeframe,
        mode: "replay",
        asOf: boundaryTs,
        candles: candlesUpTo,
        trades: tradesUpTo,
        l2Snapshots: l2UpTo,
        settings: options.settings,
    });
}

/**
 * Streaming replay accumulator — one pass over history, snapshot at any index.
 * O(1) per candle; snapshots are exact reconstructions of the boundary state
 * for the candle-grade features (profile/absorption/exhaustion).
 */
export class ReplayOrderFlow {
    private readonly options: ReplayOrderFlowOptions;
    private cursor = 0;

    constructor(options: ReplayOrderFlowOptions) {
        this.options = options;
    }

    /** Advance the replay cursor one candle; returns the boundary context. */
    step(): ReturnType<typeof buildOrderFlowContext> | null {
        if (this.cursor >= this.options.candles.length) return null;
        const ctx = orderFlowAtBoundary(this.options, this.cursor);
        this.cursor += 1;
        return ctx;
    }

    /** Seek directly to a boundary (forward or backward — always deterministic). */
    seek(index: number): ReturnType<typeof buildOrderFlowContext> {
        this.cursor = Math.max(0, Math.min(index, this.options.candles.length - 1));
        return orderFlowAtBoundary(this.options, this.cursor);
    }

    reset(): void {
        this.cursor = 0;
    }
}
