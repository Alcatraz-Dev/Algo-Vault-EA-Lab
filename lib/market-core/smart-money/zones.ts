/**
 * Imbalance (FVG) and Order Block detection — deterministic, lifecycle-aware.
 *
 * Rules (v1, SMART_MONEY_VERSION "1.0.0"):
 *
 * FVG — three-candle gap:
 *   • bullish: c3.low  > c1.high  → zone = [c1.high, c3.low]
 *   • bearish: c3.high < c1.low   → zone = [c3.high, c1.low]
 * `detectedAt` = c3 open, `confirmationAt` = c3 close (the gap only exists
 * once the third candle closed). The zone SPANS from c1 (`metadata.zoneStart`)
 * for drawing.
 * Lifecycle (measured on later candles only):
 *   • fill < 50% of the gap           → active (metadata.fillPercent),
 *   • ≥ 50% penetration (CE reached)  → mitigated,
 *   • close beyond the gap origin     → invalidated (fully traded through).
 *
 * ORDER BLOCK — the last opposite candle before a displacement close:
 *   • bullish OB: bearish candle at i, and a later candle k (≤ i+lookahead)
 *     closes ABOVE c[i].high with a bullish close → displacement,
 *   • bearish OB: bullish candle at i, and a later candle k closes BELOW
 *     c[i].low with a bearish close.
 * The zone is c[i]'s high/low. `detectedAt` = k open, `confirmationAt` =
 * k close, zone anchored at c[i] (`metadata.zoneStart`).
 * Lifecycle:
 *   • close beyond the far edge      → invalidated (structure broken),
 *   • later trade back into the zone → mitigated.
 * Strength is deterministic: displacement body ÷ ATR(14), capped at 100.
 */

import { atrRuntime } from "../indicators/primitives";
import type { CoreCandle, SmartMoneyObject } from "../types";
import { baseObject, closeTimeOf, isForming, makeId, type DetectorContext } from "./shared";

export interface ZonesResult {
    fvgs: SmartMoneyObject[];
    orderBlocks: SmartMoneyObject[];
    objects: SmartMoneyObject[];
}

/** Wilder ATR(14) values aligned 1:1 with the candles (computed once). */
function atrSeriesOf(candles: readonly CoreCandle[], period = 14): Array<number | null> {
    const runtime = atrRuntime(period);
    const state = runtime.initialState();
    const out: Array<number | null> = new Array(candles.length);
    for (let i = 0; i < candles.length; i++) out[i] = runtime.step(state, candles[i]).value;
    return out;
}

export function detectFvgs(ctx: DetectorContext): SmartMoneyObject[] {
    const { candles, symbol, timeframe, tfMs } = ctx;
    const out: SmartMoneyObject[] = [];

    for (let i = 0; i + 2 < candles.length; i++) {
        const c1 = candles[i];
        const c3 = candles[i + 2];
        let bottom: number;
        let top: number;
        let direction: "bullish" | "bearish";
        if (c3.low > c1.high) {
            bottom = c1.high;
            top = c3.low;
            direction = "bullish";
        } else if (c3.high < c1.low) {
            bottom = c3.high;
            top = c1.low;
            direction = "bearish";
        } else {
            continue;
        }
        if (!(top > bottom)) continue;

        const formingThird = isForming(candles, i + 2);
        const height = top - bottom;
        const obj = baseObject(
            ctx,
            "fvg",
            makeId(["fvg", direction, symbol, timeframe, c1.timestamp]),
            c3.timestamp,
            closeTimeOf(c3, tfMs),
            direction,
        );
        obj.status = formingThird ? "developing" : "confirmed";
        obj.priceHigh = top;
        obj.priceLow = bottom;
        obj.sourceCandles = [c1.timestamp, candles[i + 1].timestamp, c3.timestamp];
        obj.detectedAtIndex = i + 2;
        obj.confirmationAtIndex = i + 2;

        // Lifecycle from candles AFTER the gap (point-in-time safe: running
        // detection on a prefix never sees these).
        let penetration = 0;
        let invalid = false;
        for (let k = i + 3; k < candles.length; k++) {
            const c = candles[k];
            if (direction === "bullish") {
                if (c.close <= bottom) invalid = true;
                penetration = Math.max(penetration, (top - Math.min(c.low, top)) / height);
            } else {
                if (c.close >= top) invalid = true;
                penetration = Math.max(penetration, (Math.max(c.high, bottom) - bottom) / height);
            }
            if (invalid) break;
        }
        const fill = Math.max(0, Math.min(1, penetration));
        if (invalid) {
            obj.status = "invalidated";
            obj.invalidatedAt = undefined;
        } else if (fill >= 0.5) {
            obj.status = "mitigated";
        } else if (obj.status === "confirmed") {
            obj.status = "active";
        }
        obj.metadata = {
            zoneStart: c1.timestamp,
            fillPercent: Math.round(fill * 100) / 100,
            height,
            midpoint: (top + bottom) / 2,
        };
        out.push(obj);
    }
    return out;
}

export function detectOrderBlocks(ctx: DetectorContext, options?: { lookahead?: number }): SmartMoneyObject[] {
    const { candles, symbol, timeframe, tfMs } = ctx;
    const lookahead = options?.lookahead ?? 3;
    const out: SmartMoneyObject[] = [];
    const atrSeries = atrSeriesOf(candles, 14);

    for (let i = 0; i < candles.length - 1; i++) {
        const c = candles[i];
        const bullishCandle = c.close > c.open;
        const limit = Math.min(candles.length - 1, i + lookahead);
        let displacementIndex = -1;
        for (let k = i + 1; k <= limit; k++) {
            const d = candles[k];
            const dBullish = d.close > d.open;
            if (!bullishCandle && dBullish && d.close > c.high) {
                displacementIndex = k;
                break;
            }
            if (bullishCandle && !dBullish && d.close < c.low) {
                displacementIndex = k;
                break;
            }
        }
        if (displacementIndex < 0) continue;

        const d = candles[displacementIndex];
        const direction: "bullish" | "bearish" = !bullishCandle ? "bullish" : "bearish";
        const forming = isForming(candles, displacementIndex);
        const atr = atrSeries[displacementIndex] ?? 0;
        const body = Math.abs(d.close - d.open);
        const strength = atr > 0 ? Math.max(10, Math.min(100, Math.round((body / (2 * atr)) * 100))) : 50;

        const obj = baseObject(
            ctx,
            "order_block",
            makeId(["ob", direction, symbol, timeframe, c.timestamp]),
            d.timestamp,
            closeTimeOf(d, tfMs),
            direction,
        );
        obj.status = forming ? "developing" : "confirmed";
        obj.priceHigh = c.high;
        obj.priceLow = c.low;
        obj.sourceCandles = [c.timestamp, d.timestamp];
        obj.detectedAtIndex = displacementIndex;
        obj.confirmationAtIndex = displacementIndex;
        obj.strength = strength;

        let mitigated = false;
        let invalidated = false;
        for (let k = displacementIndex + 1; k < candles.length; k++) {
            const later = candles[k];
            if (direction === "bullish") {
                if (later.close < c.low) {
                    invalidated = true;
                    break;
                }
                if (later.low <= c.high) mitigated = true;
            } else {
                if (later.close > c.high) {
                    invalidated = true;
                    break;
                }
                if (later.high >= c.low) mitigated = true;
            }
        }
        if (invalidated) obj.status = "invalidated";
        else if (mitigated) obj.status = "mitigated";
        else if (obj.status === "confirmed") obj.status = "active";

        obj.metadata = {
            zoneStart: c.timestamp,
            displacementTime: d.timestamp,
            displacementBody: body,
            atr: atr > 0 ? atr : undefined,
        };
        out.push(obj);
    }
    return out;
}

export function detectZones(ctx: DetectorContext, options?: { lookahead?: number }): ZonesResult {
    const fvgs = detectFvgs(ctx);
    const orderBlocks = detectOrderBlocks(ctx, options);
    return { fvgs, orderBlocks, objects: [...fvgs, ...orderBlocks] };
}
