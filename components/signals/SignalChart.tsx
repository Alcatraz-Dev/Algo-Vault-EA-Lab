"use client";

import { useEffect, useRef, useState } from "react";
import {
    createChart,
    type IChartApi,
    type ISeriesApi,
    CandlestickSeries,
    HistogramSeries,
} from "lightweight-charts";
import type { AISignal } from "@/lib/ai-signals/types";

interface SignalChartProps {
    signal: AISignal;
    height?: number;
}

interface PriceLine {
    price: number;
    color: string;
    title: string;
    lineStyle?: 0 | 1 | 2;
    lineWidth?: 1 | 2 | 3 | 4;
}

interface CandlePoint {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// Map the signal's timeframe label onto the timeframe enum used by the
// canonical OHLC API (M1..D1). Unknown values are left as-is so the API
// validation can report an honest error instead of silently fabricating data.
function timeframeToSeconds(tf: string): number {
    const map: Record<string, number> = {
        M1: 60,
        M5: 300,
        M15: 900,
        M30: 1800,
        H1: 3600,
        H4: 14400,
        D1: 86400,
    };
    return map[String(tf).toUpperCase()] || 3600;
}

function timeframeParam(tf: string): string {
    const value = String(tf ?? "H1").toUpperCase();
    const known = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
    return known.includes(value) ? value : "H1";
}

function buildPriceLines(signal: AISignal): PriceLine[] {
    const lines: PriceLine[] = [];
    if (signal.entry) {
        lines.push({ price: signal.entry, color: "#38bdf8", title: "Entry", lineWidth: 2, lineStyle: 0 });
    }
    if (signal.stopLoss) {
        lines.push({ price: signal.stopLoss, color: "#f87171", title: "SL", lineWidth: 1, lineStyle: 2 });
    }
    if (signal.tp1) {
        lines.push({ price: signal.tp1, color: "#34d399", title: "TP1", lineWidth: 1, lineStyle: 2 });
    }
    if (signal.tp2) {
        lines.push({ price: signal.tp2, color: "#34d399", title: "TP2", lineWidth: 1, lineStyle: 2 });
    }
    if (signal.tp3) {
        lines.push({ price: signal.tp3, color: "#34d399", title: "TP3", lineWidth: 1, lineStyle: 2 });
    }
    return lines;
}

export default function SignalChart({ signal, height = 400 }: SignalChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const [width, setWidth] = useState(800);
    // Real market data from the canonical OHLC API — never fabricated candles.
    // Keyed by symbol|timeframe so a symbol change immediately shows the
    // loading state (derived from the key mismatch) instead of stale candles.
    const [market, setMarket] = useState<{
        key: string;
        candles: CandlePoint[] | null;
        error: string | null;
    }>({ key: "", candles: null, error: null });
    const requestKey = `${signal.symbol}|${timeframeParam(signal.timeframe)}`;
    const candles = market.key === requestKey ? market.candles : null;
    const marketError = market.key === requestKey ? market.error : null;

    useEffect(() => {
        if (!containerRef.current) return;
        setWidth(containerRef.current.clientWidth);
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setWidth(entry.contentRect.width);
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const ctrl = new AbortController();
        const key = requestKey;

        (async () => {
            try {
                const params = new URLSearchParams({
                    symbol: signal.symbol,
                    timeframe: timeframeParam(signal.timeframe),
                    limit: "150",
                });
                const res = await fetch(`/api/analytics/ohlc?${params.toString()}`, {
                    signal: ctrl.signal,
                    cache: "no-store",
                });
                const data = (await res.json().catch(() => ({}))) as {
                    candles?: Array<{
                        timestamp: number;
                        open: number;
                        high: number;
                        low: number;
                        close: number;
                        volume?: number;
                    }>;
                    error?: string;
                };
                if (!res.ok || !data?.candles?.length) {
                    setMarket({ key, candles: null, error: data?.error ?? "No market data available for this symbol/timeframe" });
                    return;
                }
                setMarket({
                    key,
                    candles: data.candles.map((c) => ({
                        time: Math.floor(c.timestamp / 1000),
                        open: c.open,
                        high: c.high,
                        low: c.low,
                        close: c.close,
                        volume: c.volume ?? 0,
                    })),
                    error: null,
                });
            } catch (err) {
                if ((err as Error)?.name !== "AbortError") {
                    setMarket({ key, candles: null, error: "Failed to load market data" });
                }
            }
        })();

        return () => ctrl.abort();
    }, [signal.symbol, signal.timeframe, requestKey]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        if (!candles || candles.length < 2) return;

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
                fontFamily: "Inter, -apple-system, sans-serif",
            },
            grid: {
                vertLines: { color: "rgba(148,163,184,0.05)" },
                horzLines: { color: "rgba(148,163,184,0.05)" },
            },
            rightPriceScale: {
                borderColor: "rgba(148,163,184,0.2)",
                scaleMargins: { top: 0.1, bottom: 0.2 },
            },
            timeScale: {
                borderColor: "rgba(148,163,184,0.2)",
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 3,
                barSpacing: 6,
            },
            crosshair: {
                mode: 0,
                vertLine: { color: "rgba(234,123,74,0.4)", width: 1, style: 1 },
                horzLine: { color: "rgba(234,123,74,0.4)", width: 1, style: 1 },
            },
        });

        chartRef.current = chart;

        const series = chart.addSeries(CandlestickSeries, {
            upColor: "#26a69a",
            downColor: "#ef5350",
            borderDownColor: "#ef5350",
            borderUpColor: "#26a69a",
            wickDownColor: "#ef5350",
            wickUpColor: "#26a69a",
        });
        seriesRef.current = series;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        series.setData(candles as any);

        for (const line of buildPriceLines(signal)) {
            series.createPriceLine({
                price: line.price,
                color: line.color,
                title: line.title,
                lineWidth: line.lineWidth ?? 1,
                lineStyle: line.lineStyle ?? 0,
                axisLabelVisible: true,
            });
        }

        const volSeries = chart.addSeries(HistogramSeries, {
            color: "#26a69a",
            priceFormat: { type: "volume" },
            priceScaleId: "vol",
        });
        chart.priceScale("vol").applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        });
        volSeries.setData(
            candles.map((c) => ({
                time: c.time as unknown as import("lightweight-charts").Time,
                value: c.volume,
                color: c.close >= c.open ? "rgba(38,166,154,0.4)" : "rgba(239,83,80,0.4)",
            }))
        );

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
            seriesRef.current = null;
        };
    }, [width, height, candles, signal, requestKey]);

    const timeframeLabel = timeframeToSeconds(signal.timeframe) >= 86400 ? "D1" : signal.timeframe;

    return (
        <div className="rounded-2xl border border-border/20 bg-gradient-to-br from-background/80 via-background/40 to-background/80 backdrop-blur-xl p-5">
            <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Price Chart
                </h3>
                <div className="flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-0.5 w-3 bg-sky-400" />
                        <span className="text-foreground/70">Entry</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-0.5 w-3 bg-rose-400" />
                        <span className="text-foreground/70">SL</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block h-0.5 w-3 bg-emerald-400" />
                        <span className="text-foreground/70">TP</span>
                    </span>
                </div>
            </div>
            <div className="relative w-full" style={{ height }}>
                <div ref={containerRef} className="w-full" style={{ height }} />
                {marketError ? (
                    <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-border bg-background/60 backdrop-blur-sm">
                        <div className="max-w-xs text-center">
                            <p className="text-xs font-medium text-muted-foreground">
                                Real-time chart unavailable
                            </p>
                            <p className="mt-1 text-[11px] leading-5 text-muted-foreground/70">
                                {marketError} — the market data provider returned no candles for{" "}
                                {signal.symbol} {timeframeLabel}.
                            </p>
                        </div>
                    </div>
                ) : candles === null ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">Loading market data…</span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}