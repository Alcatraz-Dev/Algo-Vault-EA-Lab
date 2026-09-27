import type { Time } from "lightweight-charts";
import type { MarketCandle } from "./types";

/**
 * Shared candle-merging helpers for live charts.
 *
 * The canonical `/api/analytics/ohlc` feed returns closed (and the forming)
 * candles; a live quote ticks faster than the feed. These helpers merge the
 * two so charts can show a moving last candle without fabricating data:
 * the forming candle's high/low/close track the live quote, its open stays
 * anchored to the provider bar. Closed candles are never rewritten.
 */

export type LiveTick = {
    price: number;
    timestamp: number;
};

/** Coarse per-timeframe bucket sizes in ms (used when a tick needs a new bar). */
export const TIMEFRAME_MS: Record<string, number> = {
    M1: 60_000,
    M3: 180_000,
    M5: 300_000,
    M15: 900_000,
    M30: 1_800_000,
    H1: 3_600_000,
    H4: 14_400_000,
    D1: 86_400_000,
};

export function timeframeMs(timeframe: string): number {
    return TIMEFRAME_MS[String(timeframe).toUpperCase()] ?? 300_000;
}

/**
 * Merge a live tick into a candle array (mutates nothing; returns the same
 * array when nothing changed, a new array when a bar was appended).
 *
 * Rules:
 *  - tick lands inside the forming bar → high/low/close extend toward it;
 *  - tick opens a new bar (its bucket time is beyond the last bar's) → a new
 *    candle is appended seeded at the tick price;
 *  - the forming bar is considered the last array entry regardless of
 *    provider `isOpen` flags, so merged output always ends with a live bar.
 */
export function applyLiveTick(
    candles: MarketCandle[],
    tick: LiveTick,
    timeframe: string
): MarketCandle[] {
    if (!Number.isFinite(tick.price) || tick.price <= 0) return candles;
    if (candles.length === 0) return candles;

    const last = candles[candles.length - 1];
    const bucketMs = timeframeMs(timeframe);
    const lastBarOpen = Math.floor(last.timestamp / bucketMs) * bucketMs;
    const tickBarOpen = Math.floor(tick.timestamp / bucketMs) * bucketMs;

    if (tickBarOpen > lastBarOpen) {
        const next: MarketCandle = {
            timestamp: tickBarOpen,
            open: last.close,
            high: Math.max(last.close, tick.price),
            low: Math.min(last.close, tick.price),
            close: tick.price,
            volume: 0,
        };
        // Do not fabricate history if the provider bar has not arrived yet:
        // only append one forward bar.
        return [...candles, next];
    }

    if (tick.price === last.close && tick.price >= last.high && tick.price <= last.low) {
        return candles;
    }
    if (tick.price === last.close && tick.price <= last.high && tick.price >= last.low) {
        return candles; // no visible change
    }

    const updated: MarketCandle = {
        ...last,
        high: Math.max(last.high, tick.price),
        low: Math.min(last.low, tick.price),
        close: tick.price,
    };
    if (
        updated.high === last.high &&
        updated.low === last.low &&
        updated.close === last.close
    ) {
        return candles;
    }
    return [...candles.slice(0, -1), updated];
}

/** lightweight-charts candle point from a MarketCandle. */
export function toCandlePoint(c: MarketCandle): {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
} {
    return {
        time: (Math.floor(c.timestamp / 1000) as number) as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
    };
}

/** lightweight-charts histogram point (volume) from a MarketCandle. */
export function toVolumePoint(c: MarketCandle): {
    time: Time;
    value: number;
    color: string;
} {
    const up = c.close >= c.open;
    return {
        time: (Math.floor(c.timestamp / 1000) as number) as Time,
        value: c.volume ?? 0,
        color: up ? "rgba(38, 166, 154, 0.45)" : "rgba(239, 83, 80, 0.45)",
    };
}

/**
 * Push the newest candle of `candles` into a lightweight-charts series when it
 * differs from what the series already shows. Works for both the initial
 * full `setData` (nothing tracked yet) and incremental `series.update()`.
 *
 * `lastPushedRef` must be a per-chart ref: { time, close, high, low, open } of
 * the final bar the series currently holds.
 */
export type LastPushedBar = {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
} | null;

export function pushLiveBar(
    series: { update: (bar: unknown) => void } | null,
    candles: MarketCandle[],
    lastPushed: LastPushedBar,
    setLastPushed: (bar: LastPushedBar) => void
): void {
    if (!series || candles.length === 0) return;
    const last = candles[candles.length - 1];
    const time = Math.floor(last.timestamp / 1000);
    const bar = { time, open: last.open, high: last.high, low: last.low, close: last.close };

    const changed =
        !lastPushed ||
        lastPushed.time !== bar.time ||
        lastPushed.open !== bar.open ||
        lastPushed.high !== bar.high ||
        lastPushed.low !== bar.low ||
        lastPushed.close !== bar.close;

    if (!changed) return;
    try {
        series.update({
            ...bar,
            time: bar.time as unknown as Time,
        });
        setLastPushed(bar);
    } catch {
        // Series may have been reset concurrently; the next full setData fixes it.
    }
}
