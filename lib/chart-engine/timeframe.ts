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
 * Helper to determine if US Eastern Time is currently in Daylight Saving Time (EDT).
 * US DST: second Sunday in March at 02:00 local to first Sunday in November at 02:00 local.
 */
export function isUSEasternDST(date: Date): boolean {
    try {
        const tzString = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            timeZoneName: "short",
        }).format(date);
        return tzString.includes("EDT");
    } catch {
        const month = date.getUTCMonth();
        return month >= 2 && month <= 10;
    }
}

/**
 * Is the (forex/CFD) market expected to be tradable at `timestampMs`?
 * Trading week: Sunday 21:00 UTC → Friday 21:00 UTC. Crypto exchanges trade
 * through the weekend — callers dealing with crypto-only symbols can pass
 * `alwaysOpen` to skip the weekend gate.
 */
export function isMarketTradableAt(timestampMs: number, opts?: { alwaysOpen?: boolean; symbol?: string }): boolean {
    if (opts?.alwaysOpen) return true;
    const rawSymbol = opts?.symbol?.toUpperCase() || "";
    const isCrypto = rawSymbol ? /BTC|ETH|SOL|XRP|ADA|DOGE|BNB|LTC|DOT/i.test(rawSymbol) : false;
    if (isCrypto) return true;

    const isMetal = rawSymbol ? /XAU|XAG|GOLD|SILVER/i.test(rawSymbol) : false;
    const isIndex = rawSymbol ? /US30|NAS100|SPX500|GER40|UK100|DAX/i.test(rawSymbol) : false;

    const d = new Date(timestampMs);
    const day = d.getUTCDay(); // 0 = Sunday
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();

    if (day === 6) return false; // Saturday: always closed

    const isEDT = isUSEasternDST(d);
    // Sunday open: Metals & Indices open 18:00 New York time
    // In summer (EDT, UTC-4): 18:00 NY = 22:00 UTC
    // In winter (EST, UTC-5): 18:00 NY = 23:00 UTC
    const metalsOpenMin = isEDT ? 22 * 60 : 23 * 60;

    if (isMetal) {
        // Metals open Sunday 18:00 NY time, close Friday 21:00 UTC
        if (day === 0) return minutes >= metalsOpenMin;
        if (day === 5) return minutes < 21 * 60;
        // Daily break Monday - Thursday 21:00 to 22:00 UTC
        if (minutes >= 21 * 60 && minutes < 22 * 60) return false;
        return true;
    }

    if (isIndex) {
        // Indices open Sunday 18:00 NY time, close Friday 21:00 UTC
        if (day === 0) return minutes >= metalsOpenMin;
        if (day === 5) return minutes < 21 * 60;
        if (minutes >= 21 * 60 && minutes < 22 * 60) return false;
        return true;
    }

    // Default Forex: Sunday 21:00 UTC → Friday 21:00 UTC
    if (day === 0) return minutes >= 21 * 60;
    if (day === 5) return minutes < 21 * 60;
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
