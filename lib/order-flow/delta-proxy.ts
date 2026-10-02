/**
 * Estimated delta — candle-grade PROXY model (documented, not simulated).
 *
 * IMPORTANT — what this is and is not:
 *  • It is NOT bid/ask delta and NEVER will be from candles. Candle volume is
 *    still never split into fake buy/sell; there is no aggressor side here.
 *  • It is a deterministic proxy: each bar's whole volume is signed by the
 *    bar's body direction (close vs open — the documented model), producing a
 *    "directional volume pressure" series. It answers: is volume arriving on
 *    bars the market closes up, or on bars it closes down?
 *  • Data quality is ESTIMATED (a different data class than the true feature)
 *    and the method string ("candle-body-direction-volume") is stamped on
 *    every bucket so UI/AI can always tell it apart from HIGH-quality
 *    aggressor delta (lib/order-flow/delta.ts).
 *  • A provider upgrade (real classified trades) switches consumers to the
 *    true engine; this module never upgrades itself to HIGH.
 *
 * Semantics mirror the true delta engine so downstream code can treat both
 * uniformly: buckets on the candle timeframe, cumulative running total,
 * bucket-over-bucket acceleration, and the same four divergence types.
 *
 * Determinism: same candles ⇒ identical output. Replay purity: uses only the
 * candles passed in (callers pass a truncated prefix in backtests).
 */

import type { Timeframe } from "@/lib/market-data/types";
import type { MarketCandle } from "@/lib/market-data/types";
import type { DeltaBucket, DeltaDivergenceEvent, DeltaDivergenceType, DeltaResult, OrderFlowMode } from "./types";

export interface EstimatedDeltaOptions {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
}

/**
 * Compute the estimated (candle-direction) delta over chronological candles.
 * Each bucket = one candle. Doji bars (close === open) contribute zero.
 */
export function computeEstimatedDelta(candles: readonly MarketCandle[], options: EstimatedDeltaOptions): DeltaResult {
    const empty: DeltaResult = {
        symbol: options.symbol,
        timeframe: options.timeframe,
        mode: options.mode,
        buckets: [],
        buyVolume: 0,
        sellVolume: 0,
        delta: 0,
        deltaPercent: 0,
        cumulativeDelta: 0,
        deltaAcceleration: 0,
        dataQuality: "INSUFFICIENT_HISTORY",
        method: ESTIMATED_DELTA_METHOD,
    };
    if (!candles || candles.length === 0) return empty;
    // A window with no positive volume (volume-less feed) has nothing to
    // sign — INSUFFICIENT_HISTORY, never a flat fabricated zero series.
    if (!candles.some((c) => candleVolume(c) > 0)) return empty;

    const buckets: DeltaBucket[] = [];
    let upVolume = 0;
    let downVolume = 0;

    for (const c of candles) {
        const volume = candleVolume(c);
        const bullish = c.close > c.open;
        const bearish = c.close < c.open;
        const buyVolume = bullish ? volume : 0;
        const sellVolume = bearish ? volume : 0;
        const total = buyVolume + sellVolume;
        buckets.push({
            timestamp: c.timestamp,
            buyVolume,
            sellVolume,
            delta: buyVolume - sellVolume,
            deltaPercent: total > 0 ? ((buyVolume - sellVolume) / total) * 100 : 0,
        });
        upVolume += buyVolume;
        downVolume += sellVolume;
    }

    let cum = 0;
    for (const b of buckets) cum += b.delta;

    const n = buckets.length;
    const delta = upVolume - downVolume;
    const total = upVolume + downVolume;

    return {
        symbol: options.symbol,
        timeframe: options.timeframe,
        mode: options.mode,
        buckets,
        buyVolume: upVolume,
        sellVolume: downVolume,
        delta,
        deltaPercent: total > 0 ? (delta / total) * 100 : 0,
        cumulativeDelta: cum,
        deltaAcceleration: n >= 2 ? buckets[n - 1].delta - buckets[n - 2].delta : 0,
        dataQuality: "ESTIMATED",
        method: ESTIMATED_DELTA_METHOD,
    };
}

/** Method string stamped on every estimated-delta result and event. */
export const ESTIMATED_DELTA_METHOD = "candle-body-direction-volume";

function candleVolume(c: MarketCandle): number {
    return typeof c.volume === "number" && Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0;
}

/**
 * Divergence detection over estimated buckets + per-bucket close prices.
 * Emits the same four canonical types as the true-delta engine, but events
 * carry quality "ESTIMATED" and the proxy method so provenance stays honest.
 */
export function detectEstimatedDeltaDivergences(
    result: DeltaResult,
    prices: number[],
    meta: { symbol: string; timeframe: Timeframe; mode: OrderFlowMode },
): DeltaDivergenceEvent[] {
    const events: DeltaDivergenceEvent[] = [];
    const n = Math.min(result.buckets.length, prices.length);
    if (n < 2) return events;

    let cumPrev = 0;
    const cumulative: number[] = [];
    for (let i = 0; i < n; i++) {
        cumPrev += result.buckets[i].delta;
        cumulative.push(cumPrev);
    }

    for (let i = 1; i < n; i++) {
        const priceChange = prices[i] - prices[i - 1];
        const deltaChange = result.buckets[i].delta - result.buckets[i - 1].delta;
        const cumChange = cumulative[i] - cumulative[i - 1];
        for (const type of classifyDivergence(priceChange, deltaChange, cumChange)) {
            events.push({
                id: `estdiv_${type}_${meta.symbol}_${meta.timeframe}_${result.buckets[i].timestamp}`,
                timestamp: result.buckets[i].timestamp,
                symbol: meta.symbol,
                timeframe: meta.timeframe,
                mode: meta.mode,
                method: result.method,
                quality: "ESTIMATED",
                type,
                price: prices[i],
                priceChange,
                delta: result.buckets[i].delta,
                cumulativeDelta: cumulative[i],
            });
        }
    }
    return events;
}

/** All divergence types applicable to one bar-to-bar change. */
function classifyDivergence(priceChange: number, deltaChange: number, cumChange: number): DeltaDivergenceType[] {
    const eps = 1e-12;
    const types: DeltaDivergenceType[] = [];
    if (priceChange > eps && deltaChange < -eps) types.push("PRICE_UP_DELTA_DOWN");
    if (priceChange < -eps && deltaChange > eps) types.push("PRICE_DOWN_DELTA_UP");
    if (priceChange > eps && cumChange < -eps) types.push("PRICE_UP_CUM_DELTA_DOWN");
    if (priceChange < -eps && cumChange > eps) types.push("PRICE_DOWN_CUM_DELTA_UP");
    return types;
}
