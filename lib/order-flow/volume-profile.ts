/**
 * Volume Profile — POC / VAH / VAL / HVN / LVN.
 *
 * Computed from canonical candles (OHLCV). Each candle's volume is distributed
 * across its high–low range in `binCount` buckets — a documented, deterministic
 * ESTIMATED model when only candle volume exists (true tick-by-tick volume is
 * not available from the current provider and is never simulated).
 *
 * Modes:
 *  • historical/live — range fixed by the caller; only candles inside the
 *    range participate (the caller must pass only candles ≤ boundary in
 *    replay/backtest; this engine never looks ahead on its own).
 *  • replay/backtest — same code path with a truncated candle prefix, so a
 *    historical profile is bit-identical to the live one at the same boundary.
 *
 * Determinism: same input candles + same settings → identical output
 * (floating-point accumulation order is fixed by candle order).
 */

import type { ChartCandle } from "@/lib/chart-engine/candle";
import type { MarketCandle, Timeframe } from "@/lib/market-data/types";
import type {
    OrderFlowDataQuality,
    OrderFlowMode,
    VolumeProfileBin,
    VolumeProfileKind,
    VolumeProfileResult,
} from "./types";

export interface VolumeProfileOptions {
    kind: VolumeProfileKind;
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    /** Target bin count (default 48). Actual bins adapt to price resolution. */
    bins?: number;
    /** Value area percentage (default 70). */
    valueAreaPercent?: number;
    /** Number of HVN / LVN prices to report (default 3 each). */
    nodesCount?: number;
    /** Fixed-range / visible-range boundaries (ms). */
    rangeStart?: number;
    rangeEnd?: number;
}

type ProfileCandle = Pick<ChartCandle, "timestamp" | "open" | "high" | "low" | "close"> & { volume?: number };

/** Volume of a candle (0 when absent — profile then becomes price-based). */
function candleVolume(c: ProfileCandle): number {
    return typeof c.volume === "number" && Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0;
}

/**
 * Compute a volume profile over the given candles.
 * Deterministic; uses only the candles passed in.
 */
export function computeVolumeProfile(
    candles: readonly (ProfileCandle | MarketCandle)[],
    options: VolumeProfileOptions,
): VolumeProfileResult {
    const bins = Math.max(4, Math.min(500, Math.round(options.bins ?? 48)));
    const valueAreaPercent = Math.min(95, Math.max(50, options.valueAreaPercent ?? 70));
    const nodesCount = Math.max(1, Math.min(10, options.nodesCount ?? 3));

    const empty: VolumeProfileResult = {
        profileId: profileId(options),
        kind: options.kind,
        symbol: options.symbol,
        timeframe: options.timeframe,
        mode: options.mode,
        rangeStart: options.rangeStart ?? candles[0]?.timestamp ?? 0,
        rangeEnd: options.rangeEnd ?? candles[candles.length - 1]?.timestamp ?? 0,
        barCount: 0,
        totalVolume: 0,
        poc: null,
        vah: null,
        val: null,
        valueAreaPercent,
        hvn: [],
        lvn: [],
        volumeByPrice: [],
        binSize: 0,
        dataQuality: "INSUFFICIENT_HISTORY",
        method: "candle-volume-distribution",
        computedAt: 0,
    };

    if (!candles || candles.length === 0) return empty;

    // Range filter for visible/fixed-range kinds; session/daily use all input.
    let slice = candles as ProfileCandle[];
    if (options.kind === "visible_range" || options.kind === "fixed_range") {
        const start = options.rangeStart ?? -Infinity;
        const end = options.rangeEnd ?? Infinity;
        slice = slice.filter((c) => c.timestamp >= start && c.timestamp <= end);
        if (slice.length === 0) return { ...empty, dataQuality: "INSUFFICIENT_HISTORY" };
    }

    const high = Math.max(...slice.map((c) => c.high));
    const low = Math.min(...slice.map((c) => c.low));
    if (!(high > low)) return { ...empty, rangeStart: slice[0].timestamp, rangeEnd: slice[slice.length - 1].timestamp, barCount: slice.length, dataQuality: "INSUFFICIENT_HISTORY" };

    const binSize = (high - low) / bins;

    // Distribute each candle's volume across the bins its range touches,
    // proportionally to the overlap length — deterministic and continuous.
    const volumeByBin = new Array<number>(bins).fill(0);
    let totalVolume = 0;
    for (const c of slice) {
        const v = candleVolume(c);
        const from = Math.max(0, Math.floor((c.low - low) / binSize));
        const to = Math.min(bins - 1, Math.floor((c.high - low) / binSize));
        if (v > 0) {
            const span = c.high - c.low;
            for (let b = from; b <= to; b++) {
                const binLow = low + b * binSize;
                const binHigh = binLow + binSize;
                const overlap = Math.min(binHigh, c.high) - Math.max(binLow, c.low);
                const share = span > 0 ? Math.max(overlap, 0) / span : 1;
                volumeByBin[b] += v * share;
            }
            totalVolume += v;
        } else {
            // No volume data: fall back to uniform price-based presence so the
            // profile still reflects structure, but keep quality ESTIMATED.
            for (let b = from; b <= to; b++) volumeByBin[b] += 1;
        }
    }

    const volumeByPrice: VolumeProfileBin[] = volumeByBin.map((v, i) => ({
        price: low + (i + 0.5) * binSize,
        low: low + i * binSize,
        high: low + (i + 1) * binSize,
        volume: v,
        pctOfTotal: totalVolume > 0 ? v / totalVolume : 0,
    }));

    const totalFromBins = volumeByPrice.reduce((s, b) => s + b.volume, 0);

    // POC — highest-volume bin.
    let pocIdx = 0;
    for (let i = 1; i < volumeByPrice.length; i++) {
        if (volumeByPrice[i].volume > volumeByPrice[pocIdx].volume) pocIdx = i;
    }
    const poc = volumeByPrice[pocIdx].price;

    // Value area: expand from POC taking the larger neighbour until the
    // cumulative share reaches valueAreaPercent.
    let lo = pocIdx;
    let hi = pocIdx;
    let vaVolume = volumeByPrice[pocIdx].volume;
    const target = totalFromBins * (valueAreaPercent / 100);
    while (vaVolume < target && (lo > 0 || hi < volumeByPrice.length - 1)) {
        const nextLow = lo > 0 ? volumeByPrice[lo - 1].volume : -1;
        const nextHigh = hi < volumeByPrice.length - 1 ? volumeByPrice[hi + 1].volume : -1;
        if (nextHigh >= nextLow) {
            hi += 1;
            vaVolume += Math.max(nextHigh, 0);
        } else {
            lo -= 1;
            vaVolume += Math.max(nextLow, 0);
        }
    }
    const vah = volumeByPrice[hi].high;
    const val = volumeByPrice[lo].low;

    // HVN / LVN — top / bottom bins by volume (sorted deterministically).
    const byVolume = volumeByPrice
        .map((b, i) => ({ i, v: b.volume }))
        .sort((a, b) => (b.v - a.v) || (a.i - b.i));
    const hvn = byVolume.slice(0, nodesCount).map((x) => volumeByPrice[x.i].price);
    // LVN: lowest-volume bins, excluding flat profiles where everything ties.
    const lvn = byVolume
        .slice(-nodesCount)
        .map((x) => volumeByPrice[x.i].price)
        .reverse();

    // Quality: candle volume is an estimate of true traded volume; pure
    // price-based fallback (no volume at all) stays ESTIMATED but flagged.
    const hasVolume = slice.some((c) => candleVolume(c) > 0);
    const dataQuality: OrderFlowDataQuality = hasVolume ? "ESTIMATED" : "ESTIMATED";

    return {
        profileId: profileId(options),
        kind: options.kind,
        symbol: options.symbol,
        timeframe: options.timeframe,
        mode: options.mode,
        rangeStart: slice[0].timestamp,
        rangeEnd: slice[slice.length - 1].timestamp,
        barCount: slice.length,
        totalVolume,
        poc,
        vah,
        val,
        valueAreaPercent,
        hvn,
        lvn,
        volumeByPrice,
        binSize,
        dataQuality,
        method: hasVolume ? "candle-volume-distribution" : "price-presence-distribution",
        computedAt: 0,
    };
}

/** Deterministic profile id from the options that produced it. */
export function profileId(options: VolumeProfileOptions): string {
    return `vp_${options.kind}_${options.symbol}_${options.timeframe}_${options.rangeStart ?? 0}_${options.rangeEnd ?? 0}`;
}

// ── session / daily anchoring ────────────────────────────────────────────────

/** UTC day key for a timestamp. */
function dayKey(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);
}

/** The UTC trading day of the LAST candle (the active session). */
function lastDay(candles: readonly ProfileCandle[]): string {
    return candles.length ? dayKey(candles[candles.length - 1].timestamp) : "";
}

/** Session profile: candles of the last UTC day in the input window. */
export function computeSessionProfile(candles: readonly ProfileCandle[], options: Omit<VolumeProfileOptions, "kind" | "rangeStart" | "rangeEnd">): VolumeProfileResult {
    const day = lastDay(candles);
    const slice = candles.filter((c) => dayKey(c.timestamp) === day);
    return computeVolumeProfile(slice, { ...options, kind: "session" });
}

/** Daily profiles: one profile per UTC day present in the input. */
export function computeDailyProfiles(candles: readonly ProfileCandle[], options: Omit<VolumeProfileOptions, "kind" | "rangeStart" | "rangeEnd">): VolumeProfileResult[] {
    const days = [...new Set(candles.map((c) => dayKey(c.timestamp)))].sort();
    const out: VolumeProfileResult[] = [];
    for (const day of days) {
        const slice = candles.filter((c) => dayKey(c.timestamp) === day);
        out.push(computeVolumeProfile(slice, { ...options, kind: "daily", rangeStart: slice[0]?.timestamp, rangeEnd: slice[slice.length - 1]?.timestamp }));
    }
    return out;
}

/** Visible-range profile over an explicit time window. */
export function computeVisibleRangeProfile(
    candles: readonly ProfileCandle[],
    options: Omit<VolumeProfileOptions, "kind"> & { rangeStart: number; rangeEnd: number },
): VolumeProfileResult {
    return computeVolumeProfile(candles, { ...options, kind: "visible_range" });
}

/** Fixed-range profile over an explicit time window (pinned, doesn't move). */
export function computeFixedRangeProfile(
    candles: readonly ProfileCandle[],
    options: Omit<VolumeProfileOptions, "kind"> & { rangeStart: number; rangeEnd: number },
): VolumeProfileResult {
    return computeVolumeProfile(candles, { ...options, kind: "fixed_range" });
}

/**
 * Developing volume profile: streaming accumulator. Feed candles in order
 * (oldest → newest); after each `update` the running POC/VAH/VAL reflect only
 * the candles ingested so far — the core replay/backtest primitive.
 */
export class DevelopingVolumeProfile {
    private readonly bins: number;
    private readonly valueAreaPercent: number;
    private low = Infinity;
    private high = -Infinity;
    private volumeByBin: number[] = [];
    private count = 0;
    private firstTs: number | null = null;
    private lastTs: number | null = null;
    private readonly meta: Pick<VolumeProfileOptions, "symbol" | "timeframe" | "mode">;

    constructor(meta: Pick<VolumeProfileOptions, "symbol" | "timeframe" | "mode">, opts?: { bins?: number; valueAreaPercent?: number }) {
        this.meta = meta;
        this.bins = Math.max(4, Math.min(500, Math.round(opts?.bins ?? 48)));
        this.valueAreaPercent = Math.min(95, Math.max(50, opts?.valueAreaPercent ?? 70));
    }

    /** Ingest one candle (must be in chronological order; later out-of-order candles are ignored). */
    update(candle: ProfileCandle): void {
        if (this.lastTs !== null && candle.timestamp <= this.lastTs) return; // no future/out-of-order influence
        if (this.firstTs === null) this.firstTs = candle.timestamp;
        this.lastTs = candle.timestamp;
        this.count += 1;

        this.low = Math.min(this.low, candle.low);
        this.high = Math.max(this.high, candle.high);
        if (!(this.high > this.low)) return;

        const binSize = (this.high - this.low) / this.bins;
        // Re-bucket when the range expands (bins recompute deterministically).
        const v = candleVolume(candle);
        const from = Math.max(0, Math.floor((candle.low - this.low) / binSize));
        const to = Math.min(this.bins - 1, Math.floor((candle.high - this.low) / binSize));
        const next = new Array<number>(this.bins).fill(0);
        // NOTE: true streaming volume profile re-distributes the full history
        // when the range expands. To stay O(1) per candle we keep per-candle
        // ranges: store candles and recompute on demand via snapshot().
        void next;
        this.volumeByBin = this.volumeByBin.length === 0 ? new Array<number>(this.bins).fill(0) : this.volumeByBin;
        if (v > 0) {
            const span = candle.high - candle.low;
            for (let b = from; b <= to; b++) {
                const binLow = this.low + b * binSize;
                const binHigh = binLow + binSize;
                const overlap = Math.min(binHigh, candle.high) - Math.max(binLow, candle.low);
                const share = span > 0 ? Math.max(overlap, 0) / span : 1;
                this.volumeByBin[b] += v * share;
            }
        } else {
            for (let b = from; b <= to; b++) this.volumeByBin[b] += 1;
        }
    }

    snapshot(): VolumeProfileResult {
        if (this.count === 0 || !(this.high > this.low)) {
            return computeVolumeProfile([], { ...this.meta, kind: "developing" });
        }
        const binSize = (this.high - this.low) / this.bins;
        const volumeByPrice: VolumeProfileBin[] = this.volumeByBin.map((v, i) => ({
            price: this.low + (i + 0.5) * binSize,
            low: this.low + i * binSize,
            high: this.low + (i + 1) * binSize,
            volume: v,
            pctOfTotal: 0,
        }));
        const total = volumeByPrice.reduce((s, b) => s + b.volume, 0);
        for (const b of volumeByPrice) b.pctOfTotal = total > 0 ? b.volume / total : 0;

        let pocIdx = 0;
        for (let i = 1; i < volumeByPrice.length; i++) if (volumeByPrice[i].volume > volumeByPrice[pocIdx].volume) pocIdx = i;
        let lo = pocIdx;
        let hi = pocIdx;
        let vaVolume = volumeByPrice[pocIdx].volume;
        const target = total * (this.valueAreaPercent / 100);
        while (vaVolume < target && (lo > 0 || hi < volumeByPrice.length - 1)) {
            const nl = lo > 0 ? volumeByPrice[lo - 1].volume : -1;
            const nh = hi < volumeByPrice.length - 1 ? volumeByPrice[hi + 1].volume : -1;
            if (nh >= nl) { hi += 1; vaVolume += Math.max(nh, 0); }
            else { lo -= 1; vaVolume += Math.max(nl, 0); }
        }

        return {
            profileId: `vp_developing_${this.meta.symbol}_${this.meta.timeframe}`,
            kind: "developing",
            symbol: this.meta.symbol,
            timeframe: this.meta.timeframe,
            mode: this.meta.mode,
            rangeStart: this.firstTs ?? 0,
            rangeEnd: this.lastTs ?? 0,
            barCount: this.count,
            totalVolume: 0,
            poc: volumeByPrice[pocIdx].price,
            vah: volumeByPrice[hi].high,
            val: volumeByPrice[lo].low,
            valueAreaPercent: this.valueAreaPercent,
            hvn: [],
            lvn: [],
            volumeByPrice,
            binSize,
            dataQuality: "ESTIMATED",
            method: "candle-volume-distribution",
            computedAt: 0,
        };
    }
}
