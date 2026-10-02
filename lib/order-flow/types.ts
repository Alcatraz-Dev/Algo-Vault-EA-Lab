/**
 * Order Flow & Market Microstructure Intelligence — canonical types.
 *
 * Ground rules enforced across the whole module:
 *  • Every calculation result carries its data quality and the capability it
 *    was derived from. No result is ever presented without provenance.
 *  • Derived-from-candles values are labelled ESTIMATED (or PARTIAL), never
 *    presented as true tick/L2/order-book facts.
 *  • Timestamps are ms since epoch (UTC), matching lib/chart-engine.
 *  • No future data: calculations are strictly incremental/streaming where
 *    history matters, and every result states the mode it was computed in.
 */

import type { Timeframe } from "@/lib/market-data/types";

// ── data quality ─────────────────────────────────────────────────────────────

/**
 * Data-quality state for any order-flow calculation.
 *  HIGH       — computed from the exact data class the feature requires
 *               (true trades with aggressor side, real L2 snapshots…).
 *  PARTIAL    — computed from real but incomplete data of the right class
 *               (e.g. trades without side, sampled L2).
 *  ESTIMATED  — computed from a *different* data class (candle OHLCV)
 *               through a documented estimation model. Never presented as
 *               true microstructure data.
 *  UNAVAILABLE — the required data class does not exist for this feed.
 *  STALE      — the data exists but is older than the feature's freshness gate.
 *  INSUFFICIENT_HISTORY — the data class exists but not enough of it to
 *               produce a statistically meaningful result.
 */
export type OrderFlowDataQuality =
    | "HIGH"
    | "PARTIAL"
    | "ESTIMATED"
    | "UNAVAILABLE"
    | "STALE"
    | "INSUFFICIENT_HISTORY";

export type OrderFlowMode = "live" | "historical" | "replay";

export const DATA_QUALITY_ORDER: Record<OrderFlowDataQuality, number> = {
    HIGH: 3,
    PARTIAL: 2,
    ESTIMATED: 1,
    UNAVAILABLE: 0,
    STALE: 0,
    INSUFFICIENT_HISTORY: 0,
};

/** Best of two qualities — used when merging partial results. */
export function bestQuality(a: OrderFlowDataQuality, b: OrderFlowDataQuality): OrderFlowDataQuality {
    return DATA_QUALITY_ORDER[a] >= DATA_QUALITY_ORDER[b] ? a : b;
}

/** Worst of two qualities — propagation when combining evidence. */
export function worstQuality(a: OrderFlowDataQuality, b: OrderFlowDataQuality): OrderFlowDataQuality {
    return DATA_QUALITY_ORDER[a] <= DATA_QUALITY_ORDER[b] ? a : b;
}

// ── provider capability model ────────────────────────────────────────────────

/**
 * What the current market-data provider can actually supply. Populated by
 * the provider adapter (normalizer.ts) — never guessed by consumers.
 */
export interface OrderFlowCapabilities {
    /** OHLC candles (all providers). */
    candles: boolean;
    /** Individual trades / tape (time, price, size). */
    trades: boolean;
    /** Trades carry an aggressor side (buy/sell classification). */
    bidAskClassification: boolean;
    /** Best bid/ask quotes at trade time. */
    bidAskQuotes: boolean;
    /** Live order book (Level 2 depth) snapshots. */
    level2: boolean;
    /** Historical/replayable L2 snapshots. */
    historicalLevel2: boolean;
    /** Options chains. */
    options: boolean;
    /** Open interest. */
    openInterest: boolean;
    /** Implied volatility. */
    impliedVolatility: boolean;
}

export const UNAVAILABLE_CAPABILITIES: OrderFlowCapabilities = {
    candles: false,
    trades: false,
    bidAskClassification: false,
    bidAskQuotes: false,
    level2: false,
    historicalLevel2: false,
    options: false,
    openInterest: false,
    impliedVolatility: false,
};

// ── per-feature availability ────────────────────────────────────────────────

export type OrderFlowFeatureId =
    | "volumeProfile"
    | "delta"
    | "cumulativeDelta"
    | "footprint"
    | "imbalances"
    | "absorption"
    | "exhaustion"
    | "largeTrades"
    | "liquidity"
    | "heatmap"
    | "gex";

export interface FeatureAvailability {
    feature: OrderFlowFeatureId;
    quality: OrderFlowDataQuality;
    /** Human explanation of why, shown in disabled toggles. */
    reason: string;
}

/**
 * Derive what is honestly computable from a capability set. Single source of
 * truth consumed by the chart toolbar, terminal panels and the AI context —
 * so no UI can ever claim a feature the engine cannot compute.
 */
export function deriveFeatureAvailability(caps: OrderFlowCapabilities): Record<OrderFlowFeatureId, FeatureAvailability> {
    const withVolume = caps.candles; // candle volume always accompanies candles when present
    return {
        volumeProfile: withVolume
            ? { feature: "volumeProfile", quality: "ESTIMATED", reason: "Built from candle volume distribution (estimated — true tick volume unavailable)." }
            : { feature: "volumeProfile", quality: "UNAVAILABLE", reason: "No volume data available from the current provider." },
        // Delta tiering: true aggressor classification → HIGH; candle-only →
        // ESTIMATED through the documented body-direction proxy model
        // (delta-proxy.ts — never presented as bid/ask delta).
        delta: caps.bidAskClassification
            ? { feature: "delta", quality: "HIGH", reason: "Computed from true aggressor-side trade classification." }
            : withVolume
                ? { feature: "delta", quality: "ESTIMATED", reason: "Estimated delta from candle volume signed by bar direction (candle-body-direction-volume) — NOT bid/ask delta; upgrades to true delta only with classified trades." }
                : { feature: "delta", quality: "UNAVAILABLE", reason: "Requires bid/ask trade classification — not provided by the current provider." },
        cumulativeDelta: caps.bidAskClassification
            ? { feature: "cumulativeDelta", quality: "HIGH", reason: "Running total of true delta." }
            : withVolume
                ? { feature: "cumulativeDelta", quality: "ESTIMATED", reason: "Running total of estimated candle-direction delta (candle-body-direction-volume) — NOT bid/ask delta." }
                : { feature: "cumulativeDelta", quality: "UNAVAILABLE", reason: "Requires bid/ask trade classification — not provided by the current provider." },
        footprint: caps.bidAskClassification
            ? { feature: "footprint", quality: "HIGH", reason: "Bid × Ask volume per price level from classified trades." }
            : { feature: "footprint", quality: "UNAVAILABLE", reason: "True footprint requires bid/ask classified trades — not provided by the current provider." },
        imbalances: caps.bidAskClassification
            ? { feature: "imbalances", quality: "HIGH", reason: "Bid/ask imbalance from classified trade pairs." }
            : { feature: "imbalances", quality: "UNAVAILABLE", reason: "Requires bid/ask classified trades — not provided by the current provider." },
        absorption: withVolume
            ? { feature: "absorption", quality: "ESTIMATED", reason: "Evidence from volume/price behaviour (estimated — no L2 persistence data)." }
            : { feature: "absorption", quality: "UNAVAILABLE", reason: "Requires volume data." },
        exhaustion: withVolume
            ? { feature: "exhaustion", quality: "ESTIMATED", reason: "Evidence from volume/extension behaviour (estimated)." }
            : { feature: "exhaustion", quality: "UNAVAILABLE", reason: "Requires volume data." },
        largeTrades: caps.trades
            ? { feature: "largeTrades", quality: caps.bidAskClassification ? "HIGH" : "PARTIAL", reason: caps.bidAskClassification ? "From the real trade tape." : "Trade sizes without side classification." }
            : { feature: "largeTrades", quality: "UNAVAILABLE", reason: "Requires individual trade data — not provided by the current provider." },
        liquidity: caps.level2
            ? { feature: "liquidity", quality: "HIGH", reason: "From live Level 2 order book snapshots." }
            : { feature: "liquidity", quality: "UNAVAILABLE", reason: "Requires Level 2 / order-book data — not provided by the current provider." },
        heatmap: caps.level2
            ? { feature: "heatmap", quality: caps.historicalLevel2 ? "HIGH" : "PARTIAL", reason: caps.historicalLevel2 ? "Historical L2 depth available." : "Live depth only; history not replayable." }
            : { feature: "heatmap", quality: "UNAVAILABLE", reason: "Requires Level 2 / order-book depth — not provided by the current provider." },
        gex: caps.options && caps.openInterest && caps.impliedVolatility
            ? { feature: "gex", quality: "HIGH", reason: "Options chain with open interest and IV available." }
            : { feature: "gex", quality: "UNAVAILABLE", reason: "Requires options chain, open interest and implied volatility — not provided by the current provider." },
    };
}

// ── raw inputs (provider-neutral) ────────────────────────────────────────────

/** A single classified trade. `side` requires bidAskClassification. */
export interface OrderFlowTrade {
    timestamp: number;
    price: number;
    size: number;
    side: "buy" | "sell";
}

/** One Level 2 depth level. */
export interface L2Level {
    price: number;
    size: number;
}

/** A full L2 book snapshot for one side at one instant. */
export interface L2Snapshot {
    timestamp: number;
    bids: L2Level[];
    asks: L2Level[];
}

/** Options-chain quote for one strike/expiry. */
export interface OptionQuote {
    strike: number;
    /** Expiry in ms since epoch. */
    expiration: number;
    type: "call" | "put";
    openInterest: number;
    impliedVolatility: number;
    /** Gamma supplied by the provider when available (0 when absent). */
    gamma?: number;
    /** Underlying price the chain was quoted against. */
    underlyingPrice: number;
}

// ── events ───────────────────────────────────────────────────────────────────

/** Provenance stamped on every structured event. */
export interface OrderFlowEventMeta {
    id: string;
    timestamp: number;
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    /** Calculation method actually used, e.g. "candle-volume-distribution". */
    method: string;
    quality: OrderFlowDataQuality;
}

export type ImbalanceType =
    | "BUY_IMBALANCE"
    | "SELL_IMBALANCE"
    | "DIAGONAL_BUY_IMBALANCE"
    | "DIAGONAL_SELL_IMBALANCE"
    | "STACKED_BUY_IMBALANCE"
    | "STACKED_SELL_IMBALANCE";

export interface ImbalanceEvent extends OrderFlowEventMeta {
    type: ImbalanceType;
    priceStart: number;
    priceEnd: number;
    ratio: number;
    levels: number;
    buyVolume: number;
    sellVolume: number;
}

export type AbsorptionType = "BUY_ABSORPTION" | "SELL_ABSORPTION";

export interface AbsorptionEvent extends OrderFlowEventMeta {
    type: AbsorptionType;
    price: number;
    /** Volume traded at/around the level, in the aggressor direction. */
    aggressiveVolume: number;
    /** Price progress achieved while that volume traded (price units). */
    priceProgress: number;
    /** How the level behaved after: capped, rejected, or broke through. */
    outcome: "held" | "rejected" | "breakout";
    evidence: string[];
}

export type ExhaustionType = "BUY_EXHAUSTION" | "SELL_EXHAUSTION";

export interface ExhaustionEvent extends OrderFlowEventMeta {
    type: ExhaustionType;
    price: number;
    /** ATR- or range-relative extension of the move into this bar. */
    extension: number;
    evidence: string[];
}

export type LargeTradeType = "LARGE_BUY" | "LARGE_SELL";

export interface LargeTradeEvent extends OrderFlowEventMeta {
    type: LargeTradeType;
    price: number;
    size: number;
    /** The rule that fired: absolute | percentile | rolling-multiple. */
    thresholdRule: "absolute" | "percentile" | "rolling_multiple";
    thresholdValue: number;
}

export type LiquidityEventType =
    | "LIQUIDITY_WALL"
    | "LIQUIDITY_ADDED"
    | "LIQUIDITY_REMOVED"
    | "STACKING"
    | "PULLING"
    | "LIQUIDITY_IMBALANCE"
    | "LIQUIDITY_SWEEP"
    | "LIQUIDITY_REPLENISHED";

export interface LiquidityEvent extends OrderFlowEventMeta {
    type: LiquidityEventType;
    side: "bid" | "ask";
    price: number;
    size: number;
    previousSize?: number;
    newSize?: number;
    /** Persistence: how many consecutive snapshots the level held. */
    persistence?: number;
    /** Distance from the current mid, in price units. */
    distanceFromMarket: number;
}

export type DeltaDivergenceType =
    | "PRICE_UP_DELTA_DOWN"
    | "PRICE_DOWN_DELTA_UP"
    | "PRICE_UP_CUM_DELTA_DOWN"
    | "PRICE_DOWN_CUM_DELTA_UP";

export interface DeltaDivergenceEvent extends OrderFlowEventMeta {
    type: DeltaDivergenceType;
    price: number;
    priceChange: number;
    delta: number;
    cumulativeDelta: number;
}

// ── volume profile ───────────────────────────────────────────────────────────

export type VolumeProfileKind = "session" | "daily" | "visible_range" | "fixed_range" | "developing";

export interface VolumeProfileBin {
    /** Representative price of the bin (bin centre). */
    price: number;
    low: number;
    high: number;
    volume: number;
    /** Relative share of total profile volume, 0–1. */
    pctOfTotal: number;
}

export interface VolumeProfileResult {
    profileId: string;
    kind: VolumeProfileKind;
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    rangeStart: number;
    rangeEnd: number;
    /** Number of candle observations folded into the profile. */
    barCount: number;
    /** Total volume represented by the profile (0 when volume missing). */
    totalVolume: number;
    poc: number | null;
    vah: number | null;
    val: number | null;
    valueAreaPercent: number;
    hvn: number[];
    lvn: number[];
    volumeByPrice: VolumeProfileBin[];
    binSize: number;
    dataQuality: OrderFlowDataQuality;
    method: string;
    computedAt: number;
}

// ── delta ────────────────────────────────────────────────────────────────────

export interface DeltaBucket {
    timestamp: number;
    buyVolume: number;
    sellVolume: number;
    delta: number;
    /** delta / total, −100…+100 (0 when no volume). */
    deltaPercent: number;
}

export interface DeltaResult {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    buckets: DeltaBucket[];
    buyVolume: number;
    sellVolume: number;
    delta: number;
    deltaPercent: number;
    cumulativeDelta: number;
    /** Latest bucket vs prior: acceleration of delta (bucket-over-bucket). */
    deltaAcceleration: number;
    dataQuality: OrderFlowDataQuality;
    method: string;
}

// ── footprint ────────────────────────────────────────────────────────────────

export interface FootprintCell {
    price: number;
    bidVolume: number;
    askVolume: number;
    delta: number;
    totalVolume: number;
}

export interface FootprintBar {
    /** Candle opening time this footprint covers. */
    timestamp: number;
    high: number;
    low: number;
    cells: FootprintCell[];
    delta: number;
    totalVolume: number;
    /** Imbalance events local to this bar. */
    imbalances: ImbalanceEvent[];
}

export interface FootprintResult {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    bars: FootprintBar[];
    dataQuality: OrderFlowDataQuality;
    method: string;
}

// ── liquidity / heatmap ──────────────────────────────────────────────────────

export interface HeatmapCell {
    timestamp: number;
    price: number;
    /** Resting size on this side at this price/time. */
    size: number;
    side: "bid" | "ask";
    /** Wall if above the configured wall threshold. */
    isWall: boolean;
}

export interface HeatmapState {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    cells: HeatmapCell[];
    /** Max cell size, for renderer normalisation. */
    maxSize: number;
    wallCount: number;
    dataQuality: OrderFlowDataQuality;
    computedAt: number;
}

// ── GEX ──────────────────────────────────────────────────────────────────────

export interface GammaWall {
    strike: number;
    /** Net gamma notional at this strike. */
    gamma: number;
    openInterest: number;
}

export interface GexExpirationBreakdown {
    expiration: number;
    callGex: number;
    putGex: number;
    netGex: number;
}

export interface GexResult {
    underlying: string;
    timestamp: number;
    mode: OrderFlowMode;
    /** Underlying spot used. */
    spot: number;
    netGex: number;
    callGex: number;
    putGex: number;
    /** Strike where cumulative net GEX crosses zero (null when unresolved). */
    gammaFlip: number | null;
    callWalls: GammaWall[];
    putWalls: GammaWall[];
    expirations: GexExpirationBreakdown[];
    dataQuality: OrderFlowDataQuality;
    method: string;
}

// ── AI context ───────────────────────────────────────────────────────────────

export type OrderFlowEvidenceKind =
    | "FACT"
    | "INTERPRETATION"
    | "LIMITATION";

export interface OrderFlowEvidence {
    kind: OrderFlowEvidenceKind;
    text: string;
    /** Structured event ids backing this item (traceability). */
    sourceIds: string[];
}

export interface OrderFlowContext {
    symbol: string;
    timeframe: Timeframe;
    mode: OrderFlowMode;
    /** Timestamp boundary the context is valid at (replay-safe). */
    asOf: number;
    capabilities: OrderFlowCapabilities;
    featureAvailability: Record<OrderFlowFeatureId, FeatureAvailability>;
    dataQuality: OrderFlowDataQuality;
    delta: {
        available: boolean;
        value: number | null;
        cumulative: number | null;
        deltaPercent: number | null;
        method: string | null;
    };
    /**
     * Candle-derived ESTIMATED delta (candle-body-direction-volume proxy).
     * Present when no true trade-grade delta exists; always `available: false`
     * when real classified trades supply `delta` above. Never a substitute
     * for bid/ask delta — rendered/quoted only with its ESTIMATED label.
     */
    deltaEstimated: {
        available: boolean;
        value: number | null;
        cumulative: number | null;
        deltaPercent: number | null;
        method: string | null;
        dataQuality: OrderFlowDataQuality;
    };
    volumeProfile: {
        available: boolean;
        kind: VolumeProfileKind | null;
        poc: number | null;
        vah: number | null;
        val: number | null;
        hvn: number[];
        lvn: number[];
        priceRelation: "above_poc" | "below_poc" | "inside_value_area" | null;
        method: string | null;
    };
    footprint: {
        available: boolean;
        method: string | null;
        /** Recent footprint bars, newest last. */
        recentBars: number;
    };
    imbalances: {
        available: boolean;
        recent: ImbalanceEvent[];
    };
    absorption: {
        available: boolean;
        recent: AbsorptionEvent[];
    };
    exhaustion: {
        available: boolean;
        recent: ExhaustionEvent[];
    };
    largeTrades: {
        available: boolean;
        recent: LargeTradeEvent[];
    };
    liquidity: {
        available: boolean;
        recentEvents: LiquidityEvent[];
    };
    heatmap: {
        available: boolean;
        cellCount: number;
    };
    gex: {
        available: boolean;
        netGex: number | null;
        gammaFlip: number | null;
        callWalls: number[];
        putWalls: number[];
        method: string | null;
    };
    confluence: OrderFlowConfluenceResult | null;
    facts: OrderFlowEvidence[];
    interpretations: OrderFlowEvidence[];
    limitations: string[];
}

// ── confluence ───────────────────────────────────────────────────────────────

export interface OrderFlowConfluenceResult {
    direction: "bullish" | "bearish" | "neutral";
    /** 0–100 strength of the aligned order-flow evidence. */
    score: number;
    bullEvidence: string[];
    bearEvidence: string[];
    conflicts: string[];
}
