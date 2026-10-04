"use client";

/**
 * Pro Terminal chart — real candles plus overlays computed from real data.
 *
 * Base candles come from the canonical `/api/analytics/ohlc` endpoint. The
 * overlays are computed client-side from those same candles with the same
 * rules the server engines use (VWAP from cumulative typical price, structure
 * swings from the confirmed pivot rule, FVGs from 3-candle gaps, order blocks
 * from displacement candles, equal highs/lows by tolerance clustering). When a
 * layer needs engine output the terminal does not fetch (BOS/CHoCH events),
 * it consumes the analysis payload passed in as a prop.
 *
 * Renders with lightweight-charts (already a dependency) directly, so the
 * terminal controls the full overlay set without touching the shared
 * TradingChart component.
 */

import { useEffect, useMemo, useRef, useState, useCallback, type RefObject } from "react";
import {
    createChart,
    ColorType,
    CrosshairMode,
    LineStyle,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    createSeriesMarkers,
    type IChartApi,
    type ISeriesApi,
    type IPriceLine,
    type ISeriesMarkersPluginApi,
    type SeriesMarker,
    type LineData,
    type Time,
    type UTCTimestamp,
} from "lightweight-charts";
import { cn } from "@/lib/utils";
import { useLiveCandles } from "@/hooks/useLiveCandles";
import { gexLevels, type GexLevel } from "@/lib/order-flow/gex/levels";
import { isMarketTradableAt, isChartTimeframe, TIMEFRAME_MS } from "@/lib/chart-engine/timeframe";
import { structureOverlayLayer } from "@/lib/chart-engine/overlay-contract";
import { ChartAnchoredOverlay, type AnchoredItem } from "@/lib/chart-engine/chart-anchored-overlay";
import { barIndexForTime, shiftLogicalRangeForPrepend } from "@/lib/chart-engine/coordinate-mapping";
import { useOrderFlow } from "@/hooks/use-order-flow";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { AdvancedAnalysisResult } from "@/lib/ai/analysis/intelligence";
import type { ChartLayerId } from "./chart-layers";
import type { PineStudyOverlay } from "./pine-overlays";
import type { TerminalSignal } from "@/lib/ai/scalping/radar";
import { fmtPrice } from "./terminal-utils";
import { TA } from "@/lib/pine-runtime/builtins";

type Candle = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
};
// ── overlay computation (same rules as the server engines) ──────────────────

/** Session anchors: the UTC windows used by lib/analytics/sessions.ts. */
const SESSION_WINDOWS: Array<{ key: string; label: string; startH: number; endH: number; color: string }> = [
    { key: "asian", label: "Asia", startH: 0, endH: 8, color: "#a78bfa" },
    { key: "london", label: "London", startH: 7, endH: 16, color: "#22d3ee" },
    { key: "ny", label: "New York", startH: 12, endH: 21, color: "#f59e0b" },
];

function computeSessionLevels(candles: Candle[]): Array<{ price: number; label: string; color: string }> {
    if (candles.length === 0) return [];
    const out: Array<{ price: number; label: string; color: string }> = [];
    const lastTs = candles[candles.length - 1].timestamp;
    const lastDay = new Date(lastTs).toISOString().slice(0, 10);
    for (const w of SESSION_WINDOWS) {
        const inWindow = candles.filter((c) => {
            const d = new Date(c.timestamp);
            return d.toISOString().slice(0, 10) === lastDay && d.getUTCHours() >= w.startH && d.getUTCHours() < w.endH;
        });
        if (inWindow.length < 3) continue;
        out.push({ price: Math.max(...inWindow.map((c) => c.high)), label: `${w.label} H`, color: w.color });
        out.push({ price: Math.min(...inWindow.map((c) => c.low)), label: `${w.label} L`, color: w.color });
    }
    return out;
}

function computePrevDay(candles: Candle[]): Array<{ price: number; label: string; color: string }> {
    if (candles.length === 0) return [];
    const lastTs = candles[candles.length - 1].timestamp;
    const lastDay = new Date(lastTs).toISOString().slice(0, 10);
    const days = [...new Set(candles.map((c) => new Date(c.timestamp).toISOString().slice(0, 10)))].sort();
    const idx = days.indexOf(lastDay);
    if (idx <= 0) return [];
    const prevDay = candles.filter((c) => new Date(c.timestamp).toISOString().slice(0, 10) === days[idx - 1]);
    if (prevDay.length < 3) return [];
    return [
        { price: Math.max(...prevDay.map((c) => c.high)), label: "Prev day H", color: "#94a3b8" },
        { price: Math.min(...prevDay.map((c) => c.low)), label: "Prev day L", color: "#94a3b8" },
    ];
}

/** VWAP from cumulative typical price × volume (session-anchored by UTC day). */
function computeVwap(candles: Candle[]): Array<{ time: UTCTimestamp; value: number }> {
    const out: Array<{ time: UTCTimestamp; value: number }> = [];
    let cumPV = 0;
    let cumV = 0;
    let currentDay = "";
    for (const c of candles) {
        const day = new Date(c.timestamp).toISOString().slice(0, 10);
        if (day !== currentDay) {
            currentDay = day;
            cumPV = 0;
            cumV = 0;
        }
        const tp = (c.high + c.low + c.close) / 3;
        const v = c.volume && c.volume > 0 ? c.volume : 1;
        cumPV += tp * v;
        cumV += v;
        out.push({ time: Math.floor(c.timestamp / 1000) as UTCTimestamp, value: cumPV / cumV });
    }
    return out;
}

function ema(values: number[], period: number): Array<number | null> {
    const out: Array<number | null> = [];
    const k = 2 / (period + 1);
    let prev: number | null = null;
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) {
            out.push(null);
            continue;
        }
        if (i === period - 1) {
            const seed = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
            prev = seed;
            out.push(seed);
            continue;
        }
        prev = values[i] * k + (prev ?? values[i]) * (1 - k);
        out.push(prev);
    }
    return out;
}

/**
 * Confirmed swing pivots (fractal rule, matching the structure engine's
 * swing detection window): a bar whose high is the highest of its ±2
 * neighbourhood is a swing high; mirrored for lows.
 */
function computeSwings(candles: Candle[], leftRight = 2) {
    const highs: Array<{ index: number; price: number }> = [];
    const lows: Array<{ index: number; price: number }> = [];
    for (let i = leftRight; i < candles.length - leftRight; i++) {
        const c = candles[i];
        let isHigh = true;
        let isLow = true;
        for (let j = i - leftRight; j <= i + leftRight; j++) {
            if (j === i) continue;
            if (candles[j].high >= c.high) isHigh = false;
            if (candles[j].low <= c.low) isLow = false;
        }
        if (isHigh) highs.push({ index: i, price: c.high });
        if (isLow) lows.push({ index: i, price: c.low });
    }
    return { highs, lows };
}

/** Support/resistance: swing clusters within a tolerance of the symbol range. */
function computeSrLevels(candles: Candle[]): Array<{ price: number; touches: number; kind: "support" | "resistance" }> {
    const last = candles[candles.length - 1];
    if (!last) return [];
    const { highs, lows } = computeSwings(candles, 3);
    const range = Math.max(...candles.map((c) => c.high)) - Math.min(...candles.map((c) => c.low));
    if (range <= 0) return [];
    const tol = range * 0.0015;

    const cluster = (points: Array<{ price: number }>, kind: "support" | "resistance") => {
        const sorted = [...points].sort((a, b) => a.price - b.price);
        const out: Array<{ price: number; touches: number; kind: "support" | "resistance" }> = [];
        let bucket: number[] = [];
        const flush = () => {
            if (bucket.length === 0) return;
            const price = bucket.reduce((s, v) => s + v, 0) / bucket.length;
            if ((kind === "support" && price < last.close) || (kind === "resistance" && price > last.close)) {
                out.push({ price, touches: bucket.length, kind });
            }
            bucket = [];
        };
        for (const p of sorted) {
            if (bucket.length === 0 || Math.abs(p.price - bucket[bucket.length - 1]) <= tol) bucket.push(p.price);
            else {
                flush();
                bucket = [p.price];
            }
        }
        flush();
        return out.sort((a, b) => b.touches - a.touches).slice(0, 3);
    };

    return [...cluster(highs, "resistance"), ...cluster(lows, "support")];
}

/** Fair value gaps: 3-candle imbalance where candle 1 and 3 wicks do not overlap. */
function computeFvgs(candles: Candle[]): Array<{ top: number; bottom: number; startIdx: number; bullish: boolean }> {
    const out: Array<{ top: number; bottom: number; startIdx: number; bullish: boolean }> = [];
    for (let i = 2; i < candles.length; i++) {
        const a = candles[i - 2];
        const c = candles[i];
        if (c.low > a.high) out.push({ top: c.low, bottom: a.high, startIdx: i - 2, bullish: true });
        else if (c.high < a.low) out.push({ top: a.low, bottom: c.high, startIdx: i - 2, bullish: false });
    }
    // Keep only gaps not fully mitigated by later price action.
    return out.filter((g) => {
        const later = candles.slice(g.startIdx + 3);
        return !later.some((c) => c.low <= g.bottom && c.high >= g.top);
    }).slice(-6);
}

/** Order blocks: last opposite candle before a displacement move. */
function computeOrderBlocks(candles: Candle[]): Array<{ top: number; bottom: number; startIdx: number; bullish: boolean }> {
    const out: Array<{ top: number; bottom: number; startIdx: number; bullish: boolean }> = [];
    const atrWindow = 14;
    for (let i = atrWindow; i < candles.length - 1; i++) {
        const c = candles[i];
        const win = candles.slice(Math.max(0, i - atrWindow), i);
        const avgBody = win.reduce((s, w) => s + Math.abs(w.close - w.open), 0) / win.length;
        const body = Math.abs(c.close - c.open);
        if (body < avgBody * 1.5) continue;
        const bullish = c.close > c.open;
        const prev = candles[i - 1];
        if (bullish && prev.close < prev.open) out.push({ top: prev.high, bottom: prev.low, startIdx: i - 1, bullish: true });
        if (!bullish && prev.close > prev.open) out.push({ top: prev.high, bottom: prev.low, startIdx: i - 1, bullish: false });
    }
    return out.filter((ob) => {
        const later = candles.slice(ob.startIdx + 2);
        return !later.some((c) => c.low <= ob.bottom && c.high >= ob.top);
    }).slice(-4);
}

/** Equal highs/lows: swing prices clustered within a tight tolerance. */
function computeEqualLevels(candles: Candle[]): Array<{ price: number; kind: "eqh" | "eql"; count: number }> {
    const { highs, lows } = computeSwings(candles, 2);
    const range = Math.max(...candles.map((c) => c.high)) - Math.min(...candles.map((c) => c.low));
    if (range <= 0) return [];
    const tol = range * 0.0004;
    const find = (points: Array<{ price: number }>, kind: "eqh" | "eql") => {
        const sorted = [...points].sort((a, b) => a.price - b.price);
        const out: Array<{ price: number; kind: "eqh" | "eql"; count: number }> = [];
        let bucket: number[] = [];
        const flush = () => {
            if (bucket.length >= 2) out.push({ price: bucket.reduce((s, v) => s + v, 0) / bucket.length, kind, count: bucket.length });
            bucket = [];
        };
        for (const p of sorted) {
            if (bucket.length === 0 || Math.abs(p.price - bucket[bucket.length - 1]) <= tol) bucket.push(p.price);
            else {
                flush();
                bucket = [p.price];
            }
        }
        flush();
        return out;
    };
    return [...find(highs, "eqh"), ...find(lows, "eql")];
}

// ── component ───────────────────────────────────────────────────────────────

const PINE_PANE_STRETCH = 0.35;
/** Panning within this many bars of the loaded window's left edge triggers an older-page load. */
const HISTORY_LOAD_THRESHOLD_BARS = 6;

/** Push a series of values (NaN → skipped) onto the chart, aligned 1:1 with candles. */
function feedSeries(series: ISeriesApi<"Line">, candles: Candle[], values: Array<number | null>): void {
    const data: Array<{ time: UTCTimestamp; value: number }> = [];
    candles.forEach((c, i) => {
        const v = values[i];
        if (v !== null && v !== undefined && Number.isFinite(v)) {
            data.push({ time: Math.floor(c.timestamp / 1000) as UTCTimestamp, value: v });
        }
    });
    series.setData(data);
}

/** Instantiate a hidden line series in the given pane. */
function addHiddenLine(chart: IChartApi, paneIndex = 0, color = "#94a3b8", width: 1 | 2 = 1): ISeriesApi<"Line"> {
    return chart.addSeries(
        LineSeries,
        {
            color,
            lineWidth: width,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        },
        paneIndex
    );
}

/**
 * Classic floor-trader daily pivots from the previous UTC day, computed on
 * the displayed candles (last day with data = the day pivots are held for).
 */
function computeDailyPivotLines(candles: Candle[]): Array<{ price: number; label: string; color: string }> {
    if (candles.length < 3) return [];
    const lastDay = new Date(candles[candles.length - 1].timestamp).toISOString().slice(0, 10);
    const prev = candles.filter((c) => new Date(c.timestamp).toISOString().slice(0, 10) !== lastDay);
    if (prev.length < 3) return [];
    const H = Math.max(...prev.map((c) => c.high));
    const L = Math.min(...prev.map((c) => c.low));
    const C = prev[prev.length - 1].close;
    const p = (H + L + C) / 3;
    const range = H - L;
    return [
        { price: p, label: "P", color: "#eab308" },
        { price: 2 * p - L, label: "R1", color: "#fb7185" },
        { price: p + range, label: "R2", color: "#fb7185" },
        { price: 2 * p - H, label: "S1", color: "#34d399" },
        { price: p - range, label: "S2", color: "#34d399" },
    ];
}

export function ProTerminalChart({
    symbol,
    timeframe,
    layers,
    analysis,
    token = null,
    height,
    studyOverlay = null,
    signals = [],
    onCandlesChange,
    orderFlowSettings,
    chartLevels = null,
    optionsChain = null,
}: {
    symbol: SupportedSymbol;
    timeframe: Timeframe;
    layers: Record<ChartLayerId, boolean>;
    analysis: AdvancedAnalysisResult | null;
    /** Optional auth token; the OHLC feed works without one. */
    token?: string | null;
    height: number;
    /** Pine script overlays (plots / hlines / plotshapes) computed from the same candles. */
    studyOverlay?: PineStudyOverlay | null;
    /** Live deterministic scanner signals for the active symbol. */
    signals?: TerminalSignal[];
    /** Notified with the fetched candles so callers can compute overlays on the same data. */
    onCandlesChange?: (candles: Candle[]) => void;
    /** Order Flow user settings (calculation parameters). */
    orderFlowSettings?: Partial<import("@/lib/order-flow/settings").OrderFlowSettings>;
    /** Chart-confluence levels a signal was built from (session/pivot/VWAP-side/EQH/EQL). */
    chartLevels?: Array<{ kind: string; label: string; price: number }> | null;
    /** Real options chain (GEX) from useOptionsChain; null → GEX layer stays unavailable. */
    optionsChain?: {
        quotes: import("@/lib/order-flow/types").OptionQuote[];
        available: boolean;
        contractMultiplier?: number;
    } | null;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const ema9Ref = useRef<ISeriesApi<"Line"> | null>(null);
    const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    // Math-indicator layers: recreated when their layer flag flips.
    const bbSeriesRef = useRef<{ basis: ISeriesApi<"Line">; upper: ISeriesApi<"Line">; lower: ISeriesApi<"Line"> } | null>(null);
    const kcSeriesRef = useRef<{ mid: ISeriesApi<"Line">; upper: ISeriesApi<"Line">; lower: ISeriesApi<"Line"> } | null>(null);
    const dcSeriesRef = useRef<{ upper: ISeriesApi<"Line">; lower: ISeriesApi<"Line">; mid: ISeriesApi<"Line"> } | null>(null);
    const stSeriesRef = useRef<{ line: ISeriesApi<"Line">; pane: number | null } | null>(null);
    // Viewport guard: keeps the user's zoom/scroll position while live ticks
    // move the forming bar, only auto-fitting when the symbol/timeframe or
    // history length actually changes (like a regular market chart).
    const lastBarCountRef = useRef(0);
    const lastKeyRef = useRef("");
    // Tail of the bar the candle series currently holds — lets live quote ticks
    // be pushed with `series.update()` instead of a full `setData` redraw.
    const lastPushedBarRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
    const lastPushedCandlesRef = useRef<Candle[]>([]);
    const haSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const rsiSeriesRef = useRef<{ rsi: ISeriesApi<"Line">; pane: number | null; lines: IPriceLine[] } | null>(null);
    const macdSeriesRef = useRef<{ macd: ISeriesApi<"Line">; signal: ISeriesApi<"Line">; pane: number | null } | null>(null);
    // Panes created by these layers — remembered so the pane can be removed
    // again when the layer is switched off.
    const stPaneOwnedRef = useRef<number | null>(null);
    const rsiPaneOwnedRef = useRef<number | null>(null);
    const macdPaneOwnedRef = useRef<number | null>(null);
    // Estimated delta pane (candle-direction proxy — clearly labelled, never
    // presented as bid/ask delta).
    const deltaPaneOwnedRef = useRef<number | null>(null);
    const deltaSeriesRef = useRef<{ hist: ISeriesApi<"Histogram">; line: ISeriesApi<"Line"> } | null>(null);
    // Pine study overlays: line series (overlay pane) + a stacked pane for
    // non-overlay scripts, rebuilt whenever the applied script changes.
    const studySeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
    const studyPaneRef = useRef<number | null>(null);
    const studyMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const signalMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const studyHlineLinesRef = useRef<IPriceLine[]>([]);
    // Order Flow overlay state (price lines + event markers + profile drawing).
    const orderFlowLinesRef = useRef<IPriceLine[]>([]);
    const orderFlowMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    // GEX gamma levels (call/put walls + flip) from the real options chain.
    const gexLinesRef = useRef<IPriceLine[]>([]);
    // Chart-confluence levels of the displayed signal (dashed price lines).
    const chartLevelLinesRef = useRef<IPriceLine[]>([]);
    // Anchored overlay layer (FVG/OB zones + volume profile) — positioned by
    // the chart's own coordinate transforms, never by independent DOM math.
    const anchoredOverlayRef = useRef<ChartAnchoredOverlay | null>(null);
    // Mirror of the latest candles + interval for the overlay's time→bar
    // transform (read inside the rAF loop, never during render).
    const candlesMirrorRef = useRef<Candle[]>([]);
    const intervalMsRef = useRef(3_600_000);
    // Progressive-history request callback, refreshed every render and read
    // by the chart's visible-range handler (no re-subscription churn).
    const olderPageRequestRef = useRef<(() => void) | null>(null);
    const firstPushedTimeRef = useRef<number | null>(null);

    const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number; time: number } | null>(null);

    // ── live-follow state (Phase 6) ───────────────────────────────────────
    // When the user is at the live edge the chart follows new candles
    // (scrollToRealTime on every append). Any manual drag/zoom away from the
    // edge disengages following; the Go-to-Live chip re-engages it.
    const [followLive, setFollowLive] = useState(true);
    const [showGoLive, setShowGoLive] = useState(false);
    const [olderLoading, setOlderLoading] = useState(false);

    // Live feed shared with every chart in the app: history, tick merge into
    // the forming bar, and periodic reconciliation against the provider.
    const { candles: liveCandles, error: feedError, isLoading: feedLoading, connection: liveConnection, quality: liveQuality, hasMoreHistory, loadOlder } = useLiveCandles(
        symbol,
        timeframe,
        { limit: 400 }
    );        // `candles` must be declared before useOrderFlow below — referencing it
        // earlier threw "Cannot access 'candles' before initialization" and
        // crashed the signal detail pages.
    const candles = liveCandles;

    const onCandlesChangeRef = useRef(onCandlesChange);
    useEffect(() => {
        onCandlesChangeRef.current = onCandlesChange;
    }, [onCandlesChange]);

    // ── Order Flow & Market Microstructure Intelligence ────────────────
    // Derived from the SAME canonical candles the chart renders, memoized in
    // the hook (one recompute per data change, never per render). Only the
    // honestly-computable layers render; the capability model keeps the rest
    // explicitly unavailable.
    const orderFlow = useOrderFlow(symbol, timeframe, candles, { settings: orderFlowSettings, optionsChain });

    // Notify callers (overlay engines) with the current candle list. Kept in
    // an effect so the callback is not invoked during render.
    const candlesChangedRef = useRef(false);
    useEffect(() => {
        if (liveCandles.length === 0) return;
        if (candlesChangedRef.current) {
            onCandlesChangeRef.current?.(liveCandles);
        } else {
            candlesChangedRef.current = true;
            onCandlesChangeRef.current?.(liveCandles);
        }
    }, [liveCandles]);

    const requestKey = `${symbol}|${timeframe}`;
    const loading = feedLoading;

    // Canonical interval for the market→bar-index transform (chart timeframes
    // only; the terminal never renders D1/W1).
    const intervalMs = isChartTimeframe(timeframe) ? TIMEFRAME_MS[timeframe] : 3_600_000;
    useEffect(() => {
        intervalMsRef.current = intervalMs;
        candlesMirrorRef.current = candles;
    }, [intervalMs, candles]);
    useEffect(() => {
        return () => {
            anchoredOverlayRef.current?.destroy();
            anchoredOverlayRef.current = null;
        };
    }, []);

    // Stable market→bar-index transform handed to the overlay bridge.
    const timeToBarIndex = useCallback(
        (timeMs: number) => barIndexForTime(candlesMirrorRef.current, timeMs, intervalMsRef.current),
        [],
    );
    // Market-closed honesty (Phase 7): weekend silence is reported, never
    // papered over with fabricated candles. The badge above renders the
    // status; the engine simply produces no new candles when nothing trades.
    // Purity: session classification reads the LAST CANDLE's timestamp (a
    // render-stable value), never Date.now() during render.
    const cryptoSymbol = /BTC|ETH|SOL|XRP|ADA|DOGE|BNB|LTC|DOT/i.test(symbol);
    const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
    const marketOpen = lastCandle ? isMarketTradableAt(lastCandle.timestamp, { alwaysOpen: cryptoSymbol }) : true;
    const connection = marketOpen ? liveConnection : "reconnecting";
    const quality = marketOpen ? liveQuality : "market_closed";
    void requestKey;
    void token;
    void feedError;

    // Create chart once.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        lastBarCountRef.current = 0;
        lastKeyRef.current = "";
        lastPushedBarRef.current = null;
        lastPushedCandlesRef.current = [];

        const chart = createChart(container, {
            autoSize: true,
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: "#94a3b8",
                fontFamily: "var(--font-sans, Inter), sans-serif",
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: "rgba(148, 163, 184, 0.06)" },
                horzLines: { color: "rgba(148, 163, 184, 0.06)" },
            },
            rightPriceScale: {
                borderColor: "rgba(148, 163, 184, 0.2)",
                scaleMargins: { top: 0.12, bottom: 0.22 },
            },
            timeScale: {
                borderColor: "rgba(148, 163, 184, 0.2)",
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 6,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: "rgba(234, 123, 74, 0.4)", labelBackgroundColor: "#1e293b" },
                horzLine: { color: "rgba(234, 123, 74, 0.4)", labelBackgroundColor: "#1e293b" },
            },
        });
        chartRef.current = chart;

        candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: "#26a69a",
            downColor: "#ef5350",
            borderUpColor: "#26a69a",
            borderDownColor: "#ef5350",
            wickUpColor: "#26a69a",
            wickDownColor: "#ef5350",
            priceFormat: { type: "price", precision: symbolPrecision(symbol), minMove: 10 ** -symbolPrecision(symbol) },
        });

        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
            priceScaleId: "vol",
            priceFormat: { type: "volume" },
            color: "rgba(100, 116, 139, 0.5)",
        });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

        // Anchored overlay bridge: FVG/OB zones and the volume profile are
        // positioned through the chart's own time→x / price→y transforms
        // (single coordinate source — they cannot detach from the candles).
        if (candleSeriesRef.current) {
            const overlay = new ChartAnchoredOverlay();
            overlay.attach({
                chart,
                series: candleSeriesRef.current,
                paneIndex: 0,
                timeToBarIndex,
            });
            anchoredOverlayRef.current = overlay;
        }

        vwapSeriesRef.current = chart.addSeries(LineSeries, {
            color: "#f59e0b",
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        ema9Ref.current = chart.addSeries(LineSeries, {
            color: "#38bdf8",
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });
        ema20Ref.current = chart.addSeries(LineSeries, {
            color: "#a78bfa",
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });

        chart.subscribeCrosshairMove((param) => {
            const data = param.seriesData.get(candleSeriesRef.current as ISeriesApi<"Candlestick">);
            if (data && "close" in data) {
                const d = data as { open: number; high: number; low: number; close: number };
                setHover({ o: d.open, h: d.high, l: d.low, c: d.close, time: (param.time as number) * 1000 });
            } else {
                setHover(null);
            }
        });

        // ── live-follow interaction wiring (Phase 6/11) ────────────────────
        // Manual scroll/zoom away from the newest candle pauses following;
        // the visible Go-to-Live chip restores it. Panning back to the edge
        // re-engages automatically.
        const timeScale = chart.timeScale();
        const handleVisibleRange = () => {
            try {
                const range = timeScale.getVisibleLogicalRange();
                const bars = lastBarCountRef.current;
                if (range === null || bars <= 0) return;
                const atEdge = range.to >= bars - 1.5;
                setShowGoLive(!atEdge);
                setFollowLive(atEdge);
                // ── progressive historical loading (Phase 3) ────────────────
                // Reaching the left edge of the loaded window prepends the
                // next older page, so the user can scroll back through the
                // full provider history naturally (never hard-limited).
                if (range.from <= HISTORY_LOAD_THRESHOLD_BARS) {
                    olderPageRequestRef.current?.();
                }
            } catch {
                // range not available yet
            }
        };
        timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRange);

        return () => {
            anchoredOverlayRef.current?.destroy();
            anchoredOverlayRef.current = null;
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
            vwapSeriesRef.current = null;
            ema9Ref.current = null;
            ema20Ref.current = null;
            priceLinesRef.current = [];
            studySeriesRef.current = [];
            studyPaneRef.current = null;
            studyMarkersRef.current = null;
            signalMarkersRef.current = null;
            studyHlineLinesRef.current = [];
            chartLevelLinesRef.current = [];
            bbSeriesRef.current = null;
            kcSeriesRef.current = null;
            dcSeriesRef.current = null;
            stSeriesRef.current = null;
            haSeriesRef.current = null;
            rsiSeriesRef.current = null;
            macdSeriesRef.current = null;
            stPaneOwnedRef.current = null;
            rsiPaneOwnedRef.current = null;
            macdPaneOwnedRef.current = null;
            deltaPaneOwnedRef.current = null;
            deltaSeriesRef.current = null;
            gexLinesRef.current = [];
            signalMarkersRef.current = null;
            studyHlineLinesRef.current = [];
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Push candle + derived series data. Live quote ticks only move the
    // forming bar, so those updates are pushed incrementally with
    // `series.update()` — the last candle animates in place like a real
    // market chart. History rewrites (symbol/timeframe switch, provider
    // reconcile) fall back to a full `setData`.
    useEffect(() => {
        const cs = candleSeriesRef.current;
        const vs = volumeSeriesRef.current;
        const vw = vwapSeriesRef.current;
        const e9 = ema9Ref.current;
        const e20 = ema20Ref.current;
        if (!cs || !vs || !vw || !e9 || !e20) return;

        const toSec = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;

        if (candles.length === 0) {
            cs.setData([]);
            vs.setData([]);
            vw.setData([]);
            e9.setData([]);
            e20.setData([]);
            lastPushedBarRef.current = null;
            lastPushedCandlesRef.current = [];
            lastBarCountRef.current = 0;
            firstPushedTimeRef.current = null;
            return;
        }

        const seen = new Set<number>();
        const bars = candles
            .filter((c) => {
                const t = toSec(c.timestamp) as number;
                if (seen.has(t)) return false;
                seen.add(t);
                return true;
            })
            .map((c) => ({ time: toSec(c.timestamp), open: c.open, high: c.high, low: c.low, close: c.close }));

        const key = `${symbol}|${timeframe}`;
        const pushed = lastPushedBarRef.current;
        const last = bars[bars.length - 1];
        const prev = bars.length > 1 ? bars[bars.length - 2] : null;

        // Prepend detection: the same series grew at the FRONT (an older
        // history page arrived). lightweight-charts setData replaces all
        // bars, which would otherwise re-anchor the viewport — so the
        // logical range is captured and shifted by the prepend size to keep
        // the exact same candles on screen (no jump, no re-zoom).
        const prepended =
            key === lastKeyRef.current &&
            bars.length > lastBarCountRef.current &&
            firstPushedTimeRef.current !== null &&
            bars[0].time < firstPushedTimeRef.current &&
            lastPushedBarRef.current !== null &&
            bars[bars.length - 1].time >= lastPushedBarRef.current.time;
        let restoreRange: { from: number; to: number } | null = null;
        if (prepended) {
            try {
                const range = chartRef.current?.timeScale().getVisibleLogicalRange();
                if (range) {
                    const prependCount = bars.findIndex((bar) => bar.time >= firstPushedTimeRef.current!);
                    if (prependCount > 0) {
                        restoreRange = shiftLogicalRangeForPrepend(range, 0, prependCount);
                    }
                }
            } catch {
                restoreRange = null;
            }
        }

        // Tick-only path: same instrument/timeframe, history length stable or
        // grown by exactly one bar, and the visible change is confined to the
        // forming bar (same time as the last pushed bar) or a single forward
        // append right after it (bar close). Anything else — provider reconcile
        // that rewrote history, timeframe switch — takes the full redraw path.
        const previousCandles = lastPushedCandlesRef.current;
        const previousCount = lastBarCountRef.current;
        const previousStableCount = Math.min(previousCandles.length, candles.length) - 1;
        let stableHistoryPrefix = previousCount > 0 && previousCandles.length === previousCount && candles.length >= previousCount && !prepended;
        for (let i = 0; stableHistoryPrefix && i < previousStableCount; i++) {
            const a = previousCandles[i];
            const b = candles[i];
            if (a.timestamp !== b.timestamp || a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close || (a.volume ?? 0) !== (b.volume ?? 0)) {
                stableHistoryPrefix = false;
            }
        }
        const isTailOnly =
            key === lastKeyRef.current &&
            pushed !== null &&
            stableHistoryPrefix &&
            (bars.length === lastBarCountRef.current || bars.length === lastBarCountRef.current + 1) &&
            (last.time === pushed.time ||
                (prev !== null && prev.time === pushed.time && last.time > pushed.time));

        if (isTailOnly) {
            const tailBars = prev && prev.time === pushed!.time && last.time > pushed!.time ? [prev, last] : [last];
            const tailCandles = candles.slice(-tailBars.length);
            for (let i = 0; i < tailBars.length; i++) {
                const bar = tailBars[i];
                const c = tailCandles[i];
                cs.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
                vs.update({
                    time: bar.time,
                    value: c.volume ?? 0,
                    color: c.close >= c.open ? "rgba(38, 166, 154, 0.45)" : "rgba(239, 83, 80, 0.45)",
                });
            }
            // Lines: history is unchanged, so only the tail point(s) move.
            const closes = candles.map((c) => c.close);
            const vwapVals = computeVwap(candles).map((p) => p.value as number | null);
            const pushLineTail = (series: ISeriesApi<"Line">, vals: Array<number | null>) => {
                for (let i = 0; i < tailBars.length; i++) {
                    const idx = candles.length - tailBars.length + i;
                    const v = vals[idx];
                    if (v === null || v === undefined || !Number.isFinite(v)) continue;
                    series.update({ time: toSec(candles[idx].timestamp), value: v });
                }
            };
            pushLineTail(vw, vwapVals);
            pushLineTail(e9, ema(closes, 9));
            pushLineTail(e20, ema(closes, 20));
            lastPushedBarRef.current = { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close };
            lastPushedCandlesRef.current = candles.map((c) => ({ ...c }));
            lastBarCountRef.current = bars.length;
            return;
        }

        cs.setData(bars);
        if (restoreRange) {
            try {
                chartRef.current?.timeScale().setVisibleLogicalRange(restoreRange);
            } catch {
                // timescale not ready — the default view is acceptable
            }
        }
        vs.setData(
            bars.map((bar, i) => {
                const candle = candles[i];
                return {
                    time: bar.time,
                    value: candle.volume ?? 0,
                    color: candle.close >= candle.open ? "rgba(38, 166, 154, 0.45)" : "rgba(239, 83, 80, 0.45)",
                };
            })
        );
        vw.setData(computeVwap(candles));

        const closes = candles.map((c) => c.close);
        const pushEma = (series: ISeriesApi<"Line">, period: number) => {
            const vals = ema(closes, period);
            const data: Array<{ time: UTCTimestamp; value: number }> = [];
            candles.forEach((c, i) => {
                const v = vals[i];
                if (v !== null) data.push({ time: toSec(c.timestamp), value: v });
            });
            series.setData(data);
        };
        pushEma(e9, 9);
        pushEma(e20, 20);

        // Only auto-fit when the dataset itself changed (symbol/timeframe
        // switch or a reconcile that added closed bars). Live tick updates to
        // the forming bar keep the current viewport so the last candle moves
        // in place instead of the chart re-zooming every 2 seconds. Prepends
        // keep the user's scroll position (restoreRange above).
        const barCountChanged = bars.length !== lastBarCountRef.current;
        const appended = barCountChanged && bars.length > lastBarCountRef.current && key === lastKeyRef.current && !prepended && stableHistoryPrefix;
        if (key !== lastKeyRef.current || (barCountChanged && !appended && !prepended)) {
            chartRef.current?.timeScale().fitContent();
            lastKeyRef.current = key;
        }
        // Live follow (Phase 6): when the user is at the live edge, keep the
        // newest candle glued to the right margin as new candles append. When
        // they scrolled away, the viewport is theirs — never yanked back.
        if (appended && followLive) {
            try {
                chartRef.current?.timeScale().scrollToRealTime();
            } catch {
                // timescale not ready
            }
        }
        lastBarCountRef.current = bars.length;
        firstPushedTimeRef.current = bars[0].time;
        lastPushedBarRef.current = { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close };
        lastPushedCandlesRef.current = candles.map((c) => ({ ...c }));
    }, [candles, symbol, timeframe, followLive]);

    // ── Pine study overlays ─────────────────────────────────────────────
    // Recreate the study series whenever the applied script (or its pane
    // layout) changes, then feed it the plot values from the same candles.
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;

        for (const s of studySeriesRef.current) {
            try {
                chart.removeSeries(s);
            } catch {
                // series already gone with the chart
            }
        }
        studySeriesRef.current = [];
        if (studyPaneRef.current !== null) {
            try {
                chart.removePane(studyPaneRef.current);
            } catch {
                // pane already gone with the chart
            }
            studyPaneRef.current = null;
        }

        if (!studyOverlay || studyOverlay.lines.length === 0) return;

        const mainIndex = 0;
        let paneIndex = mainIndex;
        if (!studyOverlay.overlay) {
            try {
                // addPane appends to the end, so the new pane's index equals
                // the pane count before it was added.
                paneIndex = chart.panes().length;
                chart.addPane();
            } catch {
                paneIndex = mainIndex; // fall back to the main pane rather than not drawing
            }
            studyPaneRef.current = paneIndex;
        }
        try {
            chart.panes()[mainIndex]?.setStretchFactor(1);
            if (paneIndex !== mainIndex) chart.panes()[paneIndex]?.setStretchFactor(PINE_PANE_STRETCH);
        } catch {
            // stretch factors are a nicety; the default split is still usable
        }

        studySeriesRef.current = studyOverlay.lines.map((line) =>
            chart.addSeries(
                LineSeries,
                {
                    color: line.color,
                    lineWidth: line.lineWidth as 1 | 2 | 3 | 4,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                },
                paneIndex
            )
        );
    }, [studyOverlay]);

    // Feed the study plot values (aligned 1:1 with the candle array).
    useEffect(() => {
        if (!studyOverlay || studySeriesRef.current.length === 0) return;
        studyOverlay.lines.forEach((line, i) => {
            const series = studySeriesRef.current[i];
            if (!series) return;
            const data: LineData<UTCTimestamp>[] = [];
            candles.forEach((c, idx) => {
                const v = line.values[idx];
                if (v !== null && v !== undefined && Number.isFinite(v)) {
                    data.push({ time: Math.floor(c.timestamp / 1000) as UTCTimestamp, value: v });
                }
            });
            series.setData(data);
        });
    }, [candles, studyOverlay]);

    // Plotshape markers from the applied script, drawn on the candle series.
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        if (!studyOverlay || studyOverlay.shapes.length === 0) {
            studyMarkersRef.current?.setMarkers([]);
            return;
        }
        const markers: SeriesMarker<Time>[] = studyOverlay.shapes
            .filter((s) => s.index >= 0 && s.index < candles.length)
            .map((s) => ({
                time: Math.floor(candles[s.index].timestamp / 1000) as UTCTimestamp,
                position: s.bullish ? ("belowBar" as const) : ("aboveBar" as const),
                shape: s.bullish ? ("arrowUp" as const) : ("arrowDown" as const),
                color: s.color,
                size: 1,
                ...(s.text ? { text: s.text } : {}),
            }))
            .sort((a, b) => (a.time as number) - (b.time as number));                if (studyMarkersRef.current) {
            studyMarkersRef.current.setMarkers(markers);
        } else {
            studyMarkersRef.current = createSeriesMarkers(cs, markers);
        }
    }, [candles, studyOverlay]);

    // ── Smart Money structure overlay (Phase 15) ─────────────────────────
    // BOS / CHoCH markers from the canonical deterministic structure engine
    // (lib/analytics/market-structure.ts) via the chart-engine overlay
    // contract. The chart only draws; the engine owns the evidence rules.
    const structureMarkers = useMemo(() => {
        if (!layers.bosChoch || candles.length === 0) return [];
        const layer = structureOverlayLayer(true);
        const structCandles = candles.map((c) => ({
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? 0,
            symbol: String(symbol).toUpperCase(),
            timeframe: timeframe as import("@/lib/chart-engine/timeframe").ChartTimeframe,
            finalized: true,
        }));
        return layer.getEventMarkers?.(structCandles) ?? [];
    }, [layers.bosChoch, candles, symbol, timeframe]);

    const structureMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        if (!structureMarkers || structureMarkers.length === 0) {
            structureMarkersRef.current?.setMarkers([]);
            return;
        }
        const timeIndex = new Map<number, number>();
        candles.forEach((c, i) => timeIndex.set(Math.floor(c.timestamp / 1000), i));
        const markers: SeriesMarker<Time>[] = structureMarkers
            .map((m) => ({ marker: m, time: Math.floor(m.time / 1000) }))
            .filter(({ time }) => timeIndex.has(time))
            .map(({ marker, time }) => ({
                time: time as UTCTimestamp,
                position: (marker.position === "belowBar" ? "belowBar" : "aboveBar") as SeriesMarker<Time>["position"],
                shape: (marker.text === "BOS" && marker.color === "#fb7185") || (marker.text === "CHOCH" && marker.color === "#f97316") ? ("arrowDown" as const) : ("arrowUp" as const),
                color: marker.color,
                size: 1,
                text: marker.text,
            }) as SeriesMarker<Time>)
            .sort((a, b) => (a.time as number) - (b.time as number));
        if (structureMarkersRef.current) {
            structureMarkersRef.current.setMarkers(markers);
        } else {
            structureMarkersRef.current = createSeriesMarkers(cs, markers);
        }
    }, [structureMarkers, candles]);

    // Live deterministic signals: entry / stop / target markers on the active symbol.
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        if (!signals || signals.length === 0) {
            signalMarkersRef.current?.setMarkers([]);
            return;
        }
        const lastTime = candles.length > 0 ? (Math.floor(candles[candles.length - 1].timestamp / 1000) as UTCTimestamp) : null;
        if (lastTime === null) {
            signalMarkersRef.current?.setMarkers([]);
            return;
        }
        const markers: SeriesMarker<Time>[] = [];
        for (const sig of signals) {
            if (sig.symbol !== symbol) continue;
            const long = sig.direction === "long";
            const entry: SeriesMarker<Time> = {
                time: lastTime,
                position: long ? "belowBar" : "aboveBar",
                shape: long ? "arrowUp" : "arrowDown",
                color: long ? "#34d399" : "#fb7185",
                size: 2,
                text: `${long ? "BUY" : "SELL"} ${fmtPrice(sig.entry, symbol)}`,
            };
            const level = (price: number, label: string, color: string): SeriesMarker<Time> => ({
                time: lastTime,
                position: "atPriceBottom",
                shape: "circle",
                color,
                size: 1,
                price,
                text: label,
            });
            markers.push(entry);
            markers.push(level(sig.stop, `SL ${fmtPrice(sig.stop, symbol)}`, "#ef4444"));
            markers.push(level(sig.target, `TP ${fmtPrice(sig.target, symbol)}`, "#22c55e"));
        }
        if (signalMarkersRef.current) {
            signalMarkersRef.current.setMarkers(markers);
        } else {
            signalMarkersRef.current = createSeriesMarkers(cs, markers);
        }
    }, [signals, candles, symbol]);

    // Pine hlines from the applied script — dashed price lines like TradingView's hline().
    // Tracked separately from the static layers so both effects can clear
    // their own lines without deleting each other's.
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        for (const l of studyHlineLinesRef.current) {
            try {
                cs.removePriceLine(l);
            } catch {
                // line already gone with the series
            }
        }
        studyHlineLinesRef.current = [];
        if (!studyOverlay || studyOverlay.levels.length === 0) return;
        for (const level of studyOverlay.levels) {
            studyHlineLinesRef.current.push(
                cs.createPriceLine({
                    price: level.value,
                    color: level.color,
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: false,
                    title: level.title,
                })
            );
        }
    }, [candles, studyOverlay]);

    // Signal chart-confluence levels — the exact session/pivot/EQH/EQL lines
    // the generating engine scored. Dotted so they read as reference levels,
    // distinct from the user's own drawings.
    const chartLevelsKey = chartLevels ? chartLevels.map((l) => `${l.kind}:${l.price}`).join("|") : "";
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        for (const l of chartLevelLinesRef.current) {
            try {
                cs.removePriceLine(l);
            } catch {
                // line already gone with the series
            }
        }
        chartLevelLinesRef.current = [];
        if (!chartLevels || chartLevels.length === 0) return;
        const palette: Record<string, string> = {
            session_high: "#22d3ee",
            session_low: "#22d3ee",
            pivot: "#eab308",
            pivot_r1: "#fb7185",
            pivot_r2: "#fb7185",
            pivot_s1: "#34d399",
            pivot_s2: "#34d399",
            prev_day_high: "#94a3b8",
            prev_day_low: "#94a3b8",
            eqh: "#f97316",
            eql: "#34d399",
        };
        for (const level of chartLevels) {
            if (!Number.isFinite(level.price) || level.price <= 0) continue;
            chartLevelLinesRef.current.push(
                cs.createPriceLine({
                    price: level.price,
                    color: palette[level.kind] ?? "#94a3b8",
                    lineWidth: 1,
                    lineStyle: LineStyle.Dotted,
                    axisLabelVisible: false,
                    title: level.label,
                })
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chartLevelsKey]);

    // Static price-line overlays (session, prev day, S/R, equal H/L, liquidity).
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;

        // Clear old lines.
        for (const l of priceLinesRef.current) {
            try {
                cs.removePriceLine(l);
            } catch {
                // line already gone with the series
            }
        }
        priceLinesRef.current = [];

        if (candles.length === 0) return;

        const lines: Array<{ price: number; label: string; color: string }> = [];
        if (layers.sessionLevels) lines.push(...computeSessionLevels(candles));
        if (layers.prevDayHighLow) lines.push(...computePrevDay(candles));
        if (layers.dailyPivots) lines.push(...computeDailyPivotLines(candles));
        if (layers.supportResistance) {
            for (const l of computeSrLevels(candles)) {
                lines.push({
                    price: l.price,
                    label: `${l.kind === "support" ? "S" : "R"} ×${l.touches}`,
                    color: l.kind === "support" ? "#34d399" : "#fb7185",
                });
            }
        }
        if (layers.equalHighsLows) {
            for (const l of computeEqualLevels(candles)) {
                lines.push({
                    price: l.price,
                    label: l.kind === "eqh" ? `EQH ×${l.count}` : `EQL ×${l.count}`,
                    color: "#c084fc",
                    ...(l.kind === "eqh" ? {} : {}),
                });
            }
        }
        if (layers.liquidityLevels && analysis?.structure.liquidityLevels.value) {
            const lastPrice = candles[candles.length - 1].close;
            const sorted = [...analysis.structure.liquidityLevels.value].sort(
                (a, b) => Math.abs(a.price - lastPrice) - Math.abs(b.price - lastPrice)
            );
            for (const l of sorted.slice(0, 6)) {
                lines.push({
                    price: l.price,
                    label: l.type.replace(/_/g, " "),
                    color: l.price > lastPrice ? "#f472b6" : "#60a5fa",
                });
            }
        }

        priceLinesRef.current = lines.map((l) =>
            cs.createPriceLine({
                price: l.price,
                color: l.color,
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: l.label,
            })
        );
    }, [candles, layers, analysis]);

    // Zone rectangles (FVG / order blocks) as MARKET coordinates: the zone's
    // own price band and candle-time span. The anchored overlay bridge maps
    // (time, price) → screen px through the chart's coordinate transforms on
    // viewport/data/resize changes — zones can never drift from their candles.
    const zoneItems = useMemo<AnchoredItem[]>(() => {
        if (candles.length === 0) return [];
        const lastTime = candles[candles.length - 1].timestamp;
        // Unmitigated zones extend to just past the newest candle (right margin).
        const rightEdge = lastTime + 3 * intervalMs;
        const items: AnchoredItem[] = [];
        if (layers.fvg) {
            for (const z of computeFvgs(candles)) {
                items.push({
                    id: `fvg_${z.startIdx}_${z.top}`,
                    kind: "zone",
                    fromTime: candles[z.startIdx]?.timestamp ?? lastTime,
                    toTime: rightEdge,
                    top: z.top,
                    bottom: z.bottom,
                    style: {
                        background: z.bullish ? "rgba(52, 211, 153, 0.10)" : "rgba(251, 113, 133, 0.10)",
                        borderTop: `1px dashed ${z.bullish ? "rgba(52, 211, 153, 0.5)" : "rgba(251, 113, 133, 0.5)"}`,
                        borderBottom: `1px dashed ${z.bullish ? "rgba(52, 211, 153, 0.5)" : "rgba(251, 113, 133, 0.5)"}`,
                        label: `FVG ${fmtPrice(z.bottom, symbol)}–${fmtPrice(z.top, symbol)}`,
                        labelColor: z.bullish ? "rgba(52, 211, 153, 0.85)" : "rgba(251, 113, 133, 0.85)",
                    },
                });
            }
        }
        if (layers.orderBlocks) {
            for (const z of computeOrderBlocks(candles)) {
                items.push({
                    id: `ob_${z.startIdx}_${z.top}`,
                    kind: "zone",
                    fromTime: candles[z.startIdx]?.timestamp ?? lastTime,
                    toTime: rightEdge,
                    top: z.top,
                    bottom: z.bottom,
                    style: {
                        background: z.bullish ? "rgba(56, 189, 248, 0.10)" : "rgba(251, 146, 60, 0.10)",
                        borderLeft: `2px solid ${z.bullish ? "rgba(56, 189, 248, 0.6)" : "rgba(251, 146, 60, 0.6)"}`,
                        label: `OB`,
                        labelColor: z.bullish ? "rgba(56, 189, 248, 0.9)" : "rgba(251, 146, 60, 0.9)",
                    },
                });
            }
        }
        return items;
    }, [candles, layers.fvg, layers.orderBlocks, intervalMs, symbol]);

    // ── Volume Profile side histogram (right-aligned horizontal bars) ────
    // Market coordinates only (price range + volume fraction); the anchored
    // overlay bridge converts them to screen pixels through the chart's own
    // price scale on every frame, so the profile stays aligned with candles
    // through pan, zoom, autoscale and resize.
    const volumeProfileItems = useMemo<AnchoredItem[]>(() => {
        if (!layers.volumeProfile || !orderFlow.sessionProfile) return [];
        const p = orderFlow.sessionProfile;
        const maxVol = Math.max(...p.volumeByPrice.map((b) => b.volume), 1);
        // Downsample to at most 60 bars for rendering performance.
        const step = Math.max(1, Math.ceil(p.volumeByPrice.length / 60));
        const out: AnchoredItem[] = [];
        for (let i = 0; i < p.volumeByPrice.length; i += step) {
            const b = p.volumeByPrice[i];
            out.push({
                id: `vp_${b.price}`,
                kind: "hbar",
                low: b.low,
                high: b.high,
                widthFrac: b.volume / maxVol,
                style: {
                    background: b.price === p.poc
                        ? "rgba(245, 158, 11, 0.55)"
                        : p.hvn.includes(b.price)
                            ? "rgba(56, 189, 248, 0.30)"
                            : p.lvn.includes(b.price)
                                ? "rgba(148, 163, 184, 0.12)"
                                : "rgba(100, 116, 139, 0.22)",
                    ...(b.price === p.poc ? { borderRight: "2px solid #f59e0b" } : {}),
                },
            });
        }
        return out;
    }, [layers.volumeProfile, orderFlow.sessionProfile]);

    // Push the anchored item set into the coordinate bridge (data changes
    // only touch market coordinates; pixel geometry re-syncs on viewport/resize changes).
    useEffect(() => {
        const overlay = anchoredOverlayRef.current;
        if (!overlay) return;
        overlay.setItems([...zoneItems, ...volumeProfileItems]);
    }, [zoneItems, volumeProfileItems]);

    // ── Math-indicator layers ────────────────────────────────────────
    // Every layer is computed with the same deterministic TA the Pine
    // runtime exposes (lib/pine-runtime/builtins.ts), so a plotted layer
    // matches what a Pine script over the same candles would produce.
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;

        const removeIf = (ref: RefObject<Record<string, ISeriesApi<"Line"> | ISeriesApi<"Candlestick">> | null>) => {
            const group = ref.current;
            if (!group) return;
            for (const key of Object.keys(group)) {
                const s = group[key];
                if (s && typeof s === "object" && "applyOptions" in s) {
                    try {
                        chart.removeSeries(s);
                    } catch {
                        // already gone with the chart
                    }
                }
            }
            ref.current = null;
        };

        // ── Bollinger bands (SMA ± 2σ, 20) ──
        if (!layers.bollingerBands) {
            removeIf(bbSeriesRef as RefObject<Record<string, ISeriesApi<"Line"> | ISeriesApi<"Candlestick">> | null>);
        } else if (!bbSeriesRef.current) {
            const basis = addHiddenLine(chart, 0, "#94a3b8");
            const upper = addHiddenLine(chart, 0, "#60a5fa");
            const lower = addHiddenLine(chart, 0, "#60a5fa");
            bbSeriesRef.current = { basis, upper, lower };
        }

        // ── Keltner channels (EMA ± ATR, 20/2) ──
        if (!layers.keltnerChannels) {
            removeIf(kcSeriesRef as RefObject<Record<string, ISeriesApi<"Line"> | ISeriesApi<"Candlestick">> | null>);
        } else if (!kcSeriesRef.current) {
            const mid = addHiddenLine(chart, 0, "#f97316");
            const upper = addHiddenLine(chart, 0, "rgba(249, 115, 22, 0.55)");
            const lower = addHiddenLine(chart, 0, "rgba(249, 115, 22, 0.55)");
            kcSeriesRef.current = { mid, upper, lower };
        }

        // ── Donchian channels (20-bar high/low envelope) ──
        if (!layers.donchianChannels) {
            removeIf(dcSeriesRef as RefObject<Record<string, ISeriesApi<"Line"> | ISeriesApi<"Candlestick">> | null>);
        } else if (!dcSeriesRef.current) {
            const upper = addHiddenLine(chart, 0, "#22d3ee");
            const lower = addHiddenLine(chart, 0, "#22d3ee");
            const mid = addHiddenLine(chart, 0, "rgba(34, 211, 238, 0.5)");
            dcSeriesRef.current = { upper, lower, mid };
        }

        // ── Supertrend (ATR trailing stop line, own pane) ──
        if (!layers.supertrend) {
            if (stSeriesRef.current) {
                try {
                    chart.removeSeries(stSeriesRef.current.line);
                } catch {
                    // already gone
                }
                stSeriesRef.current = null;
            }
            if (stSeriesRef.current === null && stPaneOwnedRef.current !== null) {
                try {
                    chart.removePane(stPaneOwnedRef.current);
                } catch {
                    // pane may hold other series
                }
                stPaneOwnedRef.current = null;
            }
        } else if (!stSeriesRef.current) {
            const [, stDir] = TA.supertrend(
                candles.map((c) => c.high),
                candles.map((c) => c.low),
                candles.map((c) => c.close),
                10,
                3
            );
            void stDir;
            let paneIndex = 0;
            try {
                paneIndex = chart.panes().length;
                chart.addPane();
                stPaneOwnedRef.current = paneIndex;
                chart.panes()[paneIndex]?.setStretchFactor(0.25);
            } catch {
                paneIndex = 0;
                stPaneOwnedRef.current = null;
            }
            const line = addHiddenLine(chart, paneIndex, "#f472b6", 2);
            stSeriesRef.current = { line, pane: paneIndex };
        }

        // ── Heikin-Ashi candles (main pane) ──
        if (!layers.heikinAshi) {
            if (haSeriesRef.current) {
                try {
                    chart.removeSeries(haSeriesRef.current);
                } catch {
                    // already gone
                }
                haSeriesRef.current = null;
            }
        } else if (!haSeriesRef.current) {
            haSeriesRef.current = chart.addSeries(CandlestickSeries, {
                upColor: "#26a69a",
                downColor: "#ef5350",
                borderUpColor: "#26a69a",
                borderDownColor: "#ef5350",
                wickUpColor: "#26a69a",
                wickDownColor: "#ef5350",
                priceLineVisible: false,
                lastValueVisible: false,
                priceFormat: { type: "price", precision: symbolPrecision(symbol), minMove: 10 ** -symbolPrecision(symbol) },
            });
        }

        // ── RSI pane (14, 30/70 guides) ──
        if (!layers.rsiPane) {
            if (rsiSeriesRef.current) {
                try {
                    chart.removeSeries(rsiSeriesRef.current.rsi);
                } catch {
                    // already gone
                }
                for (const l of rsiSeriesRef.current.lines) {
                    try {
                        rsiSeriesRef.current.rsi.removePriceLine(l);
                    } catch {
                        // already gone
                    }
                }
                rsiSeriesRef.current = null;
            }
            if (rsiSeriesRef.current === null && rsiPaneOwnedRef.current !== null) {
                try {
                    chart.removePane(rsiPaneOwnedRef.current);
                } catch {
                    // pane may hold other series
                }
                rsiPaneOwnedRef.current = null;
            }
        } else if (!rsiSeriesRef.current) {
            let paneIndex = 0;
            try {
                paneIndex = chart.panes().length;
                chart.addPane();
                rsiPaneOwnedRef.current = paneIndex;
                chart.panes()[paneIndex]?.setStretchFactor(0.3);
            } catch {
                paneIndex = 0;
                rsiPaneOwnedRef.current = null;
            }
            const rsi = addHiddenLine(chart, paneIndex, "#c084fc");
            // 30/70 guides are part of the layer itself — created once with
            // the series, never recreated per tick.
            const guides = [30, 70].map((v) =>
                rsi.createPriceLine({
                    price: v,
                    color: "rgba(148, 163, 184, 0.6)",
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: false,
                    title: `RSI ${v}`,
                })
            );
            rsiSeriesRef.current = { rsi, pane: paneIndex, lines: guides };
        }

        // ── Estimated delta pane (histogram + cumulative line) ──
        if (!layers.delta && !layers.cumulativeDelta) {
            if (deltaSeriesRef.current) {
                try {
                    chart.removeSeries(deltaSeriesRef.current.hist);
                    chart.removeSeries(deltaSeriesRef.current.line);
                } catch {
                    // already gone
                }
                deltaSeriesRef.current = null;
            }
            if (deltaSeriesRef.current === null && deltaPaneOwnedRef.current !== null) {
                try {
                    chart.removePane(deltaPaneOwnedRef.current);
                } catch {
                    // pane may hold other series
                }
                deltaPaneOwnedRef.current = null;
            }
        } else if (!deltaSeriesRef.current) {
            let paneIndex = 0;
            try {
                paneIndex = chart.panes().length;
                chart.addPane();
                deltaPaneOwnedRef.current = paneIndex;
            } catch {
                paneIndex = 0;
                deltaPaneOwnedRef.current = null;
            }
            chart.panes()[paneIndex]?.setStretchFactor(0.25);
            const hist = chart.addSeries(
                HistogramSeries,
                {
                    priceFormat: { type: "volume" },
                    priceLineVisible: false,
                    lastValueVisible: false,
                },
                paneIndex
            );
            const line = chart.addSeries(
                LineSeries,
                {
                    color: "#eab308",
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                },
                paneIndex
            );
            deltaSeriesRef.current = { hist, line };
        }

        // ── MACD pane (12/26/9 histogram-less lines + zero guide) ──
        if (!layers.macdPane) {
            if (macdSeriesRef.current) {
                try {
                    chart.removeSeries(macdSeriesRef.current.macd);
                    chart.removeSeries(macdSeriesRef.current.signal);
                } catch {
                    // already gone
                }
                macdSeriesRef.current = null;
            }
            if (macdSeriesRef.current === null && macdPaneOwnedRef.current !== null) {
                try {
                    chart.removePane(macdPaneOwnedRef.current);
                } catch {
                    // pane may hold other series
                }
                macdPaneOwnedRef.current = null;
            }
        } else if (!macdSeriesRef.current) {
            let paneIndex = 0;
            try {
                paneIndex = chart.panes().length;
                chart.addPane();
                macdPaneOwnedRef.current = paneIndex;
            } catch {
                paneIndex = 0;
                macdPaneOwnedRef.current = null;
            }
            chart.panes()[paneIndex]?.setStretchFactor(0.3);
            const macd = addHiddenLine(chart, paneIndex, "#38bdf8");
            const signal = addHiddenLine(chart, paneIndex, "#f59e0b");
            macdSeriesRef.current = { macd, signal, pane: paneIndex };
        }
    }, [layers.bollingerBands, layers.keltnerChannels, layers.donchianChannels, layers.supertrend, layers.heikinAshi, layers.rsiPane, layers.macdPane, layers.delta, layers.cumulativeDelta, symbol]);

    // Data feed for the indicator layers — recomputed only when candles change.
    useEffect(() => {
        if (candles.length === 0) return;
        const closes = candles.map((c) => c.close);
        const highs = candles.map((c) => c.high);
        const lows = candles.map((c) => c.low);

        if (bbSeriesRef.current) {
            const [basis, upper, lower] = TA.bb(closes, 20, 2);
            feedSeries(bbSeriesRef.current.basis, candles, basis);
            feedSeries(bbSeriesRef.current.upper, candles, upper);
            feedSeries(bbSeriesRef.current.lower, candles, lower);
        }
        if (kcSeriesRef.current) {
            const [mid, upper, lower] = TA.keltner(highs, lows, closes, 20, 2);
            feedSeries(kcSeriesRef.current.mid, candles, mid);
            feedSeries(kcSeriesRef.current.upper, candles, upper);
            feedSeries(kcSeriesRef.current.lower, candles, lower);
        }
        if (dcSeriesRef.current) {
            const [upper, lower, mid] = TA.donchian(highs, lows, 20);
            feedSeries(dcSeriesRef.current.upper, candles, upper);
            feedSeries(dcSeriesRef.current.lower, candles, lower);
            feedSeries(dcSeriesRef.current.mid, candles, mid);
        }
        if (stSeriesRef.current) {
            const [line] = TA.supertrend(highs, lows, closes, 10, 3);
            feedSeries(stSeriesRef.current.line, candles, line);
        }
        if (haSeriesRef.current) {
            const [ho, hh, hl, hc] = TA.heikinashi(
                candles.map((c) => c.open),
                highs,
                lows,
                closes
            );
            haSeriesRef.current.setData(
                candles
                    .map((c, i) => ({
                        time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
                        open: ho[i],
                        high: hh[i],
                        low: hl[i],
                        close: hc[i],
                    }))
                    .filter((d) => Number.isFinite(d.open) && Number.isFinite(d.close))
            );
        }
        if (rsiSeriesRef.current) {
            const rsiVals = TA.rsi(closes, 14);
            feedSeries(rsiSeriesRef.current.rsi, candles, rsiVals);
        }
        if (macdSeriesRef.current) {
            const [macdLine, signalLine] = TA.macd(closes, 12, 26, 9);
            feedSeries(macdSeriesRef.current.macd, candles, macdLine);
            feedSeries(macdSeriesRef.current.signal, candles, signalLine);
        }
        // Estimated delta pane: per-bar directional volume histogram +
        // cumulative line. Buckets are the candles themselves, so values
        // align 1:1 with the displayed bars. When a true trade-grade delta
        // ever becomes available the context switches and this proxy stays
        // labelled ESTIMATED.
        if (deltaSeriesRef.current && orderFlow.estimatedDelta) {
            const ed = orderFlow.estimatedDelta;
            const histData: Array<{ time: UTCTimestamp; value: number; color: string }> = [];
            const lineData: Array<{ time: UTCTimestamp; value: number }> = [];
            let cum = 0;
            for (const b of ed.buckets) {
                const t = Math.floor(b.timestamp / 1000) as UTCTimestamp;
                if (layers.delta && Number.isFinite(b.delta) && b.delta !== 0) {
                    histData.push({
                        time: t,
                        value: b.delta,
                        color: b.delta > 0 ? "rgba(52, 211, 153, 0.55)" : "rgba(251, 113, 133, 0.55)",
                    });
                }
                if (layers.cumulativeDelta) {
                    cum += b.delta;
                    if (Number.isFinite(cum)) lineData.push({ time: t, value: cum });
                }
            }
            deltaSeriesRef.current.hist.setData(histData);
            deltaSeriesRef.current.line.setData(lineData);
        } else if (deltaSeriesRef.current) {
            deltaSeriesRef.current.hist.setData([]);
            deltaSeriesRef.current.line.setData([]);
        }
    }, [candles, layers.delta, layers.cumulativeDelta, orderFlow.estimatedDelta]);

    // ── Order Flow overlays (volume profile + behavioural events) ────────
    // POC/VAH/VAL render as price lines on the candle series; the horizontal
    // profile histogram and event markers render as positioned overlays.
    // Recreated only when the computed profile actually changes (memoized by
    // the hook), so live ticks never thrash the price-line list.
    const ofProfileKey = orderFlow.sessionProfile
        ? `${orderFlow.sessionProfile.profileId}|${orderFlow.sessionProfile.poc}|${orderFlow.sessionProfile.vah}|${orderFlow.sessionProfile.val}|${orderFlow.sessionProfile.barCount}`
        : "";
    const ofEventsKey = `${orderFlow.absorptionEvents.length}|${orderFlow.exhaustionEvents.length}|${orderFlow.computedFrom}`;

    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        for (const l of orderFlowLinesRef.current) {
            try {
                cs.removePriceLine(l);
            } catch {
                // line already gone with the series
            }
        }
        orderFlowLinesRef.current = [];
        if (!orderFlow.sessionProfile) return;
        const p = orderFlow.sessionProfile;
        const showPoc = layers.poc && p.poc !== null;
        const showVa = layers.valueArea && p.vah !== null && p.val !== null;
        if (showPoc) {
            orderFlowLinesRef.current.push(cs.createPriceLine({
                price: p.poc as number,
                color: "#f59e0b",
                lineWidth: 2,
                lineStyle: LineStyle.Solid,
                axisLabelVisible: true,
                title: "POC",
            }));
        }
        if (showVa) {
            for (const [price, label] of [[p.vah as number, "VAH"], [p.val as number, "VAL"]] as const) {
                orderFlowLinesRef.current.push(cs.createPriceLine({
                    price,
                    color: "rgba(167, 139, 250, 0.8)",
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: label,
                }));
            }
        }
    }, [ofProfileKey, layers.poc, layers.valueArea, orderFlow.sessionProfile]);

    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        if (orderFlowMarkersRef.current) {
            orderFlowMarkersRef.current.setMarkers([]);
            orderFlowMarkersRef.current = null;
        }
        if (!layers.absorption && !layers.exhaustion) return;
        const timeIndex = new Map<number, number>();
        candles.forEach((c, i) => timeIndex.set(Math.floor(c.timestamp / 1000), i));
        const markers: SeriesMarker<Time>[] = [];
        if (layers.absorption) {
            for (const e of orderFlow.absorptionEvents) {
                const t = Math.floor(e.timestamp / 1000);
                if (!timeIndex.has(t)) continue;
                markers.push({
                    time: t as UTCTimestamp,
                    position: "aboveBar",
                    shape: "circle",
                    color: "#22d3ee",
                    size: 1,
                    text: e.type === "BUY_ABSORPTION" ? "ABSB" : "ABSS",
                });
            }
        }
        if (layers.exhaustion) {
            for (const e of orderFlow.exhaustionEvents) {
                const t = Math.floor(e.timestamp / 1000);
                if (!timeIndex.has(t)) continue;
                markers.push({
                    time: t as UTCTimestamp,
                    position: e.type === "BUY_EXHAUSTION" ? "aboveBar" : "belowBar",
                    shape: e.type === "BUY_EXHAUSTION" ? "arrowDown" : "arrowUp",
                    color: "#f472b6",
                    size: 1,
                    text: "EXH",
                });
            }
        }
        markers.sort((a, b) => (a.time as number) - (b.time as number));
        if (markers.length > 0) {
            orderFlowMarkersRef.current = createSeriesMarkers(cs, markers);
        }
    }, [ofEventsKey, layers.absorption, layers.exhaustion, candles, orderFlow.absorptionEvents, orderFlow.exhaustionEvents]);

    // ── GEX gamma levels (real options chain — Deribit / CBOE) ─────────
    // Call walls (resistance), put walls (support) and the gamma flip render
    // as price lines on the candle series. Sourced from the same GexResult
    // the context carries; empty when no chain is available for the symbol.
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        for (const l of gexLinesRef.current) {
            try {
                cs.removePriceLine(l);
            } catch {
                // line already gone with the series
            }
        }
        gexLinesRef.current = [];
        if (!layers.gex) return;
        const levels: GexLevel[] = gexLevels(orderFlow.gex, {
            showWalls: orderFlow.settings.gexShowWalls,
            showGammaFlip: orderFlow.settings.gexShowGammaFlip,
        });
        for (const level of levels) {
            gexLinesRef.current.push(
                cs.createPriceLine({
                    price: level.price,
                    color: level.kind === "call_wall" ? "#fb7185" : level.kind === "put_wall" ? "#34d399" : "#eab308",
                    lineWidth: 2,
                    lineStyle: level.kind === "gamma_flip" ? LineStyle.Dotted : LineStyle.Solid,
                    axisLabelVisible: true,
                    title: level.label,
                })
            );
        }
    }, [layers.gex, orderFlow.gex, orderFlow.settings.gexShowWalls, orderFlow.settings.gexShowGammaFlip]);

    // ── historical scrolling (Phase 3) ────────────────────────────────────
    // The chart's visible-range handler calls this when the user pans within
    // HISTORY_LOAD_THRESHOLD_BARS of the loaded window's left edge. The
    // engine dedupes in-flight requests; the prepended page is viewport-
    // compensated in the data-push effect so candles do not shift on screen.
    useEffect(() => {
        olderPageRequestRef.current = () => {
            if (!hasMoreHistory || olderLoading) return;
            setOlderLoading(true);
            void loadOlder().finally(() => setOlderLoading(false));
        };
        return () => {
            olderPageRequestRef.current = null;
        };
    }, [hasMoreHistory, olderLoading, loadOlder]);

    // Go to Live: jump to the newest candle and re-enable following.
    const handleGoLive = useCallback(() => {
        setFollowLive(true);
        setShowGoLive(false);
        try {
            chartRef.current?.timeScale().scrollToRealTime();
        } catch {
            // chart not ready
        }
    }, []);

    return (
        <div className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-card" data-chart-container>
            {/* HUD */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[11px]">
                <span className="font-mono font-semibold text-foreground">{symbol}</span>
                <span className="rounded border border-primary/30 bg-primary/10 px-1 py-0.5 font-mono text-[10px] font-bold text-primary">
                    {timeframe}
                </span>
                {hover ? (
                    <span className="font-mono tabular-nums text-muted-foreground">
                        O <span className="text-foreground">{fmtPrice(hover.o, symbol)}</span>{" "}
                        H <span className="text-emerald-400">{fmtPrice(hover.h, symbol)}</span>{" "}
                        L <span className="text-rose-400">{fmtPrice(hover.l, symbol)}</span>{" "}
                        C <span className={cn(hover.c >= hover.o ? "text-emerald-400" : "text-rose-400")}>{fmtPrice(hover.c, symbol)}</span>
                    </span>
                ) : candles.length > 0 ? (
                    <span className="font-mono tabular-nums text-muted-foreground">
                        last <span className="text-foreground">{fmtPrice(candles[candles.length - 1].close, symbol)}</span>
                    </span>
                ) : null}
                <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                    {loading ? (
                        "loading…"
                    ) : (
                        <>
                            {candles.length} bars · /api/analytics/ohlc
                            <span className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase",
                                quality === "live" && connection === "live"
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                                    : quality === "market_closed"
                                        ? "border-slate-500/30 bg-slate-500/10 text-slate-400"
                                        : quality === "delayed" || connection === "reconnecting"
                                            ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                                            : "border-border bg-background text-muted-foreground",
                            )}>
                                <span className={cn(
                                    "inline-block h-1 w-1 rounded-full",
                                    quality === "live" && connection === "live" ? "bg-emerald-500 animate-pulse"
                                        : quality === "delayed" || connection === "reconnecting" ? "bg-amber-500 animate-pulse"
                                            : "bg-muted-foreground",
                                )} />
                                {quality === "live" && connection === "live" ? "live"
                                    : quality === "market_closed" ? "market closed"
                                        : quality === "delayed" ? "delayed"
                                            : quality === "stale" || connection === "error" || connection === "reconnecting" ? "stale / reconnecting"
                                                : "history"}
                            </span>
                        </>
                    )}
                </span>
            </div>

            {/* Applied Pine study readout — mirrors what is actually drawn below. */}
            {studyOverlay && (studyOverlay.lines.length > 0 || studyOverlay.levels.length > 0 || studyOverlay.shapes.length > 0) ? (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px]">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pine study</span>
                    {studyOverlay.lines.map((l) => (
                        <span key={l.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color }} />
                            {l.title}
                        </span>
                    ))}
                    {studyOverlay.shapes.length > 0 ? (
                        <span className="rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {studyOverlay.shapes.length} marker{studyOverlay.shapes.length !== 1 ? "s" : ""}
                        </span>
                    ) : null}
                    {studyOverlay.levels.length > 0 ? (
                        <span className="rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {studyOverlay.levels.length} hline{studyOverlay.levels.length !== 1 ? "s" : ""}
                        </span>
                    ) : null}
                    {!studyOverlay.overlay ? (
                        <span className="rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            separate pane
                        </span>
                    ) : null}
                </div>
            ) : null}

            <div className="relative" style={{ height }}>
                <div ref={containerRef} className="absolute inset-0" />

                {/* Progressive-history status — left edge (Phase 3) */}
                {olderLoading ? (
                    <div className="pointer-events-none absolute bottom-3 left-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-background/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
                        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-primary" aria-hidden />
                        Loading older history…
                    </div>
                ) : null}

                {/* Go-to-Live chip — visible only when the user scrolled away */}
                {showGoLive ? (
                    <button
                        type="button"
                        onClick={handleGoLive}
                        className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-background/90 px-3 py-1 text-[11px] font-semibold text-primary shadow-sm backdrop-blur-sm transition hover:bg-primary/10"
                    >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
                        Go to Live →
                    </button>
                ) : null}

                {/* Data-quality badge (Phase 20): never presents stale data as live */}
                {!loading || candles.length > 0 ? (
                    <div className="absolute left-3 top-2 z-10 flex items-center gap-1.5 rounded-full border border-border/50 bg-background/85 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
                        {quality === "live" && connection === "live" ? (
                            <>
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                                <span className="text-emerald-400">LIVE</span>
                            </>
                        ) : connection === "reconnecting" ? (
                            <>
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" aria-hidden />
                                <span className="text-amber-400">RECONNECTING</span>
                            </>
                        ) : quality === "gap_detected" ? (
                            <>
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden />
                                <span className="text-rose-400">GAP — SYNCING</span>
                            </>
                        ) : quality === "delayed" ? (
                            <>
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
                                <span className="text-amber-400">DELAYED</span>
                            </>
                        ) : quality === "stale" ? (
                            <>
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-500" aria-hidden />
                                <span>STALE</span>
                            </>
                        ) : (
                            <>
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" aria-hidden />
                                <span>{connection === "error" ? "OFFLINE" : quality === "market_closed" ? "MARKET CLOSED" : connection.toUpperCase()}</span>
                            </>
                        )}
                    </div>
                ) : null}

                {/* Order Flow: data-quality + capability chip */}
                {orderFlow.enabled && orderFlow.context ? (
                    <div
                        className="absolute right-3 top-2 z-10 rounded-full border border-border/50 bg-background/85 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur-sm"
                        title={`Order Flow data quality: ${orderFlow.context.dataQuality}. ${orderFlow.context.limitations[0] ?? ""}`}
                    >
                        OF · {orderFlow.context.dataQuality}
                    </div>
                ) : null}

                {/* Estimated delta provenance chip — honest labelling for the
                    candle-direction proxy layers (never bid/ask delta) */}
                {(layers.delta || layers.cumulativeDelta) && orderFlow.estimatedDelta ? (
                    <div
                        className="absolute left-3 top-8 z-10 rounded-full border border-amber-500/40 bg-background/85 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-400 backdrop-blur-sm"
                        title={`ESTIMATED — ${orderFlow.estimatedDelta.method}: candle volume signed by bar direction. NOT bid/ask delta; upgrades only with a trade-classified feed.`}
                    >
                        Δ ESTIMATED · {orderFlow.estimatedDelta.method}
                    </div>
                ) : null}

                {/* Empty / error states */}
                {feedError ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 p-4 backdrop-blur-[2px]">
                        <div className="max-w-sm text-center">
                            <p className="text-xs font-medium text-foreground">Chart unavailable</p>
                            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{feedError}</p>
                        </div>
                    </div>
                ) : loading && candles.length === 0 ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">Loading market data…</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function symbolPrecision(symbol: string): number {
    const s = symbol.toUpperCase();
    if (s.endsWith("JPY")) return 3;
    if (s === "XAGUSD") return 3;
    if (["BTCUSD", "ETHUSD"].includes(s)) return 1;
    // Forex, metals, indices: 2 decimals (matches the feed's quote precision).
    return 2;
}
