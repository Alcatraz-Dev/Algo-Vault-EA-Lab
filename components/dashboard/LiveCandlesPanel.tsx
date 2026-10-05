"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
    CandlestickSeries,
    ColorType,
    CrosshairMode,
    HistogramSeries,
    createChart,
    type IChartApi,
    type ISeriesApi,
    type UTCTimestamp,
} from "lightweight-charts";
import { AlertTriangle, Loader2, Radio } from "lucide-react";
import { useLiveCandles } from "@/hooks/useLiveCandles";
import { cn } from "@/lib/utils";
import CountUp from "@/components/charts/CountUp";
import { trendProjection } from "./trend-projection";

/* Data-viz hexes: chart internals keep hardcoded series colours (see the design
   system rules) so lightweight-charts always receives a parseable colour. */
const UP = "#26a69a";
const DOWN = "#ef5350";
const UP_VOLUME = "rgba(38, 166, 154, 0.28)";
const DOWN_VOLUME = "rgba(239, 83, 80, 0.28)";
const PROJECTION_COLOR = "#38bdf8";

const QUALITY_LABELS: Record<string, string> = {
    live: "live feed",
    delayed: "delayed feed",
    stale: "stale feed",
    gap_detected: "gap repaired",
    market_closed: "market closed",
    synchronizing: "syncing",
    pristine: "clean history",
};

type ConnectionTone = "positive" | "warning" | "negative" | "muted";

function connectionTone(connection: string): ConnectionTone {
    if (connection === "live") return "positive";
    if (connection === "reconnecting") return "warning";
    if (connection === "error") return "negative";
    return "muted";
}

/** Digits that keep a price readable without floating-point noise. */
function priceDigits(value: number): number {
    if (value >= 100) return 2;
    if (value >= 1) return 5;
    return 6;
}

/** Read the AlgoVault theme tokens so the chart follows light/dark mode. */
function readCssColor(name: string, fallback: string): string {
    if (typeof window === "undefined" || typeof getComputedStyle !== "function") return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * LiveCandlesPanel — the live candle chart body used by the dashboard's
 * Live Chart widget.
 *
 * Reuses the canonical live feed (`useLiveCandles`, the same one behind
 * TradingChart / AdvancedChart) and lightweight-charts v5, created once per
 * symbol+timeframe and fed incrementally so the forming bar moves instead of
 * repainting the window. On top of the candles it draws an honest trend
 * projection (least-squares extension of the observed closes, see
 * trend-projection.ts) as a dashed price line — every value comes from
 * candles the feed returned; nothing is forecast or invented.
 */
export default function LiveCandlesPanel({
    symbol,
    timeframe,
    height = 240,
    badge,
    limit = 200,
}: {
    symbol: string;
    timeframe: string;
    height?: number;
    /** Extra chip in the header (bias, confidence…). */
    badge?: ReactNode;
    limit?: number;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const projectionLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
    const projectionPriceRef = useRef<number | null>(null);
    const seededRef = useRef(false);
    const lastBarRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);

    const {
        candles,
        currentPrice,
        isLive,
        isLoading,
        error,
        connection,
        quality,
    } = useLiveCandles(symbol, timeframe, { limit });

    const projection = useMemo(() => trendProjection(candles), [candles]);

    // ── chart lifecycle: one chart per symbol + timeframe + height ─────────
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const width = container.clientWidth || 600;
        const chart = createChart(container, {
            width,
            height,
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: readCssColor("--muted-foreground", "#94a3b8"),
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: readCssColor("--border", "rgba(148,163,184,0.12)") },
                horzLines: { color: readCssColor("--border", "rgba(148,163,184,0.12)") },
            },
            rightPriceScale: {
                borderColor: readCssColor("--border", "rgba(148,163,184,0.2)"),
                scaleMargins: { top: 0.12, bottom: 0.22 },
            },
            timeScale: {
                borderColor: readCssColor("--border", "rgba(148,163,184,0.2)"),
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 8,
                barSpacing: 6,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: "rgba(56,189,248,0.35)", width: 1, style: 1 },
                horzLine: { color: "rgba(56,189,248,0.35)", width: 1, style: 1 },
            },
        });
        chartRef.current = chart;

        candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: UP,
            downColor: DOWN,
            borderUpColor: UP,
            borderDownColor: DOWN,
            wickUpColor: UP,
            wickDownColor: DOWN,
            priceLineVisible: false,
        });

        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
            priceFormat: { type: "volume" },
            priceScaleId: "volume",
            lastValueVisible: false,
            priceLineVisible: false,
        });
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

        const observer = new ResizeObserver((entries) => {
            const next = Math.round(entries[0]?.contentRect.width ?? 0);
            if (next > 0) chart.applyOptions({ width: next });
        });
        observer.observe(container);

        return () => {
            observer.disconnect();
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
            projectionLineRef.current = null;
            projectionPriceRef.current = null;
            seededRef.current = false;
            lastBarRef.current = null;
        };
    }, [symbol, timeframe, height]);

    // ── data feed: seed once, then push the forming bar incrementally ──────
    useEffect(() => {
        const series = candleSeriesRef.current;
        const volumeSeries = volumeSeriesRef.current;
        if (!series || !volumeSeries || candles.length === 0) return;

        const bars = candles.map((c) => ({
            time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }));
        const volumes = candles.map((c) => ({
            time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
            value: c.volume ?? 0,
            color: c.close >= c.open ? UP_VOLUME : DOWN_VOLUME,
        }));

        if (!seededRef.current) {
            series.setData(bars);
            volumeSeries.setData(volumes);
            chartRef.current?.timeScale().fitContent();
            seededRef.current = true;
            lastBarRef.current = bars[bars.length - 1];
            return;
        }

        const last = bars[bars.length - 1];
        try {
            series.update(last);
            volumeSeries.update(volumes[volumes.length - 1]);
            lastBarRef.current = last;
        } catch {
            // Bar-ordering violation after a history replace → full reseed.
            series.setData(bars);
            volumeSeries.setData(volumes);
            chartRef.current?.timeScale().fitContent();
            lastBarRef.current = last;
        }
    }, [candles]);

    // ── dashed trend-projection line ───────────────────────────────────────
    useEffect(() => {
        const series = candleSeriesRef.current;
        if (!series) return;

        if (!projection || !Number.isFinite(projection.price)) {
            if (projectionLineRef.current) {
                try {
                    series.removePriceLine(projectionLineRef.current);
                } catch {
                    // The series may already be disposed after a symbol change.
                }
                projectionLineRef.current = null;
                projectionPriceRef.current = null;
            }
            return;
        }

        // Quantise to display precision so a live tick does not rebuild the
        // line on every poll — only a visible change does.
        const digits = priceDigits(projection.price);
        const quantised = Number(projection.price.toFixed(digits));
        if (projectionLineRef.current && projectionPriceRef.current === quantised) return;

        if (projectionLineRef.current) {
            try {
                series.removePriceLine(projectionLineRef.current);
            } catch {
                // The series may already be disposed after a symbol change.
            }
            projectionLineRef.current = null;
        }

        projectionPriceRef.current = quantised;
        projectionLineRef.current = series.createPriceLine({
            price: quantised,
            color: PROJECTION_COLOR,
            title: "PROJ",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
        });
    }, [projection, symbol, timeframe, height]);

    const lastBar = candles.length > 0 ? candles[candles.length - 1] : null;
    const prevBar = candles.length > 1 ? candles[candles.length - 2] : null;
    const changePercent =
        lastBar && prevBar && prevBar.close !== 0
            ? ((lastBar.close - prevBar.close) / prevBar.close) * 100
            : null;
    const price = currentPrice > 0 ? currentPrice : (lastBar?.close ?? 0);
    const tone = connectionTone(connection);
    const showLoading = isLoading && candles.length === 0;
    const showError = Boolean(error) && candles.length === 0;

    return (
        <div className="space-y-2.5">
            {/* Header — live status, identity and the animated price readout */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="relative flex h-1.5 w-1.5 shrink-0" title={`Connection: ${connection}`}>
                        {isLive ? (
                            <span
                                aria-hidden="true"
                                className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60"
                            />
                        ) : null}
                        <span
                            className={cn(
                                "relative inline-flex h-1.5 w-1.5 rounded-full",
                                tone === "positive" && "bg-positive",
                                tone === "warning" && "bg-warning",
                                tone === "negative" && "bg-negative",
                                tone === "muted" && "bg-muted-foreground"
                            )}
                        />
                    </span>
                    <span className="font-numeric truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                        {symbol} · {timeframe}
                    </span>
                    {badge}
                </div>

                <div className="flex items-baseline gap-2">
                    <CountUp
                        className="font-numeric text-xl font-semibold text-foreground"
                        value={price}
                        decimals={priceDigits(price)}
                        durationMs={500}
                    />
                    {changePercent !== null ? (
                        <span
                            className={cn(
                                "font-numeric rounded-full border px-1.5 py-0.5 text-[11px] font-medium",
                                changePercent > 0 && "border-positive/30 bg-positive/10 text-positive",
                                changePercent < 0 && "border-negative/30 bg-negative/10 text-negative",
                                changePercent === 0 && "border-border bg-muted text-muted-foreground"
                            )}
                        >
                            {changePercent >= 0 ? "+" : ""}
                            {changePercent.toFixed(2)}%
                        </span>
                    ) : null}
                </div>
            </div>

            {/* Chart */}
            {showError ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-negative/30 px-4 py-8 text-center">
                    <AlertTriangle size={18} className="text-negative" />
                    <p className="text-[13px] font-medium text-foreground">Live chart unavailable</p>
                    <p className="max-w-[38ch] text-xs text-muted-foreground">{error}</p>
                </div>
            ) : (
                <div className="relative">
                    <div
                        ref={containerRef}
                        className={cn("w-full", showLoading && "opacity-40")}
                        style={{ minHeight: height }}
                    />
                    {showLoading ? (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2">
                            <Loader2 size={14} className="animate-spin text-primary" />
                            <span className="text-xs text-muted-foreground">Loading live candles…</span>
                        </div>
                    ) : null}
                    {!showLoading && candles.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className="rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                                No candles for {symbol} {timeframe}
                            </span>
                        </div>
                    ) : null}
                </div>
            )}

            {/* Footer — feed honesty + what the dashed line actually is */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <Radio size={11} className={cn(isLive && "text-positive")} />
                    {candles.length} bars · {QUALITY_LABELS[quality] ?? quality}
                </span>
                {projection ? (
                    <span className="flex items-center gap-1.5">
                        <span
                            aria-hidden="true"
                            className="inline-block h-0 w-6 border-t border-dashed"
                            style={{ borderColor: PROJECTION_COLOR }}
                        />
                        Trend projection{" "}
                        <span className="font-numeric text-foreground">
                            {projection.price.toFixed(priceDigits(projection.price))}
                        </span>
                        <span
                            className={cn(
                                "font-numeric",
                                projection.direction === "up" && "text-positive",
                                projection.direction === "down" && "text-negative"
                            )}
                        >
                            {projection.direction === "up" ? "▲" : projection.direction === "down" ? "▼" : "■"}
                        </span>
                        <span className="font-numeric">
                            {projection.bars} bars · fit {projection.rSquared.toFixed(2)}
                        </span>
                    </span>
                ) : null}
            </div>
        </div>
    );
}
