"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    createChart,
    type IChartApi,
    type ISeriesApi,
    type IPriceLine,
    type UTCTimestamp,
    CandlestickSeries,
    HistogramSeries,
    ColorType,
    CrosshairMode,
} from "lightweight-charts";
import {
    Pause,
    Play,
    RotateCcw,
    SkipBack,
    SkipForward,
    StepBack,
    StepForward,
} from "lucide-react";
import type { AISignal } from "@/lib/ai-signals/types";
import { useLiveCandles } from "@/hooks/useLiveCandles";
import { PLAYHEAD_RIGHT_MARGIN_RATIO } from "@/lib/chart-engine/viewport";
import { cn } from "@/lib/utils";

interface SignalChartProps {
    signal: AISignal;
    height?: number;
    replayStart?: number; // timestamp ms
    replayEnd?: number;   // timestamp ms
    initialCursor?: number;
    replaySpeed?: number; // ms per candle, default 300
}

type MarketCandleLike = {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
};

interface PriceLine {
    price: number;
    color: string;
    title: string;
    lineStyle?: 0 | 1 | 2;
    lineWidth?: 1 | 2 | 3 | 4;
}

// Map the signal's timeframe label onto the timeframe enum used by the
// canonical OHLC API (M1..D1). Unknown values fall back to H1.
function timeframeParam(tf: string): string {
    const value = String(tf ?? "H1").toUpperCase();
    const known = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
    return known.includes(value) ? value : "H1";
}

function timeframeToSeconds(tf: string): number {
    const map: Record<string, number> = {
        M1: 60, M5: 300, M15: 900, M30: 1800,
        H1: 3600, H4: 14400, D1: 86400,
    };
    return map[String(tf).toUpperCase()] || 3600;
}

/**
 * Normalise a signal symbol to the canonical SupportedSymbol used by the
 * chart data engine. Signals can be stored with legacy or alternative names
 * (e.g. "SP500" → "SPX500", "US500" → "SPX500", "GOLD" → "XAUUSD").
 */
function normaliseSymbol(raw: string): string {
    const sym = String(raw ?? "").toUpperCase().replace(/[\s_/-]/g, "");
    const aliases: Record<string, string> = {
        SP500: "SPX500",
        S500: "SPX500",
        US500: "SPX500",
        SPXUSD: "SPX500",
        SPX: "SPX500",
        SP: "SPX500",
        DJIA: "US30",
        DOW: "US30",
        DOW30: "US30",
        DOWJONES: "US30",
        NDX: "NAS100",
        NAS: "NAS100",
        NASDAQ: "NAS100",
        NASDAQ100: "NAS100",
        GOLD: "XAUUSD",
        SILVER: "XAGUSD",
        BTCUSDT: "BTCUSD",
        ETHUSDT: "ETHUSD",
    };
    return aliases[sym] ?? sym;
}

function buildPriceLines(signal: AISignal): PriceLine[] {
    const lines: PriceLine[] = [];
    if (signal.entry)    lines.push({ price: signal.entry,    color: "#3faff3", title: "Entry", lineWidth: 2, lineStyle: 0 });
    if (signal.stopLoss) lines.push({ price: signal.stopLoss, color: "#ff645f", title: "SL",    lineWidth: 1, lineStyle: 2 });
    if (signal.tp1)      lines.push({ price: signal.tp1,      color: "#30d697", title: "TP1",   lineWidth: 1, lineStyle: 2 });
    if (signal.tp2)      lines.push({ price: signal.tp2,      color: "#30d697", title: "TP2",   lineWidth: 1, lineStyle: 2 });
    if (signal.tp3)      lines.push({ price: signal.tp3,      color: "#30d697", title: "TP3",   lineWidth: 1, lineStyle: 2 });
    return lines;
}

/** Theme palette — chart follows the app's light/dark theme. */
const THEME = {
    dark: {
        bg: "#0b0c0e",
        text: "#9a9fa6",
        grid: "rgba(148,163,184,0.05)",
        border: "rgba(148,163,184,0.2)",
        crosshair: "rgba(218,186,107,0.4)",
    },
    light: {
        bg: "#ffffff",
        text: "#5b616b",
        grid: "rgba(100,116,139,0.08)",
        border: "rgba(100,116,139,0.25)",
        crosshair: "rgba(249,115,22,0.35)",
    },
} as const;

type ThemeName = keyof typeof THEME;

/** Track the app theme via the `dark` class on <html>. */
function useAppTheme(): ThemeName {
    const [theme, setTheme] = useState<ThemeName>("dark");
    useEffect(() => {
        const read = () =>
            setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
        read();
        const mo = new MutationObserver(read);
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => mo.disconnect();
    }, []);
    return theme;
}

const SPEEDS = [600, 300, 150, 75] as const; // 0.5x, 1x, 2x, 4x at base 300
const SPEED_LABEL: Record<number, string> = { 600: "0.5×", 300: "1×", 150: "2×", 75: "4×" };

/**
 * Replay playhead policy — the only viewport call bar replay is allowed to
 * make.
 *
 * The newest revealed bar (the playhead) is placed in the middle of the window
 * the first time, and the window is then LEFT COMPLETELY ALONE while the
 * playhead still has room to its right: each revealed bar simply fills the
 * empty space to the right of the playhead instead of dragging the whole chart
 * along, which is what `scrollToRealTime()` did on every single step and what
 * made replay look like an endless auto-scroll to the end of the screen. The
 * window is re-centred (at the current zoom — never fitted) only when the
 * playhead would otherwise leave the visible range.
 */
function holdReplayPlayhead(chart: IChartApi | null, barCount: number): void {
    if (!chart || barCount <= 0) return;
    const timeScale = chart.timeScale();
    const playhead = barCount - 1;
    const visible = timeScale.getVisibleLogicalRange();
    const span = visible ? Math.round(visible.to - visible.from) : 0;
    const bars = span > 1 ? span : 100;
    const margin = Math.max(2, Math.round(bars * PLAYHEAD_RIGHT_MARGIN_RATIO));
    if (visible && playhead >= visible.from && playhead <= visible.to - margin) return;
    const half = Math.round(bars / 2);
    timeScale.setVisibleLogicalRange({ from: playhead - half, to: playhead + half });
}

export default function SignalChart({
    signal,
    height = 400,
    replayStart,
    replayEnd,
    initialCursor,
    replaySpeed = 300,
}: SignalChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef     = useRef<IChartApi | null>(null);
    const seriesRef    = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const priceLineRefs = useRef<IPriceLine[]>([]);
    const seededRef    = useRef(false);
    const userScrolledRef = useRef(false);
    /** True while this component writes the viewport itself — never a user pan. */
    const programmaticRangeRef = useRef(false);
    const totalBarsRef = useRef(0);
    const [noData, setNoData] = useState(false);

    const theme = useAppTheme();
    const palette = THEME[theme];

    const symbol = normaliseSymbol(signal.symbol);
    const [tfOverride, setTfOverride] = useState<string | null>(null);
    const timeframe = timeframeParam(tfOverride ?? signal.timeframe);

    const {
        candles: liveCandles,
        error: marketError,
        isLoading: loading,
        loadOlder,
        hasMoreHistory,
        loadingOlder,
    } = useLiveCandles(
        symbol,
        timeframe,
        { limit: 300 }
    );

    // Timeframe switch resets chart seed + replay cursor for the new series.
    useEffect(() => { seededRef.current = false; }, [tfOverride]);

    const isReplay = Boolean(replayStart && replayEnd);

    // ── replay history: fetch the exact window (live feed only holds the tail) ──
    const [replayHistory, setReplayHistory] = useState<MarketCandleLike[]>([]);

    useEffect(() => {
        if (!isReplay || !replayStart || !replayEnd) return;
        let cancelled = false;
        const tfMs = timeframeToSeconds(timeframe) * 1000;
        const contextMs = tfMs * 180;          // ~180 bars of lead-in context
        const padMs = tfMs * 40;               // tail so the resolution is visible
        const from = Math.max(0, replayStart - contextMs);
        const to = replayEnd + padMs;
        setReplayHistory([]);
        (async () => {
            try {
                const res = await fetch(
                    `/api/analytics/ohlc?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&from=${from}&to=${to}&limit=500`,
                    { cache: "no-store" }
                );
                const body = (await res.json().catch(() => null)) as
                    | { candles?: MarketCandleLike[] }
                    | null;
                if (cancelled || !body?.candles?.length) return;
                setReplayHistory(
                    [...body.candles].sort((a, b) => a.timestamp - b.timestamp)
                );
            } catch {
                /* fall back to the live tail below */
            }
        })();
        return () => { cancelled = true; };
    }, [isReplay, symbol, timeframe, replayStart, replayEnd]);

    /** Source series for replay: exact range when available, else the live tail. */
    const sourceCandles = replayHistory.length > 0 ? replayHistory : liveCandles;

    /** Price line descriptors — only rebuild when levels change. */
    const priceLines   = useMemo(() => buildPriceLines(signal), [signal]);
    const priceLineKey = useMemo(
        () => priceLines.map((l) => `${l.price}:${l.title}`).join("|"),
        [priceLines]
    );

    // ── replay state (TradingView bar-replay style) ─────────────────────
    const replayBars = useMemo(() => {
        if (!replayStart || !replayEnd) return [];
        return sourceCandles
            .filter((c) => Math.floor(c.timestamp) >= replayStart && Math.floor(c.timestamp) <= replayEnd)
            .sort((a, b) => Math.floor(a.timestamp) - Math.floor(b.timestamp))
            .map((c) => ({
                time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                vol: c.volume ?? 0,
                ts: c.timestamp,
            }));
    }, [sourceCandles, replayStart, replayEnd]);

    /** Historical context — everything BEFORE the replay window, always visible. */
    const preBars = useMemo(() => {
        if (!replayStart) return [];
        return sourceCandles
            .filter((c) => Math.floor(c.timestamp) < replayStart)
            .sort((a, b) => Math.floor(a.timestamp) - Math.floor(b.timestamp))
            .map((c) => ({
                time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                vol: c.volume ?? 0,
                ts: c.timestamp,
            }));
    }, [sourceCandles, replayStart]);

    const [cursor, setCursor] = useState(0);          // number of visible bars
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(replaySpeed);

    /** Whole available series — used when the trade window can't be served. */
    const fallbackBars = useMemo(
        () => sourceCandles
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((c) => ({
                time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                vol: c.volume ?? 0,
                ts: c.timestamp,
            })),
        [sourceCandles]
    );

    /** True when the provider couldn't serve the trade window — replay runs over the tail. */
    const usingFallback = preBars.length + replayBars.length === 0 && fallbackBars.length > 0;

    /** Total bars the replay cursor steps through. */
    const totalReplayBars = usingFallback ? fallbackBars.length : replayBars.length;

    // Seed cursor once bars load: honour initialCursor, else start at first bar.
    useEffect(() => {
        if (totalReplayBars === 0) return;
        if (usingFallback) {
            // Degraded mode (no trade window): begin mid-series so there is
            // history to step forward through.
            setCursor((c) => (c === 0 ? Math.max(1, Math.floor(totalReplayBars * 0.5)) : c));
            return;
        }
        if (initialCursor) {
            const idx = replayBars.findIndex((b) => b.ts >= initialCursor);
            setCursor(idx >= 0 ? idx : 1);
        } else {
            setCursor((c) => (c === 0 ? 1 : c));
        }
    }, [replayBars, initialCursor, totalReplayBars, usingFallback]);

    // Auto-play when entering replay mode.
    useEffect(() => {
        if (isReplay && totalReplayBars > 0 && !usingFallback) setPlaying(true);
        return () => setPlaying(false);
    }, [isReplay, totalReplayBars, usingFallback]);

    // Play timer — advance one bar per tick (TradingView bar replay logic).
    useEffect(() => {
        if (!playing || !isReplay) return;
        const t = setInterval(() => {
            setCursor((c) => {
                if (c >= totalReplayBars) { setPlaying(false); return c; }
                return c + 1;
            });
        }, speed);
        return () => clearInterval(t);
    }, [playing, isReplay, speed, totalReplayBars]);

    // ── chart lifecycle: create once per height change ───────────────────
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const w = container.clientWidth  || 600;
        const h = container.clientHeight || height;

        const chart = createChart(container, {
            width: w,
            height: h,
            layout: {
                background: { type: ColorType.Solid, color: palette.bg },
                textColor: palette.text,
                fontFamily: "Inter, -apple-system, sans-serif",
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: palette.grid },
                horzLines: { color: palette.grid },
            },
            rightPriceScale: {
                borderColor: palette.border,
                scaleMargins: { top: 0.1, bottom: 0.2 },
            },
            timeScale: {
                borderColor: palette.border,
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 3,
                barSpacing: 6,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: palette.crosshair, width: 1, style: 1 },
                horzLine: { color: palette.crosshair, width: 1, style: 1 },
            },
        });
        chartRef.current = chart;

        seriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor:        "#30d697",
            downColor:      "#ff645f",
            borderDownColor:"#ff645f",
            borderUpColor:  "#30d697",
            wickDownColor:  "#ff645f",
            wickUpColor:    "#30d697",
        });

        volSeriesRef.current = chart.addSeries(HistogramSeries, {
            color: "#30d697",
            priceFormat: { type: "volume" },
            priceScaleId: "vol",
        });
        chart.priceScale("vol").applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        });

        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const newW = Math.round(entry.contentRect.width);
                if (newW > 0) chart.applyOptions({ width: newW });
            }
        });
        ro.observe(container);

        return () => {
            ro.disconnect();
            chart.remove();
            chartRef.current    = null;
            seriesRef.current   = null;
            volSeriesRef.current = null;
            priceLineRefs.current = [];
            seededRef.current   = false;
        };
    }, [height]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── theme change → restyle chart in place ────────────────────────────
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.applyOptions({
            layout: {
                background: { type: ColorType.Solid, color: palette.bg },
                textColor: palette.text,
            },
            grid: {
                vertLines: { color: palette.grid },
                horzLines: { color: palette.grid },
            },
            rightPriceScale: { borderColor: palette.border },
            timeScale: { borderColor: palette.border },
            crosshair: {
                vertLine: { color: palette.crosshair },
                horzLine: { color: palette.crosshair },
            },
        });
    }, [palette]);

    // ── detect "loaded but no data" state ───────────────────────────────
    useEffect(() => {
        if (!loading && !marketError && liveCandles.length === 0) {
            const t = setTimeout(() => setNoData(true), 4000);
            return () => clearTimeout(t);
        }
        setNoData(false);
    }, [loading, marketError, liveCandles.length]);

    // ── data feed (live mode only) ──────────────────────────────────────
    useEffect(() => {
        if (isReplay) return;
        const series    = seriesRef.current;
        const volSeries = volSeriesRef.current;
        if (!series || !volSeries || liveCandles.length === 0) return;

        const bars = liveCandles.map((c) => ({
            time:  Math.floor(c.timestamp / 1000) as UTCTimestamp,
            open:  c.open,
            high:  c.high,
            low:   c.low,
            close: c.close,
        }));
        const volumes = liveCandles.map((c) => ({
            time:  Math.floor(c.timestamp / 1000) as UTCTimestamp,
            value: c.volume ?? 0,
            color: c.close >= c.open ? "rgba(48,214,151,0.4)" : "rgba(255,100,95,0.4)",
        }));

        if (!seededRef.current) {
            series.setData(bars);
            volSeries.setData(volumes);
            totalBarsRef.current = bars.length;
            chartRef.current?.timeScale().fitContent();
            chartRef.current?.timeScale().scrollToRealTime();
            seededRef.current = true;
            return;
        }

        // Deep-history page prepended → keep the user's time viewport stable.
        if (bars.length > totalBarsRef.current) {
            const chart = chartRef.current;
            const savedRange = userScrolledRef.current ? chart?.timeScale().getVisibleRange() : null;
            series.setData(bars);
            volSeries.setData(volumes);
            totalBarsRef.current = bars.length;
            if (savedRange) {
                try { chart?.timeScale().setVisibleRange(savedRange); } catch { /* ignore */ }
            }
            return;
        }

        const last = bars[bars.length - 1];
        try {
            series.update(last);
            volSeries.update(volumes[volumes.length - 1]);
        } catch {
            series.setData(bars);
            volSeries.setData(volumes);
            chartRef.current?.timeScale().fitContent();
        }
        totalBarsRef.current = bars.length;
    }, [liveCandles, isReplay]);

    // ── scroll-back: load deeper history when the left edge is reached ────
    const scrollGuardRef = useRef(false);
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const ts = chart.timeScale();
        const handler = (range: { from: number; to: number } | null) => {
            if (!range) return;
            // Our own series/playhead writes are not user pans: a shrinking
            // replay window must never be mistaken for the user browsing back.
            if (programmaticRangeRef.current) return;
            // User scrolled away from the live edge → remember so feed updates
            // preserve their viewport instead of snapping back to the right.
            userScrolledRef.current = range.to < totalBarsRef.current - 3;
            if (
                range.from < 8 &&
                hasMoreHistory &&
                !loadingOlder &&
                !scrollGuardRef.current
            ) {
                scrollGuardRef.current = true;
                void loadOlder().finally(() => {
                    setTimeout(() => { scrollGuardRef.current = false; }, 400);
                });
            }
        };
        ts.subscribeVisibleLogicalRangeChange(handler);
        return () => ts.unsubscribeVisibleLogicalRangeChange(handler);
    }, [height, hasMoreHistory, loadingOlder, loadOlder]);

    // ── replay data feed: render bars[0..cursor] (TradingView bar replay) ─
    useEffect(() => {
        if (!isReplay) return;
        const series    = seriesRef.current;
        const volSeries = volSeriesRef.current;
        if (!series || !volSeries) return;

        // Prefer the trade window; when the provider can't serve that window
        // (older than its history boundary), fall back to the available series
        // so the chart is never blank and the replay controls still work.
        const bars = usingFallback
            ? fallbackBars.slice(0, Math.max(1, cursor))
            : [...preBars, ...replayBars.slice(0, Math.max(1, cursor))];

        if (bars.length === 0) return;

        // Preserve the user's viewport when they've scrolled back to browse
        // history; otherwise hold the playhead in the middle of the window so
        // replay runs without the chart auto-scrolling to the end on every bar.
        const chart = chartRef.current;
        const savedRange = userScrolledRef.current ? chart?.timeScale().getVisibleRange() : null;

        programmaticRangeRef.current = true;
        try {
            series.setData(bars.map((b) => ({
                time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
            })));
            volSeries.setData(bars.map((b) => ({
                time: b.time, value: b.vol,
                color: b.close >= b.open ? "rgba(48,214,151,0.4)" : "rgba(255,100,95,0.4)",
            })));
            totalBarsRef.current = bars.length;
            if (savedRange) {
                try { chart?.timeScale().setVisibleRange(savedRange); } catch { /* ignore */ }
            } else {
                holdReplayPlayhead(chart, bars.length);
            }
        } finally {
            programmaticRangeRef.current = false;
        }
    }, [isReplay, usingFallback, fallbackBars, preBars, replayBars, cursor]);

    // ── entry / SL / TP price lines ──────────────────────────────────────
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;
        for (const line of priceLineRefs.current) {
            try { series.removePriceLine(line); } catch { /* already gone */ }
        }
        priceLineRefs.current = priceLines.map((line) =>
            series.createPriceLine({
                price:           line.price,
                color:           line.color,
                title:           line.title,
                lineWidth:       line.lineWidth ?? 1,
                lineStyle:       line.lineStyle ?? 0,
                axisLabelVisible: true,
            })
        );
    }, [priceLines, priceLineKey, liveCandles]);

    const tfLabel = timeframeToSeconds(timeframe) >= 86400 ? "D1" : timeframe;
    const replayPct = totalReplayBars > 0 ? Math.round((cursor / totalReplayBars) * 100) : 0;
    const cursorBar = (usingFallback ? fallbackBars : replayBars)[Math.max(0, cursor - 1)];
    const cursorTime = cursorBar
        ? new Date(cursorBar.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "";

    // The provider could not serve the trade's historical window.
    const replayWindowMissing = isReplay && preBars.length + replayBars.length === 0 && sourceCandles.length > 0;

    const btn = "flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40";

    return (
        <div className="rounded-xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.05)] sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[8px] font-extrabold uppercase tracking-widest text-muted-foreground">
                    Price Chart
                    {symbol !== signal.symbol && (
                        <span className="ml-2 normal-case font-normal text-muted-foreground/60">
                            ({symbol})
                        </span>
                    )}
                </h3>
                <div className="flex flex-wrap items-center gap-3 text-[8px]">
                    <div className="flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/40 p-0.5">
                        {([["M1", "1m"], ["M5", "5m"], ["M15", "15m"], ["M30", "30m"], ["H1", "1h"], ["H4", "4h"]] as const).map(([t, lbl]) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => setTfOverride((prev) => ((prev ?? signal.timeframe) === t ? null : t))}
                                className={cn(
                                    "rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-widest transition-colors",
                                    timeframe === t
                                        ? "bg-foreground text-background"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {lbl}
                            </button>
                        ))}
                    </div>
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-0.5 w-3 bg-info" />
                        <span className="text-foreground/70">Entry</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-0.5 w-3 bg-negative" />
                        <span className="text-foreground/70">SL</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-0.5 w-3 bg-positive" />
                        <span className="text-foreground/70">TP</span>
                    </span>
                </div>
            </div>

            {/* Outer div owns the height; inner div is the chart mount point */}
            <div className="relative w-full" style={{ height }}>
                <div ref={containerRef} className="absolute inset-0" />

                {/* Error overlay */}
                {marketError && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-border bg-background/70 backdrop-blur-sm">
                        <div className="max-w-xs text-center px-4">
                            <p className="text-xs font-medium text-muted-foreground">
                                Real-time chart unavailable
                            </p>
                            <p className="mt-1 text-[8px] leading-5 text-muted-foreground/60">
                                {marketError} — no candles returned for {signal.symbol} {tfLabel}.
                            </p>
                        </div>
                    </div>
                )}

                {/* Loading overlay */}
                {!isReplay && !marketError && loading && liveCandles.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground animate-pulse">
                            Loading market data…
                        </span>
                    </div>
                )}

                {/* No-data overlay (loaded but empty) */}
                {!isReplay && !marketError && !loading && noData && liveCandles.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-border/40 bg-background/60 backdrop-blur-sm">
                        <div className="max-w-xs text-center px-4">
                            <p className="text-xs font-medium text-muted-foreground">
                                No chart data available
                            </p>
                            <p className="mt-1 text-[8px] text-muted-foreground/60">
                                Market data for {symbol} {tfLabel} is currently unavailable.
                            </p>
                        </div>
                    </div>
                )}

                {/* Honest notice: historical window not served by the provider */}
                {replayWindowMissing && (
                    <div className="absolute bottom-2 left-2 rounded-full border border-border/40 bg-background/85 px-2.5 py-1 text-[8px] font-medium text-muted-foreground backdrop-blur-sm">
                        Trade window unavailable from provider — showing latest {timeframe} series
                    </div>
                )}

                {/* Replay timestamp badge (replay mode) */}
                {isReplay && totalReplayBars > 0 && (
                    <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full border border-border/40 bg-background/85 px-2 py-0.5 font-numeric text-[8px] text-muted-foreground backdrop-blur-sm">
                        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", playing ? "bg-info animate-pulse" : "bg-muted-foreground/50")} aria-hidden />
                        {cursorTime}
                    </div>
                )}

                {/* Deeper-history loading hint */}
                {loadingOlder && (
                    <div className="absolute bottom-2 right-2 rounded-full border border-border/40 bg-background/85 px-2 py-0.5 text-[8px] text-muted-foreground backdrop-blur-sm">
                        Loading earlier candles…
                    </div>
                )}

                {/* Live badge (live mode only) */}
                {!isReplay && liveCandles.length > 0 && (
                    <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full border border-border/40 bg-background/80 px-2 py-0.5 text-[8px] text-muted-foreground backdrop-blur-sm">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive animate-pulse" aria-hidden />
                        Live
                    </div>
                )}
            </div>

            {/* Replay controls — TradingView bar-replay style */}
            {isReplay && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                    <button type="button" className={btn} title="Restart replay" aria-label="Restart replay"
                        onClick={() => { setCursor(1); setPlaying(true); }}>
                        <RotateCcw size={13} />
                    </button>
                    <button type="button" className={btn} title="Jump to start" aria-label="Jump to start"
                        disabled={cursor <= 1}
                        onClick={() => { setPlaying(false); setCursor(1); }}>
                        <SkipBack size={13} />
                    </button>
                    <button type="button" className={btn} title="Step back" aria-label="Step back one bar"
                        disabled={cursor <= 1}
                        onClick={() => { setPlaying(false); setCursor((c) => Math.max(1, c - 1)); }}>
                        <StepBack size={13} />
                    </button>
                    <button
                        type="button"
                        className="flex h-7 items-center gap-1.5 rounded-md bg-black px-3 text-[8px] font-extrabold uppercase tracking-widest text-white transition-colors hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
                        title={playing ? "Pause replay" : "Play replay"}
                        onClick={() => setPlaying((p) => !p)}
                    >
                        {playing ? <Pause size={12} /> : <Play size={12} />}
                        {playing ? "Pause" : "Play"}
                    </button>
                    <button type="button" className={btn} title="Step forward" aria-label="Step forward one bar"
                        disabled={cursor >= totalReplayBars}
                        onClick={() => { setPlaying(false); setCursor((c) => Math.min(totalReplayBars, c + 1)); }}>
                        <StepForward size={13} />
                    </button>
                    <button type="button" className={btn} title="Jump to end" aria-label="Jump to end"
                        disabled={cursor >= totalReplayBars}
                        onClick={() => { setPlaying(false); setCursor(totalReplayBars); }}>
                        <SkipForward size={13} />
                    </button>

                    {/* Speed selector */}
                    <div className="ml-1 flex items-center gap-1">
                        {SPEEDS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => setSpeed(s)}
                                className={cn(
                                    "h-6 rounded-md px-1.5 font-numeric text-[8px] font-bold transition-colors",
                                    speed === s
                                        ? "bg-foreground text-background"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {SPEED_LABEL[s]}
                            </button>
                        ))}
                    </div>

                    {/* Progress */}
                    <div className="ml-auto flex min-w-40 flex-1 items-center gap-2 sm:flex-none">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted sm:w-32 sm:flex-none">
                            <div
                                className="h-full rounded-full bg-foreground transition-[width] duration-150"
                                style={{ width: `${replayPct}%` }}
                            />
                        </div>
                        <span className="font-numeric text-[8px] text-muted-foreground tabular-nums">
                            {cursor}/{totalReplayBars}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
