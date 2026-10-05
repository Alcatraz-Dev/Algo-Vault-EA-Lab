"use client";

import { useEffect, useRef } from "react";
import {
    createChart,
    IChartApi,
    LineSeries,
    AreaSeries,
    BarSeries,
    createSeriesMarkers,
    CandlestickSeries,
    HistogramSeries,
    ColorType,
    CrosshairMode,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type Time,
    type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, ChartPriceLine, ChartTradeMarker, ChartType } from "./types";
import { countPrependedBars, shiftLogicalRangeForPrepend } from "@/lib/chart-engine/coordinate-mapping";

interface ChartEngineProps {
    width: number;
    height: number;
    chartType: ChartType;
    candles: Candle[];
    priceLines?: ChartPriceLine[];
    tradeMarkers?: ChartTradeMarker[];
    onChartReady: (chart: IChartApi) => void;
    onSeriesReady?: (series: unknown) => void;
    /** Live-follow toggled by viewport position (user at live edge or not). */
    onFollowChange?: (following: boolean) => void;
    /** Called when the user pans within a few bars of the loaded window's left edge (progressive history). */
    onNearHistoryEdge?: () => void;
}

type ChartSeries = ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area"> | ISeriesApi<"Bar">;

/**
 * ChartEngine — lightweight-charts v5 renderer for the main TradingChart.
 *
 * The chart is created once and candle data is fed incrementally
 * (`series.update()` for the tail), so live tick merges never tear the chart
 * down or reset the user's zoom/scroll position.
 */
export default function ChartEngine({
    width,
    height,
    chartType,
    candles,
    priceLines = [],
    tradeMarkers = [],
    onChartReady,
    onSeriesReady,
    onFollowChange,
    onNearHistoryEdge,
}: ChartEngineProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ChartSeries | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const priceLineRefs = useRef<Map<string, { line: ReturnType<ChartSeries["createPriceLine"]>; signature: string }>>(new Map());
    const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const createdForRef = useRef<string | null>(null);
    const pushedCountRef = useRef(0);
    const onFollowChangeRef = useRef(onFollowChange);
    useEffect(() => {
        onFollowChangeRef.current = onFollowChange;
    }, [onFollowChange]);
    const onNearHistoryEdgeRef = useRef(onNearHistoryEdge);
    useEffect(() => {
        onNearHistoryEdgeRef.current = onNearHistoryEdge;
    }, [onNearHistoryEdge]);
    // First/last pushed bar times — used to detect history PREPENDS so the
    // logical range can be preserved across the full setData they require.
    const firstPushedTimeRef = useRef<number | null>(null);
    const lastPushedTimeRef = useRef<number | null>(null);
    const lastPushedDataRef = useRef<Candle[]>([]);
    const followingLiveRef = useRef(true);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const priceLineRefsForChart = priceLineRefs.current;

        const key = `${chartType}|${height}`;
        if (createdForRef.current === key && chartRef.current) return;
        if (chartRef.current) {
            chartRef.current.remove();
            chartRef.current = null;
        }
        createdForRef.current = key;

        const chart = createChart(container, {
            width,
            height,
            layout: {
                background: { type: ColorType.Solid, color: "#0b1118" },
                textColor: "#94a3b8",
                fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
            },
            grid: {
                vertLines: { color: "rgba(148, 163, 184, 0.05)", style: 0 },
                horzLines: { color: "rgba(148, 163, 184, 0.05)", style: 0 },
            },
            rightPriceScale: {
                borderColor: "rgba(148, 163, 184, 0.2)",
                scaleMargins: { top: 0.15, bottom: 0.2 },
            },
            timeScale: {
                borderColor: "rgba(148, 163, 184, 0.2)",
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 5,
                barSpacing: 8,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: "rgba(234, 123, 74, 0.5)", width: 1, style: 1 },
                horzLine: { color: "rgba(234, 123, 74, 0.5)", width: 1, style: 1 },
            },
        });

        chartRef.current = chart;

        let series: ChartSeries;

        switch (chartType) {
            case "line":
                series = chart.addSeries(LineSeries, {
                    color: "#22d3ee",
                    lineWidth: 2,
                });
                break;
            case "area":
                series = chart.addSeries(AreaSeries, {
                    topColor: "rgba(34, 211, 238, 0.3)",
                    bottomColor: "rgba(34, 211, 238, 0.01)",
                    lineColor: "#22d3ee",
                    lineWidth: 2,
                });
                break;
            case "bar":
                series = chart.addSeries(BarSeries, {
                    upColor: "#26a69a",
                    downColor: "#ef5350",
                });
                break;
            case "candlestick":
            default:
                series = chart.addSeries(CandlestickSeries, {
                    upColor: "#26a69a",
                    downColor: "#ef5350",
                    borderDownColor: "#ef5350",
                    borderUpColor: "#26a69a",
                    wickDownColor: "#ef5350",
                    wickUpColor: "#26a69a",
                });
                break;
        }

        seriesRef.current = series;
        markerPluginRef.current = createSeriesMarkers(series, []);
        onChartReady(chart);
        onSeriesReady?.(series);

        if (chartType === "candlestick" || chartType === "bar") {
            try {
                const volSeries = chart.addSeries(HistogramSeries, {
                    color: "#26a69a",
                    priceFormat: { type: "volume" },
                    priceScaleId: "",
                });
                chart.priceScale("").applyOptions({
                    scaleMargins: { top: 0.8, bottom: 0 },
                });
                volumeSeriesRef.current = volSeries;
            } catch {
                volumeSeriesRef.current = null;
            }
        }

        pushedCountRef.current = 0;

        // Live-follow wiring (Phase 6): report viewport position so the
        // parent can show the Go-to-Live control and stop auto-scrolling
        // while the user inspects history.
        const timeScale = chart.timeScale();
        const handleRange = () => {
            try {
                const range = timeScale.getVisibleLogicalRange();
                const bars = pushedCountRef.current;
                if (range === null || bars <= 0) return;
                const following = range.to >= bars - 1.5;
                followingLiveRef.current = following;
                onFollowChangeRef.current?.(following);
            } catch {
                // range not available yet
            }
        };
        timeScale.subscribeVisibleLogicalRangeChange(handleRange);

        // ── progressive historical loading ─────────────────────────────────
        // Panning near the left edge of the loaded window asks the parent for
        // one older page (the parent owns hasMore/loading guards).
        const handleHistoryEdge = () => {
            try {
                const range = timeScale.getVisibleLogicalRange();
                if (range === null) return;
                if (range.from <= 6) onNearHistoryEdgeRef.current?.();
            } catch {
                // range not available yet
            }
        };
        timeScale.subscribeVisibleLogicalRangeChange(handleHistoryEdge);

        const handleResize = () => {
            const element = containerRef.current;
            if (!element) return;
            const nextWidth = element.clientWidth;
            if (nextWidth > 0) chart.resize(nextWidth, height);
        };
        const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(handleResize) : null;
        if (containerRef.current && resizeObserver) resizeObserver.observe(containerRef.current);
        window.addEventListener("resize", handleResize);
        handleResize();

        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener("resize", handleResize);
            markerPluginRef.current?.detach();
            markerPluginRef.current = null;
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            volumeSeriesRef.current = null;
            priceLineRefsForChart.clear();
            createdForRef.current = null;
            pushedCountRef.current = 0;
            firstPushedTimeRef.current = null;
            lastPushedTimeRef.current = null;
            lastPushedDataRef.current = [];
            followingLiveRef.current = true;
        };
        // `width` is intentionally excluded: the resize handler keeps the
        // canvas in sync without rebuilding the series.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chartType, height]);

    // Feed data: full setData on first load / type switch, incremental
    // updates for live tails.
    useEffect(() => {
        const series = seriesRef.current;
        const chart = chartRef.current;
        if (!series || !chart) return;

        const clean = candles.filter(
            (c) =>
                c &&
                typeof c.time === "number" &&
                Number.isFinite(c.open) &&
                Number.isFinite(c.high) &&
                Number.isFinite(c.low) &&
                Number.isFinite(c.close)
        );

        if (clean.length === 0) {
            series.setData([]);
            volumeSeriesRef.current?.setData([]);
            pushedCountRef.current = 0;
            firstPushedTimeRef.current = null;
            lastPushedTimeRef.current = null;
            lastPushedDataRef.current = [];
            return;
        }

        // Prepend detection (older history page arrived at the front while the
        // tail is unchanged or newer). Capture the logical range and shift it
        // by the prepend size after setData so the exact same candles stay on
        // screen — scrolling back must never jump or re-zoom the chart.
        const prepended =
            pushedCountRef.current > 0 &&
            clean.length > pushedCountRef.current &&
            firstPushedTimeRef.current !== null &&
            clean[0].time < firstPushedTimeRef.current &&
            lastPushedTimeRef.current !== null &&
            clean[clean.length - 1].time >= lastPushedTimeRef.current;
        let restoreRange: { from: number; to: number } | null = null;
        if (prepended) {
            try {
                const range = chart.timeScale().getVisibleLogicalRange();
                if (range && firstPushedTimeRef.current !== null) {
                    const prependCount = countPrependedBars(clean, firstPushedTimeRef.current);
                    if (prependCount > 0) {
                        restoreRange = shiftLogicalRangeForPrepend(range, 0, prependCount);
                    }
                }
            } catch {
                restoreRange = null;
            }
        }

        // Incremental paths are only safe when every already-pushed bar
        // except the forming tail is unchanged. This handles same-bar ticks
        // and one-bar appends without re-seeding thousands of candles, while
        // a provider history rewrite still takes the full setData path.
        const previousData = lastPushedDataRef.current;
        const previousCount = pushedCountRef.current;
        const comparableCount = Math.max(0, Math.min(previousData.length, clean.length) - 1);
        let stablePrefix = previousCount > 0 && clean.length >= previousCount && previousData.length === previousCount;
        for (let i = 0; stablePrefix && i < comparableCount; i++) {
            const a = previousData[i];
            const b = clean[i];
            if (a.time !== b.time || a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close || (a.volume ?? 0) !== (b.volume ?? 0)) {
                stablePrefix = false;
            }
        }
        const sameLengthTailOnly = stablePrefix && clean.length === previousCount && clean[clean.length - 1].time === previousData[previousCount - 1].time;
        const oneBarAppend = stablePrefix && clean.length === previousCount + 1 && clean[previousCount - 1].time === previousData[previousCount - 1].time && clean[previousCount].time > previousData[previousCount - 1].time;
        const canIncrement = sameLengthTailOnly || oneBarAppend;
        const needsFullSet = pushedCountRef.current === 0 || (!prepended && !canIncrement);

        if (needsFullSet || prepended) {
            if (chartType === "line" || chartType === "area") {
                // Line/area series take a single value per time point, not
                // full candles.
                series.setData(
                    clean.map((c) => ({ time: c.time as UTCTimestamp, value: c.close }))
                );
            } else {
                series.setData(clean as never);
            }
            if (volumeSeriesRef.current) {
                volumeSeriesRef.current.setData(
                    clean.map((c) => ({
                        time: c.time as UTCTimestamp,
                        value: c.volume ?? 0,
                        color: c.close >= c.open ? "rgba(38, 166, 154, 0.6)" : "rgba(239, 83, 80, 0.6)",
                    }))
                );
            }
            if (restoreRange) {
                try {
                    chart.timeScale().setVisibleLogicalRange(restoreRange);
                } catch {
                    // timescale not ready — default view is acceptable
                }
            }
            pushedCountRef.current = clean.length;
            firstPushedTimeRef.current = clean[0].time;
            lastPushedTimeRef.current = clean[clean.length - 1].time;
            lastPushedDataRef.current = clean.map((c) => ({ ...c }));
            return;
        }

        // Incremental tail update (same forming bar) or finalize+append.
        const prevCount = pushedCountRef.current;
        const updateStart = oneBarAppend ? prevCount - 1 : clean.length - 1;
        for (let i = Math.max(0, updateStart); i < clean.length; i++) {
            const c = clean[i];
            try {
                if (chartType === "line" || chartType === "area") {
                    (series as ISeriesApi<"Line">).update({ time: c.time as UTCTimestamp, value: c.close });
                } else {
                    (series as ISeriesApi<"Candlestick">).update({
                        time: c.time as UTCTimestamp,
                        open: c.open,
                        high: c.high,
                        low: c.low,
                        close: c.close,
                    });
                }
                if (volumeSeriesRef.current && (i === clean.length - 1 || (oneBarAppend && i === prevCount - 1))) {
                    volumeSeriesRef.current.update({
                        time: c.time as UTCTimestamp,
                        value: c.volume ?? 0,
                        color: c.close >= c.open ? "rgba(38, 166, 154, 0.6)" : "rgba(239, 83, 80, 0.6)",
                    });
                }
            } catch {
                // Bar ordering violation after a history replace — force a
                // full set on the next pass.
                pushedCountRef.current = 0;
                return;
            }
        }
        pushedCountRef.current = clean.length;
        firstPushedTimeRef.current = clean[0].time;
        lastPushedTimeRef.current = clean[clean.length - 1].time;
        lastPushedDataRef.current = clean.map((c) => ({ ...c }));
        if (oneBarAppend && followingLiveRef.current) {
            try {
                chart.timeScale().scrollToRealTime();
            } catch {
                // time scale may not yet be initialized
            }
        }
    }, [candles, chartType]);

    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;

        for (const [id, existing] of priceLineRefs.current) {
            if (!priceLines.some((item) => item.id === id)) {
                series.removePriceLine(existing.line);
                priceLineRefs.current.delete(id);
            }
        }

        for (const item of priceLines) {
            if (!Number.isFinite(item.price) || item.price <= 0) continue;
            const signature = `${item.price}|${item.color}|${item.title}`;
            const existing = priceLineRefs.current.get(item.id);
            if (existing?.signature === signature) continue;
            if (existing) series.removePriceLine(existing.line);
            priceLineRefs.current.set(item.id, {
                line: series.createPriceLine({
                    price: item.price,
                    color: item.color,
                    lineWidth: 1,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: item.title,
                }),
                signature,
            });
        }
    }, [priceLines, chartType]);

    useEffect(() => {
        const plugin = markerPluginRef.current;
        if (!plugin) return;
        const candleTimes = candles.map((candle) => candle.time).filter(Number.isFinite);
        const firstTime = candleTimes[0];
        const lastTime = candleTimes[candleTimes.length - 1];
        const markers = tradeMarkers
            .filter((marker) => Number.isFinite(marker.time) && Number.isFinite(marker.price) && marker.price > 0)
            .filter((marker) => candleTimes.length > 0 && marker.time >= firstTime && marker.time <= lastTime)
            .map((marker) => {
                // Lightweight Charts requires markers to correspond to an actual
                // series time point. Snap to the nearest loaded candle so the
                // trade remains visible even when its timestamp is off-grid.
                let low = 0;
                let high = candleTimes.length - 1;
                while (low < high) {
                    const middle = Math.floor((low + high) / 2);
                    if (candleTimes[middle] < marker.time) low = middle + 1;
                    else high = middle;
                }
                const next = candleTimes[low];
                const previous = candleTimes[Math.max(0, low - 1)];
                const time = marker.time - previous <= next - marker.time ? previous : next;
                return {
                    id: marker.id,
                    time: time as UTCTimestamp,
                    position: "atPriceMiddle" as const,
                    price: marker.price,
                    shape: "circle" as const,
                    color: marker.side === "long" ? "#22c55e" : "#ef4444",
                    text: marker.label,
                };
            })
            .sort((a, b) => Number(a.time) - Number(b.time));
        plugin.setMarkers(markers);
    }, [tradeMarkers, chartType, candles]);

    return <div ref={containerRef} className="h-full w-full" />;
}
