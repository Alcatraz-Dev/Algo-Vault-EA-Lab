/**
 * Premium / Discount — dealing range from confirmed structure.
 *
 * Rules (v1, SMART_MONEY_VERSION "1.0.0"):
 *   • dealing range = [last confirmed swing low, last confirmed swing high]
 *     (both must already be confirmable; the range's `confirmationAt` is the
 *     later of the two confirmations),
 *   • equilibrium   = (high + low) / 2,
 *   • zone          = premium when price > equilibrium, discount below,
 *     equilibrium within 0.1% of the range.
 * If the latest confirmed high is BELOW the latest confirmed low the range is
 * invalid (crossed structure) and no object is emitted — never fabricate.
 */

import type { CoreCandle, SmartMoneyObject } from "../types";
import { baseObject, makeId, type DetectorContext } from "./shared";

export interface DealingRange {
    high: number;
    low: number;
    equilibrium: number;
    zone: "premium" | "discount" | "equilibrium";
    confirmationAt: number;
    highTime: number;
    lowTime: number;
}

export function detectDealingRange(
    ctx: DetectorContext,
    confirmedHighs: Array<{ price: number; timestamp: number; confirmationTime: number }>,
    confirmedLows: Array<{ price: number; timestamp: number; confirmationTime: number }>,
    lastClose: number,
): { range: DealingRange | null; object: SmartMoneyObject | null } {
    const high = confirmedHighs[confirmedHighs.length - 1];
    const low = confirmedLows[confirmedLows.length - 1];
    if (!high || !low || high.price <= low.price) return { range: null, object: null };

    const equilibrium = (high.price + low.price) / 2;
    const height = high.price - low.price;
    const distance = Math.abs(lastClose - equilibrium);
    const zone: DealingRange["zone"] =
        height > 0 && distance <= height * 0.001 ? "equilibrium" : lastClose > equilibrium ? "premium" : "discount";
    const confirmationAt = Math.max(high.confirmationTime, low.confirmationTime);

    const range: DealingRange = {
        high: high.price,
        low: low.price,
        equilibrium,
        zone,
        confirmationAt,
        highTime: high.timestamp,
        lowTime: low.timestamp,
    };

    const obj = baseObject(
        ctx,
        "dealing_range",
        makeId(["range", ctx.symbol, ctx.timeframe, high.timestamp, low.timestamp]),
        Math.max(high.timestamp, low.timestamp),
        confirmationAt,
        zone === "premium" ? "bearish" : zone === "discount" ? "bullish" : "neutral",
    );
    obj.status = "active";
    obj.priceHigh = high.price;
    obj.priceLow = low.price;
    obj.sourceCandles = [high.timestamp, low.timestamp];
    obj.strength = 60;
    obj.metadata = { equilibrium, zone, lastClose };

    return { range, object: obj };
}

/** Pure helper reused by dashboards: classify a price inside a range. */
export function classifyZone(price: number, range: Pick<DealingRange, "high" | "low" | "equilibrium">): DealingRange["zone"] {
    const height = range.high - range.low;
    if (!(height > 0)) return "equilibrium";
    const distance = Math.abs(price - range.equilibrium);
    if (distance <= height * 0.001) return "equilibrium";
    return price > range.equilibrium ? "premium" : "discount";
}

/** Guard: the detector never runs on an empty series. */
export function hasRangeInputs(candles: readonly CoreCandle[]): boolean {
    return candles.length > 0;
}
