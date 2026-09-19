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

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        if (chartRef.current) {
            chartRef.current.remove();
            chartRef.current = null;
        }

        const chart = createChart(container, {
            width,
            height,
            layout: {
                background: { color: "#0b1118" },
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
                mode: 0,
                vertLine: { color: "rgba(234, 123, 74, 0.5)", width: 1, style: 1 },
                horzLine: { color: "rgba(234, 123, 74, 0.5)", width: 1, style: 1 },
            },
        });

        chartRef.current = chart;
        onChartReady(chart);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let series: any;

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

        if (candles.length > 0) {
            series.setData(candles);
        }

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
                volSeries.setData(
                    candles.map((c) => ({
                        time: c.time as unknown as import("lightweight-charts").Time,
                        value: c.volume,
                        color: c.close >= c.open ? "rgba(38, 166, 154, 0.6)" : "rgba(239, 83, 80, 0.6)",
                    }))
                );
            } catch {
                // Volume series may fail if price scale already exists
            }
        }

        onSeriesReady?.(series);

        chart.timeScale().fitContent();
        chart.timeScale().scrollToRealTime();

        const handleResize = () => {
            if (!containerRef.current) return;
            chart.resize(containerRef.current.clientWidth, height);
        };
        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            chart.remove();
            chartRef.current = null;
        };
    }, [width, height, chartType, candles, onChartReady, onSeriesReady]);

    return <div ref={containerRef} className="h-full w-full" />;
}
