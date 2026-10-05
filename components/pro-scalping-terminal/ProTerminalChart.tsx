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
    BarSeries,
    AreaSeries,
    BaselineSeries,
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
import {
    barCloseCountdown as computeBarCloseCountdown,
    formatCountdown,
} from "@/lib/chart-engine/bar-countdown";
import { structureOverlayLayer } from "@/lib/chart-engine/overlay-contract";
import {
    detectSmartMoney,
    detectPivots,
    sessionLevels as coreSessionLevels,
    alignedIndicatorSeries,
    indicatorPrimitives,
    type SmartMoneyDetection,
} from "@/lib/market-core";
import { ChartAnchoredOverlay, type AnchoredItem } from "@/lib/chart-engine/chart-anchored-overlay";
import { barIndexForTime, countPrependedBars, shiftLogicalRangeForPrepend } from "@/lib/chart-engine/coordinate-mapping";
import { useOrderFlow } from "@/hooks/use-order-flow";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { AdvancedAnalysisResult } from "@/lib/ai/analysis/intelligence";
import type { ChartLayerId } from "./chart-layers";
import type { PineStudyOverlay } from "./pine-overlays";
import type { TerminalSignal } from "@/lib/ai/scalping/radar";
import { fmtPrice } from "./terminal-utils";
import { TA } from "@/lib/pine-runtime/builtins";
import {
    defaultChartSettings,
    TOOL_COLOR_SWATCHES,
    type ChartSettings,
    type ChartPositionView,
    type ChartPendingOrderView,
    type ChartTradeFill,
} from "./chart-settings";
import {
    MAGNET_TOOLS,
    hitTestDrawing,
    removeDrawingById,
    snapToOHLC,
    translateDrawingByMarketDelta,
    undoLastDrawing,
    updateDrawingColor,
    updateDrawingLabel,
    type DrawingGeom,
} from "./drawing-utils";
import { Pencil, Trash2 } from "lucide-react";
import { aiDrawLevels, computeAiDrawPlan, type AiDrawPlan } from "@/lib/chart-engine/ai-draw";

export type ChartType = "candlestick" | "bar" | "line" | "area" | "baseline";

export type DrawingTool =
    | "select"
    | "hand"
    | "trendline"
    | "arrow"
    | "horizontal"
    | "vertical"
    | "ray"
    | "fibo"
    | "rectangle"
    | "text"
    | "ruler"
    | "triangle";
export type DrawingPoint = {
    time?: number;
    price: number;
};
export type DrawingItem = {
    id: string;
    type: DrawingTool;
    points: DrawingPoint[];
    label?: string;
    color?: string;
    /** Stroke width captured when the drawing was placed (tool settings). */
    width?: number;
    /** Stroke style captured when the drawing was placed (tool settings). */
    lineStyle?: "solid" | "dashed" | "dotted";
};

/** One computed line an AI overlay wants drawn on the price pane. */
export type AiOverlaySeries = {
    id: string;
    label: string;
    color: string;
    /** Aligned 1:1 with the chart's candles; null/NaN points are skipped. */
    values: Array<number | null>;
};

export type AiOverlaySignal = {
    id: string;
    /** Market time in ms (matched against candle timestamps). */
    time: number;
    direction: "long" | "short";
    price: number;
    stop?: number;
    target?: number;
};

/**
 * AI overlay payload (indicator preview or backtested strategy) computed by
 * an AI engine from the SAME candles the chart renders. The chart only draws
 * it — series as lines, signals as entry/SL/TP markers, plus a HUD chip —
 * and never fabricates values it was not given.
 */
export type AiOverlay = {
    kind: "indicator" | "strategy";
    id: string;
    name: string;
    status?: "loading" | "ready" | "error";
    error?: string;
    series?: AiOverlaySeries[];
    signals?: AiOverlaySignal[];
};

export type Candle = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    /** Canonical fields (present on every chart-engine candle). */
    symbol?: string;
    timeframe?: string;
    finalized?: boolean;
};
// ── overlay computation (single source: lib/market-core) ─────────────────
//
// Since Phase 3 the chart no longer owns indicator or Smart Money math.
// Every helper below is a thin adapter over the ONE Market Intelligence
// Core: same values as backtest/replay/alerts/AI, anchored by candle open
// time, deterministic, and memoized per candle snapshot.

/** Interval length for a candle snapshot (falls back to M5). */
function tfMsOf(candles: readonly Candle[]): number {
    const tf = candles[0]?.timeframe;
    if (tf && tf in TIMEFRAME_MS) return TIMEFRAME_MS[tf as keyof typeof TIMEFRAME_MS];
    return TIMEFRAME_MS.M5;
}

/** Binary search: index of the candle opened at `timestamp` (-1 if absent). */
function indexAtTimestamp(candles: readonly Candle[], timestamp: number): number {
    let lo = 0;
    let hi = candles.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const ts = candles[mid].timestamp;
        if (ts === timestamp) return mid;
        if (ts < timestamp) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

/**
 * Memoized Smart Money detection for the current candle snapshot. One
 * detection serves every zone/level layer in this component, and the result
 * dies with the snapshot it was computed from.
 */
const detectionCache = new WeakMap<readonly Candle[], SmartMoneyDetection>();
function chartDetection(candles: readonly Candle[]): SmartMoneyDetection {
    const cached = detectionCache.get(candles);
    if (cached) return cached;
    const detection = detectSmartMoney(candles, {
        symbol: candles[0]?.symbol ?? "UNKNOWN",
        timeframe: candles[0]?.timeframe ?? "M5",
    });
    detectionCache.set(candles, detection);
    return detection;
}

/** Session high/low levels for the latest UTC day (core session windows). */
function computeSessionLevels(candles: Candle[]): Array<{ price: number; label: string; color: string }> {
    const out: Array<{ price: number; label: string; color: string }> = [];
    for (const level of coreSessionLevels(candles)) {
        out.push({ price: level.high, label: `${level.label} H`, color: level.color });
        out.push({ price: level.low, label: `${level.label} L`, color: level.color });
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

/** VWAP from the core indicator engine (session-anchored by UTC day). */
function computeVwap(candles: Candle[]): Array<{ time: UTCTimestamp; value: number }> {
    const values = alignedIndicatorSeries(candles, { id: "vwap" }, "value");
    const out: Array<{ time: UTCTimestamp; value: number }> = [];
    candles.forEach((c, i) => {
        const v = values[i];
        if (v !== null && v !== undefined && Number.isFinite(v)) {
            out.push({ time: Math.floor(c.timestamp / 1000) as UTCTimestamp, value: v });
        }
    });
    return out;
}

/**
 * EMA over a raw value array through the core EMA kernel (SMA-seeded,
 * null until the seed window fills — identical to the platform's `ema`).
 */
function ema(values: number[], period: number): Array<number | null> {
    const runtime = indicatorPrimitives.emaRuntime(period);
    const state = runtime.initialState();
    return values.map((v, i) =>
        runtime.step(state, { timestamp: i, open: v, high: v, low: v, close: v, volume: 0 }).value ?? null
    );
}

/**
 * Confirmed swing pivots from the core structure detector (fractal rule,
 * `lookback` bars each side). Only CONFIRMED pivots are returned so the
 * plotted levels never repaint on the forming candle.
 */
function computeSwings(candles: Candle[], leftRight = 2) {
    const pivots = detectPivots(candles, leftRight, tfMsOf(candles));
    const highs: Array<{ index: number; price: number }> = [];
    const lows: Array<{ index: number; price: number }> = [];
    for (const p of pivots) {
        if (p.developing) continue;
        if (p.side === "high") highs.push({ index: p.index, price: p.price });
        else lows.push({ index: p.index, price: p.price });
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

/**
 * Fair value gaps from the core FVG detector (3-candle imbalance with a
 * documented lifecycle). Only zones that are not invalidated are drawn.
 */
function computeFvgs(candles: Candle[]): Array<{ top: number; bottom: number; startIdx: number; bullish: boolean }> {
    const out: Array<{ top: number; bottom: number; startIdx: number; bullish: boolean }> = [];
    for (const z of chartDetection(candles).fvgs) {
        if (z.status === "invalidated") continue;
        const anchor = typeof z.metadata?.zoneStart === "number" ? z.metadata.zoneStart : z.detectedAt;
        const startIdx = indexAtTimestamp(candles, anchor);
        if (startIdx < 0 || z.priceHigh === undefined || z.priceLow === undefined) continue;
        out.push({ top: z.priceHigh, bottom: z.priceLow, startIdx, bullish: z.direction === "bullish" });
    }
    return out.slice(-6);
}

/** Order blocks from the core detector (displacement-based, lifecycle-aware). */
function computeOrderBlocks(candles: Candle[]): Array<{ top: number; bottom: number; startIdx: number; bullish: boolean }> {
    const out: Array<{ top: number; bottom: number; startIdx: number; bullish: boolean }> = [];
    for (const z of chartDetection(candles).orderBlocks) {
        if (z.status === "invalidated") continue;
        const anchor = typeof z.metadata?.zoneStart === "number" ? z.metadata.zoneStart : z.detectedAt;
        const startIdx = indexAtTimestamp(candles, anchor);
        if (startIdx < 0 || z.priceHigh === undefined || z.priceLow === undefined) continue;
        out.push({ top: z.priceHigh, bottom: z.priceLow, startIdx, bullish: z.direction === "bullish" });
    }
    return out.slice(-4);
}

/**
 * Equal highs/lows from the core liquidity detector (confirmed swing
 * clusters within the documented relative tolerance).
 */
function computeEqualLevels(candles: Candle[]): Array<{ price: number; kind: "eqh" | "eql"; count: number }> {
    const out: Array<{ price: number; kind: "eqh" | "eql"; count: number }> = [];
    for (const pool of chartDetection(candles).pools) {
        if (pool.kind !== "equal_highs" && pool.kind !== "equal_lows") continue;
        if (pool.price === undefined) continue;
        out.push({
            price: pool.price,
            kind: pool.kind === "equal_highs" ? "eqh" : "eql",
            count: typeof pool.metadata?.count === "number" ? pool.metadata.count : 2,
        });
    }
    return out;
}

// ── component ───────────────────────────────────────────────────────────────

/**
 * Chart view themes — fallback values used before the user's persisted
 * ChartSettings hydrate (and for callers that do not pass settings).
 * Kept pixel-identical to the `midnight` / `light` presets in
 * chart-settings.ts so the chart never flashes a different palette.
 */
const THEME_OPTIONS = {
    light: {
        gridColor: "rgba(148, 163, 184, 0.22)",
        textColor: "#546a82",
        crosshairColor: "rgba(234, 123, 74, 0.55)",
        uiBackground: "#ffffff",
    },
    dark: {
        gridColor: "rgba(148, 163, 184, 0.08)",
        textColor: "#8b98ad",
        crosshairColor: "rgba(255, 255, 255, 0.35)",
        uiBackground: "#0b0f17",
    },
} as const;

const PINE_PANE_STRETCH = 0.35;

/** In-chart hint shown while a drawing tool is active (bottom-center chip). */
const DRAWING_TOOL_HINTS: Record<DrawingTool, string> = {
    select: "Click an object to select · Del removes it",
    hand: "Drag to move a drawing · click to release",
    trendline: "Drag between two points",
    arrow: "Drag from origin to target (arrow drawn at target)",
    horizontal: "Click to place a price level",
    vertical: "Click to place a time marker",
    ray: "Drag from an origin through a target",
    fibo: "Drag from swing start to swing end",
    rectangle: "Drag to mark a zone",
    text: "Click, type a label, Enter saves",
    ruler: "Drag to measure price / time",
    triangle: "Drag to draw arrow / triangle",
};
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

/**
 * Pick a legible text colour for a filled tag.
 *
 * The AI direction pill is filled with the user's buy/sell colour, which they
 * can set to anything — including a pale yellow. Hard-coding white would make
 * the label unreadable, so pick black or white from the colour's relative
 * luminance. Non-hex values (the rgba() strings presets may hold for lines)
 * fall back to white, which is correct for every preset's saturated side
 * colours.
 */
function contrastText(hex: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return "#ffffff";
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    // Rec. 709 luma on gamma-encoded sRGB is close enough for a pick-a-ink test.
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luma > 0.6 ? "#0b0f17" : "#ffffff";
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
    chartType = "candlestick",
    activeDrawingTool = "select",
    drawings = [],
    onDrawingsChange,
    gridVisible = true,
    theme = "dark",
    aiOverlay: aiOverlayProp = null,
    settings = null,
    positions = [],
    pendingOrders = [],
    tradeHistory = [],
    quote = null,
    aiDraw = false,
    fitSignal = 0,
    focusRequest = null,
    onAiPlanChange,
    onClosePosition,
    onCancelOrder,
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
    chartType?: ChartType;
    activeDrawingTool?: DrawingTool;
    drawings?: DrawingItem[];
    onDrawingsChange?: (drawings: DrawingItem[]) => void;
    /** Show/hide the chart grid lines. */
    gridVisible?: boolean;
    /** Chart color theme (dark/light). */
    theme?: "dark" | "light";
    /** AI-computed indicator/strategy overlay (series + signals) to draw. */
    aiOverlay?: AiOverlay | null;
    /** User chart settings (colors / display flags / tool style). Defaults to the dark preset. */
    settings?: ChartSettings | null;
    /** Open positions to draw as entry/SL/TP trade levels (active symbol only). */
    positions?: ChartPositionView[];
    /** Pending orders (buy/sell limit & stop) to draw on the price pane. */
    pendingOrders?: ChartPendingOrderView[];
    /** Historical fills rendered as entry/exit markers (real executions only). */
    tradeHistory?: ChartTradeFill[];
    /** Real-time quote for BID/ASK lines. Ask is drawn only when provided. */
    quote?: { bid?: number | null; ask?: number | null; spreadEstimated?: boolean; timestamp?: number } | null;
    /** Pro AI Draw: derive entry/SL/TP plan levels from the chart's own candles. */
    aiDraw?: boolean;
    /** Increment to reset the viewport (fit content + re-enable price auto-scale). */
    fitSignal?: number;
    /**
     * Event → chart navigation (Phase 5 §32). Each request carries its own
     * `seq`, so clicking the same feed entry twice re-centres the view. The
     * chart selects the bar's timestamp, centres the visible range around it
     * and pins a labelled price line on the event's price when one is given.
     */
    focusRequest?: { seq: number; time: number; price?: number; label?: string } | null;
    /** Countdown to next bar close (phase 9 → 10). */
    /** Notified when the AI draw plan is (re)computed — null when off/insufficient data. */
    onAiPlanChange?: (plan: AiDrawPlan | null) => void;
    /** Close a position by percentage (25 → close 25% of the volume). */
    onClosePosition?: (ticket: string, percent: number) => void;
    /** Cancel a pending order from the chart's trade strip. */
    onCancelOrder?: (ticket: string) => void;
}) {
    // ── user chart settings ───────────────────────────────────────────
    // Single resolved view configuration: explicit settings prop wins,
    // otherwise the dark-preset defaults keyed off the legacy theme prop.
    // Every color/flag the chart draws from lives here, so the toolbar's
    // settings panel is the one place appearance is decided.
    const cfg = useMemo<ChartSettings>(
        () => settings ?? defaultChartSettings(theme === "light" ? "light" : "midnight"),
        [settings, theme]
    );
    const cfgRef = useRef(cfg);
    useEffect(() => { cfgRef.current = cfg; }, [cfg]);

    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const ema9Ref = useRef<ISeriesApi<"Line"> | null>(null);
    const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    // Trade levels: open-position entry/SL/TP + pending order lines.
    const tradeLinesRef = useRef<IPriceLine[]>([]);
    // BID/ASK lines from the real-time quote.
    const bidAskLinesRef = useRef<IPriceLine[]>([]);
    // Bar-close countdown line — rides the live candle's price (like BID/ASK).
    const countdownLinesRef = useRef<IPriceLine[]>([]);
    // Which series owns those lines, so a chart-type switch removes them from
    // the series that actually created them.
    const countdownLineOwnerRef = useRef<{
        series: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area"> | ISeriesApi<"Baseline"> | ISeriesApi<"Bar">;
        lines: IPriceLine[];
    } | null>(null);
    // AI-drawn plan lines (entry/SL/TP/support/resistance).
    const aiPlanLinesRef = useRef<IPriceLine[]>([]);
    // Transient line marking the event the feed navigated to.
    const focusLineRef = useRef<IPriceLine[]>([]);
    // Focus request waiting for the chart to hold data for it.
    const pendingFocusRef = useRef<{ seq: number; time: number; price?: number; label?: string } | null>(null);
    // Historical fill markers (trade entry/exit history).
    const historyMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    // AI draw marker (direction arrow on the live bar).
    const aiDrawMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
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
    // Smart-money structure markers (BOS/CHoCH) — declared with the other
    // marker plugins so every effect that touches it sees the same binding.
    const structureMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
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

    // ── AI draw plan (Pro) ─────────────────────────────────────────────────
    // The plan itself is derived below (`aiPlan` memo, keyed on candle
    // values); this effect publishes plan changes to listeners.
    const onAiPlanChangeRef = useRef(onAiPlanChange);
    useEffect(() => { onAiPlanChangeRef.current = onAiPlanChange; }, [onAiPlanChange]);
    const onClosePositionRef = useRef(onClosePosition);
    useEffect(() => { onClosePositionRef.current = onClosePosition; }, [onClosePosition]);
    // Live chart handles mirrored into state so the SVG drawing overlay can
    // convert price/time → pixels during render without touching refs.
    const [chartHandles, setChartHandles] = useState<{
        chart: IChartApi | null;
        cs: ISeriesApi<"Candlestick"> | null;
    } | null>(null);

    // ── AI overlay ───────────────────────────────────────────────────────────
    // The prop itself is the source of truth; the effects below render its
    // series/markers whenever the payload (or the candles) change.
    const aiOverlay = aiOverlayProp;

    // ── live-follow state (Phase 6) ───────────────────────────────────────
    // When the user is at the live edge the chart follows new candles
    // (scrollToRealTime on every append). Any manual drag/zoom away from the
    // edge disengages following; the Go-to-Live chip re-engages it.
    const [followLive, setFollowLive] = useState(true);
    const [showGoLive, setShowGoLive] = useState(false);
    const [olderLoading, setOlderLoading] = useState(false);

    // ── alt chart-type series ─────────────────────────────────────────────
    // Created once alongside the main candlestick series; only one is visible
    // at a time. The chartType prop switches visibility and feeds data from
    // the same candle pipeline so no additional fetches are needed.
    const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const areaSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
    const baselineSeriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);
    const barSeriesRef = useRef<ISeriesApi<"Bar"> | null>(null);
    const activeSeriesTypeRef = useRef<ChartType>("candlestick");
    // The price series the user is actually looking at (candle/line/area/
    // baseline/bar). Overlays that must sit ON the price — the countdown line,
    // the AI plan, chart markers — attach to this so they follow the chart when
    // the type changes instead of staying pinned to a hidden candle series.
    const activePriceSeriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area"> | ISeriesApi<"Baseline"> | ISeriesApi<"Bar"> | null>(null);
    // ── Drawing + indicator/strategy layer state ─────────────────────────────
    // SVG overlay for interactive drawing tools. Coordinate transforms use
    // the chart's own time→x and price→y APIs so drawings stay pinned to
    // candles regardless of zoom/scroll.
    const svgOverlayRef = useRef<SVGSVGElement | null>(null);
    const drawingInProgressRef = useRef<{
        tool: DrawingTool;
        startX: number; startY: number;
        startPrice: number; startTime: number;
        curX: number; curY: number;
        // Drag-to-move existing drawing; source coordinates are market values.
        moveId?: string;
        pointerStartPrice?: number;
        pointerStartTime?: number;
    } | null>(null);
    // Double-click detection for the select tool (second tap edits a label).
    const lastSelectClickRef = useRef<{ id: string; at: number } | null>(null);
    // Fresh-ref mirrors so DOM event callbacks never capture stale closures.
    const drawingsRef = useRef<DrawingItem[]>(drawings);
    const onDrawingsChangeRef = useRef(onDrawingsChange);
    useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
    useEffect(() => { onDrawingsChangeRef.current = onDrawingsChange; }, [onDrawingsChange]);
    const activeDrawingToolRef = useRef<DrawingTool>(activeDrawingTool);
    useEffect(() => { activeDrawingToolRef.current = activeDrawingTool; }, [activeDrawingTool]);
    // Local mirror of drawings used to render the SVG overlay. Re-synced
    // during render (React's "adjust state when props change" pattern) so no
    // effect has to push prop changes back into state.
    const [drawingElements, setDrawingElements] = useState<DrawingItem[]>(drawings);
    const [lastDrawingsProp, setLastDrawingsProp] = useState<DrawingItem[]>(drawings);
    if (lastDrawingsProp !== drawings) {
        setLastDrawingsProp(drawings);
        setDrawingElements(drawings);
    }
    // Live preview of the shape being dragged. Kept in state (not only the
    // ref) so the SVG re-renders on every pointer move without the old
    // "fake containerSize update" hack; the ref stays as the handler's
    // mutable source of truth.
    const [drawingPreview, setDrawingPreview] = useState<{
        tool: DrawingTool;
        startX: number; startY: number;
        startPrice: number; startTime: number;
        curX: number; curY: number;
    } | null>(null);
    // Container dimensions tracked for the SVG viewport.
    const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
    // Bumped on every pan/zoom so chart-anchored SVG (drawings, AI badge)
    // recomputes its pixel coordinates in step with the canvas.
    const [viewportTick, setViewportTick] = useState(0);

    // ── selection + text editing ─────────────────────────────────────
    // One drawing can be selected (click), restyled, renamed and deleted;
    // text labels are typed into an inline editor instead of a placeholder.
    const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
    const [textEdit, setTextEdit] = useState<{ id: string; value: string } | null>(null);

    /** Single write path for every drawing mutation (place/delete/undo/edit). */
    const commitDrawings = useCallback((next: DrawingItem[]) => {
        drawingsRef.current = next;
        onDrawingsChangeRef.current?.(next);
        setDrawingElements(next);
    }, []);

    const deleteSelectedDrawing = useCallback(() => {
        if (!selectedDrawingId) return;
        commitDrawings(removeDrawingById(drawingsRef.current, selectedDrawingId));
        setSelectedDrawingId(null);
    }, [commitDrawings, selectedDrawingId]);

    const saveTextEdit = useCallback(() => {
        setTextEdit((cur) => {
            if (!cur) return null;
            const current = drawingsRef.current;
            const drawing = current.find((d) => d.id === cur.id);
            const trimmed = cur.value.trim();
            if (drawing) {
                queueMicrotask(() => {
                    if (!trimmed) {
                        commitDrawings(removeDrawingById(current, cur.id));
                        setSelectedDrawingId((s) => (s === cur.id ? null : s));
                    } else {
                        commitDrawings(updateDrawingLabel(current, cur.id, trimmed));
                    }
                });
            }
            return null;
        });
    }, [commitDrawings]);

    const cancelTextEdit = useCallback(() => {
        setTextEdit((cur) => {
            if (!cur) return null;
            const drawing = drawingsRef.current.find((d) => d.id === cur.id);
            queueMicrotask(() => {
                if (drawing && !drawing.label) {
                    commitDrawings(removeDrawingById(drawingsRef.current, cur.id));
                    setSelectedDrawingId((s) => (s === cur.id ? null : s));
                }
            });
            return null;
        });
    }, [commitDrawings]);

    // Switching tools drops the current selection (and any open label edit).
    // Adjust-during-render pattern (same as lastDrawingsProp below) — no
    // effect, no cascading render.
    const [lastActiveTool, setLastActiveTool] = useState(activeDrawingTool);
    if (lastActiveTool !== activeDrawingTool) {
        setLastActiveTool(activeDrawingTool);
        setSelectedDrawingId(null);
        setTextEdit(null);
    }

    // ── keyboard: Del removes the selection, Ctrl/Cmd+Z undoes the last
    // placement. Ignored while typing in an input (label editor, panels). ──
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const typing =
                !!target &&
                (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
            if (typing || textEdit) return;
            if (e.key === "Delete" || e.key === "Backspace") {
                if (!selectedDrawingId) return;
                e.preventDefault();
                deleteSelectedDrawing();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
                e.preventDefault();
                commitDrawings(undoLastDrawing(drawingsRef.current));
                setSelectedDrawingId(null);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [textEdit, selectedDrawingId, deleteSelectedDrawing, commitDrawings]);

    const selectedDrawing = selectedDrawingId
        ? drawingElements.find((d) => d.id === selectedDrawingId) ?? null
        : null;
    const textEditDrawing = textEdit
        ? drawingElements.find((d) => d.id === textEdit.id) ?? null
        : null;

    /** Screen coordinates of a drawing's anchor points (null when unready). */
    const drawingScreenPos = (
        d: DrawingItem | null | undefined
    ): { x1: number; y1: number; x2: number; y2: number } | null => {
        const chart = chartHandles?.chart ?? null;
        const cs = chartHandles?.cs ?? null;
        if (!d || !chart || !cs || d.points.length < 2) return null;
        try {
            const p1 = d.points[0];
            const p2 = d.points[1];
            const x1 = p1.time
                ? chart.timeScale().timeToCoordinate(Math.floor(p1.time / 1000) as UTCTimestamp) ?? 0
                : 0;
            const y1 = cs.priceToCoordinate(p1.price) ?? 0;
            const x2 = p2.time
                ? chart.timeScale().timeToCoordinate(Math.floor(p2.time / 1000) as UTCTimestamp) ?? 0
                : containerSize.w;
            const y2 = cs.priceToCoordinate(p2.price) ?? 0;
            return { x1, y1, x2, y2 };
        } catch {
            return null;
        }
    };

    const selPos = drawingScreenPos(selectedDrawing);
    const textPos = drawingScreenPos(textEditDrawing);

    // Indicator / strategy series refs: each added indicator or backtested
    // strategy creates its own line/histogram series + markers. Refs are
    // kept in arrays so the layer can be removed when the item is deleted.
    const indicatorSeriesRef = useRef<Array<{
        id: string;
        series: ISeriesApi<"Line">;
        pane: number;
        color: string;
        values: Array<number | null>;
    }>>([]);
    const strategySignalMarkersRef = useRef<Array<{
        id: string;
        markers: ISeriesMarkersPluginApi<Time>;
        lines: IPriceLine[];
    }>>([]);

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

    // Sync volume series visibility with layers prop (clean chart by default)
    useEffect(() => {
        if (volumeSeriesRef.current) {
            volumeSeriesRef.current.applyOptions({ visible: layers.volume || false });
        }
    }, [layers.volume]);

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

    // ── AI draw plan (Pro) ─────────────────────────────────────────────
    // Derived ONLY from the candles this chart renders — ATR, swing
    // structure and S/R clusters — so the levels can never reference a
    // price the chart is not already showing. Keyed down to a value
    // signature so tick updates do not churn the drawn lines every 2 s.
    const candleCount = candles.length;
    const lastClose = candles[candles.length - 1]?.close;
    // Deliberate value keying: bar count + last close change only when the
    // charted data changes, while the candles array identity changes on every
    // tick — recomputing the ATR/S-R plan per tick would redraw the lines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const aiPlan = useMemo(() => (aiDraw ? computeAiDrawPlan(candles) : null), [aiDraw, candleCount, lastClose]);
    const aiPlanKey = aiPlan
        ? `${aiPlan.direction}|${aiPlan.entry}|${aiPlan.sl}|${aiPlan.tp1}|${aiPlan.tp2}|${aiPlan.support}|${aiPlan.resistance}|${aiPlan.anchorTime}`
        : "";

    // Trade views scoped to the active symbol (the chart draws only these).
    const symbolPositions = useMemo(
        () => positions.filter((p) => p.symbol === symbol && Number.isFinite(p.entry) && p.entry > 0),
        [positions, symbol]
    );
    const symbolOrders = useMemo(
        () => pendingOrders.filter(
            (o) => o.symbol === symbol && Number.isFinite(o.price) && o.price > 0 && !/cancel|expired|filled/i.test(o.status ?? "")
        ),
        [pendingOrders, symbol]
    );

    // Canonical interval for the market→bar-index transform (chart timeframes
    // only; the terminal never renders D1/W1).
    const intervalMs = isChartTimeframe(timeframe) ? TIMEFRAME_MS[timeframe] : 3_600_000;
    // ── Bar-close countdown clock ───────────────────────────────────────
    // One shared clock for the moving countdown line and the footer chip.
    // Ticks on a 250 ms interval (not rAF: rAF burns a frame budget for a
    // label that only shows whole seconds) and rolls into the next bar on its
    // own, so the countdown never sticks at 00:00:00.
    const [countdown, setCountdown] = useState(() => computeBarCloseCountdown(Date.now(), intervalMs));
    useEffect(() => {
        const tick = () => setCountdown(computeBarCloseCountdown(Date.now(), intervalMs));
        tick();
        const id = window.setInterval(tick, 250);
        return () => window.clearInterval(id);
    }, [intervalMs]);
    // A host may pin its own clock; the chart's own stays the fallback so the
    // timer is always present (and moving) even without the prop.
    const countdownMs = countdown?.remainingMs ?? 0;
    const countdownLabel = formatCountdown(countdownMs);

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

        const initialTheme = document.documentElement.dataset.chartTheme === "light" ? "light" : "dark";
        const t = THEME_OPTIONS[initialTheme];
        const chart = createChart(container, {
            autoSize: true,
            layout: {
                background: { type: ColorType.Solid, color: t.uiBackground },
                textColor: t.textColor,
                fontFamily: "var(--font-sans, Inter), var(--font-mono, monospace), sans-serif",
                fontSize: 11,
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: t.gridColor, style: LineStyle.Solid },
                horzLines: { color: t.gridColor, style: LineStyle.Solid },
            },
            rightPriceScale: {
                borderColor: t.gridColor,
                scaleMargins: { top: 0.10, bottom: 0.18 },
            },
            timeScale: {
                borderColor: t.gridColor,
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 6,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: t.crosshairColor, labelBackgroundColor: t.uiBackground, width: 1, style: LineStyle.Dashed },
                horzLine: { color: t.crosshairColor, labelBackgroundColor: t.uiBackground, width: 1, style: LineStyle.Dashed },
            },
            // Free movement: the chart pans in every direction (including a
            // vertical price-scale drag) and zooms by wheel/pinch — the
            // settings panel can lock it back down via display.freeMove.
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: true,
                horzTouchDrag: true,
                vertTouchDrag: true,
            },
            handleScale: {
                axisPressedMouseMove: { time: true, price: true },
                mouseWheel: true,
                pinch: true,
            },
        });
        chartRef.current = chart;

        // TradingView-style theme switch is driven by the chart toolbar and
        // persisted per-symbol; `autoSize` + transparent-swap is unreliable
        // across browsers, so set the explicit canvas background here.
        chart.applyOptions({
            layout: { background: { type: ColorType.Solid, color: t.uiBackground } },
        });            candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: cfg.colors.bull,
            downColor: cfg.colors.bear,
            borderUpColor: cfg.colors.bull,
            borderDownColor: cfg.colors.bear,
            wickUpColor: cfg.colors.bull,
            wickDownColor: cfg.colors.bear,
            priceFormat: { type: "price", precision: symbolPrecision(symbol), minMove: 10 ** -symbolPrecision(symbol) },
            lastValueVisible: false,
            // Apply user's candle width setting (0 = auto-width)
            barWidth: cfg.tools.candleWidth,
        });
        // Volume series is created but NOT shown by default — clean chart experience
        // User activates volume from the indicator panel when desired
        // Volume shares candle colors so the chart stays cohesive
        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
            priceScaleId: "vol",
            priceFormat: { type: "volume" },
            color: cfg.colors.bull,
            borderColor: cfg.colors.bear,
            visible: layers.volume || false,
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

        // ── AI overlay ─────────────────────────────────────────────────
        // Indicator/strategy series produced by the AI overlay are attached
        // to this chart by the AI overlay effect below (runs after mount).

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

        // Alt chart-type series — created once, hidden by default, switched
        // visible when chartType changes. All share the same price scale so
        // any overlay price lines stay anchored.
        lineSeriesRef.current = chart.addSeries(LineSeries, {
            color: "#38bdf8",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: true,
            visible: false,
        });
        areaSeriesRef.current = chart.addSeries(AreaSeries, {
            lineColor: cfg.colors.bull,
            topColor: cfg.colors.bullFill,
            bottomColor: cfg.colors.bullFill,
            lineWidth: cfg.tools.lineWidth,
            priceLineVisible: false,
            lastValueVisible: true,
            visible: false,
        });
        baselineSeriesRef.current = chart.addSeries(BaselineSeries, {
            baseValue: { type: "price", price: 0 },
            topLineColor: cfg.colors.bull,
            topFillColor1: cfg.colors.bullFill,
            topFillColor2: cfg.colors.bullFill,
            bottomLineColor: cfg.colors.bear,
            bottomFillColor1: cfg.colors.bearFill,
            bottomFillColor2: cfg.colors.bearFill,
            lineWidth: cfg.tools.lineWidth,
            priceLineVisible: false,
            lastValueVisible: true,
            visible: false,
        });
        barSeriesRef.current = chart.addSeries(BarSeries, {
            upColor: cfg.colors.bull,
            downColor: cfg.colors.bear,
            borderUpColor: cfg.colors.bull,
            borderDownColor: cfg.colors.bear,
            wickUpColor: cfg.colors.bullFill,
            wickDownColor: cfg.colors.bearFill,
            priceFormat: { type: "price", precision: symbolPrecision(symbol), minMove: 10 ** -symbolPrecision(symbol) },
            visible: false,
        });
        activeSeriesTypeRef.current = "candlestick";

        chart.subscribeCrosshairMove((param) => {
            const data = param.seriesData.get(candleSeriesRef.current as ISeriesApi<"Candlestick">);
            if (data && "close" in data) {
                const d = data as unknown as { open: number; high: number; low: number; close: number };
                setHover({ o: d.open, h: d.high, l: d.low, c: d.close, time: (param.time as number) * 1000 });
                return;
            }
            const activeType = activeSeriesTypeRef.current;
            const activeSeries = activeType === "line" ? lineSeriesRef.current
                : activeType === "area" ? areaSeriesRef.current
                    : activeType === "baseline" ? baselineSeriesRef.current
                        : activeType === "bar" ? barSeriesRef.current
                            : null;
            const activeData = activeSeries ? param.seriesData.get(activeSeries) : undefined;
            if (activeData && "close" in activeData) {
                const d = activeData as unknown as { open: number; high: number; low: number; close: number };
                setHover({ o: d.open, h: d.high, l: d.low, c: d.close, time: Number(param.time) * 1000 });
            } else if (activeData && "value" in activeData) {
                const value = (activeData as unknown as { value: number }).value;
                setHover({ o: value, h: value, l: value, c: value, time: Number(param.time) * 1000 });
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
            // The SVG overlay (drawings + the AI direction badge) positions
            // itself from chart coordinates, so any pan/zoom invalidates those
            // pixels. One state bump re-renders it in step with the canvas.
            setViewportTick((t) => t + 1);
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

        // Publish the live handles for the SVG drawing overlay's render-time
        // coordinate conversion (state, not refs — refs can't be read in render).
        setChartHandles({ chart, cs: candleSeriesRef.current });

        return () => {
            anchoredOverlayRef.current?.destroy();
            anchoredOverlayRef.current = null;
            for (const plugin of [studyMarkersRef.current, structureMarkersRef.current, signalMarkersRef.current, orderFlowMarkersRef.current, historyMarkersRef.current, aiDrawMarkersRef.current]) {
                plugin?.detach();
            }
            studyMarkersRef.current = null;
            structureMarkersRef.current = null;
            signalMarkersRef.current = null;
            orderFlowMarkersRef.current = null;
            historyMarkersRef.current = null;
            aiDrawMarkersRef.current = null;
            gexLinesRef.current = [];
            tradeLinesRef.current = [];
            bidAskLinesRef.current = [];
            aiPlanLinesRef.current = [];
            indicatorSeriesRef.current = [];
            strategySignalMarkersRef.current = [];
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
            structureMarkersRef.current = null;
            signalMarkersRef.current = null;
            orderFlowMarkersRef.current = null;
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
            lineSeriesRef.current = null;
            areaSeriesRef.current = null;
            baselineSeriesRef.current = null;
            barSeriesRef.current = null;
            countdownLinesRef.current = [];
            activePriceSeriesRef.current = null;
            activeSeriesTypeRef.current = "candlestick";
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Resize observer — track container dimensions for SVG overlay ──────
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);    // ── Chart settings application (theme colors / grid / trade display) ────
    // Applies the toolbar's resolved settings to the live chart. Pure view
    // options — no data refetch, no viewport change (except re-enabling the
    // price auto-scale the user explicitly asked for).
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const t = cfg.colors;
        const gridOn = gridVisible && cfg.display.grid;
        try {
            chart.applyOptions({
                layout: {
                    background: { type: ColorType.Solid, color: t.background },
                    textColor: t.text,
                },
                grid: {
                    vertLines: { color: gridOn ? t.grid : "transparent" },
                    horzLines: { color: gridOn ? t.grid : "transparent" },
                },
                rightPriceScale: {
                    borderColor: gridOn ? t.grid : "transparent",
                    autoScale: cfg.display.autoScale,
                },
                timeScale: { borderColor: gridOn ? t.grid : "transparent" },
                crosshair: {
                    vertLine: { color: t.crosshair, labelBackgroundColor: t.background },
                    horzLine: { color: t.crosshair, labelBackgroundColor: t.background },
                },
                handleScroll: cfg.display.freeMove
                    ? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true }
                    : false,
                handleScale: cfg.display.freeMove
                    ? { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true }
                    : false,
            });
            // MT5-style candle coloring: bull/bear body, border and wick all
            // follow the preset (or the user's custom swatch).
            candleSeriesRef.current?.applyOptions({
                upColor: t.bull,
                downColor: t.bear,
                borderUpColor: t.bull,
                borderDownColor: t.bear,
                wickUpColor: t.bull,
                wickDownColor: t.bear,
            });
            barSeriesRef.current?.applyOptions({ upColor: t.bull, downColor: t.bear });
            volumeSeriesRef.current?.applyOptions({ visible: cfg.display.volume });
        } catch {
            // chart may have been removed between renders
        }
    }, [gridVisible, cfg]);

    // ── AI overlay: series lines + signal markers ────────────────────────────
    // Rebuilds only when the overlay payload changes; values are fed from the
    // same candle array the rest of the chart uses, so the overlay can never
    // drift from what is rendered. Loading/error states render in the HUD.
    const aiOverlayKey = aiOverlay
        ? `${aiOverlay.kind}|${aiOverlay.id}|${aiOverlay.status ?? "ready"}|${(aiOverlay.series ?? []).map((s) => `${s.id}:${s.values.length}`).join(",")}|${(aiOverlay.signals ?? []).length}`
        : "";
    useEffect(() => {
        const chart = chartRef.current;
        const cs = candleSeriesRef.current;
        if (!chart || !cs) return;

        // Tear down the previous overlay.
        for (const entry of indicatorSeriesRef.current) {
            try { chart.removeSeries(entry.series); } catch { /* already gone */ }
        }
        indicatorSeriesRef.current = [];
        for (const entry of strategySignalMarkersRef.current) {
            entry.markers.detach();
            for (const l of entry.lines) {
                try { cs.removePriceLine(l); } catch { /* already gone */ }
            }
        }
        strategySignalMarkersRef.current = [];

        if (!aiOverlay || aiOverlay.status === "error" || (aiOverlay.series ?? []).length === 0) return;
        if (candles.length === 0) return;

        const toSec = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;
        for (const s of aiOverlay.series ?? []) {
            if (!Number.isFinite(Number(s.color)) && !s.color) continue;
            try {
                const series = chart.addSeries(LineSeries, {
                    color: s.color,
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                    title: s.label,
                });
                const data: Array<{ time: UTCTimestamp; value: number }> = [];
                candles.forEach((c, i) => {
                    const v = s.values[i];
                    if (v !== null && v !== undefined && Number.isFinite(v)) {
                        data.push({ time: toSec(c.timestamp), value: v });
                    }
                });
                series.setData(data);
                indicatorSeriesRef.current.push({
                    id: s.id,
                    series,
                    pane: 0,
                    color: s.color,
                    values: s.values,
                });
            } catch {
                // pane/series limits — skip this series rather than break the overlay
            }
        }

        // Strategy signals: entry arrows + SL/TP price lines on the price pane.
        const signals = aiOverlay.signals ?? [];
        if (signals.length > 0) {
            const timeIndex = new Map<number, number>();
            candles.forEach((c, i) => timeIndex.set(Math.floor(c.timestamp / 1000), i));
            const markers: SeriesMarker<Time>[] = [];
            const lines: IPriceLine[] = [];
            for (const sig of signals) {
                const t = Math.floor(sig.time / 1000);
                if (!timeIndex.has(t)) continue;
                const long = sig.direction === "long";
                markers.push({
                    time: t as UTCTimestamp,
                    position: long ? "belowBar" : "aboveBar",
                    shape: long ? "arrowUp" : "arrowDown",
                    color: long ? "#34d399" : "#fb7185",
                    size: 1,
                    text: `${long ? "LONG" : "SHORT"} ${fmtPrice(sig.price, symbol)}`,
                });
                if (sig.stop !== undefined && Number.isFinite(sig.stop)) {
                    lines.push(cs.createPriceLine({
                        price: sig.stop,
                        color: "rgba(244, 63, 94, 0.8)",
                        lineWidth: 1,
                        lineStyle: LineStyle.Dashed,
                        axisLabelVisible: false,
                        title: "AI SL",
                    }));
                }
                if (sig.target !== undefined && Number.isFinite(sig.target)) {
                    lines.push(cs.createPriceLine({
                        price: sig.target,
                        color: "rgba(34, 197, 94, 0.8)",
                        lineWidth: 1,
                        lineStyle: LineStyle.Dashed,
                        axisLabelVisible: false,
                        title: "AI TP",
                    }));
                }
            }
            markers.sort((a, b) => (a.time as number) - (b.time as number));
            if (markers.length > 0) {
                const markersApi = createSeriesMarkers(cs, markers);
                strategySignalMarkersRef.current.push({ id: aiOverlay.id, markers: markersApi, lines });
            } else {
                // Lines were created but no marker set — still track them for cleanup.
                strategySignalMarkersRef.current.push({
                    id: aiOverlay.id,
                    markers: createSeriesMarkers(cs, []),
                    lines,
                });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aiOverlayKey]);

    // Feed AI overlay values on new candles (live ticks) without rebuilding series.
    useEffect(() => {
        if (!aiOverlay || aiOverlay.status !== "ready") return;
        if (indicatorSeriesRef.current.length === 0) return;
        const toSec = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;
        for (const entry of indicatorSeriesRef.current) {
            const s = (aiOverlay.series ?? []).find((x) => x.id === entry.id);
            if (!s) continue;
            const data: Array<{ time: UTCTimestamp; value: number }> = [];
            candles.forEach((c, i) => {
                const v = s.values[i];
                if (v !== null && v !== undefined && Number.isFinite(v)) {
                    data.push({ time: toSec(c.timestamp), value: v });
                }
            });
            try { entry.series.setData(data); } catch { /* chart removed */ }
        }
    }, [candles, aiOverlay]);

    // ── Chart type switching ─────────────────────────────────────────────
    // When chartType changes, hide the currently active series and show the
    // new one. Data is forwarded from candles so the switch is instant.
    useEffect(() => {
        const chart = chartRef.current;
        const cs = candleSeriesRef.current;
        const ls = lineSeriesRef.current;
        const as_ = areaSeriesRef.current;
        const bs = baselineSeriesRef.current;
        const bars = barSeriesRef.current;
        if (!chart || !cs) return;

        const toSec = (ts: number) => Math.floor(ts / 1000) as UTCTimestamp;
        const closePts = candles
            .filter((c, i, arr) => i === arr.findIndex((x) => x.timestamp === c.timestamp))
            .map((c) => ({ time: toSec(c.timestamp), value: c.close }));
        const barPts = candles
            .filter((c, i, arr) => i === arr.findIndex((x) => x.timestamp === c.timestamp))
            .map((c) => ({ time: toSec(c.timestamp), open: c.open, high: c.high, low: c.low, close: c.close }));

        if (ls) { try { ls.setData(closePts); } catch { /* chart not ready */ } }
        if (as_) { try { as_.setData(closePts); } catch { /* chart not ready */ } }
        if (bs) {
            const mid = candles.length > 0 ? candles.reduce((sum, c) => sum + c.close, 0) / candles.length : 0;
            try {
                bs.applyOptions({ baseValue: { type: "price", price: mid } });
                bs.setData(closePts);
            } catch { /* chart not ready */ }
        }
        if (bars) { try { bars.setData(barPts); } catch { /* chart not ready */ } }

        // Publish which price series is on screen BEFORE the early return:
        // overlays (countdown line, AI plan) attach to this ref, and on the
        // very first pass the type is already correct yet still unassigned.
        activePriceSeriesRef.current =
            chartType === "line" ? ls
            : chartType === "area" ? as_
            : chartType === "baseline" ? bs
            : chartType === "bar" ? bars
            : cs;

        if (activeSeriesTypeRef.current === chartType) return;
        try {
            cs.applyOptions({ visible: chartType === "candlestick" });
            ls?.applyOptions({ visible: chartType === "line" });
            as_?.applyOptions({ visible: chartType === "area" });
            bs?.applyOptions({ visible: chartType === "baseline" });
            bars?.applyOptions({ visible: chartType === "bar" });
            activeSeriesTypeRef.current = chartType;
        } catch { /* chart not ready */ }
    }, [chartType, candles]);

    // ── Drawing tool event handlers ──────────────────────────────────────
    // The SVG overlay sits on top of the chart. When a drawing tool (not
    // "select") is active, we intercept pointer events and map pixel
    // coordinates to chart price/time via the lightweight-charts API.
    useEffect(() => {
        const container = containerRef.current;
        const chart = chartRef.current;
        if (!container || !chart) return;

        const getCoords = (e: PointerEvent | MouseEvent) => {
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            return { x, y };
        };

        const pixelToPrice = (x: number, y: number): number => {
            try {
                const cs = candleSeriesRef.current;
                if (!cs) return 0;
                const raw = cs.coordinateToPrice(y) ?? 0;
                // Magnet: snap to the nearest open/high/low/close of the
                // candle under the cursor so the drawing lands on a real
                // price. Only applies to price-anchored tools — the ruler
                // must keep measuring exact pixel distances.
                const tool = activeDrawingToolRef.current;
                if (!cfgRef.current.display.magnet || !MAGNET_TOOLS.has(tool)) return raw;
                const ts = chart.timeScale().coordinateToTime(x);
                if (!ts) return raw;
                const idx = barIndexForTime(
                    candlesMirrorRef.current,
                    (ts as number) * 1000,
                    intervalMsRef.current
                );
                const candle = candlesMirrorRef.current[idx];
                return snapToOHLC(candle, raw) ?? raw;
            } catch { return 0; }
        };

        const pixelToTime = (x: number): number => {
            try {
                const ts = chart.timeScale().coordinateToTime(x);
                // lightweight-charts returns null when x lands in a whitespace
                // area or before the first bar. Date.now() can never be
                // resolved back to a candle, so fall back to the nearest
                // real candle in the mirror so every drawing keeps a
                // timeToCoordinate-resolvable timestamp.
                if (ts) return (ts as number) * 1000;

                const idx = barIndexForTime(
                    candlesMirrorRef.current,
                    Date.now(),
                    intervalMsRef.current
                );
                const candle = candlesMirrorRef.current[idx];
                return candle?.timestamp ?? Date.now();
            } catch { return candlesMirrorRef.current[0]?.timestamp ?? Date.now(); }
        };

        /** Newest-first hit test: which placed drawing is under the cursor? */
        const hitTestAt = (x: number, y: number, w: number, h: number): DrawingItem | null => {
            const cs = candleSeriesRef.current;
            if (!cs) return null;
            const priceToY = (p: number) => {
                try { return cs.priceToCoordinate(p) ?? 0; } catch { return 0; }
            };
            const timeToX = (t: number) => {
                try {
                    return chart.timeScale().timeToCoordinate(Math.floor(t / 1000) as UTCTimestamp) ?? 0;
                } catch { return 0; }
            };
            const fontSize = cfgRef.current.tools.fontSize;
            const list = drawingsRef.current;
            for (let i = list.length - 1; i >= 0; i--) {
                const d = list[i];
                if (d.points.length < 2) continue;
                const p1 = d.points[0];
                const p2 = d.points[1];
                const geom: DrawingGeom = {
                    x1: p1.time ? timeToX(p1.time) : 0,
                    y1: priceToY(p1.price),
                    x2: p2.time ? timeToX(p2.time) : w,
                    y2: priceToY(p2.price),
                    width: w,
                    height: h,
                    fontSize,
                    label: d.label,
                };
                if (hitTestDrawing(d.type, geom, x, y)) return d;
            }
            return null;
        };

        const handlePointerDown = (e: PointerEvent) => {
            const tool = activeDrawingToolRef.current;
            if (tool === "select") {
                // Select tool: hit-test the placed drawings (newest on top)
                // so a single object can be selected → restyled / renamed /
                // deleted. Empty space keeps normal pan behaviour and drops
                // the selection.
                const rect = container.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const hit = hitTestAt(sx, sy, rect.width, rect.height);
                if (hit) {
                    // Run in capture phase so the chart canvas does not start
                    // its own pan/scale gesture before the drawing drag begins.
                    e.preventDefault();
                    e.stopPropagation();
                    const now = Date.now();
                    const last = lastSelectClickRef.current;
                    const isDouble = last?.id === hit.id && now - last.at < 450;
                    lastSelectClickRef.current = { id: hit.id, at: now };
                    setSelectedDrawingId(hit.id);
                    // Start drag-to-move on selected drawing
                    const pointerStartPrice = pixelToPrice(sx, sy);
                    const pointerStartTime = pixelToTime(sx);
                    drawingInProgressRef.current = {
                        tool: "select",
                        startX: sx, startY: sy,
                        startPrice: pointerStartPrice,
                        startTime: pointerStartTime,
                        curX: sx, curY: sy,
                        moveId: hit.id,
                        pointerStartPrice,
                        pointerStartTime,
                    };
                    try {
                        container.setPointerCapture(e.pointerId);
                    } catch {
                        // Pointer capture can fail for synthetic or stale events.
                    }
                    if (isDouble && hit.type === "text") {
                        setTextEdit({ id: hit.id, value: hit.label ?? "" });
                    }
                    return;
                } else {
                    lastSelectClickRef.current = null;
                    setSelectedDrawingId(null);
                }
                return;
            }
            // Active drawing tools own the gesture; suppress canvas pan/scale
            // before the event reaches lightweight-charts target listeners.
            e.preventDefault();
            e.stopPropagation();
            const { x, y } = getCoords(e);
            drawingInProgressRef.current = {
                tool,
                startX: x, startY: y,
                startPrice: pixelToPrice(x, y),
                startTime: pixelToTime(x),
                curX: x, curY: y,
            };
            setDrawingPreview({ ...drawingInProgressRef.current });
            try {
                container.setPointerCapture(e.pointerId);
            } catch {
                // No active pointer (synthetic/racing events) — pointer events
                // still track while they remain over the chart container.
            }
        };

        const handlePointerMove = (e: PointerEvent) => {
            const dp = drawingInProgressRef.current;
            if (!dp) return;
            e.stopPropagation();
            const { x, y } = getCoords(e);
            dp.curX = x;
            dp.curY = y;
            e.preventDefault();
            e.stopPropagation();
            if (dp.moveId) {
                // Render a temporary, market-coordinate translation from the
                // original anchors; do not accumulate deltas frame by frame.
                const deltaPrice = pixelToPrice(x, y) - (dp.pointerStartPrice ?? dp.startPrice);
                const deltaTimeMs = pixelToTime(x) - (dp.pointerStartTime ?? dp.startTime);
                setDrawingPreview(null);
                setDrawingElements(drawingsRef.current.map((drawing) =>
                    drawing.id === dp.moveId
                        ? translateDrawingByMarketDelta(drawing, deltaTimeMs, deltaPrice)
                        : drawing
                ));
            } else {
                setDrawingPreview({ ...dp });
            }
        };

        const handlePointerUp = (e: PointerEvent) => {
            const dp = drawingInProgressRef.current;
            if (!dp) return;
            e.stopPropagation();
            const { x, y } = getCoords(e);
            dp.curX = x;
            dp.curY = y;
            e.preventDefault();
            e.stopPropagation();
            const endPrice = pixelToPrice(x, y);
            const endTime = pixelToTime(x);

            // Only add if the drag moved enough (filter accidental clicks).
            const dist = Math.hypot(dp.curX - dp.startX, dp.curY - dp.startY);
            if (dp.moveId) {
                const deltaPrice = endPrice - (dp.pointerStartPrice ?? dp.startPrice);
                const deltaTimeMs = endTime - (dp.pointerStartTime ?? dp.startTime);
                const current = drawingsRef.current;
                const moved = current.map((drawing) =>
                    drawing.id === dp.moveId
                        ? translateDrawingByMarketDelta(drawing, deltaTimeMs, deltaPrice)
                        : drawing
                );
                commitDrawings(moved);
                drawingInProgressRef.current = null;
                setDrawingPreview(null);
                setSelectedDrawingId(dp.moveId);
                return;
            }
            if (dist > 4 || dp.tool === "horizontal" || dp.tool === "text") {
                // Capture the user's current tool style (color + width from
                // the settings panel) so each drawing keeps its own look.
                const toolStyle = cfgRef.current.tools;
                const newDrawing: DrawingItem = {
                    id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    type: dp.tool,
                    points: [
                        { time: dp.startTime, price: dp.startPrice },
                        { time: endTime, price: endPrice },
                    ],
                    color: toolStyle.color,
                    width: toolStyle.lineWidth,
                    lineStyle: toolStyle.lineStyle,
                    ...(dp.tool === "text" ? { label: "" } : {}),
                };
                commitDrawings([...drawingsRef.current, newDrawing]);
                setSelectedDrawingId(newDrawing.id);
                // Text tool: open the inline label editor immediately so the
                // user types the label instead of getting a placeholder.
                if (dp.tool === "text") {
                    setTextEdit({ id: newDrawing.id, value: "" });
                }
            }
            drawingInProgressRef.current = null;
            setDrawingPreview(null);
        };

        const handlePointerCancel = () => {
            if (!drawingInProgressRef.current) return;
            drawingInProgressRef.current = null;
            setDrawingPreview(null);
            setDrawingElements(drawingsRef.current);
        };

        // Capture-phase routing is essential: lightweight-charts attaches its
        // gesture handlers to the canvas target, which runs before bubble-phase
        // listeners on this container. Select-on-empty still propagates, so
        // native chart panning remains available in the select tool.
        const capture = true;
        container.addEventListener("pointerdown", handlePointerDown, capture);
        container.addEventListener("pointermove", handlePointerMove, capture);
        container.addEventListener("pointerup", handlePointerUp, capture);
        container.addEventListener("pointercancel", handlePointerCancel, capture);
        return () => {
            container.removeEventListener("pointerdown", handlePointerDown, capture);
            container.removeEventListener("pointermove", handlePointerMove, capture);
            container.removeEventListener("pointerup", handlePointerUp, capture);
            container.removeEventListener("pointercancel", handlePointerCancel, capture);
        };
    }, [commitDrawings]);

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
            lineSeriesRef.current?.setData([]);
            areaSeriesRef.current?.setData([]);
            baselineSeriesRef.current?.setData([]);
            barSeriesRef.current?.setData([]);
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
                    const prependCount = countPrependedBars(bars, firstPushedTimeRef.current!);
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
        const previousStableCount = Math.max(0, Math.min(previousCandles.length, candles.length) - 1);
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
        // This layer is explicitly BOS / CHoCH. Swing-point classifications
        // belong in a separate layer; including them here duplicates a label
        // on most pivots and makes the price pane unreadable at normal zoom.
        return (layer.getEventMarkers?.(structCandles) ?? []).filter(
            (marker) => marker.text === "BOS" || marker.text === "CHOCH",
        );
    }, [layers.bosChoch, candles, symbol, timeframe]);

    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        if (!structureMarkersRef.current) {
            structureMarkersRef.current = createSeriesMarkers(cs, []);
        }
        if (!structureMarkers || structureMarkers.length === 0) {
            structureMarkersRef.current.setMarkers([]);
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
        structureMarkersRef.current?.setMarkers(markers);
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

    // ── BID / ASK lines ─────────────────────────────────────────────────
    // BID = the real-time quote, falling back to the last rendered close
    // (the feed's own current price). ASK renders only when a real ask is
    // supplied — the chart never invents the other side of the spread.
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        for (const l of bidAskLinesRef.current) {
            try {
                cs.removePriceLine(l);
            } catch {
                // line already gone with the series
            }
        }
        bidAskLinesRef.current = [];
        if (!cfg.display.bidAsk) return;
        const bid = quote?.bid ?? (candles.length > 0 ? candles[candles.length - 1].close : null);
        const ask = quote?.ask ?? null;
        const lines: IPriceLine[] = [];
        if (bid !== null && Number.isFinite(bid)) {
            lines.push(
                cs.createPriceLine({
                    price: bid,
                    color: cfg.colors.bidLine,
                    lineWidth: 1,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: "BID",
                })
            );
        }
        if (ask !== null && Number.isFinite(ask)) {
            lines.push(
                cs.createPriceLine({
                    price: ask,
                    color: cfg.colors.askLine,
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: quote?.spreadEstimated ? "ASK ≈" : "ASK",
                })
            );
        }
        bidAskLinesRef.current = lines;
    }, [cfg, quote, candles]);

    // ── Bar-close countdown line (moves with the live candle) ───────────
    // Rendered as a price line on the ACTIVE series so it tracks the forming
    // candle exactly like BID/ASK does — the label rides the price axis and
    // the line follows the last price instead of sitting in a fixed corner.
    // lightweight-charts cannot restyle a price line in place, so the line is
    // rebuilt once per second: one create + one remove per tick is cheap and
    // keeps a single source of truth (the shared clock).
    useEffect(() => {
        // Remove from the series that OWNS the line — the active series can
        // have changed since the line was created (chart-type switch).
        const prev = countdownLineOwnerRef.current;
        if (prev) {
            for (const l of prev.lines) {
                try {
                    prev.series.removePriceLine(l);
                } catch {
                    // series already gone
                }
            }
        }
        countdownLinesRef.current = [];
        countdownLineOwnerRef.current = null;

        const series = activePriceSeriesRef.current;
        if (!series || !cfg.display.showBarCloseCountdown) return;
        const last = candles[candles.length - 1];
        if (!last || !Number.isFinite(last.close) || last.close <= 0) return;

        const line = series.createPriceLine({
                // Follows the live quote when one is known, otherwise the last
                // rendered close — the same price the candle is drawing at.
                price: quote?.bid ?? last.close,
                color: cfg.colors.countdownLine,
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                // "00:04:31" — always zero-padded HH:MM:SS.
                title: countdownLabel,
        });
        countdownLinesRef.current = [line];
        countdownLineOwnerRef.current = { series, lines: [line] };
    }, [countdownLabel, candles, quote, cfg, chartType]);

    // ── Trade levels: open positions + pending orders ────────────────────
    // MT5-style level lines on the price pane: a solid entry line coloured
    // by side (with the lot size on the axis) plus dashed SL/TP lines, and
    // dotted buy/sell limit & stop lines for pending orders.
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        for (const l of tradeLinesRef.current) {
            try {
                cs.removePriceLine(l);
            } catch {
                // line already gone with the series
            }
        }
        tradeLinesRef.current = [];
        if (!cfg.display.tradeLevels) return;

        const vol = (v?: number) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "");
        // `ChartPositionView.profit` is the declared field for live P/L. The
        // `unrealized` spelling is tolerated because some hosts feed a broker
        // position object straight through — but it is read off an optional,
        // explicitly-typed alias rather than via an untyped cast, so a rename
        // of the declared field cannot silently disable the label.
        const liveProfitOf = (p: ChartPositionView & { unrealized?: number }): number | null => {
            const value = p.unrealized ?? p.profit;
            return typeof value === "number" && Number.isFinite(value) ? value : null;
        };
        const livePnL = (p: ChartPositionView & { unrealized?: number }) => {
            const value = liveProfitOf(p);
            if (value === null) return "";
            return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USD`;
        };
        const lines: IPriceLine[] = [];
        const stopLine = (price: number, volume: number | undefined, kind: "SL" | "TP", pnl?: string) =>
            cs.createPriceLine({
                price,
                color: kind === "SL" ? cfg.colors.slLine : cfg.colors.tpLine,
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: `${kind} ${vol(volume)}${pnl ? ` · ${pnl}` : ""}`.trim(),
            });

        for (const p of symbolPositions) {
            const pn = livePnL(p);
            // With no live P/L there is nothing to colour by — default to the
            // winning tint rather than claiming a loss the data does not show.
            const liveValue = liveProfitOf(p);
            const isWin = liveValue === null ? true : liveValue >= 0;
            lines.push(
                cs.createPriceLine({
                    price: p.entry,
                    color: isWin ? cfg.colors.tpLine : cfg.colors.slLine,
                    lineWidth: 2,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: `${p.side} ${vol(p.volume)} ${pn}`.trim(),
                })
            );
            if (p.sl != null && Number.isFinite(p.sl) && p.sl > 0) lines.push(stopLine(p.sl, p.volume, "SL", pn));
            if (p.tp != null && Number.isFinite(p.tp) && p.tp > 0) lines.push(stopLine(p.tp, p.volume, "TP", pn));
        }

        for (const o of symbolOrders) {
            lines.push(
                cs.createPriceLine({
                    price: o.price,
                    color: cfg.colors.pendingLine,
                    lineWidth: 2,
                    lineStyle: LineStyle.Dotted,
                    axisLabelVisible: true,
                    title: `${o.type.replace("_", " ")} ${vol(o.volume)}`.trim(),
                })
            );
            if (o.sl != null && Number.isFinite(o.sl) && o.sl > 0) lines.push(stopLine(o.sl, o.volume, "SL"));
            if (o.tp != null && Number.isFinite(o.tp) && o.tp > 0) lines.push(stopLine(o.tp, o.volume, "TP"));
        }

        tradeLinesRef.current = lines;
    }, [cfg, symbolPositions, symbolOrders]);

    // ── Trade history markers (real entry/exit fills) ─────────────────────
    // Fills whose timestamps fall outside the loaded window are skipped —
    // markers are never placed at a time the chart cannot resolve.
    const historyKey = tradeHistory
        .map((f) => `${f.id}:${f.time}:${f.price}:${f.kind}:${f.side}:${f.label ?? ""}:${f.profit ?? ""}`)
        .join("|");
    useEffect(() => {
        const cs = candleSeriesRef.current;
        if (!cs) return;
        const api = historyMarkersRef.current;
        if (!cfg.display.historyMarkers || tradeHistory.length === 0 || candles.length === 0) {
            api?.setMarkers([]);
            return;
        }
        const visible = new Set(candles.map((c) => Math.floor(c.timestamp / 1000)));
        const markers: SeriesMarker<Time>[] = [];
        for (const f of tradeHistory) {
            if (f.symbol && f.symbol !== symbol) continue;
            const t = Math.floor(f.time / 1000);
            if (!visible.has(t)) continue;
            const price = fmtPrice(f.price, symbol);
            if (f.kind === "entry" && f.side !== "unknown") {
                const long = f.side === "buy";
                markers.push({
                    time: t as UTCTimestamp,
                    position: long ? "belowBar" : "aboveBar",
                    shape: long ? "arrowUp" : "arrowDown",
                    color: long ? cfg.colors.buyEntry : cfg.colors.sellEntry,
                    size: 2,
                    text: `${f.label ?? (long ? "BUY" : "SELL")} ${price}`,
                });
            } else {
                // Exits (and entries whose direction the log never recorded)
                // render as neutral shapes — direction is not guessed.
                const profit = f.profit ?? null;
                markers.push({
                    time: t as UTCTimestamp,
                    position: "aboveBar",
                    shape: f.kind === "partial" ? "circle" : "square",
                    color:
                        profit === null
                            ? "#94a3b8"
                            : profit >= 0
                                ? cfg.colors.tpLine
                                : cfg.colors.slLine,
                    size: 2,
                    text: `${f.label ?? (f.kind === "partial" ? "PARTIAL" : "CLOSE")} ${price}`,
                });
            }
        }
        markers.sort((a, b) => (a.time as number) - (b.time as number));
        if (api) {
            api.setMarkers(markers);
        } else if (markers.length > 0) {
            historyMarkersRef.current = createSeriesMarkers(cs, markers);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cfg, historyKey, candles, symbol]);

    // ── AI draw rendering (Pro) ────────────────────────────────────────────
    // Publish the current plan to listeners, then draw its levels + a
    // direction arrow on the live bar. Keyed on the plan value signature so
    // quote ticks do not rebuild the lines between candle changes.
    useEffect(() => {
        const plan = aiDraw ? aiPlan : null;
        onAiPlanChangeRef.current?.(plan);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aiDraw, aiPlanKey]);    useEffect(() => {
        const activeType = activeSeriesTypeRef.current;
        const linesRef = (
            activeType === "line" ? lineSeriesRef
            : activeType === "area" ? areaSeriesRef
            : activeType === "baseline" ? baselineSeriesRef
            : activeType === "bar" ? barSeriesRef
            : candleSeriesRef
        );
        const cs = linesRef.current;
        if (!cs) return;
        for (const l of aiPlanLinesRef.current) {
            try {
                cs.removePriceLine(l);
            } catch {
                // line already gone with the series
            }
        }
        aiPlanLinesRef.current = [];

        const plan = aiDraw ? aiPlan : null;
        if (!plan) {
            aiDrawMarkersRef.current?.setMarkers([]);
            return;
        }

        const lines: IPriceLine[] = [];
        const sideWord = plan.direction === "long" ? "LONG" : "SHORT";
        for (const lvl of aiDrawLevels(plan)) {
            const isRef = lvl.key === "support" || lvl.key === "resistance";
            const color =
                lvl.key === "entry"
                    ? plan.direction === "long"
                        ? cfg.colors.buyEntry
                        : cfg.colors.sellEntry
                    : lvl.key === "sl"
                        ? cfg.colors.slLine
                        : lvl.key === "tp1" || lvl.key === "tp2"
                            ? cfg.colors.tpLine
                            : cfg.colors.aiLine;
            lines.push(
                cs.createPriceLine({
                    price: lvl.price,
                    color,
                    lineWidth: isRef ? 1 : 2,
                    lineStyle: isRef ? LineStyle.Dotted : lvl.key === "entry" ? LineStyle.Solid : LineStyle.Dashed,
                    axisLabelVisible: !isRef,
                    // MT5-style tags on the price scale: the entry line carries
                    // the direction so the scale alone tells you which way the
                    // plan is pointing ("AI LONG · ENTRY").
                    title: lvl.key === "entry" ? `AI ${sideWord} · ENTRY` : lvl.label,
                })
            );
        }
        aiPlanLinesRef.current = lines;

        // The direction label is drawn as a chat-box badge in the SVG overlay
        // (below), not as a chart marker: lightweight-charts markers can only
        // render a bare shape plus loose text, which reads as a raw arrow.
        aiDrawMarkersRef.current?.setMarkers([]);
        aiDrawMarkersRef.current = null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aiPlanKey, aiDraw, cfg]);

    // ── View reset (toolbar "Fit") ────────────────────────────────────
    // Refits the time axis and re-enables the price auto-scale (when the
    // user hasn't deliberately locked it). Respects the free-move setting.
    useEffect(() => {
        if (!fitSignal) return;
        const chart = chartRef.current;
        if (!chart) return;
        try {
            if (cfgRef.current.display.autoScale) {
                chart.priceScale("right").applyOptions({ autoScale: true });
            }
            chart.timeScale().fitContent();
        } catch {
            // chart not ready
        }
    }, [fitSignal]);

    // ── Event → chart navigation (Phase 5 §32) ────────────────────────────
    // The request may arrive before the new symbol's candles have loaded, so
    // it is held pending and applied on the first render that has data. That
    // is what makes "click the BOS in the feed" land on the right bar instead
    // of being wiped out by the post-load fit.
    useEffect(() => {
        if (!focusRequest || !focusRequest.seq) return;
        pendingFocusRef.current = focusRequest;
    }, [focusRequest]);

    useEffect(() => {
        const pending = pendingFocusRef.current;
        if (!pending || candles.length === 0) return;
        const chart = chartRef.current;
        if (!chart) return;
        pendingFocusRef.current = null;
        try {
            const spanMs = isChartTimeframe(timeframe) ? TIMEFRAME_MS[timeframe] : TIMEFRAME_MS.M5;
            const half = Math.max(300, Math.floor((spanMs * 12) / 1000));
            const centre = Math.floor(pending.time / 1000);
            chart.timeScale().setVisibleRange({
                from: (centre - half) as UTCTimestamp,
                to: (centre + half) as UTCTimestamp,
            });

            const cs = candleSeriesRef.current;
            if (cs) {
                for (const l of focusLineRef.current) {
                    try {
                        cs.removePriceLine(l);
                    } catch {
                        // line already gone with the series
                    }
                }
                focusLineRef.current = [];
                if (typeof pending.price === "number" && Number.isFinite(pending.price)) {
                    focusLineRef.current = [
                        cs.createPriceLine({
                            price: pending.price,
                            color: cfgRef.current.colors.aiLine,
                            lineWidth: 2,
                            lineStyle: LineStyle.Dashed,
                            axisLabelVisible: true,
                            title: pending.label ?? "Event",
                        }),
                    ];
                }
            }
        } catch {
            // chart not ready — the next data render retries from the pending ref
        }
    }, [focusRequest?.seq, candles.length, timeframe]);

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
            upColor: cfg.colors.bull,
            downColor: cfg.colors.bear,
            borderUpColor: cfg.colors.bull,
            borderDownColor: cfg.colors.bear,
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

            {/* AI draw readout (Pro) — plan derived from this chart's own candles. */}
            {aiDraw ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-violet-500/[0.04] px-3 py-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-violet-400">
                        ✦ AI DRAW
                    </span>
                    {aiPlan ? (
                        <>
                            <span
                                className={cn(
                                    "font-mono text-[10px] font-bold",
                                    aiPlan.direction === "long" ? "text-emerald-400" : "text-rose-400"
                                )}
                            >
                                {aiPlan.direction === "long" ? "LONG" : "SHORT"}
                            </span>
                            <span className="font-mono text-muted-foreground">
                                ENTRY <span className="text-foreground">{fmtPrice(aiPlan.entry, symbol)}</span>
                                {" · "}SL <span className="text-rose-400">{fmtPrice(aiPlan.sl, symbol)}</span>
                                {" · "}TP1 <span className="text-emerald-400">{fmtPrice(aiPlan.tp1, symbol)}</span>
                                {" · "}TP2 <span className="text-emerald-400">{fmtPrice(aiPlan.tp2, symbol)}</span>
                                {aiPlan.tp3 !== undefined ? ` · TP3 ${fmtPrice(aiPlan.tp3, symbol)}` : ""}
                                {aiPlan.tp4 !== undefined ? ` · TP4 ${fmtPrice(aiPlan.tp4, symbol)}` : ""}
                                {aiPlan.tp5 !== undefined ? ` · TP5 ${fmtPrice(aiPlan.tp5, symbol)}` : ""}
                                {" · "}R:R {aiPlan.rr1.toFixed(1)}/{aiPlan.rr2.toFixed(1)}
                                {aiPlan.rr3 !== undefined ? `/${aiPlan.rr3.toFixed(1)}` : ""}
                                {aiPlan.rr4 !== undefined ? `/${aiPlan.rr4.toFixed(1)}` : ""}
                                {aiPlan.rr5 !== undefined ? `/${aiPlan.rr5.toFixed(1)}` : ""}
                            </span>
                            <span
                                className="hidden truncate text-[10px] text-muted-foreground lg:inline"
                                title={aiPlan.evidence.join(" · ")}
                            >
                                {aiPlan.evidence.slice(0, 2).join(" · ")}
                            </span>
                            <span className="text-[10px] text-muted-foreground/70">
                                derived from this chart&apos;s candles · not financial advice
                            </span>
                        </>
                    ) : (
                        <span className="text-muted-foreground">
                            Insufficient candle data to anchor levels — nothing drawn.
                        </span>
                    )}
                </div>
            ) : null}

            {/* AI overlay readout — mirrors what the AI engine handed to the chart. */}
            {aiOverlay ? (
                <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-violet-400">
                        ✦ AI {aiOverlay.kind === "strategy" ? "strategy" : "indicator"}
                    </span>
                    <span className="font-medium text-foreground">{aiOverlay.name}</span>
                    {aiOverlay.status === "loading" ? (
                        <span className="text-muted-foreground">computing…</span>
                    ) : aiOverlay.status === "error" ? (
                        <span className="text-rose-400" title={aiOverlay.error}>{aiOverlay.error ?? "failed"}</span>
                    ) : (
                        <>
                            {(aiOverlay.series ?? []).map((s) => (
                                <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                                    {s.label}
                                </span>
                            ))}
                            {(aiOverlay.signals ?? []).length > 0 ? (
                                <span className="rounded-full border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                    {aiOverlay.signals!.length} signal{(aiOverlay.signals ?? []).length !== 1 ? "s" : ""}
                                </span>
                            ) : null}
                        </>
                    )}
                </div>
            ) : null}

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
                <div
                    ref={containerRef}
                    className="absolute inset-0"
                    style={{ cursor: activeDrawingTool !== "select" ? "crosshair" : "default" }}
                />

                {/* SVG Drawing overlay — renders committed drawings + live preview */}
                <svg
                    ref={svgOverlayRef}
                    className="pointer-events-none absolute inset-0 z-30 overflow-visible"
                    width={containerSize.w}
                    height={containerSize.h}
                    style={{ opacity: containerSize.w > 0 ? 1 : 0 }}
                >
                    <defs>
                        <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
                            <polygon points="0 0, 10 3, 0 6" fill="#38bdf8" />
                        </marker>
                        <marker id="arrow-red" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
                            <polygon points="0 0, 10 3, 0 6" fill="#f43f5e" />
                        </marker>
                    </defs>
                    {/* Render committed drawings */}
                    {drawingElements.map((d) => {
                        const chart = chartHandles?.chart ?? null;
                        const cs = chartHandles?.cs ?? null;
                        if (!chart || !cs || d.points.length < 2) return null;

                        const priceToY = (price: number): number => {
                            try { return cs.priceToCoordinate(price) ?? 0; } catch { return 0; }
                        };
                        const timeToX = (timeMs: number): number => {
                            try {
                                const sec = Math.floor(timeMs / 1000) as UTCTimestamp;
                                return chart.timeScale().timeToCoordinate(sec) ?? 0;
                            } catch { return 0; }
                        };

                        const p1 = d.points[0];
                        const p2 = d.points[1];
                        const x1 = p1.time ? timeToX(p1.time) : 0;
                        const y1 = priceToY(p1.price);
                        const x2 = p2.time ? timeToX(p2.time) : containerSize.w;
                        const y2 = priceToY(p2.price);
                        const color = d.color ?? cfg.tools.color;
                        const width = d.width ?? cfg.tools.lineWidth;
                        const lineStyle = (d.lineStyle ?? cfg.tools.lineStyle) as "solid" | "dashed" | "dotted";
                        const dash = lineStyle === "dashed" ? "6,3" : lineStyle === "dotted" ? "2,3" : "none";
                        const labelSize = Math.max(8, cfg.tools.fontSize - 3);

                        if (d.type === "horizontal") {
                            return (
                                <g key={d.id}>
                                    <line x1={0} y1={y1} x2={containerSize.w} y2={y1} stroke={color} strokeWidth={width} strokeDasharray={dash === "none" ? undefined : dash} />
                                    <text x={4} y={y1 - 4} fill={color} fontSize={cfg.tools.fontSize} fontFamily="monospace">{fmtPrice(p1.price, symbol)}</text>
                                </g>
                            );
                        }
                        if (d.type === "vertical") {
                            return (
                                <g key={d.id}>
                                    <line x1={x1} y1={0} x2={x1} y2={containerSize.h} stroke={color} strokeWidth={width} strokeDasharray={dash === "none" ? undefined : dash} />
                                </g>
                            );
                        }
                        if (d.type === "trendline" || d.type === "ray") {
                            return (
                                <line key={d.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeDasharray={dash === "none" ? undefined : dash} markerEnd={d.type === "ray" ? "url(#arrow)" : undefined} />
                            );
                        }
                        if (d.type === "arrow") {
                            // Arrow drawing: line from p1 to p2 with arrowhead at p2
                            return (
                                <g key={d.id}>
                                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeDasharray={dash === "none" ? undefined : dash} markerEnd="url(#arrow)" />
                                    <polygon points={`${x2},${y2 - 4} ${x2 - 4},${y2 + 3} ${x2 + 4},${y2 + 3}`} fill={color} opacity={0.85} />
                                </g>
                            );
                        }
                        if (d.type === "rectangle") {
                            const rx = Math.min(x1, x2);
                            const ry = Math.min(y1, y2);
                            const rw = Math.abs(x2 - x1);
                            const rh = Math.abs(y2 - y1);
                            return (
                                <rect key={d.id} x={rx} y={ry} width={rw} height={rh} stroke={color} strokeWidth={width} fill={`${color}18`} />
                            );
                        }
                        if (d.type === "fibo") {
                            const levels = cfg.tools.fiboLevels;
                            const priceDiff = p2.price - p1.price;
                            return (
                                <g key={d.id}>
                                    {levels.map((lvl) => {
                                        const price = p1.price + priceDiff * lvl;
                                        const yLvl = priceToY(price);
                                        return (
                                            <g key={lvl}>
                                                <line x1={Math.min(x1, x2)} y1={yLvl} x2={Math.max(x1, x2)} y2={yLvl} stroke={color} strokeWidth={1} strokeDasharray="4,3" opacity={0.8} />
                                                <text x={Math.max(x1, x2) + 4} y={yLvl + 4} fill={color} fontSize={labelSize} fontFamily="monospace">{(lvl * 100).toFixed(1)}%</text>
                                            </g>
                                        );
                                    })}
                                </g>
                            );
                        }
                        if (d.type === "ruler") {
                            const priceDiff = Math.abs(p2.price - p1.price);
                            const pips = priceDiff.toFixed(2);
                            return (
                                <g key={d.id}>
                                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeDasharray={dash === "none" ? undefined : dash} />
                                    <line x1={x1} y1={y1} x2={x1} y2={y2} stroke={color} strokeWidth={1} opacity={0.5} />
                                    <line x1={x1} y1={y2} x2={x2} y2={y2} stroke={color} strokeWidth={1} opacity={0.5} />
                                    <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 4} fill={color} fontSize={labelSize} fontFamily="monospace" textAnchor="middle">Δ {pips}</text>
                                </g>
                            );
                        }
                        if (d.type === "text") {
                            // Empty label = mid-edit or cancelled — the inline
                            // input is the visible editor for it.
                            if (!d.label) return null;
                            return (
                                <text key={d.id} x={x1} y={y1} fill={color} fontSize={cfg.tools.fontSize} fontFamily="monospace" fontWeight="bold">{d.label}</text>
                            );
                        }
                        return null;
                    })}

                    {/* Selection outline + endpoint handles for the selected drawing */}
                    {selectedDrawing && selPos ? (() => {
                        const d = selectedDrawing;
                        const pos = selPos;
                        let box: { x: number; y: number; w: number; h: number };
                        if (d.type === "horizontal") {
                            box = { x: 0, y: pos.y1 - 7, w: containerSize.w, h: 14 };
                        } else if (d.type === "vertical") {
                            box = { x: pos.x1 - 7, y: 0, w: 14, h: containerSize.h };
                        } else {
                            const minX = Math.min(pos.x1, pos.x2);
                            const maxX = Math.max(pos.x1, pos.x2);
                            const minY = Math.min(pos.y1, pos.y2);
                            const maxY = Math.max(pos.y1, pos.y2);
                            box = {
                                x: minX - 7,
                                y: minY - 7,
                                w: Math.max(14, maxX - minX + 14),
                                h: Math.max(14, maxY - minY + 14),
                            };
                        }
                        const withPoints =
                            d.type !== "horizontal" && d.type !== "vertical" && d.type !== "text";
                        return (
                            <g>
                                <rect
                                    x={box.x}
                                    y={box.y}
                                    width={box.w}
                                    height={box.h}
                                    rx={4}
                                    fill="none"
                                    stroke="#38bdf8"
                                    strokeWidth={1}
                                    strokeDasharray="4,3"
                                    opacity={0.9}
                                />
                                {withPoints ? (
                                    <>
                                        <circle cx={pos.x1} cy={pos.y1} r={3.5} fill="#38bdf8" />
                                        <circle cx={pos.x2} cy={pos.y2} r={3.5} fill="#38bdf8" />
                                    </>
                                ) : null}
                            </g>
                        );
                    })() : null}

                    {/* AI direction badge — a chat-box style tag anchored to the
                        entry line, the way TradingView/MT5 label a position.
                        `viewportTick` is read here purely to re-derive the pixel
                        coordinates after a pan or zoom. */}
                    {aiDraw && aiPlan && chartHandles?.chart && chartHandles.cs
                        ? (() => {
                            const chart = chartHandles.chart!;
                            const cs = chartHandles.cs!;
                            let entryY: number;
                            let x: number;
                            try {
                                entryY = cs.priceToCoordinate(aiPlan.entry) ?? 0;
                                x = chart.timeScale().timeToCoordinate(
                                    Math.floor(aiPlan.anchorTime / 1000) as UTCTimestamp
                                ) ?? 0;
                            } catch {
                                return null;
                            }
                            if (!Number.isFinite(entryY) || !Number.isFinite(x)) return null;

                            const isLong = aiPlan.direction === "long";
                            // LONG wears the bullish colour so it reads green like
                            // the up candles; SHORT keeps the sell colour. Both come
                            // from the user's own colour settings, so the tag always
                            // matches the candles it sits on.
                            const accent = isLong ? cfg.colors.bull : cfg.colors.sellEntry;
                            // TradingView-style compact tag: a solid pill carrying a
                            // direction triangle and the lowercase word, the way a
                            // broker terminal marks a trade. The numbers live in the
                            // AI Draw panel above the chart, so the tag stays small.
                            const label = isLong ? "long" : "short";
                            const ink = contrastText(accent);
                            const pillW = 58;
                            const pillH = 18;
                            const gap = 10;
                            // SHORT labels sit ABOVE the entry, LONG below: the tag
                            // always sits on the side the trade moves toward, so it
                            // never covers the level it marks.
                            const pillY = isLong ? entryY + gap : entryY - gap - pillH;
                            const pillX = Math.max(2, Math.min(containerSize.w - pillW - 2, x - pillW / 2));
                            // Triangle points the way the trade goes: up for long,
                            // down for short. It shares the pill's ink colour so the
                            // tag reads as one mark, not two glued-together shapes.
                            const triCx = pillX + 12;
                            const triCy = pillY + pillH / 2;
                            const s = 4;
                            const tri = isLong
                                ? `${triCx},${triCy - s} ${triCx - s},${triCy + s * 0.75} ${triCx + s},${triCy + s * 0.75}`
                                : `${triCx},${triCy + s} ${triCx - s},${triCy - s * 0.75} ${triCx + s},${triCy - s * 0.75}`;

                            return (
                                <g key="ai-plan-badge" data-vp={viewportTick} style={{ pointerEvents: "none" }}>
                                    <rect
                                        x={pillX}
                                        y={pillY}
                                        width={pillW}
                                        height={pillH}
                                        rx={3}
                                        fill={accent}
                                    />
                                    <polygon points={tri} fill={ink} />
                                    <text
                                        x={pillX + 22 + (pillW - 22 - 6) / 2}
                                        y={pillY + 13}
                                        fill={ink}
                                        fontSize={10}
                                        fontFamily="var(--font-sans, Inter), system-ui, sans-serif"
                                        fontWeight="600"
                                        textAnchor="middle"
                                    >
                                        {label}
                                    </text>
                                </g>
                            );
                        })()
                        : null}

                    {/* Live drawing preview */}
                    {drawingPreview && (() => {
                        const dp = drawingPreview;
                        const color = cfg.tools.color;
                        const width = cfg.tools.lineWidth;
                        const labelSize = Math.max(8, cfg.tools.fontSize - 3);

                        if (dp.tool === "horizontal") {
                            return <line x1={0} y1={dp.startY} x2={containerSize.w} y2={dp.startY} stroke={color} strokeWidth={width} strokeDasharray="5,3" opacity={0.8} />;
                        }
                        if (dp.tool === "vertical") {
                            return <line x1={dp.startX} y1={0} x2={dp.startX} y2={containerSize.h} stroke={color} strokeWidth={width} strokeDasharray="5,3" opacity={0.8} />;
                        }
                        if (dp.tool === "rectangle") {
                            const rx = Math.min(dp.startX, dp.curX);
                            const ry = Math.min(dp.startY, dp.curY);
                            const rw = Math.abs(dp.curX - dp.startX);
                            const rh = Math.abs(dp.curY - dp.startY);
                            return <rect x={rx} y={ry} width={rw} height={rh} stroke={color} strokeWidth={width} fill={`${color}18`} opacity={0.85} />;
                        }
                        if (dp.tool === "fibo") {
                            const chart = chartHandles?.chart ?? null;
                            const cs = chartHandles?.cs ?? null;
                            if (!chart || !cs) return null;
                            const priceToY = (p: number) => { try { return cs.priceToCoordinate(p) ?? 0; } catch { return 0; } };
                            const startP = dp.startPrice;
                            const endP = (() => { try { return cs.coordinateToPrice(dp.curY) ?? startP; } catch { return startP; } })();
                            const diff = endP - startP;
                            const levels = cfg.tools.fiboLevels;
                            return (
                                <g opacity={0.8}>
                                    {levels.map((lvl) => {
                                        const yLvl = priceToY(startP + diff * lvl);
                                        return (
                                            <g key={lvl}>
                                                <line x1={Math.min(dp.startX, dp.curX)} y1={yLvl} x2={Math.max(dp.startX, dp.curX)} y2={yLvl} stroke={color} strokeWidth={1} strokeDasharray="4,3" />
                                                <text x={Math.max(dp.startX, dp.curX) + 4} y={yLvl + 4} fill={color} fontSize={labelSize} fontFamily="monospace">{(lvl * 100).toFixed(1)}%</text>
                                            </g>
                                        );
                                    })}
                                </g>
                            );
                        }
                        if (dp.tool === "ruler") {
                            const cs = chartHandles?.cs ?? null;
                            const p1p = cs ? (cs.coordinateToPrice(dp.startY) ?? 0) : 0;
                            const p2p = cs ? (cs.coordinateToPrice(dp.curY) ?? 0) : 0;
                            return (
                                <g opacity={0.85}>
                                    <line x1={dp.startX} y1={dp.startY} x2={dp.curX} y2={dp.curY} stroke={color} strokeWidth={width} strokeDasharray="6,2" />
                                    <line x1={dp.startX} y1={dp.startY} x2={dp.startX} y2={dp.curY} stroke={color} strokeWidth={1} opacity={0.5} />
                                    <line x1={dp.startX} y1={dp.curY} x2={dp.curX} y2={dp.curY} stroke={color} strokeWidth={1} opacity={0.5} />
                                    <text x={(dp.startX + dp.curX) / 2} y={Math.min(dp.startY, dp.curY) - 4} fill={color} fontSize={labelSize} fontFamily="monospace" textAnchor="middle">Δ {Math.abs(p2p - p1p).toFixed(2)}</text>
                                </g>
                            );
                        }
                        if (dp.tool === "arrow") {
                            return (
                                <g opacity={0.85}>
                                    <line x1={dp.startX} y1={dp.startY} x2={dp.curX} y2={dp.curY} stroke={color} strokeWidth={width} markerEnd="url(#arrow)" />
                                    <polygon points={`${dp.curX},${dp.curY - 4} ${dp.curX - 4},${dp.curY + 3} ${dp.curX + 4},${dp.curY + 3}`} fill={color} opacity={0.85} />
                                </g>
                            );
                        }
                        // Default: trendline
                        return <line x1={dp.startX} y1={dp.startY} x2={dp.curX} y2={dp.curY} stroke={color} strokeWidth={width} opacity={0.85} />;
                    })()}
                </svg>

                {/* Inline label editor — type the text label in place.
                    Enter/blur saves, Esc cancels (an empty label removes the
                    freshly placed object so no blank junk is left behind). */}
                {textEdit && textPos ? (
                    <div
                        className="absolute z-40"
                        style={{
                            left: Math.max(4, Math.min(containerSize.w - 216, textPos.x1)),
                            top: Math.max(4, textPos.y1 - 36),
                        }}
                    >
                        <input
                            autoFocus
                            value={textEdit.value}
                            onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
                            onBlur={() => saveTextEdit()}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    saveTextEdit();
                                } else if (e.key === "Escape") {
                                    // Keep the workspace tool-reset from firing too.
                                    e.stopPropagation();
                                    e.preventDefault();
                                    cancelTextEdit();
                                }
                            }}
                            placeholder="Label — Enter saves, Esc cancels"
                            className="w-52 rounded-md border border-primary/60 bg-background/95 px-2 py-1 font-mono text-xs text-foreground shadow-lg outline-none ring-1 ring-primary/40 backdrop-blur"
                        />
                    </div>
                ) : null}

                {/* Selected drawing actions — recolor, edit label, delete ONE object */}
                {selectedDrawing && selPos && !textEdit ? (
                    <div
                        className="absolute z-40 flex items-center gap-1 rounded-lg border border-border bg-background/95 px-1.5 py-1 shadow-lg backdrop-blur"
                        style={{
                            left: Math.max(4, Math.min(containerSize.w - 160, selPos.x1)),
                            top: Math.max(4, selPos.y1 - 44),
                        }}
                    >
                        {TOOL_COLOR_SWATCHES.slice(0, 6).map((c) => (
                            <button
                                key={c}
                                type="button"
                                title={`Recolor to ${c}`}
                                onClick={() =>
                                    commitDrawings(
                                        updateDrawingColor(drawingsRef.current, selectedDrawing.id, c)
                                    )
                                }
                                className={cn(
                                    "size-4 rounded border transition",
                                    (selectedDrawing.color ?? cfg.tools.color).toLowerCase() === c.toLowerCase()
                                        ? "border-foreground scale-110"
                                        : "border-border hover:border-muted-foreground"
                                )}
                                style={{ background: c }}
                            />
                        ))}
                        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
                        {selectedDrawing.type === "text" ? (
                            <button
                                type="button"
                                title="Edit label"
                                onClick={() =>
                                    setTextEdit({ id: selectedDrawing.id, value: selectedDrawing.label ?? "" })
                                }
                                className="flex size-5 items-center justify-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            >
                                <Pencil className="size-3" />
                            </button>
                        ) : null}
                        <button
                            type="button"
                            title="Delete this drawing (Del)"
                            onClick={() => deleteSelectedDrawing()}
                            className="flex size-5 items-center justify-center rounded text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-300"
                        >
                            <Trash2 className="size-3" />
                        </button>
                    </div>
                ) : null}

                {/* Active-tool hint — what to do next, and how to get out */}
                {activeDrawingTool !== "select" && !textEdit ? (
                    <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-primary/40 bg-background/90 px-2.5 py-1 font-mono text-[10px] font-semibold text-primary backdrop-blur-sm">
                        {DRAWING_TOOL_HINTS[activeDrawingTool]} · Esc to exit
                    </div>
                ) : null}

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

            {/* Trade strip — open positions + pending orders for this symbol,
                with one-tap percentage closes (25/50/75/100%). Prices and
                volumes are the caller's real execution data; nothing here is
                simulated. */}
            {symbolPositions.length > 0 || symbolOrders.length > 0 ? (
                <div className="border-t border-border px-3 py-2 text-[11px]">
                    <div className="flex items-center gap-2 pb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span className="font-bold text-foreground">Trade</span>
                        <span>{symbolPositions.length} open</span>
                        <span aria-hidden>·</span>
                        <span>{symbolOrders.length} pending</span>
                        <span
                            className="ml-auto normal-case text-muted-foreground/70"
                            title="Level lines on the chart show entry (solid), SL/TP (dashed) and pending orders (dotted)."
                        >
                            levels on chart ↑
                        </span>
                    </div>
                    <div className="flex flex-col gap-1">
                        {symbolPositions.map((p) => (
                            <div
                                key={p.ticket}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/60 bg-background/60 px-2 py-1"
                            >
                                <span
                                    className={cn(
                                        "rounded px-1.5 py-0.5 font-mono text-[10px] font-bold",
                                        p.side === "BUY"
                                            ? "bg-emerald-500/15 text-emerald-400"
                                            : "bg-rose-500/15 text-rose-400"
                                    )}
                                >
                                    {p.side} {p.volume.toFixed(2)}
                                </span>
                                <span className="font-mono text-muted-foreground">
                                    @ <span className="text-foreground">{fmtPrice(p.entry, symbol)}</span>
                                </span>
                                {p.sl != null && Number.isFinite(p.sl) && p.sl > 0 ? (
                                    <span className="font-mono text-muted-foreground">
                                        SL <span className="text-rose-400">{fmtPrice(p.sl, symbol)}</span>
                                    </span>
                                ) : null}
                                {p.tp != null && Number.isFinite(p.tp) && p.tp > 0 ? (
                                    <span className="font-mono text-muted-foreground">
                                        TP <span className="text-emerald-400">{fmtPrice(p.tp, symbol)}</span>
                                    </span>
                                ) : null}
                                {typeof p.profit === "number" && Number.isFinite(p.profit) ? (
                                    <span
                                        className={cn(
                                            "font-mono font-semibold",
                                            p.profit >= 0 ? "text-emerald-400" : "text-rose-400"
                                        )}
                                    >
                                        {p.profit >= 0 ? "+" : ""}
                                        {p.profit.toFixed(2)}
                                    </span>
                                ) : null}
                                {onClosePosition ? (
                                    <span className="ml-auto inline-flex items-center gap-1">
                                        {[25, 50, 75].map((pct) => (
                                            <button
                                                key={pct}
                                                type="button"
                                                onClick={() => onClosePosition(p.ticket, pct)}
                                                className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition hover:border-amber-500/40 hover:text-foreground"
                                                title={`Close ${pct}% of the position VOLUME (${(p.volume * pct) / 100 >= 0.01 ? ((p.volume * pct) / 100).toFixed(2) : "0.01 min"} lot of ${p.volume.toFixed(2)}). This is volume, not profit.`}
                                            >
                                                {pct}% vol
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => onClosePosition(p.ticket, 100)}
                                            className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-400 transition hover:bg-rose-500/20"
                                            title="Close the entire position"
                                        >
                                            Close
                                        </button>
                                    </span>
                                ) : null}
                            </div>
                        ))}
                        {symbolOrders.map((o) => (
                            <div
                                key={o.ticket}
                                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed border-violet-500/30 bg-violet-500/[0.04] px-2 py-1"
                            >
                                <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-violet-300">
                                    {o.type.replace("_", " ")} {o.volume.toFixed(2)}
                                </span>
                                <span className="font-mono text-muted-foreground">
                                    @ <span className="text-foreground">{fmtPrice(o.price, symbol)}</span>
                                </span>
                                {o.sl != null && Number.isFinite(o.sl) && o.sl > 0 ? (
                                    <span className="font-mono text-muted-foreground">
                                        SL <span className="text-rose-400">{fmtPrice(o.sl, symbol)}</span>
                                    </span>
                                ) : null}
                                {o.tp != null && Number.isFinite(o.tp) && o.tp > 0 ? (
                                    <span className="font-mono text-muted-foreground">
                                        TP <span className="text-emerald-400">{fmtPrice(o.tp, symbol)}</span>
                                    </span>
                                ) : null}
                                {onCancelOrder ? (
                                    <button
                                        type="button"
                                        onClick={() => onCancelOrder(o.ticket)}
                                        className="ml-auto rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition hover:border-rose-500/40 hover:text-rose-400"
                                        title="Cancel this pending order"
                                    >
                                        Cancel
                                    </button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
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
