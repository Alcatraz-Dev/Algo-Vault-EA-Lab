"use client";

import { useEffect, useRef } from "react";
import {
    createChart,
    type IChartApi,
    type ISeriesApi,
    type UTCTimestamp,
    CandlestickSeries,
    HistogramSeries,
    ColorType,
    CrosshairMode,
} from "lightweight-charts";

/**
 * Homepage illustrative candlestick chart.
 *
 * Uses the platform's own financial chart engine (lightweight-charts v5 —
 * the same `createChart` + `CandlestickSeries` + `HistogramSeries` pattern
 * as `SignalChart`) so homepage previews read as real trading interfaces.
 *
 * Data is a deterministic seeded sample (mulberry32), fixed timestamps,
 * clearly labeled "Illustrative sample" wherever it is rendered — never
 * presented as live market data, and never connected to execution.
 * The series is static: no ticking, no fake real-time behaviour.
 *
 * Theming: colors are read from the design-token CSS variables at mount
 * and re-applied when the theme class on <html> changes (same
 * MutationObserver mechanism as ThemeToggle), so dark and light themes
 * both render correctly. Touch/scroll handling is disabled so the chart
 * never hijacks page scroll on mobile; hover crosshair still works.
 */

function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export type CandlePoint = {
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

export function buildSampleCandles(seed: number, basePrice: number, count: number, stepSeconds: number): CandlePoint[] {
    const rand = mulberry32(seed);
    // Fixed base time keeps the sample deterministic across renders.
    const baseTime = Date.UTC(2026, 7, 3, 8, 0, 0) / 1000;
    const candles: CandlePoint[] = [];
    let price = basePrice;
    for (let i = 0; i < count; i++) {
        const drift = Math.sin(i / 6.5) * basePrice * 0.0012 + (rand() - 0.485) * basePrice * 0.0035;
        const open = price;
        const close = Math.max(basePrice * 0.5, open + drift);
        const spread = basePrice * 0.0016 * (0.5 + rand());
        const high = Math.max(open, close) + spread * rand();
        const low = Math.min(open, close) - spread * rand();
        const volume = Math.round(40 + rand() * 160 + Math.abs(close - open) / (basePrice * 0.0004));
        candles.push({ time: (baseTime + i * stepSeconds) as UTCTimestamp, open, high, low, close, volume });
        price = close;
    }
    return candles;
}

function cssVar(name: string, fallback: string): string {
    if (typeof window === "undefined") return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function withAlpha(hex: string, alpha: string, fallback: string): string {
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alpha}` : fallback;
}
function readTheme() {
    return {
        background: cssVar("--card", "#121417"),
        text: cssVar("--muted-foreground", "#9aa0a8"),
        grid: "rgba(148,163,184,0.08)",
        border: cssVar("--border-color", "#262a31"),
        up: cssVar("--positive", "#34d399"),
        down: cssVar("--negative", "#f87171"),
    };
}

export default function HomeCandleChart({
    seed = 7,
    basePrice = 2650,
    precision = 2,
    count = 64,
    stepSeconds = 900,
    height = 220,
    showVolume = true,
    label = "Illustrative sample",
}: {
    seed?: number;
    basePrice?: number;
    precision?: number;
    count?: number;
    stepSeconds?: number;
    height?: number;
    showVolume?: boolean;
    label?: string;
}) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const applyTheme = (chart: IChartApi) => {
            const t = readTheme();
            chart.applyOptions({
                layout: {
                    background: { type: ColorType.Solid, color: t.background },
                    textColor: t.text,
                    fontSize: 11,
                    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
                    attributionLogo: false,
                },
                grid: {
                    vertLines: { color: t.grid },
                    horzLines: { color: t.grid },
                },
                rightPriceScale: { borderColor: t.border },
                timeScale: { borderColor: t.border, timeVisible: true, secondsVisible: false },
            });
            candleRef.current?.applyOptions({
                upColor: t.up,
                downColor: t.down,
                borderUpColor: t.up,
                borderDownColor: t.down,
                wickUpColor: t.up,
                wickDownColor: t.down,
            });
        };

        const chart = createChart(container, {
            width: container.clientWidth || 600,
            height,
            layout: {
                background: { type: ColorType.Solid, color: "#121417" },
                textColor: "#9aa0a8",
                fontSize: 11,
                fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: "rgba(148,163,184,0.08)" },
                horzLines: { color: "rgba(148,163,184,0.08)" },
            },
            rightPriceScale: {
                borderColor: "rgba(148,163,184,0.2)",
                scaleMargins: { top: 0.08, bottom: showVolume ? 0.28 : 0.08 },
            },
            timeScale: {
                borderColor: "rgba(148,163,184,0.2)",
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 2,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: "rgba(148,163,184,0.4)", width: 1, style: 2 },
                horzLine: { color: "rgba(148,163,184,0.4)", width: 1, style: 2 },
            },
            // Preview only: never capture scroll/scale gestures (page scroll
            // on mobile must keep working); hover crosshair still applies.
            handleScroll: false,
            handleScale: false,
        });
        chartRef.current = chart;

        candleRef.current = chart.addSeries(CandlestickSeries, {
            upColor: "#34d399",
            downColor: "#f87171",
            borderUpColor: "#34d399",
            borderDownColor: "#f87171",
            wickUpColor: "#34d399",
            wickDownColor: "#f87171",
            priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision },
        });

        if (showVolume) {
            volRef.current = chart.addSeries(HistogramSeries, {
                priceFormat: { type: "volume" },
                priceScaleId: "vol",
            });
            chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        }

        const candles = buildSampleCandles(seed, basePrice, count, stepSeconds);
        candleRef.current.setData(candles);
        if (showVolume && volRef.current) {
            const theme = readTheme();
            volRef.current.setData(
                candles.map((c) => ({
                    time: c.time,
                    value: c.volume,
                    color:
                        c.close >= c.open
                            ? withAlpha(theme.up, "55", "rgba(52,211,153,0.35)")
                            : withAlpha(theme.down, "55", "rgba(248,113,113,0.35)"),
                })),
            );
        }
        chart.timeScale().fitContent();
        applyTheme(chart);

        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const newW = Math.round(entry.contentRect.width);
                if (newW > 0) chart.applyOptions({ width: newW });
            }
        });
        ro.observe(container);

        const mo = new MutationObserver(() => {
            if (chartRef.current) {
                applyTheme(chartRef.current);
                if (showVolume && volRef.current) {
                    const theme = readTheme();
                    volRef.current.setData(
                        candles.map((c) => ({
                            time: c.time,
                            value: c.volume,
                            color:
                                c.close >= c.open
                                    ? withAlpha(theme.up, "55", "rgba(52,211,153,0.35)")
                                    : withAlpha(theme.down, "55", "rgba(248,113,113,0.35)"),
                        })),
                    );
                }
            }
        });
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

        return () => {
            ro.disconnect();
            mo.disconnect();
            chart.remove();
            chartRef.current = null;
            candleRef.current = null;
            volRef.current = null;
        };
    }, [seed, basePrice, precision, count, stepSeconds, height, showVolume]);

    return (
        <div
            ref={containerRef}
            style={{ height }}
            className="w-full overflow-hidden"
            role="img"
            aria-label={`${label} candlestick chart — sample data, not live market data`}
        />
    );
}
