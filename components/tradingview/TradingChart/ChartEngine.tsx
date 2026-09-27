"use client";

import { useEffect, useRef } from "react";
import {
    createChart,
    IChartApi,
    LineSeries,
    AreaSeries,
    BarSeries,
    CandlestickSeries,
    HistogramSeries,
    ColorType,
    CrosshairMode,
    type ISeriesApi,
    type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, ChartType } from "./types";

interface ChartEngineProps {
    width: number;
    height: number;
    chartType: ChartType;
    candles: Candle[];
    onChartReady: (chart: IChartApi) => void;
    onSeriesReady?: (series: unknown) => void;
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
    onChartReady,
    onSeriesReady,
}: ChartEngineProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ChartSeries | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const createdForRef = useRef<string | null>(null);
    const pushedCountRef = useRef(0);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

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

        const handleResize = () => {
            if (!containerRef.current) return;
            chart.resize(containerRef.current.clientWidth, height);
        };
        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            volumeSeriesRef.current = null;
            createdForRef.current = null;
            pushedCountRef.current = 0;
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
            return;
        }

        // Full reload when the series is empty, the history changed length
        // (reconcile / symbol / interval change), or the early bars moved —
        // incremental updates are only safe for a same-length tail patch.
        const needsFullSet =
            pushedCountRef.current === 0 ||
            clean.length !== pushedCountRef.current;

        if (needsFullSet) {
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
            pushedCountRef.current = clean.length;
            return;
        }

        // Incremental tail updates.
        const prevCount = pushedCountRef.current;
        for (let i = Math.max(0, prevCount - 1); i < clean.length; i++) {
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
                if (volumeSeriesRef.current && i === clean.length - 1) {
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
    }, [candles, chartType]);

    return <div ref={containerRef} className="h-full w-full" />;
}
