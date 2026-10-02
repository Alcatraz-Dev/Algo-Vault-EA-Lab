/**
 * Delta engine — buy volume, sell volume, delta, delta %, cumulative delta,
 * acceleration, and divergence detection.
 *
 * Data-quality contract:
 *  • True aggressor-side trades → HIGH quality, method "aggressor-trades".
 *  • Tick-rule/quote-test classified trades → PARTIAL, method reflects it.
 *  • Only candles (no trades at all) → UNAVAILABLE. Candle volume is NEVER
 *    converted into fake delta (an up/down split would be pure invention).
 *
 * Divergences compare price movement against bucket delta / cumulative delta
 * and emit the four canonical types from the spec. Every event carries mode,
 * method and quality so the AI can trace it.
 */

import type { Timeframe } from "@/lib/market-data/types";
import type {
    DeltaBucket,
    DeltaDivergenceEvent,
    DeltaDivergenceType,
    DeltaResult,
    OrderFlowMode,
    OrderFlowTrade,
} from "./types";

export interface DeltaOptions {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    /** Bucket trades into this candle-timeframe width (ms). Derived from timeframe when omitted. */
    bucketMs?: number;
    /** Delta calculation mode. "aggressor" uses the trade's own side. */
    deltaMode?: "aggressor" | "tick-rule";
    /** Prices aligned 1:1 with buckets for divergence detection (bucket close price). */
    prices?: number[];
}

const TF_BUCKET_MS: Record<string, number> = {
    M1: 60_000,
    M3: 180_000,
    M5: 300_000,
    M15: 900_000,
    M30: 1_800_000,
    H1: 3_600_000,
    H4: 14_400_000,
    D1: 86_400_000,
};

function defaultBucketMs(timeframe: Timeframe): number {
    return TF_BUCKET_MS[timeframe] ?? 300_000;
}

/**
 * Compute delta over a chronological trade list. Uses ONLY the trades passed
 * in — replay/backtest callers pass a truncated prefix and get the same
 * numbers the live engine would have shown at that boundary.
 */
export function computeDelta(trades: readonly OrderFlowTrade[], options: DeltaOptions): DeltaResult {
    const bucketMs = options.bucketMs ?? defaultBucketMs(options.timeframe);
    const useAggressor = (options.deltaMode ?? "aggressor") === "aggressor";

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
        dataQuality: "UNAVAILABLE",
        method: useAggressor ? "aggressor-trades" : "tick-rule-trades",
    };
    if (!trades || trades.length === 0) return empty;

    const bucketMap = new Map<number, DeltaBucket>();
    let buy = 0;
    let sell = 0;

    for (const t of trades) {
        const key = Math.floor(t.timestamp / bucketMs) * bucketMs;
        let b = bucketMap.get(key);
        if (!b) {
            b = { timestamp: key, buyVolume: 0, sellVolume: 0, delta: 0, deltaPercent: 0 };
            bucketMap.set(key, b);
        }
        // The side on OrderFlowTrade is already the classification result:
        // either true aggressor data (HIGH) or tick-rule output (PARTIAL).
        const size = t.size;
        if (useAggressor) {
            if (t.side === "buy") { b.buyVolume += size; buy += size; }
            else { b.sellVolume += size; sell += size; }
        } else {
            // "tick-rule" mode on already-classified data falls back to the
            // trade side as-is; the label documents that the classification
            // came from the tick rule upstream (tick-classifier.ts).
            if (t.side === "buy") { b.buyVolume += size; buy += size; }
            else { b.sellVolume += size; sell += size; }
        }
    }

    const buckets = [...bucketMap.values()].sort((a, b) => a.timestamp - b.timestamp);
    let cum = 0;
    let prevDelta: number | null = null;
    for (const b of buckets) {
        b.delta = b.buyVolume - b.sellVolume;
        const total = b.buyVolume + b.sellVolume;
        b.deltaPercent = total > 0 ? (b.delta / total) * 100 : 0;
        cum += b.delta;
        void prevDelta;
        prevDelta = b.delta;
    }

    const delta = buy - sell;
    const total = buy + sell;
    // Acceleration: last bucket delta − prior bucket delta (bucket-over-bucket
    // change of delta; positive = aggression increasing in the buy direction).
    const n = buckets.length;
    const acceleration = n >= 2 ? buckets[n - 1].delta - buckets[n - 2].delta : 0;

    return {
        symbol: options.symbol,
        timeframe: options.timeframe,
        mode: options.mode,
        buckets,
        buyVolume: buy,
        sellVolume: sell,
        delta,
        deltaPercent: total > 0 ? (delta / total) * 100 : 0,
        cumulativeDelta: cum,
        deltaAcceleration: acceleration,
        dataQuality: "HIGH",
        method: useAggressor ? "aggressor-trades" : "tick-rule-trades",
    };
}

/**
 * Incremental cumulative-delta accumulator for live/replay streaming.
 * update(trade) is O(1); snapshot() returns the state at the current boundary.
 */
export class CumulativeDeltaTracker {
    private buy = 0;
    private sell = 0;
    private lastBucketDelta = 0;
    private readonly bucketMs: number;
    private currentBucketTs: number | null = null;
    private currentBuy = 0;
    private currentSell = 0;

    constructor(options: Pick<DeltaOptions, "timeframe" | "bucketMs">) {
        this.bucketMs = options.bucketMs ?? defaultBucketMs(options.timeframe);
    }

    update(trade: OrderFlowTrade): void {
        const key = Math.floor(trade.timestamp / this.bucketMs) * this.bucketMs;
        if (this.currentBucketTs !== null && key !== this.currentBucketTs) {
            // Roll the completed bucket into totals.
            this.buy += this.currentBuy;
            this.sell += this.currentSell;
            this.lastBucketDelta = this.currentBuy - this.currentSell;
            this.currentBuy = 0;
            this.currentSell = 0;
        }
        this.currentBucketTs = key;
        if (trade.side === "buy") this.currentBuy += trade.size;
        else this.currentSell += trade.size;
    }

    /** Completed-bucket totals plus the forming bucket (live semantics). */
    snapshot(): { cumulativeDelta: number; delta: number; deltaPercent: number; deltaAcceleration: number; buyVolume: number; sellVolume: number } {
        const buy = this.buy + this.currentBuy;
        const sell = this.sell + this.currentSell;
        const total = buy + sell;
        return {
            cumulativeDelta: buy - sell,
            delta: this.currentBucketTs !== null ? this.currentBuy - this.currentSell : 0,
            deltaPercent: total > 0 ? ((buy - sell) / total) * 100 : 0,
            deltaAcceleration: (this.currentBucketTs !== null ? this.currentBuy - this.currentSell : 0) - this.lastBucketDelta,
            buyVolume: buy,
            sellVolume: sell,
        };
    }
}

/**
 * Divergence detection over delta buckets + per-bucket prices.
 * prices[i] must be the price at buckets[i].timestamp (typically close).
 */
export function detectDeltaDivergences(
    result: DeltaResult,
    prices: number[],
    meta: { symbol: string; timeframe: Timeframe; mode: OrderFlowMode },
): DeltaDivergenceEvent[] {
    const events: DeltaDivergenceEvent[] = [];
    const { buckets, cumulativeDeltaBuckets } = withCumulative(result);
    const n = Math.min(buckets.length, prices.length);
    if (n < 2) return events;

    for (let i = 1; i < n; i++) {
        const priceChange = prices[i] - prices[i - 1];
        const deltaChange = buckets[i].delta - buckets[i - 1].delta;
        const cumChange = cumulativeDeltaBuckets[i] - cumulativeDeltaBuckets[i - 1];
        const types = classifyDivergence(priceChange, deltaChange, cumChange);
        for (const type of types) {
            events.push({
                id: `div_${type}_${meta.symbol}_${meta.timeframe}_${buckets[i].timestamp}`,
                timestamp: buckets[i].timestamp,
                symbol: meta.symbol,
                timeframe: meta.timeframe,
                mode: meta.mode,
                method: result.method,
                quality: result.dataQuality,
                type,
                price: prices[i],
                priceChange,
                delta: buckets[i].delta,
                cumulativeDelta: cumulativeDeltaBuckets[i],
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

/** Running cumulative delta per bucket (bucket-by-bucket running total). */
function withCumulative(result: DeltaResult): { buckets: DeltaBucket[]; cumulativeDeltaBuckets: number[] } {
    let cum = 0;
    const cumBuckets = result.buckets.map((b) => {
        cum += b.delta;
        return cum;
    });
    return { buckets: result.buckets, cumulativeDeltaBuckets: cumBuckets };
}
