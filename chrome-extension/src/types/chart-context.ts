/**
 * Canonical chart context — the ONE structured representation of the user's
 * active TradingView chart shared by every extension feature (AI Copilot,
 * Analyze Chart, Strategy Lab, Backtest, Risk, Signals, Quick Order, Overlay).
 *
 * Legacy fields (symbol/exchange/timeframe/price/isTradingView) remain the
 * canonical accessors; extended fields are optional so the object can be
 * constructed incrementally as browser detection + market enrichment complete.
 */

export type Market = "forex" | "crypto" | "index" | "stock" | "metal" | "commodity" | "unknown";

export type ChartContextStatus = "active" | "stale" | "unknown" | "manual";

export type MarketSyncStatus = "matched" | "mismatched" | "unsupported" | "unknown";

export interface DetectedIndicator {
  id: string;
  /** Display name as seen in the TradingView legend, e.g. "EMA 20". */
  name: string;
  /** Normalized indicator type, e.g. "ema" | "rsi" | "macd" | "vwap". */
  type: string;
  parameters: Array<{ key: string; value: string | number }>;
  pane: "overlay" | "separate" | "unknown";
  /** Where the information came from. */
  source: "tradingview-legend" | "market-computed" | "tradingview-widget" | "unavailable";
  /** Live value when actually accessible (legend/values), otherwise null. */
  value: number | null;
  displayValue: string | null;
  available: boolean;
  values: Array<{ label: string | null; value: number | string | null; available: boolean }>;
  timeframe: string | null;
}

export interface DetectedDrawing {
  id: string;
  type: string;
  label: string | null;
  price: number | null;
  source: "tradingview" | "tradingview-widget" | "unavailable";
  available: boolean;
}

export interface VisibleRange {
  from: number | null;
  to: number | null;
  fromLabel: string | null;
  toLabel: string | null;
  bars: number | null;
  source: "tradingview-time-axis" | "tradingview-widget" | "unavailable";
}

export interface ChartContext {
  /* ── identity (legacy-canonical) ─────────────────────────── */
  symbol: string | null;
  exchange: string | null;
  timeframe: string | null;
  price: number | null;
  isTradingView: boolean;
  /** Original identifier exactly as seen in the browser (OANDA:XAUUSD, BINANCE:BTCUSDT). */
  rawSymbol?: string | null;
  ticker?: string | null;
  market?: Market;
  rawTimeframe?: string | null;
  displayName?: string | null;

  /* ── current state ───────────────────────────────────────── */
  priceSource?: "tradingview-legend" | "tradingview-widget" | "market-data" | "unavailable";
  priceDisplay?: string | null;

  /* ── chart content ───────────────────────────────────────── */
  indicators?: DetectedIndicator[];
  drawings?: DetectedDrawing[];
  visibleRange?: VisibleRange;

  /* ── detection provenance ────────────────────────────────── */
  symbolSources?: string[];
  timeframeSource?: string | null;
  navigationId?: number;

  /* ── freshness / validation ──────────────────────────────── */
  timestamp?: number;
  dataAgeMs?: number;
  status?: ChartContextStatus;
  source?: "tradingview" | "manual";
  /** Whether the browser symbol matches the market-data symbol used for enrichment. */
  marketSync?: MarketSyncStatus;
  /** The symbol fed to AlgoVault market data (may differ from symbol under normalization). */
  marketSymbol?: string | null;
  /** When the market-data symbol could not be resolved (unsupported provider). */
  unsupportedReason?: string | null;
  /** Manual override set by the user (popup), replacing browser detection. */
  manualOverride?: boolean;
}

/** Immutable empty context — same shape everywhere it's constructed. */
export function createEmptyChartContext(): ChartContext {
  const now = Date.now();
  return {
    symbol: null,
    exchange: null,
    timeframe: null,
    price: null,
    isTradingView: false,
    rawSymbol: null,
    ticker: null,
    market: "unknown",
    rawTimeframe: null,
    displayName: null,
    priceSource: "unavailable",
    priceDisplay: null,
    indicators: [],
    drawings: [],
    visibleRange: { from: null, to: null, fromLabel: null, toLabel: null, bars: null, source: "unavailable" },
    symbolSources: [],
    timeframeSource: null,
    navigationId: 0,
    timestamp: now,
    dataAgeMs: 0,
    status: "unknown",
    source: "manual",
    marketSync: "unknown",
    marketSymbol: null,
    unsupportedReason: null,
    manualOverride: false,
  };
}

/** True when the context carries a usable chart identity. */
export function hasChartIdentity(ctx: ChartContext | null | undefined): boolean {
  return Boolean(ctx && (ctx.symbol || ctx.rawSymbol));
}

/** Compare two contexts by identity; returns true when symbol/timeframe changed. */
export function chartIdentityChanged(a: ChartContext | null, b: ChartContext | null): boolean {
  if (!a || !b) return true;
  return a.symbol !== b.symbol || a.timeframe !== b.timeframe || a.exchange !== b.exchange;
}