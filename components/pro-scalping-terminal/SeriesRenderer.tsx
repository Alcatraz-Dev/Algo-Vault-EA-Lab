"use client";

/**
 * SeriesRenderer — owner of the Pro Terminal *price and volume series*.
 *
 * Phase 3B ownership extraction. This module owns the first separable slice of
 * the chart's series:
 *
 *   • the primary candlestick series
 *   • the alternate price series (line / area / baseline / bar) — created once,
 *     hidden by default, switched visible by chart type
 *   • the volume histogram and its `vol` price scale
 *   • their lifecycle: create once on attach, keep inactive types hidden,
 *     drop every handle on detach (the chart instance itself is removed by
 *     ChartSurface, which owns it)
 *   • their series data: the full candle/volume commit, the incremental
 *     forming-bar update, the empty-dataset clear, and the alternate-series
 *     feed the chart-type switch uses
 *   • their appearance: the resolved candle/bar colors and volume visibility
 *
 * It deliberately does NOT own:
 *
 *   • viewport policy. It never imports ViewportController, never touches a
 *     logical range, never follows live, never compensates a prepend, never
 *     calls fitContent / scrollToRealTime and never classifies a range. If
 *     changing a series makes lightweight-charts adjust its logical range,
 *     that stays implicit in the library — the renderer never compensates.
 *   • market data. No ChartDataEngine / useLiveCandles / history loading /
 *     reconciliation / normalization. It renders the candles it is handed.
 *   • the indicator and strategy layers (VWAP/EMA, BB/KC/DC, RSI, MACD,
 *     stochastic, ATR, Supertrend, Ichimoku, PSAR, delta, Pine studies).
 *     VWAP/EMA9/EMA20 stay in ProTerminalChart during this phase: they share
 *     the live candle commit that is welded to the viewport's prepend
 *     detection, so they are not separable yet. IndicatorRenderer is later,
 *     separate work.
 *   • drawings, markers, price lines, the anchored overlay and the HUD.
 *
 * ## Lifecycle ordering (must not be reordered)
 *
 * ProTerminalChart drives the sequence explicitly and calls into this class at
 * exactly one point:
 *
 *     ChartSurface creates chart
 *          ↓
 *     ProTerminalChart resets/attaches ViewportController
 *          ↓
 *     SeriesRenderer.attach()   ← creates the price + volume series
 *          ↓
 *     viewport subscriptions / wiring
 *          ↓
 *     data updates (setCandleData / setVolumeData / updateTail)
 *
 * This is why the renderer is a class invoked imperatively rather than a child
 * React component: a child's effects run *before* its parent's, which would
 * create the series before the viewport is attached. The imperative call keeps
 * the existing ordering byte-for-byte semantic.
 *
 * ## Handle contract
 *
 * The series handles stay as React refs owned by ProTerminalChart and are
 * handed in through `PriceSeriesRefs`. That preserves the existing access
 * contract (the parent, its overlays and the viewport smoke probe all read the
 * mounted series through `ref.current`); the renderer is the only *writer* of
 * those refs. Ref identities are stable, and the refs are already the parent's
 * accessor, so this is an explicit handle interface — not a shared mutable
 * context.
 */

import {
    AreaSeries,
    BarSeries,
    BaselineSeries,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    type IChartApi,
    type ISeriesApi,
    type LineWidth,
    type UTCTimestamp,
} from "lightweight-charts";
import type { RefObject } from "react";
import type { ChartType, Candle } from "./ProTerminalChart";
import type { ChartSettings } from "./chart-settings";

/** The five price-series shapes the chart can display. */
export type PriceSeries =
    | ISeriesApi<"Candlestick">
    | ISeriesApi<"Line">
    | ISeriesApi<"Area">
    | ISeriesApi<"Baseline">
    | ISeriesApi<"Bar">;

/** A single OHLC bar in seconds — what every price series consumes. */
export type PriceBar = {
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
};

/**
 * The parent's series slots. These refs are the access contract: ProTerminalChart
 * and the viewport smoke probe read the mounted series through them, so the
 * renderer is constructed with them and is their only writer.
 */
export type PriceSeriesRefs = {
    candle: RefObject<ISeriesApi<"Candlestick"> | null>;
    volume: RefObject<ISeriesApi<"Histogram"> | null>;
    line: RefObject<ISeriesApi<"Line"> | null>;
    area: RefObject<ISeriesApi<"Area"> | null>;
    baseline: RefObject<ISeriesApi<"Baseline"> | null>;
    bar: RefObject<ISeriesApi<"Bar"> | null>;
    /** The price series the user is actually looking at (overlays attach here). */
    activePrice: RefObject<PriceSeries | null>;
    /** Which price series currently owns the visible range. */
    activeType: RefObject<ChartType>;
};

/** Creation-time inputs resolved by the parent from its settings pipeline. */
export type SeriesRendererOptions = {
    colors: ChartSettings["colors"];
    /** Price precision of the active symbol (priceFormat). */
    pricePrecision: number;
    /** Line width for area/baseline, already narrowed to the library's union. */
    lineWidth: LineWidth;
    /** Volume layer state at creation time (clean chart by default). */
    volumeVisible: boolean;
};

/** Volume histogram colors — the same translucent up/down pair as before. */
const VOLUME_UP_COLOR = "rgba(38, 166, 154, 0.45)";
const VOLUME_DOWN_COLOR = "rgba(239, 83, 80, 0.45)";

const toSec = (ts: number): UTCTimestamp => Math.floor(ts / 1000) as UTCTimestamp;

export class SeriesRenderer {
    private readonly refs: PriceSeriesRefs;
    private chart: IChartApi | null = null;

    constructor(refs: PriceSeriesRefs) {
        this.refs = refs;
    }

    /** True once the price + volume series exist on a live chart. */
    isAttached(): boolean {
        return this.chart !== null && this.refs.candle.current !== null;
    }

    // ── creation ────────────────────────────────────────────────────────────
    /**
     * Create the candlestick, volume and alternate price series on `chart`.
     * Called once per chart instance, in the same effect and at the same point
     * the parent used to create them.
     */
    attach(chart: IChartApi, options: SeriesRendererOptions): void {
        const { colors, pricePrecision, lineWidth, volumeVisible } = options;
        const priceFormat = { type: "price" as const, precision: pricePrecision, minMove: 10 ** -pricePrecision };

        this.chart = chart;

        const candle = chart.addSeries(CandlestickSeries, {
            upColor: colors.bull,
            downColor: colors.bear,
            borderUpColor: colors.bull,
            borderDownColor: colors.bear,
            wickUpColor: colors.bull,
            wickDownColor: colors.bear,
            priceFormat,
            lastValueVisible: false,
        });
        // lightweight-charts v5 has no per-series `barWidth`: candle width is a
        // horizontal-scale concern (`barSpacing` on the time scale), applied
        // once by ChartSurface when it creates the instance (0 = auto).
        this.refs.candle.current = candle;

        // Volume is created but NOT shown by default — the layer panel decides.
        // It shares the candle palette so the chart stays cohesive.
        this.refs.volume.current = chart.addSeries(HistogramSeries, {
            priceScaleId: "vol",
            priceFormat: { type: "volume" },
            color: colors.bull,
            visible: volumeVisible,
        });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

        // Alt chart-type series — created once, hidden by default, switched
        // visible when chartType changes. All share the same price scale so any
        // overlay price lines stay anchored.
        this.refs.line.current = chart.addSeries(LineSeries, {
            color: "#38bdf8",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: true,
            visible: false,
        });
        this.refs.area.current = chart.addSeries(AreaSeries, {
            lineColor: colors.bull,
            topColor: colors.bullFill,
            bottomColor: colors.bullFill,
            lineWidth,
            priceLineVisible: false,
            lastValueVisible: true,
            visible: false,
        });
        this.refs.baseline.current = chart.addSeries(BaselineSeries, {
            baseValue: { type: "price", price: 0 },
            topLineColor: colors.bull,
            topFillColor1: colors.bullFill,
            topFillColor2: colors.bullFill,
            bottomLineColor: colors.bear,
            bottomFillColor1: colors.bearFill,
            bottomFillColor2: colors.bearFill,
            lineWidth,
            priceLineVisible: false,
            lastValueVisible: true,
            visible: false,
        });
        // v5 Bar series expose only up/down color (plus openVisible/thinBars), so
        // the preset's body colors are all a bar can carry.
        this.refs.bar.current = chart.addSeries(BarSeries, {
            upColor: colors.bull,
            downColor: colors.bear,
            priceFormat,
            visible: false,
        });

        this.refs.activeType.current = "candlestick";
        this.refs.activePrice.current = candle;
    }

    // ── lifecycle ───────────────────────────────────────────────────────────
    /**
     * Drop every series handle. The chart instance is owned by ChartSurface,
     * whose own cleanup removes it (and with it every series), so the renderer
     * nulls the parent's refs without calling removeSeries.
     */
    detach(): void {
        this.chart = null;
        this.refs.candle.current = null;
        this.refs.volume.current = null;
        this.refs.line.current = null;
        this.refs.area.current = null;
        this.refs.baseline.current = null;
        this.refs.bar.current = null;
        this.refs.activePrice.current = null;
        this.refs.activeType.current = "candlestick";
    }

    // ── appearance ──────────────────────────────────────────────────────────
    /**
     * Apply the resolved candle/bar colors and volume visibility. Pure view
     * options — no data refetch, no viewport change.
     */
    applyAppearance(colors: ChartSettings["colors"], volumeVisible: boolean): void {
        try {
            // MT5-style candle coloring: bull/bear body, border and wick all
            // follow the preset (or the user's custom swatch).
            this.refs.candle.current?.applyOptions({
                upColor: colors.bull,
                downColor: colors.bear,
                borderUpColor: colors.bull,
                borderDownColor: colors.bear,
                wickUpColor: colors.bull,
                wickDownColor: colors.bear,
            });
            this.refs.bar.current?.applyOptions({ upColor: colors.bull, downColor: colors.bear });
            this.refs.volume.current?.applyOptions({ visible: volumeVisible });
        } catch {
            // the series may already be gone with the chart
        }
    }

    /** Volume layer toggle — the only option that follows `layers.volume`. */
    setVolumeVisible(visible: boolean): void {
        try {
            this.refs.volume.current?.applyOptions({ visible });
        } catch {
            // the series may already be gone with the chart
        }
    }

    // ── data ────────────────────────────────────────────────────────────────
    /** Full commit of the candle series (bars are already deduped + ascending). */
    setCandleData(bars: PriceBar[]): void {
        this.refs.candle.current?.setData(bars);
    }

    /**
     * Full commit of the volume histogram, aligned 1:1 with the committed bars
     * and colored by candle direction.
     */
    setVolumeData(candles: Candle[], bars: PriceBar[]): void {
        const volume = this.refs.volume.current;
        if (!volume) return;
        volume.setData(
            bars.map((bar, i) => {
                const candle = candles[i];
                return {
                    time: bar.time,
                    value: candle?.volume ?? 0,
                    color: candle && candle.close >= candle.open ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR,
                };
            })
        );
    }

    /**
     * Incremental forming-bar update: `series.update()` for the candle and its
     * volume bar, so the live bar animates in place instead of redrawing.
     */
    updateTail(bars: PriceBar[], candles: Candle[]): void {
        const candleSeries = this.refs.candle.current;
        const volume = this.refs.volume.current;
        for (let i = 0; i < bars.length; i++) {
            const bar = bars[i];
            const candle = candles[i];
            candleSeries?.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
            volume?.update({
                time: bar.time,
                value: candle?.volume ?? 0,
                color: candle && candle.close >= candle.open ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR,
            });
        }
    }

    /**
     * Empty-dataset path: blank the price + volume series. VWAP/EMA are cleared
     * by the parent, which still owns them.
     */
    clearData(): void {
        this.refs.candle.current?.setData([]);
        this.refs.line.current?.setData([]);
        this.refs.area.current?.setData([]);
        this.refs.baseline.current?.setData([]);
        this.refs.bar.current?.setData([]);
        this.refs.volume.current?.setData([]);
    }

    // ── chart-type switching ────────────────────────────────────────────────
    /**
     * Feed the alternate price series from the SAME candles and switch which
     * one is visible. Never creates a series, never recreates the chart, never
     * touches the viewport or the data feed — so a type switch cannot reset
     * zoom, scroll or the symbol/timeframe context.
     */
    syncChartType(candles: Candle[], chartType: ChartType): void {
        const cs = this.refs.candle.current;
        const ls = this.refs.line.current;
        const as_ = this.refs.area.current;
        const bs = this.refs.baseline.current;
        const bars = this.refs.bar.current;
        if (!cs) return;

        // Duplicate opens are dropped (first wins) so every series shares the
        // exact timestamp axis the candle commit uses.
        const dedupe = (c: Candle, i: number, arr: Candle[]) => i === arr.findIndex((x) => x.timestamp === c.timestamp);
        const closePts = candles
            .filter(dedupe)
            .map((c) => ({ time: toSec(c.timestamp), value: c.close }));
        const barPts = candles
            .filter(dedupe)
            .map((c) => ({ time: toSec(c.timestamp), open: c.open, high: c.high, low: c.low, close: c.close }));

        if (ls) { try { ls.setData(closePts); } catch { /* chart not ready */ } }
        if (as_) { try { as_.setData(closePts); } catch { /* chart not ready */ } }
        if (bs) {
            const mid = candles.length > 0 ? candles.reduce((sum, c) => sum + c.close, 0) / candles.length : 0;
            try {
                bs.applyOptions({ baseValue: { type: "price", price: mid } });
                bs.setData(closePts);
            } catch { /* chart not ready */ }
        }
        if (bars) { try { bars.setData(barPts); } catch { /* chart not ready */ } }

        // Publish which price series is on screen BEFORE the early return:
        // overlays (countdown line, AI plan) attach to this ref, and on the
        // very first pass the type is already correct yet still unassigned.
        this.refs.activePrice.current =
            chartType === "line" ? ls
            : chartType === "area" ? as_
            : chartType === "baseline" ? bs
            : chartType === "bar" ? bars
            : cs;

        if (this.refs.activeType.current === chartType) return;
        try {
            cs.applyOptions({ visible: chartType === "candlestick" });
            ls?.applyOptions({ visible: chartType === "line" });
            as_?.applyOptions({ visible: chartType === "area" });
            bs?.applyOptions({ visible: chartType === "baseline" });
            bars?.applyOptions({ visible: chartType === "bar" });
            this.refs.activeType.current = chartType;
        } catch {
            // chart not ready
        }
    }
}
