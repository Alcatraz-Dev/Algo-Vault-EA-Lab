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

import { useEffect, useMemo, useRef, useState } from "react";
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
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { AdvancedAnalysisResult } from "@/lib/ai/analysis/intelligence";
import type { ChartLayerId } from "./chart-layers";
import type { PineStudyOverlay } from "./pine-overlays";
import type { TerminalSignal } from "@/lib/ai/scalping/radar";
import { fmtPrice } from "./terminal-utils";

type Candle = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
};

type ChartState = {
    key: string;
    candles: Candle[];
    error: string | null;
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
    // Pine study overlays: line series (overlay pane) + a stacked pane for
    // non-overlay scripts, rebuilt whenever the applied script changes.
    const studySeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
    const studyPaneRef = useRef<number | null>(null);
    const studyMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const signalMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const studyHlineLinesRef = useRef<IPriceLine[]>([]);

    const [state, setState] = useState<ChartState>({ key: "", candles: [], error: null });
    const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number; time: number } | null>(null);

    // Loading derives from a key mismatch: a symbol/TF switch reads as loading
    // immediately without any synchronous setState inside the effect.
    const requestKey = `${symbol}|${timeframe}`;
    const loading = state.key !== requestKey;

    const onCandlesChangeRef = useRef(onCandlesChange);
    useEffect(() => {
        onCandlesChangeRef.current = onCandlesChange;
    }, [onCandlesChange]);

    // Fetch candles. The OHLC endpoint is public, so an absent token only
    // means the request goes out without an Authorization header.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const params = new URLSearchParams({ symbol, timeframe, limit: "300" });
                const res = await fetch(`/api/analytics/ohlc?${params.toString()}`, {
                    cache: "no-store",
                    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
                });
                const body = (await res.json().catch(() => null)) as
                    | { candles?: Candle[]; error?: string }
                    | null;
                if (cancelled) return;
                if (!res.ok || !body?.candles?.length) {
                    setState({
                        key: requestKey,
                        candles: [],
                        error: body?.error ?? `No ${timeframe} candles returned for ${symbol}.`,
                    });
                    return;
                }
                const candles = body.candles
                    .filter((c) => Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
                    .sort((a, b) => a.timestamp - b.timestamp);
                setState({ key: requestKey, candles, error: null });
                onCandlesChangeRef.current?.(candles);
            } catch {
                if (cancelled) return;
                setState({ key: requestKey, candles: [], error: "Failed to load market data." });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [symbol, timeframe, token, requestKey]);

    const candles = state.candles;

    // Create chart once.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

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
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Push candle + derived series data.
    useEffect(() => {
        const cs = candleSeriesRef.current;
        const vs = volumeSeriesRef.current;
        const vw = vwapSeriesRef.current;
        const e9 = ema9Ref.current;
        const e20 = ema20Ref.current;
        if (!cs || !vs || !vw || !e9 || !e20) return;
        if (candles.length === 0) {
            cs.setData([]);
            vs.setData([]);
            vw.setData([]);
            e9.setData([]);
            e20.setData([]);
            return;
        }

        const seen = new Set<number>();
        const bars = candles
            .filter((c) => {
                const t = Math.floor(c.timestamp / 1000);
                if (seen.has(t)) return false;
                seen.add(t);
                return true;
            })
            .map((c) => ({ time: Math.floor(c.timestamp / 1000) as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));

        cs.setData(bars);
        vs.setData(
            candles.map((c) => ({
                time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
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
                if (v !== null) data.push({ time: Math.floor(c.timestamp / 1000) as UTCTimestamp, value: v });
            });
            series.setData(data);
        };
        pushEma(e9, 9);
        pushEma(e20, 20);

        chartRef.current?.timeScale().fitContent();
    }, [candles, symbol]);

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
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {loading ? "loading…" : `${candles.length} bars · /api/analytics/ohlc`}
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
                {state.error ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 p-4 backdrop-blur-[2px]">
                        <div className="max-w-sm text-center">
                            <p className="text-xs font-medium text-foreground">Chart unavailable</p>
                            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{state.error}</p>
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
