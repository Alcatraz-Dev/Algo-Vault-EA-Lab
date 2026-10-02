import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { candleOpenTime, type ChartTimeframe } from "./timeframe";

/**
 * Canonical chart candle — Phase 2 model.
 *
 * `timestamp` is ALWAYS the candle's opening time bucketed by the canonical
 * timeframe engine (`lib/chart-engine/timeframe.ts`). This is the only candle
 * shape the native chart engine exchanges internally; everything else
 * (provider bars, quote ticks, replay bars) is normalized into it at the
 * boundary so no incompatible candle formats exist across the platform.
 *
 * The model stays structurally assignable to `MarketCandle` so existing
 * analytics/indicator code keeps working unchanged.
 */
export interface ChartCandle {
    /** Opening time (ms, UTC). Never a close time, never a tick time. */
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    /** Provider volume when available (0 when the provider sends none). */
    volume?: number;
    /** Tick volume when the provider exposes it (Biquote does). */
    tickVolume?: number;
    /** Spread at snapshot time when the provider exposes it. */
    spread?: number;
    /** Owning instrument — dedupe key component. */
    symbol: string;
    /** Owning timeframe — dedupe key component. */
    timeframe: ChartTimeframe;
    /**
     * True once the candle bucket has fully elapsed and the provider has
     * confirmed it. The forming (live) candle is never finalized until a
     * boundary crossing or a provider `isOpen: false` bar replaces it.
     */
    finalized: boolean;
}

/** A single market price observation (from any provider/quote source). */
export interface ChartTick {
    price: number;
    timestamp: number;
    volume?: number;
    spread?: number;
    /** Optional provider tag for diagnostics ("biquote", "tradingview", ...). */
    source?: string;
}

/** Sort/dedupe identity for a candle within the engine. */
export function candleKey(symbol: string, timeframe: string, timestamp: number): string {
    return `${symbol.toUpperCase()}|${timeframe.toUpperCase()}|${timestamp}`;
}

/** Validate a raw OHLC quadruple; returns null instead of "fixing" bad data. */
export function isValidCandleValues(c: Pick<ChartCandle, "open" | "high" | "low" | "close">): boolean {
    return (
        Number.isFinite(c.open) && c.open > 0 &&
        Number.isFinite(c.high) && Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        c.high >= c.low &&
        c.close >= c.low && c.close <= c.high &&
        c.open >= c.low && c.open <= c.high
    );
}

/**
 * Normalize any `{timestamp, open, high, low, close, ...}` bar into the
 * canonical model. The bar's own timestamp is re-bucketed to its opening time
 * for the given timeframe, guaranteeing open-time semantics even when a
 * provider accidentally sends a close-anchored stamp. Returns null for
 * invalid bars — never fabricates a replacement.
 */
export function toChartCandle(
    bar: MarketCandle & Partial<Pick<ChartCandle, "tickVolume" | "spread" | "finalized" | "symbol" | "timeframe">>,
    symbol: SupportedSymbol | string,
    timeframe: ChartTimeframe,
): ChartCandle | null {
    if (!bar || !Number.isFinite(bar.timestamp) || bar.timestamp <= 0) return null;
    if (!isValidCandleValues(bar)) return null;
    return {
        timestamp: candleOpenTime(bar.timestamp, timeframe),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        ...(Number.isFinite(bar.volume) ? { volume: bar.volume } : { volume: 0 }),
        ...(Number.isFinite(bar.tickVolume) ? { tickVolume: bar.tickVolume } : {}),
        ...(Number.isFinite(bar.spread) ? { spread: bar.spread } : {}),
        symbol: String(symbol).toUpperCase(),
        timeframe,
        finalized: bar.finalized ?? false,
    };
}

/** Convert a quote/tick observation into a canonical tick (or null). */
export function toChartTick(tick: ChartTick): ChartTick | null {
    if (!tick || !Number.isFinite(tick.price) || tick.price <= 0 || !Number.isFinite(tick.timestamp)) {
        return null;
    }
    return tick;
}

/** Canonical → legacy MarketCandle for consumers of the old shape. */
export function chartCandleToMarketCandle(c: ChartCandle): MarketCandle {
    return {
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        ...(c.volume !== undefined ? { volume: c.volume } : {}),
    };
}

/**
 * Compare two candles ignoring the finalized flag — used to decide whether a
 * re-render is actually needed (data equality, not identity).
 */
export function candlesEqual(a: ChartCandle, b: ChartCandle): boolean {
    return (
        a.timestamp === b.timestamp &&
        a.open === b.open &&
        a.high === b.high &&
        a.low === b.low &&
        a.close === b.close &&
        (a.volume ?? 0) === (b.volume ?? 0)
    );
}
