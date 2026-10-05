/**
 * Liquidity detection — equal highs/lows, pools and sweeps.
 *
 * Rules (v1, SMART_MONEY_VERSION "1.0.0"):
 *
 * SIDES (platform-wide convention):
 *   • buy-side liquidity  (BSL) rests ABOVE highs — buy stops of shorts,
 *   • sell-side liquidity (SSL) rests BELOW lows  — sell stops of longs.
 *
 * POOLS — built from confirmed swing highs/lows and from clusters of equal
 * highs/lows. Equal-cluster rule: confirmed swing prices whose relative
 * distance is ≤ `equalTolerance` (default 0.001 = 0.1%) are pooled; the pool
 * price is the arithmetic mean and `confirmationAt` is the LAST contributing
 * swing's confirmation (the pool only exists once every member is known).
 *
 * SWEEPS — a sweep of a pool at level L requires:
 *   • above: candle.high > L AND candle.close < L   (wick through, close back)
 *   • below: candle.low  < L AND candle.close > L
 * evaluated only after the pool's `confirmationAt`. A sweep is `developing`
 * while its candle is still forming; `confirmationAt` = that candle's close.
 * A confirmed sweep invalidates the pool (the liquidity was taken).
 */

import type { SmartMoneyObject } from "../types";
import { baseObject, closeTimeOf, isForming, makeId, type DetectorContext } from "./shared";

export interface LiquidityResult {
    pools: SmartMoneyObject[];
    sweeps: SmartMoneyObject[];
    objects: SmartMoneyObject[];
}

interface SwingRef {
    price: number;
    timestamp: number;
    confirmationTime: number;
    index: number;
}

function clusterSwings(swings: SwingRef[], tolerance: number): SwingRef[][] {
    const sorted = [...swings].sort((a, b) => a.price - b.price);
    const clusters: SwingRef[][] = [];
    let current: SwingRef[] = [];
    for (const s of sorted) {
        if (current.length === 0) {
            current = [s];
            continue;
        }
        const anchor = current[0].price;
        const rel = Math.abs(s.price - anchor) / Math.max(anchor, Number.EPSILON);
        if (rel <= tolerance) current.push(s);
        else {
            clusters.push(current);
            current = [s];
        }
    }
    if (current.length > 0) clusters.push(current);
    return clusters;
}

export function detectLiquidity(ctx: DetectorContext, confirmedPivots: Array<{ side: "high" | "low"; price: number; timestamp: number; confirmationTime: number; index: number }>): LiquidityResult {
    const { candles, symbol, timeframe, equalTolerance } = ctx;
    const pools: SmartMoneyObject[] = [];
    const sweeps: SmartMoneyObject[] = [];

    const highs = confirmedPivots.filter((p) => p.side === "high");
    const lows = confirmedPivots.filter((p) => p.side === "low");

    // ── pools from confirmed swings ────────────────────────────────────────
    for (const s of confirmedPivots) {
        const side = s.side === "high" ? "buy_side" : "sell_side";
        const obj = baseObject(
            ctx,
            "liquidity_pool",
            makeId(["pool", s.side, symbol, timeframe, s.timestamp]),
            s.timestamp,
            s.confirmationTime,
            s.side === "high" ? "bullish" : "bearish",
        );
        obj.status = "active";
        obj.price = s.price;
        obj.sourceCandles = [s.timestamp];
        obj.detectedAtIndex = s.index;
        obj.strength = 40;
        obj.metadata = { side, source: "swing" };
        pools.push(obj);
    }

    // ── pools from equal highs / equal lows ────────────────────────────────
    const addCluster = (cluster: SwingRef[], side: "high" | "low") => {
        if (cluster.length < 2) return;
        const price = cluster.reduce((sum, s) => sum + s.price, 0) / cluster.length;
        // The pool exists as soon as the SECOND member confirms (that is the
        // first moment two equal touches are known). Later members refine the
        // pool (price/count) — point-in-time consumers that need the content
        // as-of a moment re-run detection on the available prefix.
        const byConfirmation = [...cluster].sort((a, b) => a.confirmationTime - b.confirmationTime);
        const confirmationAt = byConfirmation[1].confirmationTime;
        const detectedAt = byConfirmation[1].timestamp;
        const kind: SmartMoneyObject["kind"] = side === "high" ? "equal_highs" : "equal_lows";
        // Id anchored on the FIRST member so the pool identity is stable
        // across prefix runs.
        const anchorTime = byConfirmation[0].timestamp;
        const obj = baseObject(
            ctx,
            kind,
            makeId([kind, symbol, timeframe, anchorTime]),
            detectedAt,
            confirmationAt,
            side === "high" ? "bullish" : "bearish",
        );
        obj.status = "active";
        obj.price = price;
        obj.priceHigh = price;
        obj.priceLow = price;
        obj.sourceCandles = cluster.map((s) => s.timestamp);
        obj.strength = Math.min(100, 40 + cluster.length * 15);
        obj.metadata = {
            side: side === "high" ? "buy_side" : "sell_side",
            count: cluster.length,
            source: "equal",
            tolerance: equalTolerance,
        };
        pools.push(obj);
    };
    for (const cluster of clusterSwings(highs, equalTolerance)) addCluster(cluster, "high");
    for (const cluster of clusterSwings(lows, equalTolerance)) addCluster(cluster, "low");

    pools.sort((a, b) => a.confirmationAt - b.confirmationAt || a.price! - b.price!);

    // ── sweeps (only after the pool is known) ──────────────────────────────
    // A sweep requires the level to sit INSIDE the candle's own range
    // (wick through, close back), so pools are indexed by price and each
    // candle only checks the pools its range covers: O(n log p) instead of
    // O(n × pools).
    const poolState = new Map<string, { taken: boolean }>();
    for (const pool of pools) poolState.set(pool.id, { taken: false });
    const byPrice = [...pools].sort((a, b) => a.price! - b.price!);
    const priceAt = (i: number) => byPrice[i].price!;

    const lowerBound = (target: number): number => {
        let lo = 0;
        let hi = byPrice.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (priceAt(mid) < target) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };

    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        if (byPrice.length === 0) break;
        const forming = isForming(candles, i);
        const close = closeTimeOf(c, ctx.tfMs);
        let idx = lowerBound(c.low);
        for (; idx < byPrice.length; idx++) {
            const pool = byPrice[idx];
            if (priceAt(idx) > c.high) break;
            const state = poolState.get(pool.id)!;
            if (state.taken) continue;
            if (pool.confirmationAt > c.timestamp) continue; // pool not known yet
            const level = pool.price!;
            const isHighPool = pool.metadata?.side === "buy_side";
            const sweptAbove = isHighPool && c.high > level && c.close < level;
            const sweptBelow = !isHighPool && c.low < level && c.close > level;
            if (!sweptAbove && !sweptBelow) continue;

            state.taken = true;
            const side = isHighPool ? "buy_side" : "sell_side";
            const obj = baseObject(
                ctx,
                "liquidity_sweep",
                makeId(["sweep", pool.id, c.timestamp]),
                c.timestamp,
                close,
                sweptAbove ? "bearish" : "bullish",
            );
            obj.status = forming ? "developing" : "confirmed";
            obj.price = level;
            obj.priceHigh = sweptAbove ? c.high : level;
            obj.priceLow = sweptBelow ? c.low : level;
            obj.sourceCandles = [...pool.sourceCandles, c.timestamp];
            obj.detectedAtIndex = i;
            obj.confirmationAtIndex = i;
            obj.strength = pool.strength;
            obj.metadata = {
                side,
                poolId: pool.id,
                poolSource: pool.metadata?.source,
                sweepPrice: sweptAbove ? c.high : c.low,
            };
            sweeps.push(obj);

            pool.status = "invalidated";
            pool.invalidatedAt = close;
            pool.metadata = { ...pool.metadata, sweptAt: close, sweptBy: obj.id };
        }
    }

    return { pools, sweeps, objects: [...pools, ...sweeps] };
}
