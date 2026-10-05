/**
 * Shared helpers for the deterministic Smart Money detectors.
 *
 * Time rules (see docs/market-intelligence-core.md):
 *  - A candle's EVIDENCE (H/L/C) is only known when that candle closes.
 *  - `closeTimeOf(candle)` = open + timeframe length = the moment the candle
 *    becomes evidence. That instant is also the open of the next candle.
 *  - `confirmationAt` on every object is one of these close times, so a
 *    consumer can gate visibility with `confirmationAt <= asOf` and never
 *    see a future-confirmed object early.
 */

import type { CoreCandle, SmartMoneyObject } from "../types";

/** Interval length in ms for every canonical timeframe token. */
export function timeframeToMs(timeframe: string): number {
    switch (String(timeframe).toUpperCase()) {
        case "M1": return 60_000;
        case "M3": return 180_000;
        case "M5": return 300_000;
        case "M15": return 900_000;
        case "M30": return 1_800_000;
        case "H1": return 3_600_000;
        case "H4": return 14_400_000;
        case "D1": return 86_400_000;
        case "W1": return 604_800_000;
        default: return 0;
    }
}

/** The moment a candle's values become knowable (its close). */
export function closeTimeOf(candle: CoreCandle, tfMs: number): number {
    return candle.timestamp + tfMs;
}

const CANONICAL_INTERVALS: Array<[string, number]> = [
    ["M1", 60_000],
    ["M3", 180_000],
    ["M5", 300_000],
    ["M15", 900_000],
    ["M30", 1_800_000],
    ["H1", 3_600_000],
    ["H4", 14_400_000],
    ["D1", 86_400_000],
    ["W1", 604_800_000],
];

/**
 * Infer the canonical timeframe token from candle spacing for callers that
 * only hold raw candles (server adapters, confluence, AI draw plans).
 *
 * Uses the SMALLEST recent gap so weekend/session holes never inflate the
 * result; exact matches win, otherwise the nearest canonical interval.
 * Feeds `timeframeToMs()` for confirmation-time math only — engines that
 * receive explicit timeframe metadata must pass it instead.
 */
export function inferTimeframe(candles: ReadonlyArray<{ timestamp: number }>): string {
    if (candles.length < 2) return "M5";
    let minGap = Number.POSITIVE_INFINITY;
    const start = Math.max(1, candles.length - 50);
    for (let i = start; i < candles.length; i++) {
        const gap = Math.abs(candles[i].timestamp - candles[i - 1].timestamp);
        if (gap > 0 && gap < minGap) minGap = gap;
    }
    if (!Number.isFinite(minGap)) return "M5";
    let best = "M5";
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const [tf, ms] of CANONICAL_INTERVALS) {
        const diff = Math.abs(ms - minGap);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = tf;
        }
    }
    return best;
}

/**
 * The last candle in a snapshot may still be forming. Everything before it
 * is closed data by construction (a closed candle never changes identity in
 * the canonical series), so the forming flag only matters for the tail.
 */
export function isForming(candles: readonly CoreCandle[], index: number): boolean {
    return index === candles.length - 1 && candles[index].finalized !== true;
}

/** Confirmation time for a candle's evidence given its forming state. */
export function evidenceTime(candles: readonly CoreCandle[], index: number, tfMs: number): number {
    return closeTimeOf(candles[index], tfMs);
}

export interface DetectorContext {
    symbol: string;
    timeframe: string;
    tfMs: number;
    candles: readonly CoreCandle[];
    lookback: number;
    equalTolerance: number;
}

export function makeId(parts: Array<string | number>): string {
    return parts.join("|");
}

/** Deterministic 0–100 strength from a ratio (never model-generated). */
export function strengthFromRatio(ratio: number, fullAt = 2): number {
    if (!Number.isFinite(ratio)) return 0;
    return Math.max(0, Math.min(100, Math.round((ratio / fullAt) * 100)));
}

/** Sorted clone of canonical candle timestamps for quick lookups. */
export function timestampsOf(candles: readonly CoreCandle[]): number[] {
    return candles.map((c) => c.timestamp);
}

export function baseObject(
    ctx: DetectorContext,
    kind: SmartMoneyObject["kind"],
    id: string,
    detectedAt: number,
    confirmationAt: number,
    direction: SmartMoneyObject["direction"],
): SmartMoneyObject {
    return {
        id,
        kind,
        symbol: ctx.symbol,
        timeframe: ctx.timeframe,
        detectedAt,
        confirmationAt,
        status: "confirmed",
        direction,
        sourceCandles: [],
    };
}
