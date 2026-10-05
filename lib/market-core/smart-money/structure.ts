/**
 * Market structure detection — deterministic, confirmation-aware.
 *
 * Rules (v1, SMART_MONEY_VERSION "1.0.0"):
 *
 * PIVOTS — a swing high at index i is the bar whose high is ≥ every high in
 * the ±`lookback` neighbourhood (ties allowed so equal highs pair up).
 *   • `detectedAt`     = pivot candle open time (anchor for drawing),
 *   • `confirmationAt` = close of candle i+lookback — the first moment the
 *     pivot is KNOWABLE. A partial right window yields a `developing`
 *     pivot whose confirmation is estimated past the end of the snapshot;
 *     it can therefore never pass an `asOf` gate on this data.
 *
 * CLASSIFICATION — over confirmed pivots, ordered by time:
 *   • swing high > previous swing high → HH, lower → LH
 *   • swing low  < previous swing low  → LL, higher → HL
 *
 * BREAKS — a break is evaluated on a candle CLOSE against the most recent
 * confirmed, not-yet-broken level that was already confirmable BEFORE that
 * candle opened (confirmationIndex < i):
 *   • close > last confirmed swing high → bullish break,
 *   • close < last confirmed swing low  → bearish break.
 * The first break continues structure (BOS); a break in the opposite
 * direction of the previous break is a change of character (CHOCH).
 * `pivotTime` (level) and `confirmationAt` (breaking candle close) are
 * always exposed — this is the anti-look-ahead contract used by backtest,
 * replay, alerts and AI.
 */

import type { CoreCandle, SmartMoneyObject } from "../types";
import { baseObject, closeTimeOf, isForming, makeId, type DetectorContext } from "./shared";

export interface Pivot {
    index: number;
    side: "high" | "low";
    price: number;
    timestamp: number;
    confirmationIndex: number;
    confirmationTime: number;
    developing: boolean;
}

/** All pivots (confirmed + developing) for a candle snapshot. */
export function detectPivots(candles: readonly CoreCandle[], lookback: number, tfMs: number): Pivot[] {
    const out: Pivot[] = [];
    const n = candles.length;
    if (n === 0 || lookback < 1) return out;

    for (let i = lookback; i < n; i++) {
        const c = candles[i];
        const leftFrom = i - lookback;
        const rightTo = Math.min(n - 1, i + lookback);
        // No right-side evidence at all (last bar) → not a pivot candidate.
        if (rightTo <= i) continue;
        let isHigh = true;
        let isLow = true;
        for (let j = leftFrom; j <= rightTo && (isHigh || isLow); j++) {
            if (j === i) continue;
            // Ties are allowed (a neighbour equal to the pivot keeps it a
            // pivot) so exact equal-highs/equal-lows can pair into liquidity
            // pools — matching lib/analytics/market-structure semantics.
            if (candles[j].high > c.high) isHigh = false;
            if (candles[j].low < c.low) isLow = false;
        }
        const rightCount = rightTo - i;
        const confirmed = rightCount >= lookback;
        const confirmationIndex = i + lookback;
        const confirmationTime = confirmed
            ? closeTimeOf(candles[confirmationIndex], tfMs)
            // Developing: estimate the confirmation past the snapshot end
            // (always greater than any close time in this snapshot).
            : closeTimeOf(candles[n - 1], tfMs) + (confirmationIndex - (n - 1)) * tfMs;

        if (isHigh) {
            out.push({ index: i, side: "high", price: c.high, timestamp: c.timestamp, confirmationIndex, confirmationTime, developing: !confirmed });
        }
        if (isLow) {
            out.push({ index: i, side: "low", price: c.low, timestamp: c.timestamp, confirmationIndex, confirmationTime, developing: !confirmed });
        }
    }
    return out;
}

export interface StructureResult {
    objects: SmartMoneyObject[];
    /** Most recent break direction (for bias). */
    bias: "bullish" | "bearish" | "neutral";
    lastSwingHigh?: number;
    lastSwingLow?: number;
    counts: { hh: number; hl: number; lh: number; ll: number; bos: number; choch: number };
    pivots: Pivot[];
}

export function detectStructure(ctx: DetectorContext): StructureResult {
    const { candles, lookback, tfMs, symbol, timeframe } = ctx;
    const pivots = detectPivots(candles, lookback, tfMs);
    const objects: SmartMoneyObject[] = [];
    const counts = { hh: 0, hl: 0, lh: 0, ll: 0, bos: 0, choch: 0 };

    const confirmedHighs = pivots.filter((p) => p.side === "high" && !p.developing);
    const confirmedLows = pivots.filter((p) => p.side === "low" && !p.developing);

    // ── pivot objects ──────────────────────────────────────────────────────
    for (const p of pivots) {
        const obj = baseObject(
            ctx,
            p.side === "high" ? "swing_high" : "swing_low",
            makeId([p.side === "high" ? "sh" : "sl", symbol, timeframe, p.timestamp]),
            p.timestamp,
            p.confirmationTime,
            p.side === "high" ? "bearish" : "bullish",
        );
        obj.status = p.developing ? "developing" : "confirmed";
        obj.price = p.price;
        obj.sourceCandles = [p.timestamp];
        obj.detectedAtIndex = p.index;
        obj.confirmationAtIndex = p.confirmationIndex;
        obj.metadata = { lookback };
        objects.push(obj);
    }

    // ── HH/HL/LH/LL classification over confirmed pivots ───────────────────
    const classify = (list: Pivot[], side: "high" | "low") => {
        for (let i = 1; i < list.length; i++) {
            const prev = list[i - 1];
            const cur = list[i];
            let kind: SmartMoneyObject["kind"] | null = null;
            if (side === "high") kind = cur.price > prev.price ? "hh" : cur.price < prev.price ? "lh" : null;
            else kind = cur.price < prev.price ? "ll" : cur.price > prev.price ? "hl" : null;
            if (!kind) continue;
            counts[kind] += 1;
            const obj = baseObject(
                ctx,
                kind,
                makeId([kind, symbol, timeframe, cur.timestamp]),
                cur.timestamp,
                cur.confirmationTime,
                kind === "hh" || kind === "hl" ? "bullish" : "bearish",
            );
            obj.status = "confirmed";
            obj.price = cur.price;
            obj.sourceCandles = [prev.timestamp, cur.timestamp];
            obj.detectedAtIndex = cur.index;
            obj.confirmationAtIndex = cur.confirmationIndex;
            obj.metadata = { previousPrice: prev.price, previousTime: prev.timestamp, pivotTime: cur.timestamp };
            objects.push(obj);
        }
    };
    classify(confirmedHighs, "high");
    classify(confirmedLows, "low");

    // ── BOS / CHOCH on closes ──────────────────────────────────────────────
    const highQueue = [...confirmedHighs];
    const lowQueue = [...confirmedLows];
    let hiPtr = 0;
    let loPtr = 0;
    let activeHigh: Pivot | null = null;
    let activeLow: Pivot | null = null;
    let highBroken = false;
    let lowBroken = false;
    let lastBreakDir: "bullish" | "bearish" | null = null;
    const breakDirs: Array<"bullish" | "bearish"> = [];
    let lastSwingHigh: number | undefined;
    let lastSwingLow: number | undefined;

    for (let i = 0; i < candles.length; i++) {
        // Promote pivots confirmed strictly before this candle opened.
        while (hiPtr < highQueue.length && highQueue[hiPtr].confirmationIndex < i) {
            activeHigh = highQueue[hiPtr];
            highBroken = false;
            hiPtr += 1;
        }
        while (loPtr < lowQueue.length && lowQueue[loPtr].confirmationIndex < i) {
            activeLow = lowQueue[loPtr];
            lowBroken = false;
            loPtr += 1;
        }
        if (activeHigh) lastSwingHigh = activeHigh.price;
        if (activeLow) lastSwingLow = activeLow.price;

        const c = candles[i];
        const forming = isForming(candles, i);

        if (activeHigh && !highBroken && c.close > activeHigh.price) {
            highBroken = true;
            const kind: SmartMoneyObject["kind"] = lastBreakDir === "bearish" ? "choch" : "bos";
            counts[kind] += 1;
            const obj = baseObject(
                ctx,
                kind,
                makeId([kind, "bull", symbol, timeframe, c.timestamp]),
                c.timestamp,
                closeTimeOf(c, tfMs),
                "bullish",
            );
            obj.status = forming ? "developing" : "confirmed";
            obj.price = activeHigh.price;
            obj.sourceCandles = [activeHigh.timestamp, c.timestamp];
            obj.detectedAtIndex = i;
            obj.confirmationAtIndex = i;
            obj.metadata = {
                pivotTime: activeHigh.timestamp,
                breakPrice: c.close,
                brokenLevel: activeHigh.price,
            };
            objects.push(obj);
            lastBreakDir = "bullish";
            breakDirs.push("bullish");
        }

        if (activeLow && !lowBroken && c.close < activeLow.price) {
            lowBroken = true;
            const kind: SmartMoneyObject["kind"] = lastBreakDir === "bullish" ? "choch" : "bos";
            counts[kind] += 1;
            const obj = baseObject(
                ctx,
                kind,
                makeId([kind, "bear", symbol, timeframe, c.timestamp]),
                c.timestamp,
                closeTimeOf(c, tfMs),
                "bearish",
            );
            obj.status = forming ? "developing" : "confirmed";
            obj.price = activeLow.price;
            obj.sourceCandles = [activeLow.timestamp, c.timestamp];
            obj.detectedAtIndex = i;
            obj.confirmationAtIndex = i;
            obj.metadata = {
                pivotTime: activeLow.timestamp,
                breakPrice: c.close,
                brokenLevel: activeLow.price,
            };
            objects.push(obj);
            lastBreakDir = "bearish";
            breakDirs.push("bearish");
        }
    }

    const recent = breakDirs.slice(-5);
    const bulls = recent.filter((d) => d === "bullish").length;
    const bears = recent.length - bulls;
    const bias: StructureResult["bias"] = recent.length === 0 ? "neutral" : bulls > bears ? "bullish" : bears > bulls ? "bearish" : "neutral";

    return {
        objects,
        bias,
        lastSwingHigh,
        lastSwingLow,
        counts,
        pivots,
    };
}
