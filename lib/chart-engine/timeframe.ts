/**
 * Canonical timeframe engine — the single source of truth for candle
 * boundaries across AlgoVault.
 *
 * A candle's `timestamp` is ALWAYS its opening time, aligned to
 * `floor(ts / intervalMs) * intervalMs` in UTC. Every part of the platform
 * (charts, aggregators, indicators, Smart Money, replay) must resolve
 * boundaries through this module so no consumer hard-codes timeframe math.
 */

import type { Timeframe } from "@/lib/market-data/types";

/** Chart engine operates on the intraday timeframes the providers expose. */
export const CHART_TIMEFRAMES = [
    "M1",
    "M3",
    "M5",
    "M15",
    "M30",
    "H1",
    "H4",
] as const satisfies readonly Timeframe[];

export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number];

/** Interval length in milliseconds per canonical timeframe. */
export const TIMEFRAME_MS: Record<ChartTimeframe, number> = {
    M1: 60_000,
    M3: 180_000,
    M5: 300_000,
    M15: 900_000,
    M30: 1_800_000,
    H1: 3_600_000,
    H4: 14_400_000,
};

export function isChartTimeframe(tf: string): tf is ChartTimeframe {
    return (CHART_TIMEFRAMES as readonly string[]).includes(tf.toUpperCase());
}

export function timeframeMs(timeframe: ChartTimeframe): number {
    return TIMEFRAME_MS[timeframe];
}

/**
 * Opening time of the candle bucket containing `timestampMs`.
 * All candle math is UTC — forex closes on weekends but buckets never skew
 * by timezone.
 */
export function candleOpenTime(timestampMs: number, timeframe: ChartTimeframe): number {
    const interval = TIMEFRAME_MS[timeframe];
    return Math.floor(timestampMs / interval) * interval;
}

/** Opening time of the candle immediately after the bucket containing ts. */
export function nextCandleOpenTime(timestampMs: number, timeframe: ChartTimeframe): number {
    return candleOpenTime(timestampMs, timeframe) + timeframeMs(timeframe);
}

/** True when the timestamp falls inside the candle that opened at openTime. */
export function isInCandle(timestampMs: number, openTime: number, timeframe: ChartTimeframe): boolean {
    return (
        timestampMs >= openTime &&
        timestampMs < openTime + TIMEFRAME_MS[timeframe]
    );
}

/**
 * Is the (forex/CFD) market expected to be tradable at `timestampMs`?
 * Trading week: Sunday 21:00 UTC → Friday 21:00 UTC. Crypto exchanges trade
 * through the weekend — callers dealing with crypto-only symbols can pass
 * `alwaysOpen` to skip the weekend gate.
 */
export function isMarketTradableAt(timestampMs: number, opts?: { alwaysOpen?: boolean }): boolean {
    if (opts?.alwaysOpen) return true;
    const d = new Date(timestampMs);
    const day = d.getUTCDay(); // 0 = Sunday
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (day === 6) return false; // Saturday
    if (day === 0) return minutes >= 21 * 60; // Sunday until 21:00 UTC
    if (day === 5) return minutes < 21 * 60; // Friday after 21:00 UTC
    return true;
}

/**
 * Candle-open times a healthy feed would have produced between `fromMs`
 * (exclusive) and `toMs` (inclusive) while the market was tradable. Used for
 * gap detection: market-closed periods are NOT gaps.
 */
export function expectedCandleOpens(fromMs: number, toMs: number, timeframe: ChartTimeframe, opts?: { alwaysOpen?: boolean }): number[] {
    const interval = TIMEFRAME_MS[timeframe];
    const opens: number[] = [];
    const first = candleOpenTime(fromMs, timeframe) + interval;
    for (let t = first; t <= toMs; t += interval) {
        if (isMarketTradableAt(t, opts)) opens.push(t);
    }
    return opens;
}
