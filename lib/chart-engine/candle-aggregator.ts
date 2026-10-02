import type { ChartCandle, ChartTick } from "./candle";
import { candleKey } from "./candle";
import { candleOpenTime, isInCandle, type ChartTimeframe } from "./timeframe";

/**
 * CandleAggregator — Phase 4 real-time candle engine.
 *
 * Deterministic, side-effect-free reducer that folds market events (history
 * batches and live ticks) into a chronologically ordered candle series:
 *
 *   applyHistory(series, candles) → HistoryResult
 *   applyTick(series, tick)       → TickResult
 *
 * Rules:
 *  - A tick inside the current forming candle updates high/low/close/volume.
 *  - A tick in a NEW bucket finalizes the previous candle (finalized: true)
 *    and appends a new forming candle seeded at the tick price.
 *  - A tick in an OLD bucket (backfill arriving late) is discarded — history
 *    is authoritative for the past; ticks are authoritative for the present.
 *  - Candles are keyed by symbol|timeframe|timestamp; duplicates never occur.
 *  - Output is always sorted by opening time.
 *
 * Market-closed handling lives upstream: the engine only ever creates candles
 * from real observations, so a closed market simply produces no new candles.
 */

export type HistoryResult = {
    series: ChartCandle[];
    /** Rows dropped as invalid — never silently accepted. */
    rejected: number;
    /** Rows dropped as duplicates of candles already in the series. */
    duplicates: number;
};

export type TickResult = {
    series: ChartCandle[];
    /** "none" — tick was a no-op (stale/old bucket/no visible change). */
    action: "none" | "update" | "new";
    /** True when the previously forming candle got finalized by this tick. */
    finalizedPrevious: boolean;
    /** True when anything visible changed (caller can skip re-renders). */
    changed: boolean;
};

/** Binary search: index of the last candle with timestamp <= targetMs. */
function indexAtOrBefore(series: ChartCandle[], targetMs: number): number {
    let lo = 0;
    let hi = series.length - 1;
    let ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (series[mid].timestamp <= targetMs) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

/**
 * Merge a batch of (usually provider) candles into the series. Out-of-order
 * input is fine; older candles backfill gaps, newer candles overwrite the
 * forming tail (provider bars win over quote-merged tails on reconcile).
 */
export function applyHistory(
    series: ChartCandle[],
    incoming: ChartCandle[],
): HistoryResult {
    let rejected = 0;
    let duplicates = 0;

    const byKey = new Map<string, ChartCandle>();
    for (const c of series) byKey.set(candleKey(c.symbol, c.timeframe, c.timestamp), c);

    for (const c of incoming) {
        if (!c || !Number.isFinite(c.timestamp) || !Number.isFinite(c.close)) {
            rejected += 1;
            continue;
        }
        const key = candleKey(c.symbol, c.timeframe, c.timestamp);
        const existing = byKey.get(key);
        if (existing) {
            duplicates += 1;
            // Prefer the provider candle (history authority) over a
            // quote-merged tail candle.
            byKey.set(key, c);
            continue;
        }
        byKey.set(key, c);
    }

    const merged = Array.from(byKey.values()).sort((a, b) => a.timestamp - b.timestamp);
    return { series: merged, rejected, duplicates };
}

/**
 * Fold one live tick into the series. Never mutates the input array; returns
 * the same reference when nothing changed so React subscriptions can bail out
 * cheaply.
 */
export function applyTick(
    series: ChartCandle[],
    tick: ChartTick,
    timeframe: ChartTimeframe,
): TickResult {
    if (series.length === 0 || !tick || !Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.timestamp)) {
        return { series, action: "none", finalizedPrevious: false, changed: false };
    }

    const last = series[series.length - 1];
    const tickBucket = candleOpenTime(tick.timestamp, timeframe);
    const lastBucket = last.timestamp;

    // Tick is older than the forming candle: belongs to history. Ignore
    // rather than rewriting the past with quote data.
    if (tickBucket < lastBucket) {
        return { series, action: "none", finalizedPrevious: false, changed: false };
    }

    if (isInCandle(tick.timestamp, lastBucket, timeframe)) {
        // Update the forming candle in place.
        const prevHigh = last.high;
        const prevLow = last.low;
        const prevClose = last.close;
        const prevVolume = last.volume ?? 0;

        const high = Math.max(prevHigh, tick.price);
        const low = Math.min(prevLow, tick.price);
        const close = tick.price;
        const volume = prevVolume + (tick.volume ?? 0);

        const changed =
            high !== prevHigh || low !== prevLow || close !== prevClose || volume !== prevVolume;
        if (!changed) {
            return { series, action: "none", finalizedPrevious: false, changed: false };
        }

        const updated: ChartCandle = {
            ...last,
            high,
            low,
            close,
            volume,
        };
        const next = series.slice(0, -1);
        next.push(updated);
        return { series: next, action: "update", finalizedPrevious: false, changed: true };
    }

    // tickBucket > lastBucket: boundary crossed. Finalize the previous candle
    // and open a new forming candle seeded at the tick price. If the gap
    // spans multiple buckets (provider hiccup, weekend), only ONE new candle
    // is created from this real tick — empty buckets are NOT fabricated.
    const finalizedPrev: ChartCandle = { ...last, finalized: true };
    const fresh: ChartCandle = {
        timestamp: tickBucket,
        open: last.close,
        high: Math.max(last.close, tick.price),
        low: Math.min(last.close, tick.price),
        close: tick.price,
        volume: tick.volume ?? 0,
        symbol: last.symbol,
        timeframe: last.timeframe,
        finalized: false,
    };
    const next = series.slice(0, -1);
    next.push(finalizedPrev, fresh);
    return { series: next, action: "new", finalizedPrevious: true, changed: true };
}

/** Chronology validator used after merges and before renders. */
export function isChronological(series: ChartCandle[]): boolean {
    for (let i = 1; i < series.length; i++) {
        if (series[i].timestamp <= series[i - 1].timestamp) return false;
    }
    return true;
}

/** Enforce strict chronology by dropping out-of-order rows (defensive). */
export function enforceChronology(series: ChartCandle[]): ChartCandle[] {
    if (isChronological(series)) return series;
    const out: ChartCandle[] = [];
    for (const c of series) {
        if (out.length === 0 || c.timestamp > out[out.length - 1].timestamp) out.push(c);
    }
    return out;
}

export { indexAtOrBefore };
