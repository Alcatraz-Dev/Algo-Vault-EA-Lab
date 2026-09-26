"use client";

import { useEffect, useRef, useState } from "react";
import {
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    createChart,
    type IChartApi,
    type ISeriesApi,
    type UTCTimestamp,
} from "lightweight-charts";
import { BarChart3, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPPORTED_SYMBOLS, type MarketCandle, type Timeframe } from "@/lib/market-data/types";
import type { PriceLevel } from "@/lib/ai/analysis/intelligence";
import { AwaitingState, TerminalPanel } from "@/components/scalping/TerminalPrimitives";
import { useAuthToken } from "@/lib/scalping/client";

/**
 * AdvancedChart — candles plus structure overlays.
 *
 * Deliberately a *new* component rather than a change to `ChartEngine`: the
 * existing engine tears down and recreates the chart on every candle change,
 * which is fine for its own use but wasteful for a workspace that re-fetches on
 * a poll. This one creates the chart once and feeds it incrementally with
 * `series.update()`, which is the correct lightweight-charts v5 pattern.
 *
 * Data comes from the existing `/api/analytics/ohlc` route. Nothing is
 * synthesised: if the route returns no candles the chart shows an explicit
 * unavailable state.
 */

export type AdvancedChartProps = {
    symbol: string;
    timeframe: Timeframe;
    /** Support / resistance bands measured by the analysis engine. */
    levels?: { support: PriceLevel[]; resistance: PriceLevel[] };
    /** Most recent swing points, used for the pivot markers. */
    swingHighs?: Array<{ price: number; timestamp: number }>;
    swingLows?: Array<{ price: number; timestamp: number }>;
    /** Horizontal reference, e.g. session VWAP from the analysis engine. */
    vwap?: number | null;
    height?: number;
    className?: string;
};

const MAX_CANDLES = 500;

type OhlcResponse = {
    success?: boolean;
    candles?: MarketCandle[];
    error?: string;
};

export function AdvancedChart({
    symbol,
    timeframe,
    levels,
    swingHighs,
    swingLows,
    vwap,
    height = 420,
    className,
}: AdvancedChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    /** Support/resistance price lines, tracked so they can be replaced cleanly. */
    const priceLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[]>([]);
    /** Guards against re-creating the chart when only props change. */
    const createdForRef = useRef<string | null>(null);

    /**
     * Fetch result is stored against the key it was requested for, and the
     * visible state is *derived* by comparing that key with the current request.
     *
     * This is what stops the chart from displaying the previous symbol's candles
     * underneath a loading overlay: a mismatched key renders nothing rather than
     * stale data. It also avoids setting state synchronously in the effect body.
     */
    const [result, setResult] = useState<{
        key: string;
        candles: MarketCandle[] | null;
        error: string | null;
    } | null>(null);
    const token = useAuthToken();

    const requestKey = `${symbol}:${timeframe}:${token ? "auth" : "anon"}`;
    const isCurrent = result?.key === requestKey;
    const candles = isCurrent ? result.candles : null;
    const error = isCurrent ? result.error : null;
    const loading = !isCurrent;

    // ── data ────────────────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const res = await fetch(
                    `/api/analytics/ohlc?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${MAX_CANDLES}`,
                    {
                        cache: "no-store",
                        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
                    }
                );
                const body = (await res.json()) as OhlcResponse;

                if (cancelled) return;

                if (!res.ok) {
                    setResult({
                        key: requestKey,
                        candles: null,
                        error: body?.error ?? `Chart data request failed (${res.status}).`,
                    });
                    return;
                }
                const data = body.candles ?? [];
                if (data.length === 0) {
                    setResult({
                        key: requestKey,
                        candles: null,
                        error:
                            "The market data provider returned no candles for this symbol and timeframe."
                    });
                    return;
                }
                setResult({ key: requestKey, candles: data, error: null });
            } catch (err) {
                if (cancelled) return;
                setResult({
                    key: requestKey,
                    candles: null,
                    error: err instanceof Error ? err.message : "Chart data request failed.",
                });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [symbol, timeframe, token, requestKey]);

    // ── chart lifecycle: create once per symbol+timeframe ──────────────────
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const key = `${symbol}:${timeframe}`;
        if (createdForRef.current === key && chartRef.current) return;
        if (createdForRef.current !== null) {
            chartRef.current?.remove();
            chartRef.current = null;
        }
        createdForRef.current = key;

        const palette = readPalette();

        const chart = createChart(container, {
            height,
            layout: {
                background: { color: palette.bg },
                textColor: palette.text,
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: palette.grid },
                horzLines: { color: palette.grid },
            },
            rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.12, bottom: 0.24 } },
            timeScale: { borderColor: palette.border, timeVisible: true, secondsVisible: false, rightOffset: 4 },
            crosshair: {
                vertLine: { color: palette.accent, labelBackgroundColor: palette.accent },
                horzLine: { color: palette.accent, labelBackgroundColor: palette.accent },
            },
            autoSize: true,
        });
        chartRef.current = chart;

        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: palette.positive,
            downColor: palette.negative,
            borderUpColor: palette.positive,
            borderDownColor: palette.negative,
            wickUpColor: palette.positive,
            wickDownColor: palette.negative,
        });
        candleSeriesRef.current = candleSeries;

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: "volume" },
            priceScaleId: "volume",
            lastValueVisible: false,
            priceLineVisible: false,
        });
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        volumeSeriesRef.current = volumeSeries;

        const vwapLine = chart.addSeries(LineSeries, {
            color: palette.accent,
            lineWidth: 1,
            lineStyle: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: "VWAP",
        });
        vwapSeriesRef.current = vwapLine;

        chart.timeScale().fitContent();

        const onResize = () => {
            // `autoSize` handles the container; nothing to do. Kept as a hook so
            // the intent is explicit if a fixed-width mode is added later.
        };
        window.addEventListener("resize", onResize);

        return () => {
            window.removeEventListener("resize", onResize);
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
            vwapSeriesRef.current = null;
            priceLinesRef.current = [];
            createdForRef.current = null;
        };
    }, [symbol, timeframe, height]);

    // ── data feed ──────────────────────────────────────────────────────────
    //
    // A full `setData` is used rather than a per-candle `update()`: each poll
    // replaces the whole ≤500-bar window (and the forming bar's close may have
    // changed), so there is no single bar to patch. This is the path
    // lightweight-charts recommends for a bounded window, and it keeps the
    // chart correct when a provider revises an earlier bar.
    useEffect(() => {
        const candleSeries = candleSeriesRef.current;
        const volumeSeries = volumeSeriesRef.current;
        if (!candleSeries || !volumeSeries || !candles) return;

        candleSeries.setData(
            candles.map((c) => ({
                time: (c.timestamp / 1000) as UTCTimestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
            }))
        );
        volumeSeries.setData(
            candles.map((c) => ({
                time: (c.timestamp / 1000) as UTCTimestamp,
                value: c.volume ?? 0,
                color: c.close >= c.open ? "rgba(oklch(0.55 0.18 142) / 0.4)" : "rgba(oklch(0.577 0.245 27.32) / 0.4)",
            }))
        );
    }, [candles]);

    // ── overlays ───────────────────────────────────────────────────────────
    //
    // These effects are keyed on `candles` and `height` rather than on the
    // series refs. Both are reactive values, so no ref is read during render:
    //   • a symbol/timeframe change re-creates the chart *and* changes
    //     `candles` (new request key), so the overlays are re-applied;
    //   • a `height` change re-creates the chart and re-runs this effect.
    // The refs are only dereferenced inside the effect bodies, which is where
    // reading them is legitimate.
    useEffect(() => {
        const candleSeries = candleSeriesRef.current;
        if (!candleSeries) return;

        const support = (levels?.support ?? []).map((l) => ({
            price: l.price,
            color: "rgba(oklch(0.55 0.18 142) / 0.55)",
            lineWidth: 1 as const,
            lineStyle: 2 as const,
            axisLabelVisible: true,
            title: `S · ${l.touches} touch${l.touches === 1 ? "" : "es"}`,
        }));

        const resistance = (levels?.resistance ?? []).map((l) => ({
            price: l.price,
            color: "rgba(oklch(0.577 0.245 27.32) / 0.55)",
            lineWidth: 1 as const,
            lineStyle: 2 as const,
            axisLabelVisible: true,
            title: `R · ${l.touches} touch${l.touches === 1 ? "" : "es"}`,
        }));

        // v5 exposes `createPriceLine` (singular). The returned handles are kept
        // so the lines are removed before being re-created, otherwise every
        // re-render would stack another copy on the chart.
        priceLinesRef.current.forEach((line) => {
            try {
                candleSeries.removePriceLine(line);
            } catch {
                // The series may already be disposed if the symbol changed.
            }
        });
        priceLinesRef.current = [...support, ...resistance].map((line) =>
            candleSeries.createPriceLine(line)
        );
    }, [candles, levels, height]);

    useEffect(() => {
        const vwapLine = vwapSeriesRef.current;
        if (!vwapLine) return;
        if (vwap === null || vwap === undefined || !Number.isFinite(vwap)) {
            // Remove rather than zero-fill: a flat line at 0 would be a lie.
            vwapLine.setData([]);
            return;
        }
        if (!candles || candles.length === 0) return;
        vwapLine.setData(
            candles.map((c) => ({ time: (c.timestamp / 1000) as UTCTimestamp, value: vwap as number }))
        );
    }, [vwap, candles, height]);

    const levelCount = (levels?.support.length ?? 0) + (levels?.resistance.length ?? 0);
    const pivotCount = (swingHighs?.length ?? 0) + (swingLows?.length ?? 0);

    return (
        <TerminalPanel
            title="Price & Structure"
            icon={<BarChart3 className="size-3.5" />}
            meta={`${symbol} · ${timeframe}${candles ? ` · ${candles.length} bars` : ""}`}
            dense
            className={className}
            action={
                levelCount > 0 || pivotCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Layers className="size-3" />
                        {levelCount} level{levelCount === 1 ? "" : "s"} · {pivotCount} pivot
                        {pivotCount === 1 ? "" : "s"}
                    </span>
                ) : null
            }
        >
            {error ? (
                <div className="p-3">
                    <AwaitingState compact reason={error} />
                </div>
            ) : (
                <div className="relative">
                    <div
                        ref={containerRef}
                        className={cn("w-full", loading && candles === null && "opacity-40")}
                        style={{ minHeight: height }}
                    />
                    {loading && candles === null ? (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <span className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
                                Loading candles…
                            </span>
                        </div>
                    ) : null}
                    {candles === null && !error && !loading ? (
                        <div className="p-3">
                            <AwaitingState compact reason="No chart data has been requested yet." />
                        </div>
                    ) : null}
                </div>
            )}

            <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                Candles from the AlgoVault OHLC feed. Horizontal lines are support/resistance
                clustered from counted swing touches; the dashed line is the measured VWAP. Pivots:{" "}
                {pivotCount > 0 ? `${pivotCount} measured swing point${pivotCount === 1 ? "" : "s"}.` : "none detected on this timeframe."}
            </p>
        </TerminalPanel>
    );
}

/** Read the live AlgoVault CSS custom properties so the chart follows the theme. */
function readPalette() {
    const read = (name: string, fallback: string) => {
        if (typeof window === "undefined") return fallback;
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    };
    return {
        bg: read("--card", "oklch(0.16 0.01 260)"),
        text: read("--muted-foreground", "oklch(0.65 0.02 260)"),
        grid: read("--border", "oklch(0.28 0.01 260)"),
        border: read("--border", "oklch(0.28 0.01 260)"),
        accent: read("--primary", "#ff4d00"),
        positive: read("--positive", "oklch(0.55 0.18 142)"),
        negative: read("--negative", "oklch(0.577 0.245 27.32)"),
    };
}

export const ADVANCED_CHART_SYMBOLS = SUPPORTED_SYMBOLS;
