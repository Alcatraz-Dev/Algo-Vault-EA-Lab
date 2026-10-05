/**
 * AlgoVault Market Intelligence Core — canonical types.
 *
 * ── CANONICAL MARKET DATA ──────────────────────────────────────────────────
 *
 * The canonical candle model for the whole platform is `ChartCandle`
 * (`lib/chart-engine/candle.ts`). Its contract:
 *
 *   - `timestamp` is ALWAYS the candle's OPENING time in **milliseconds UTC**,
 *     bucketed by `candleOpenTime()` from `lib/chart-engine/timeframe.ts`.
 *     Never a close time, never a tick time, never seconds, never local time.
 *   - `symbol` is uppercase (`XAUUSD`), `timeframe` is a canonical token
 *     (`M1|M3|M5|M15|M30|H1|H4|D1|W1`).
 *   - OHLC ordering is validated (`isValidCandleValues`): high ≥ open/close ≥
 *     low, everything > 0. Invalid bars are rejected, never "fixed".
 *   - `finalized` distinguishes the forming candle from a closed bucket.
 *
 * `MarketCandle` (`lib/market-data/types.ts`) stays as the legacy structural
 * view (timestamp/OHLC/volume only) — it is assignable FROM the canonical
 * model via `chartCandleToMarketCandle`, never a second representation with
 * its own math.
 *
 * Every function in this package accepts `CoreCandle`, the structural
 * supertype both shapes satisfy, and anchors every produced value by
 * `timestamp` (+ symbol/timeframe where relevant) — never by array index
 * alone.
 */

/** Structural supertype of every canonical candle shape. */
export interface CoreCandle {
    /** Candle OPENING time, milliseconds, UTC. */
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    symbol?: string;
    timeframe?: string;
    /** True only for the still-forming bucket. */
    finalized?: boolean;
}

/** Identity of a market series (dedupe/alignment key). */
export interface SeriesKey {
    symbol: string;
    timeframe: string;
}

// ── indicators ─────────────────────────────────────────────────────────────

/**
 * Structured indicator output, anchored by market time.
 *
 * One row per candle; `values` keys are the indicator's declared outputs
 * (see `IndicatorDefinition.outputs`). `null` = not yet computed (warmup) —
 * never `NaN`, never a fabricated value.
 */
export interface IndicatorResult {
    /** Candle OPEN time this row belongs to (ms, UTC). */
    timestamp: number;
    values: Record<string, number | null>;
}

export type IndicatorCategory = "trend" | "momentum" | "volatility" | "volume" | "bands" | "other";

export type IndicatorPane = "price" | "pane";

export interface IndicatorParamSpec {
    key: string;
    label: string;
    default: number;
    min?: number;
    max?: number;
}

export interface IndicatorOutputSpec {
    key: string;
    label: string;
    /** How a renderer should draw this output line. */
    role?: "line" | "histogram" | "band_upper" | "band_middle" | "band_lower" | "area";
}

/** A step is a pure-enough fold: it mutates its own state and returns values. */
export interface IndicatorRuntime<S> {
    initialState(): S;
    /** Clone a checkpoint (used to re-run the forming candle incrementally). */
    clone(state: S): S;
    /** Fold one candle into the state; returns this candle's output values. */
    step(state: S, candle: CoreCandle): Record<string, number | null>;
}

/**
 * Indicator declaration — everything the registry, the renderer and the
 * downstream engines need to know without importing the math.
 */
export interface IndicatorDefinition<S = unknown> {
    /** Stable id (`ema`, `rsi`, `macd`, …). */
    id: string;
    name: string;
    category: IndicatorCategory;
    /** Calculation version — bump when the math changes (see docs). */
    version: string;
    /** Where it renders. */
    pane: IndicatorPane;
    /** Price-pane indicators plot over candles; sub-pane indicators do not. */
    overlayOnPrice: boolean;
    params: IndicatorParamSpec[];
    outputs: IndicatorOutputSpec[];
    /** Candles required before the first non-null value (warmup/hint). */
    warmup(params: Record<string, number>): number;
    create(params: Record<string, number>): IndicatorRuntime<S>;
    /** Short documentation string shown in the developer inspector. */
    docs?: string;
}

/** Canonical parameter hash used as cache key (order-independent). */
export function paramsKey(params: Record<string, number> | undefined, def: { params: IndicatorParamSpec[] }): string {
    const specs = def.params;
    const parts: string[] = [];
    for (const spec of specs) {
        const value = params && Number.isFinite(params[spec.key]) ? params[spec.key] : spec.default;
        parts.push(`${spec.key}=${value}`);
    }
    return parts.join(",");
}

// ── overlays ───────────────────────────────────────────────────────────────

export type OverlayKind =
    | "line"
    | "zone"
    | "box"
    | "rectangle"
    | "marker"
    | "label"
    | "channel"
    | "ray"
    | "range"
    | "entry"
    | "exit"
    | "stop_loss"
    | "take_profit"
    | "fvg"
    | "order_block"
    | "liquidity"
    | "structure_break"
    | "equal_high"
    | "equal_low"
    | "session"
    | "ai_annotation";

export type IntelligenceLayerId =
    | "candles"
    | "volume"
    | "indicators"
    | "market_structure"
    | "liquidity"
    | "fvg"
    | "order_blocks"
    | "premium_discount"
    | "sessions"
    | "signals"
    | "strategies"
    | "ai"
    | "drawings";

export type OverlayPriority = "critical" | "high" | "medium" | "low";

/**
 * An overlay is a MARKET-COORDINATE object. It never stores pixels, screen
 * positions or React layout data; renderers translate it through the single
 * coordinate pipeline (`lib/chart-engine/coordinate-mapping.ts` →
 * lightweight-charts time/price series).
 */
export interface MarketOverlay {
    id: string;
    type: OverlayKind;
    layer: IntelligenceLayerId;
    symbol: string;
    timeframe: string;
    /** Open time of the first candle the object anchors to (ms). */
    startTime: number;
    /** Open time of the last anchor candle; omitted = extends to live edge. */
    endTime?: number;
    priceStart?: number;
    priceEnd?: number;
    direction?: "bullish" | "bearish" | "neutral";
    priority?: OverlayPriority;
    label?: string;
    color?: string;
    metadata?: Record<string, unknown>;
}

/** Registry entry for a reusable overlay producer. */
export interface OverlayDefinition {
    id: string;
    name: string;
    category: string;
    version: string;
    layer: IntelligenceLayerId;
    kinds: OverlayKind[];
    docs?: string;
}

// ── smart money ────────────────────────────────────────────────────────────

export type SmartMoneyKind =
    | "swing_high"
    | "swing_low"
    | "hh"
    | "hl"
    | "lh"
    | "ll"
    | "bos"
    | "choch"
    | "equal_highs"
    | "equal_lows"
    | "liquidity_pool"
    | "liquidity_sweep"
    | "fvg"
    | "order_block"
    | "dealing_range";

/**
 * Object lifecycle:
 *
 *   detected (forming evidence) → confirmed (enough future candles)
 *       → active → mitigated → invalidated
 *
 * `developing` objects must never be shown as known-at-that-time in
 * backtests/replay/alerts — filter with `confirmationAt <= asOf`.
 */
export type SmartMoneyStatus = "developing" | "confirmed" | "active" | "mitigated" | "invalidated";

export interface SmartMoneyObject {
    /** Deterministic id: kind|symbol|timeframe|anchor timestamp|qualifier. */
    id: string;
    kind: SmartMoneyKind;
    symbol: string;
    timeframe: string;
    /** First candle open time at which the object was detectable (ms). */
    detectedAt: number;
    /**
     * Candle open time from which the object is KNOWN (ms). Equal to
     * `detectedAt` only when evidence needs no future bars; otherwise it is
     * the close of the last candle required for confirmation
     * (= open of the following candle). This is the anti-look-ahead gate.
     */
    confirmationAt: number;
    status: SmartMoneyStatus;
    direction: "bullish" | "bearish" | "neutral";
    /** Single price level (swings, breaks, pools). */
    price?: number;
    /** Zone bounds (always priceHigh ≥ priceLow). */
    priceHigh?: number;
    priceLow?: number;
    /** Open times of the candles that produced the object. */
    sourceCandles: number[];
    detectedAtIndex?: number;
    confirmationAtIndex?: number;
    invalidatedAt?: number;
    mitigatedAt?: number;
    /** Deterministic 0–100 score; never model-generated. */
    strength?: number;
    metadata?: Record<string, unknown>;
}

// ── intelligence context ───────────────────────────────────────────────────

/**
 * The deterministic facts bundle every consumer (chart, backtest, replay,
 * alerts, strategies, AI) reads. AI may INTERPRET this; it may never be the
 * source of any field in it.
 */
export interface MarketIntelligenceContext {
    version: string;
    computedAt: number;
    market: {
        symbol: string;
        timeframe: string;
        price: number;
        candleTimestamp: number;
        session: string;
    };
    structure: {
        bias: "bullish" | "bearish" | "neutral";
        events: SmartMoneyObject[];
        lastSwingHigh?: number;
        lastSwingLow?: number;
    };
    liquidity: {
        pools: SmartMoneyObject[];
        sweeps: SmartMoneyObject[];
    };
    imbalances: {
        fvgs: SmartMoneyObject[];
    };
    orderBlocks: {
        active: SmartMoneyObject[];
        mitigated: SmartMoneyObject[];
    };
    premiumDiscount: {
        rangeHigh?: number;
        rangeLow?: number;
        equilibrium?: number;
        zone: "premium" | "discount" | "equilibrium" | "unknown";
    };
    indicators: Record<string, Record<string, number | null>>;
    volatility: {
        atr?: number;
        atrPercent?: number;
    };
    activeSetups: SmartMoneyObject[];
    provenance: {
        indicatorVersions: Record<string, string>;
        smartMoneyVersion: string;
    };
}
