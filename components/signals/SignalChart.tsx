"use client";

import { useEffect, useMemo, useRef } from "react";
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
import type { AISignal } from "@/lib/ai-signals/types";
import { useLiveCandles } from "@/hooks/useLiveCandles";

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
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    const seededRef = useRef(false);

    // Live candles: initial history + real-time tick merge + periodic
    // reconciliation, shared with every other chart in the app.
    const { candles: liveCandles, error: marketError, isLoading: loading } = useLiveCandles(
        signal.symbol,
        timeframeParam(signal.timeframe),
        { limit: 150 }
    );

    /** Support/resistance price lines, recreated when the signal's levels change. */
    const priceLines = useMemo(() => buildPriceLines(signal), [signal]);
    const priceLineKey = useMemo(
        () => priceLines.map((l) => `${l.price}:${l.title}`).join("|"),
        [priceLines]
    );

    // ── chart lifecycle: create once ────────────────────────────────────
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const chart = createChart(container, {
            height,
            layout: {
                background: { type: ColorType.Solid, color: "#0b1118" },
                textColor: "#94a3b8",
                fontFamily: "Inter, -apple-system, sans-serif",
                attributionLogo: false,
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
                mode: CrosshairMode.Normal,
                vertLine: { color: "rgba(234,123,74,0.4)", width: 1, style: 1 },
                horzLine: { color: "rgba(234,123,74,0.4)", width: 1, style: 1 },
            },
            autoSize: true,
        });
        chartRef.current = chart;

        seriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: "#26a69a",
            downColor: "#ef5350",
            borderDownColor: "#ef5350",
            borderUpColor: "#26a69a",
            wickDownColor: "#ef5350",
            wickUpColor: "#26a69a",
        });

        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
            color: "#26a69a",
            priceFormat: { type: "volume" },
            priceScaleId: "vol",
        });
        chart.priceScale("vol").applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        });

        return () => {
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            volumeSeriesRef.current = null;
            priceLinesRef.current = [];
            seededRef.current = false;
        };
    }, [height]);

    // ── data feed: seed once, then incremental tail updates ─────────────
    useEffect(() => {
        const series = seriesRef.current;
        const volSeries = volumeSeriesRef.current;
        if (!series || !volSeries || liveCandles.length === 0) return;

        const bars = liveCandles.map((c) => ({
            time: (Math.floor(c.timestamp / 1000) as number) as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }));
        const volumes = liveCandles.map((c) => ({
            time: (Math.floor(c.timestamp / 1000) as number) as UTCTimestamp,
            value: c.volume ?? 0,
            color: c.close >= c.open ? "rgba(38,166,154,0.4)" : "rgba(239,83,80,0.4)",
        }));

        if (!seededRef.current) {
            series.setData(bars);
            volSeries.setData(volumes);
            chartRef.current?.timeScale().fitContent();
            chartRef.current?.timeScale().scrollToRealTime();
            seededRef.current = true;
            return;
        }

        // Tail update: only the last bar can change between renders.
        const last = bars[bars.length - 1];
        try {
            series.update(last);
            volSeries.update(volumes[volumes.length - 1]);
        } catch {
            // Ordering violation after a history replace — reseed once.
            series.setData(bars);
            volSeries.setData(volumes);
            chartRef.current?.timeScale().fitContent();
        }
    }, [liveCandles]);

    // ── entry/SL/TP price lines — recreated only when their values change ──
    useEffect(() => {
        const series = seriesRef.current;
        if (!series) return;

        for (const line of priceLinesRef.current) {
            try {
                series.removePriceLine(line);
            } catch {
                // line already gone with the series
            }
        }
        priceLinesRef.current = priceLines.map((line) =>
            series.createPriceLine({
                price: line.price,
                color: line.color,
                title: line.title,
                lineWidth: line.lineWidth ?? 1,
                lineStyle: line.lineStyle ?? 0,
                axisLabelVisible: true,
            })
        );
    }, [priceLines, priceLineKey, liveCandles]);

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
                ) : loading && liveCandles.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">Loading market data…</span>
                    </div>
                ) : liveCandles.length > 0 ? (
                    <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full border border-border/40 bg-background/80 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur-sm">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                        Live
                    </div>
                ) : null}
            </div>
        </div>
    );
}