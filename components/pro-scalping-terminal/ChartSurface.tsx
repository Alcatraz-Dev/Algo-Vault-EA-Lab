"use client";

/**
 * ChartSurface — the lightweight-charts *surface* behind ProTerminalChart.
 *
 * Phase 3A ownership extraction. This module owns the low-level chart
 * instance and everything that is purely a property of that instance:
 *
 *   • the container element lightweight-charts draws into
 *   • `createChart` and the initial layout / grid / crosshair / scale /
 *     interaction options (plus the pre-hydration fallback palette)
 *   • chart-level option application when the resolved settings change
 *   • the container ResizeObserver
 *   • the instance lifecycle: created once on mount, removed once on unmount
 *
 * It deliberately does NOT own:
 *
 *   • viewport policy. `lib/chart-engine/viewport.ts` (ViewportController)
 *     stays the single authority — the surface only hands the caller the
 *     time-scale of the instance it built, and never classifies a range,
 *     follows live or compensates a prepend itself.
 *   • market data. ChartDataEngine / useLiveCandles keep fetching,
 *     reconciling and paginating history; nothing here reads a candle.
 *   • series and panes. Candles, alternate chart types, volume, VWAP/EMA, the
 *     indicator layers and Pine studies are still created by
 *     ProTerminalChart (SeriesRenderer / IndicatorRenderer are later, separate
 *     extractions). The panes those layers stack belong to *their* lifecycle,
 *     not the chart's, so pane topology is intentionally untouched here.
 *   • drawings, markers, price lines, the anchored overlay and the HUD.
 *
 * The contract is imperative on purpose: the container and the live chart
 * instance are exchanged through refs the caller owns, so ProTerminalChart's
 * existing `chartRef.current` / `containerRef.current` reads keep working and
 * the effects that build series, attach the overlay and wire the viewport run
 * in the exact order they did before the extraction.
 */

import { useEffect, useRef, type RefObject } from "react";
import {
    createChart,
    ColorType,
    CrosshairMode,
    LineStyle,
    type IChartApi,
} from "lightweight-charts";
import type { ChartSettings } from "./chart-settings";

/**
 * Chart view themes — fallback values used before the user's persisted
 * ChartSettings hydrate (and for callers that do not pass settings).
 * Kept pixel-identical to the `midnight` / `light` presets in
 * chart-settings.ts so the chart never flashes a different palette.
 */
const THEME_OPTIONS = {
    light: {
        gridColor: "rgba(148, 163, 184, 0.22)",
        textColor: "#546a82",
        crosshairColor: "rgba(234, 123, 74, 0.55)",
        uiBackground: "#ffffff",
    },
    dark: {
        gridColor: "rgba(148, 163, 184, 0.08)",
        textColor: "#8b98ad",
        crosshairColor: "rgba(255, 255, 255, 0.35)",
        uiBackground: "#0b0f17",
    },
} as const;

/**
 * `data-chart-theme` is written by the chart toolbar and persisted
 * per-symbol; it is the surface's own presentation input, read at creation
 * time (never during render — this module server-renders).
 */
function resolveSurfaceTheme(): keyof typeof THEME_OPTIONS {
    return document.documentElement.dataset.chartTheme === "light" ? "light" : "dark";
}

export type ChartSurfaceProps = {
    /** Resolved view settings — only their chart-level (non-series) subset is applied here. */
    settings: ChartSettings;
    /** Grid visibility (toolbar toggle) folded into the chart's grid options. */
    gridVisible: boolean;
    /** Bar spacing in px applied once at creation (0 keeps the library default). */
    barSpacing: number;
    /** Container cursor, derived from the active drawing tool. */
    cursor?: string;
    /** Filled by the surface with the live chart instance; cleared on teardown. */
    chartRef: RefObject<IChartApi | null>;
    /** Filled by the surface with its container element (the caller's drawing math). */
    containerRef: RefObject<HTMLDivElement | null>;
    /**
     * Container content-box size changes. Reported instead of applied so the
     * caller keeps its own container-size state (SVG overlay) and the single
     * viewport authority (`ViewportController.handleResize()`).
     */
    onResize: (size: { w: number; h: number }) => void;
    /**
     * Fired once the instance exists, and again with `null` on teardown.
     *
     * The caller uses this instead of reading `chartRef.current` from its own
     * mount effect: the surface is the *only* owner of the instance lifecycle,
     * so this is the single deterministic signal that series / renderers /
     * viewport wiring may run. Without it the caller would depend on child-before-parent
     * effect ordering to ever see a chart.
     */
    onReady?: (chart: IChartApi | null) => void;
};

export function ChartSurface({
    settings,
    gridVisible,
    barSpacing,
    cursor,
    chartRef,
    containerRef,
    onResize,
    onReady,
}: ChartSurfaceProps) {
    // Latest-handler mirror so the observer below subscribes once while still
    // calling the current callback (no re-subscription churn per render).
    const onResizeRef = useRef(onResize);
    useEffect(() => {
        onResizeRef.current = onResize;
    }, [onResize]);

    // Same mirror for the readiness signal, so the creation effect can stay
    // dependency-free without capturing a stale callback.
    const onReadyRef = useRef(onReady);
    useEffect(() => {
        onReadyRef.current = onReady;
    }, [onReady]);

    // Created once, at mount (`useRef`'s initial value), so the chart instance
    // can never be rebuilt by a later settings/theme change.
    const barSpacingRef = useRef(barSpacing);

    // ── Create the chart once ───────────────────────────────────────────────
    // `autoSize` owns the canvas size, and the explicit canvas background is
    // re-applied here: `autoSize` + transparent-swap is unreliable across
    // browsers. Creation-once is what keeps the instance lifecycle stable.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const t = THEME_OPTIONS[resolveSurfaceTheme()];

        const chart = createChart(container, {
            autoSize: true,
            layout: {
                background: { type: ColorType.Solid, color: t.uiBackground },
                textColor: t.textColor,
                fontFamily: "var(--font-sans, Inter), var(--font-numeric, monospace), sans-serif",
                fontSize: 11,
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: t.gridColor, style: LineStyle.Solid },
                horzLines: { color: t.gridColor, style: LineStyle.Solid },
            },
            rightPriceScale: {
                borderColor: t.gridColor,
                scaleMargins: { top: 0.10, bottom: 0.18 },
            },
            timeScale: {
                borderColor: t.gridColor,
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 6,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: t.crosshairColor, labelBackgroundColor: t.uiBackground, width: 1, style: LineStyle.Dashed },
                horzLine: { color: t.crosshairColor, labelBackgroundColor: t.uiBackground, width: 1, style: LineStyle.Dashed },
            },
            // Free movement: the chart pans in every direction (including a
            // vertical price-scale drag) and zooms by wheel/pinch — the
            // settings panel can lock it back down via display.freeMove.
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: true,
                horzTouchDrag: true,
                vertTouchDrag: true,
            },
            handleScale: {
                axisPressedMouseMove: { time: true, price: true },
                mouseWheel: true,
                pinch: true,
            },
        });
        chart.applyOptions({
            layout: { background: { type: ColorType.Solid, color: t.uiBackground } },
        });
        // lightweight-charts v5 has no per-series `barWidth`: candle width is a
        // horizontal-scale concern (`barSpacing` on the time scale), so the
        // user's px setting is applied there (0 = auto, keep the default).
        const spacing = barSpacingRef.current;
        if (spacing > 0) {
            chart.applyOptions({
                timeScale: {
                    barSpacing: spacing,
                    minBarSpacing: spacing,
                },
            });
        }

        chartRef.current = chart;
        onReadyRef.current?.(chart);

        return () => {
            // The surface owns the instance lifecycle: clear the caller's
            // accessor and remove the chart exactly once.
            chartRef.current = null;
            onReadyRef.current?.(null);
            chart.remove();
        };
        // Creation-once by design — see the block comment above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Chart-level options follow the resolved settings ────────────────────
    // Pure view options — no data refetch, no viewport change (except
    // re-enabling the price auto-scale the user explicitly asked for). Series
    // colours/visibility stay in ProTerminalChart: they belong to the series,
    // not to the surface.
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const t = settings.colors;
        const gridOn = gridVisible && settings.display.grid;
        try {
            chart.applyOptions({
                layout: {
                    background: { type: ColorType.Solid, color: t.background },
                    textColor: t.text,
                },
                grid: {
                    vertLines: { color: gridOn ? t.grid : "transparent" },
                    horzLines: { color: gridOn ? t.grid : "transparent" },
                },
                rightPriceScale: {
                    borderColor: gridOn ? t.grid : "transparent",
                    autoScale: settings.display.autoScale,
                },
                timeScale: { borderColor: gridOn ? t.grid : "transparent" },
                crosshair: {
                    vertLine: { color: t.crosshair, labelBackgroundColor: t.background },
                    horzLine: { color: t.crosshair, labelBackgroundColor: t.background },
                },
                handleScroll: settings.display.freeMove
                    ? { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true }
                    : false,
                handleScale: settings.display.freeMove
                    ? { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true }
                    : false,
            });
        } catch {
            // chart may have been removed between renders
        }
    }, [gridVisible, settings, chartRef]);

    // ── Resize observation ──────────────────────────────────────────────────
    // `autoSize` resizes the canvas; this observer exists so the caller can
    // re-run its SVG overlay math and let the viewport controller re-assert a
    // live edge (a panned viewport deliberately receives no viewport call).
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                onResizeRef.current({ w: entry.contentRect.width, h: entry.contentRect.height });
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [containerRef]);

    return (
        <div
            ref={containerRef}
            className="absolute inset-0"
            style={{ cursor: cursor ?? "default" }}
        />
    );
}
