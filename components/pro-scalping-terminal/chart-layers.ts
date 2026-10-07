/**
 * Pro Scalping Terminal — chart layer vocabulary (leaf module).
 *
 * The layers are IDs, not arbitrary labels: the chart maps each id onto an
 * overlay it can actually draw from candle data. A layer the chart engine
 * cannot render is declared `available: false` so the UI marks it as such
 * instead of letting a toggle do nothing silently.
 *
 * Leaf module on purpose: the terminal imports this constant list, and the
 * only import is a market-data type, so nothing heavy joins the bundle.
 */

import type { Timeframe } from "@/lib/market-data/types";

export type ChartLayerId =
    | "volume"
    | "vwap"
    | "sessionLevels"
    | "prevDayHighLow"
    | "supportResistance"
    | "fvg"
    | "orderBlocks"
    | "bosChoch"
    | "liquidityLevels"
    | "equalHighsLows"
    // Math-grounded indicator overlays — each has a deterministic renderer in
    // ProTerminalChart that derives it from the displayed candles.
    | "bollingerBands"
    | "keltnerChannels"
    | "donchianChannels"
    | "supertrend"
    | "heikinAshi"
    | "dailyPivots"
    | "rsiPane"
    | "macdPane"
    // Moving averages & Technical Overlay Indicators
    | "ema9"
    | "ema20"
    | "ema50"
    | "ema200"
    | "sma20"
    | "sma50"
    | "sma200"
    | "stochasticPane"
    | "atrPane"
    | "parabolicSar"
    | "ichimokuCloud"
    // Order Flow & Market Microstructure Intelligence — candle-grade layers
    // are available now; trade/L2/options-grade layers are declared with
    // available: false until a provider supplies that data class (honest
    // disabled states, never fake rendering).
    | "volumeProfile"
    | "poc"
    | "valueArea"
    | "hvnLvn"
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

export type ChartLayerDef = {
    id: ChartLayerId;
    label: string;
    defaultOn: boolean;
    /** False when the chart engine has no renderer for this layer yet. */
    available: boolean;
};

export const CHART_LAYERS: ChartLayerDef[] = [
    // By default, show ONLY clean candlesticks — no overlays.
    // Users activate indicators from the layer panel when they want analysis.
    // This matches the professional trading platform UX (TradingView, brokers).
    { id: "volume", label: "Volume", defaultOn: false, available: true },
    { id: "vwap", label: "VWAP", defaultOn: false, available: true },
    { id: "sessionLevels", label: "Session H/L", defaultOn: false, available: true },
    { id: "prevDayHighLow", label: "Prev day H/L", defaultOn: false, available: true },
    { id: "supportResistance", label: "S/R", defaultOn: false, available: true },
    { id: "fvg", label: "FVG", defaultOn: false, available: true },
    { id: "orderBlocks", label: "Order blocks", defaultOn: false, available: true },
    { id: "bosChoch", label: "BOS / CHoCH", defaultOn: false, available: true },
    { id: "liquidityLevels", label: "Liquidity", defaultOn: false, available: true },
    { id: "equalHighsLows", label: "Equal H/L", defaultOn: false, available: true },
    // Indicator overlays (off by default so default charts stay uncluttered).
    { id: "bollingerBands", label: "Bollinger", defaultOn: false, available: true },
    { id: "keltnerChannels", label: "Keltner", defaultOn: false, available: true },
    { id: "donchianChannels", label: "Donchian", defaultOn: false, available: true },
    { id: "supertrend", label: "Supertrend", defaultOn: false, available: true },
    { id: "heikinAshi", label: "Heikin-Ashi", defaultOn: false, available: true },
    { id: "dailyPivots", label: "Pivots", defaultOn: false, available: true },
    { id: "rsiPane", label: "RSI pane", defaultOn: false, available: true },
    { id: "macdPane", label: "MACD pane", defaultOn: false, available: true },
    { id: "ema9", label: "EMA 9", defaultOn: false, available: true },
    { id: "ema20", label: "EMA 20", defaultOn: false, available: true },
    { id: "ema50", label: "EMA 50", defaultOn: false, available: true },
    { id: "ema200", label: "EMA 200", defaultOn: false, available: true },
    { id: "sma20", label: "SMA 20", defaultOn: false, available: true },
    { id: "sma50", label: "SMA 50", defaultOn: false, available: true },
    { id: "sma200", label: "SMA 200", defaultOn: false, available: true },
    { id: "stochasticPane", label: "Stochastic", defaultOn: false, available: true },
    { id: "atrPane", label: "ATR pane", defaultOn: false, available: true },
    { id: "parabolicSar", label: "Parabolic SAR", defaultOn: false, available: true },
    { id: "ichimokuCloud", label: "Ichimoku Cloud", defaultOn: false, available: true },
    // Order Flow layers. Availability mirrors the capability model
    // (lib/order-flow/capabilities.ts): OHLCV can honestly render the volume
    // profile, behavioural events, and the ESTIMATED candle-direction delta
    // (documented proxy model — delta-proxy.ts, clearly labelled, never
    // presented as bid/ask delta). Footprint/heatmap/L2/options-grade layers
    // still need data classes no current provider supplies — disabled with an
    // explanation, never faked.
    { id: "volumeProfile", label: "Volume Profile", defaultOn: false, available: true },
    { id: "poc", label: "POC", defaultOn: false, available: true },
    { id: "valueArea", label: "VAH / VAL", defaultOn: false, available: true },
    { id: "hvnLvn", label: "HVN / LVN", defaultOn: false, available: true },
    { id: "absorption", label: "Absorption", defaultOn: false, available: true },
    { id: "exhaustion", label: "Exhaustion", defaultOn: false, available: true },
    { id: "delta", label: "Delta (est.)", defaultOn: false, available: true },
    { id: "cumulativeDelta", label: "Cum. Delta (est.)", defaultOn: false, available: true },
    { id: "footprint", label: "Footprint", defaultOn: false, available: false },
    { id: "imbalances", label: "Imbalances", defaultOn: false, available: false },
    { id: "largeTrades", label: "Large Trades", defaultOn: false, available: false },
    { id: "liquidity", label: "L2 Liquidity", defaultOn: false, available: false },
    { id: "heatmap", label: "Heatmap", defaultOn: false, available: false },
    // GEX renders real call/put walls + gamma flip from a live options chain
    // (renderer exists), but only for symbols with a wired options source.
    // Static availability stays false so consumers that never feed the chain
    // (Pine/Analysis workspaces) keep it disabled; the terminal overrides the
    // verdict per-symbol via useLayerAvailability/PER_SYMBOL_LAYERS.
    { id: "gex", label: "GEX", defaultOn: false, available: false },
];

/**
 * Structured explanation for degraded/unavailable layers — surfaced inline in
 * the layer picker (no hover dependency) so users can see WHY a layer is off
 * and exactly WHICH data source would unlock it.
 */
export interface LayerUnlockInfo {
    /** Why the layer is degraded or unavailable on the current feed. */
    reason: string;
    /** The data class that upgrades/unlocks the layer. */
    unlock: string;
    /** Concrete source kinds that supply that data class. */
    sources: string;
    /**
     * True when the layer IS available but only through an estimated proxy
     * (renders an amber EST chip). Absent for layers that would be HIGH
     * quality when their data source is present.
     */
    estimated?: boolean;
}

/**
 * Explanations per layer. Present for unavailable layers (picker shows them
 * inline on click) and for estimated layers (picker shows them as the chip
 * tooltip so provenance stays visible).
 */
export const LAYER_REQUIREMENTS: Partial<Record<ChartLayerId, LayerUnlockInfo>> = {
    delta: {
        reason: "Estimated only: candle volume signed by bar direction (body-direction proxy). The current feed carries no per-trade aggressor side, so this is directional pressure — not bid/ask delta.",
        unlock: "A trade tape with buyer/seller (aggressor) classification",
        sources: "Exchange trade streams with side flags (Binance aggTrades, Deribit trades, Bybit tape) or an MT5 bridge publishing tick sides.",
        estimated: true,
    },
    cumulativeDelta: {
        reason: "Estimated only: running total of candle-direction volume pressure — not true cumulative delta.",
        unlock: "A trade tape with buyer/seller (aggressor) classification",
        sources: "Exchange trade streams with side flags (Binance aggTrades, Deribit trades, Bybit tape) or an MT5 bridge publishing tick sides.",
        estimated: true,
    },
    footprint: {
        reason: "Needs bid × ask volume per price level per bar. The current feed is OHLCV candles — every print inside a bar is aggregated into one number.",
        unlock: "Bid/ask-classified tick data",
        sources: "Exchange trade streams with side flags (Binance aggTrades, Deribit trades) or a book-map style tick feed.",
    },
    imbalances: {
        reason: "Needs the same bid × ask price cells footprint uses — imbalances are ratios between dominant and weak sides of those cells. Candles cannot provide them.",
        unlock: "Bid/ask-classified tick data",
        sources: "Exchange trade streams with side flags (Binance aggTrades, Deribit trades) or a book-map style tick feed.",
    },
    largeTrades: {
        reason: "Needs the individual trade tape — candles collapse every print into a single bar volume, so outlier prints are invisible.",
        unlock: "Time-stamped trade prints with size (side classification optional)",
        sources: "Exchange trade streams (Binance trades, Deribit last_trades) or any raw tape feed.",
    },
    liquidity: {
        reason: "Needs live order-book (Level 2) snapshots — candles carry no resting-order data at all.",
        unlock: "Depth snapshots or streaming book updates",
        sources: "Poll or stream exchange depth (Binance /depth, Deribit book) server-side, then feed the L2 pipeline.",
    },
    heatmap: {
        reason: "Needs Level 2 depth tracked over time so walls and stacking are visible historically — the current feed has no book data.",
        unlock: "A history of depth snapshots (L2 ring buffer)",
        sources: "Poll or stream exchange depth (Binance /depth, Deribit book) and persist snapshots in the L2 pipeline.",
    },
    gex: {
        reason: "Needs an options chain with open interest and implied volatility. A real chain is already wired — but only for symbols with listed options; forex/metals have none.",
        unlock: "Switch the chart to BTCUSD, ETHUSD, SPX500, NAS100, US30 or any listed ETF/equity (NVDA, SPY, …) — the chain feeds Deribit (crypto) or CBOE delayed (US listed) automatically.",
        sources: "Deribit book summaries (BTC/ETH, real-time) · CBOE delayed quotes (~15 min) for SPX/NDX/DJX, ETFs and US equities.",
    },
};

/** Static availability from the vocabulary (no per-symbol resolution). */
export function staticLayerAvailability(): Record<ChartLayerId, boolean> {
    return Object.fromEntries(CHART_LAYERS.map((l) => [l.id, l.available])) as Record<ChartLayerId, boolean>;
}

// ── capability truthfulness ────────────────────────────────────────────────
//
// `available: true` is a PROMISE to the user: the chart has a renderer for
// this layer. `LayerCapability` makes that promise explicit and testable:
//
//   implemented — ProTerminalChart renders it from real candle data.
//   planned     — no renderer yet; the toggle must stay visibly disabled and
//                 LAYER_REQUIREMENTS explains what would unlock it.
//   unsupported — cannot be rendered for this data class at all.
//
// The chart-upgrades test suite enforces the invariants:
//   available  ⇒ capability === "implemented"
//   capability !== "implemented" ⇒ !available ∧ LAYER_REQUIREMENTS entry
//   every available layer is actually bound in ProTerminalChart (`layers.<id>`).

export type LayerCapability = "implemented" | "planned" | "unsupported";

/** Renderer capability for layers that are NOT implemented yet. */
export const LAYER_CAPABILITY: Partial<Record<ChartLayerId, LayerCapability>> = {
    footprint: "planned",
    imbalances: "planned",
    largeTrades: "planned",
    liquidity: "planned",
    heatmap: "planned",
};

/** Capability of the chart's own renderer for one layer (default: implemented). */
export function layerCapability(id: ChartLayerId): LayerCapability {
    return LAYER_CAPABILITY[id] ?? "implemented";
}

/**
 * Layers whose availability is resolved per-symbol at render time (data
 * source is wired, but only for certain symbols). The picker intersects this
 * with the per-symbol availability map.
 */
export const PER_SYMBOL_LAYERS: Partial<Record<ChartLayerId, (symbol: string) => boolean>> = {
    gex: (symbol) => GEX_SYMBOLS.has(symbol.toUpperCase()),
};

/** Client-safe symbol set for the GEX layer (mirrors the route's sources). */
const GEX_SYMBOLS: ReadonlySet<string> = new Set([
    "BTCUSD", "ETHUSD", "SPX500", "NAS100", "US30", "SPY", "QQQ",
    "AAPL", "TSLA", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AMD", "NFLX", "COIN",
]);

export const CHART_LAYER_IDS = CHART_LAYERS.map((l) => l.id);

export function defaultLayerState(): Record<ChartLayerId, boolean> {
    return Object.fromEntries(CHART_LAYERS.map((l) => [l.id, l.defaultOn])) as Record<ChartLayerId, boolean>;
}

/**
 * Layer on/off verdict used by every renderer binding: only an explicit
 * `true` renders. Missing keys (older persisted state written before a layer
 * existed) resolve to OFF — a hidden layer may never draw, and an unknown key
 * may never silently enable one.
 */
export function isLayerOn(
    layers: Partial<Record<ChartLayerId, boolean>> | null | undefined,
    id: ChartLayerId,
): boolean {
    return layers?.[id] === true;
}

/** Execution timeframes offered in the terminal toolbar. */
export const TERMINAL_TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "M30", "H1"];

/** Timeframe → lightweight-charts interval used by the chart fetcher. */
export const TIMEFRAME_TO_INTERVAL: Record<Timeframe, string> = {
    M1: "1m",
    M3: "3m",
    M5: "5m",
    M15: "15m",
    M30: "30m",
    H1: "1h",
    H4: "4h",
    D1: "1D",
    W1: "1W",
};
