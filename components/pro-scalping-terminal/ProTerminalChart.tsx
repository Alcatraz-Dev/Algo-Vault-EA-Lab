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

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
    const haSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const rsiSeriesRef = useRef<{ rsi: ISeriesApi<"Line">; pane: number | null; lines: IPriceLine[] } | null>(null);
    const macdSeriesRef = useRef<{ macd: ISeriesApi<"Line">; signal: ISeriesApi<"Line">; pane: number | null } | null>(null);
    // Panes created by these layers — remembered so the pane can be removed
    // again when the layer is switched off.
    const stPaneOwnedRef = useRef<number | null>(null);
    const rsiPaneOwnedRef = useRef<number | null>(null);
    const macdPaneOwnedRef = useRef<number | null>(null);
    // Pine study overlays: line series (overlay pane) + a stacked pane for
    // non-overlay scripts, rebuilt whenever the applied script changes.
    const studySeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
    const studyPaneRef = useRef<number | null>(null);
    const studyMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const signalMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const studyHlineLinesRef = useRef<IPriceLine[]>([]);

    const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number; time: number } | null>(null);

    // Live feed shared with every chart in the app: history, tick merge into
    // the forming bar, and periodic reconciliation against the provider.
    const { candles: liveCandles, error: feedError, isLoading: feedLoading } = useLiveCandles(
        symbol,
        timeframe,
        { limit: 300 }
    );

    const onCandlesChangeRef = useRef(onCandlesChange);
    useEffect(() => {
        onCandlesChangeRef.current = onCandlesChange;
    }, [onCandlesChange]);

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

    const candles = liveCandles;
    const requestKey = `${symbol}|${timeframe}`;
    const loading = feedLoading;
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

        return () => {
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
            lastBarCountRef.current = 0;
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

        // Tick-only path: same instrument/timeframe, history length stable or
        // grown by exactly one bar, and the visible change is confined to the
        // forming bar (same time as the last pushed bar) or a single forward
        // append right after it (bar close). Anything else — provider reconcile
        // that rewrote history, timeframe switch — takes the full redraw path.
        const isTailOnly =
            key === lastKeyRef.current &&
            pushed !== null &&
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
            lastBarCountRef.current = bars.length;
            return;
        }

        cs.setData(bars);
        vs.setData(
            candles.map((c) => ({
                time: toSec(c.timestamp),
                value: c.volume ?? 0,
                color: c.close >= c.open ? "rgba(38, 166, 154, 0.45)" : "rgba(239, 83, 80, 0.45)",
            }))
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
        // in place instead of the chart re-zooming every 2 seconds.
        const barCountChanged = bars.length !== lastBarCountRef.current;
        if (key !== lastKeyRef.current || barCountChanged) {
            chartRef.current?.timeScale().fitContent();
            lastKeyRef.current = key;
        }
        lastBarCountRef.current = bars.length;
        lastPushedBarRef.current = { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close };
    }, [candles, symbol, timeframe]);

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

    // Zone rectangles (FVG / order blocks) drawn into a lightweight overlay.
    const zones = useMemo(() => {
        if (candles.length === 0) return { fvg: [], ob: [] };
        const lastTime = candles[candles.length - 1].timestamp;
        const range = Math.max(...candles.map((c) => c.high)) - Math.min(...candles.map((c) => c.low));
        const toPct = (price: number) => {
            const min = Math.min(...candles.map((c) => c.low));
            return ((price - min) / range) * 100;
        };
        const map = (z: { top: number; bottom: number; startIdx: number; bullish: boolean }, bullishColor: string, bearishColor: string) => ({
            topPct: toPct(z.top),
            heightPct: Math.abs(toPct(z.top) - toPct(z.bottom)),
            leftPct: (z.startIdx / Math.max(1, candles.length - 1)) * 78,
            widthPct: 100 - (z.startIdx / Math.max(1, candles.length - 1)) * 78,
            bullish: z.bullish,
            color: z.bullish ? bullishColor : bearishColor,
            fromPrice: z.bottom,
            toPrice: z.top,
            startTime: candles[z.startIdx]?.timestamp ?? lastTime,
        });
        return {
            fvg: layers.fvg ? computeFvgs(candles).map((z) => map(z, "rgba(52, 211, 153, 0.10)", "rgba(251, 113, 133, 0.10)")) : [],
            ob: layers.orderBlocks ? computeOrderBlocks(candles).map((z) => map(z, "rgba(56, 189, 248, 0.10)", "rgba(251, 146, 60, 0.10)")) : [],
        };
    }, [candles, layers.fvg, layers.orderBlocks]);

    const showZones = zones.fvg.length > 0 || zones.ob.length > 0;

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
            const [stLine, stDir] = TA.supertrend(
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
            rsiSeriesRef.current = { rsi, pane: paneIndex, lines: [] };
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
    }, [layers.bollingerBands, layers.keltnerChannels, layers.donchianChannels, layers.supertrend, layers.heikinAshi, layers.rsiPane, layers.macdPane, symbol]);

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
            const paneApi = rsiSeriesRef.current.pane !== null ? chartRef.current?.panes()[rsiSeriesRef.current.pane] : undefined;
            if (paneApi) {
                for (const l of rsiSeriesRef.current.lines) {
                    try {
                        rsiSeriesRef.current.rsi.removePriceLine(l);
                    } catch {
                        // already gone
                    }
                }
                rsiSeriesRef.current.lines = [30, 70].map((v) =>
                    rsiSeriesRef.current!.rsi.createPriceLine({
                        price: v,
                        color: "rgba(148, 163, 184, 0.6)",
                        lineWidth: 1,
                        lineStyle: LineStyle.Dashed,
                        axisLabelVisible: false,
                        title: `RSI ${v}`,
                    })
                );
            }
        }
        if (macdSeriesRef.current) {
            const [macdLine, signalLine] = TA.macd(closes, 12, 26, 9);
            feedSeries(macdSeriesRef.current.macd, candles, macdLine);
            feedSeries(macdSeriesRef.current.signal, candles, signalLine);
        }
    }, [candles]);

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
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-500">
                                <span className="inline-block h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                                live
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

                {/* Zone overlay (FVG / OB rectangles) */}
                {showZones ? (
                    <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: "22%" }}>
                        {zones.fvg.map((z, i) => (
                            <div
                                key={`fvg_${i}`}
                                className="absolute"
                                style={{
                                    top: `${z.topPct}%`,
                                    height: `${Math.max(z.heightPct, 0.4)}%`,
                                    left: `${z.leftPct}%`,
                                    width: `${z.widthPct}%`,
                                    background: z.color,
                                    borderTop: `1px dashed ${z.bullish ? "rgba(52, 211, 153, 0.5)" : "rgba(251, 113, 133, 0.5)"}`,
                                    borderBottom: `1px dashed ${z.bullish ? "rgba(52, 211, 153, 0.5)" : "rgba(251, 113, 133, 0.5)"}`,
                                }}
                                title={`FVG ${z.fromPrice}–${z.toPrice}`}
                            />
                        ))}
                        {zones.ob.map((z, i) => (
                            <div
                                key={`ob_${i}`}
                                className="absolute"
                                style={{
                                    top: `${z.topPct}%`,
                                    height: `${Math.max(z.heightPct, 0.4)}%`,
                                    left: `${z.leftPct}%`,
                                    width: `${z.widthPct}%`,
                                    background: z.color,
                                    borderLeft: `2px solid ${z.bullish ? "rgba(56, 189, 248, 0.6)" : "rgba(251, 146, 60, 0.6)"}`,
                                }}
                                title={`Order block ${z.fromPrice}–${z.toPrice}`}
                            />
                        ))}
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
    if (s === "XAUUSD") return 2;
    if (s === "XAGUSD") return 3;
    if (["BTCUSD", "ETHUSD"].includes(s)) return 1;
    const v = s.length === 6 || ["US30", "NAS100", "SPX500"].includes(s) ? 2 : 2;
    return v;
}
