"use client";

/**
 * IndicatorRenderer — owner of the Pro Terminal *indicator series*.
 *
 * Phase 3C ownership extraction. This module owns the chart's conventional
 * indicator layers as *series*:
 *
 *   • Bollinger bands (basis / upper / lower)
 *   • Keltner channels (mid / upper / lower)
 *   • Donchian channels (upper / lower / mid)
 *   • Supertrend line (own pane)
 *   • Heikin-Ashi candles (main pane)
 *   • RSI (own pane) with its 30/70 guide price lines
 *   • MACD (own pane, lines + zero guide)
 *   • EMA 50 / EMA 200 / SMA 20 / SMA 50 / SMA 200 overlays
 *   • Ichimoku cloud edges (span A / span B)
 *   • Stochastic %K/%D (own pane) with its 20/80 guide price lines
 *   • ATR (own pane)
 *   • the estimated-delta pane (histogram + cumulative line)
 *
 * For each of them this module owns:
 *
 *   • creation — each series is created once, exactly when its layer turns on
 *   • pane topology — `chart.addPane()` / `removePane()` and the stretch
 *     factors that were previously applied from ProTerminalChart
 *   • removal — when the layer turns off (or the series is being replaced)
 *   • visibility — a series exists only while its layer is on; the toggled
 *     layers that keep a persistent series (RSI/MACD/Stochastic pane series)
 *     are created/removed exactly as before
 *   • appearance — colors, widths, guides, price formats (unchanged values)
 *   • data mutation — the `setData` calls for those series
 *   • cleanup — `detach()` drops every handle (the chart instance itself is
 *     removed by ChartSurface, which owns it)
 *
 * It deliberately does NOT own:
 *
 *   • indicator mathematics. Every value fed here is computed by
 *     ProTerminalChart through the same deterministic kernels it used before
 *     (`lib/pine-runtime/builtins` TA and the memoized core engine
 *     `alignedIndicatorSeries`) and handed over as an aligned array. No
 *     calculation engine is imported here, so this renderer can never become a
 *     second math path.
 *   • market data. No ChartDataEngine / useLiveCandles / history loading /
 *     reconciliation / normalization. It renders the arrays it is handed.
 *   • viewport policy. It never imports ViewportController, never touches a
 *     logical range, never follows live, never compensates a prepend and never
 *     calls fitContent / scrollToRealTime. Adding or removing a series can make
 *     lightweight-charts adjust its own logical range — that stays implicit in
 *     the library, exactly as it did before this extraction.
 *   • VWAP / EMA 9 / EMA 20 and the Pine studies. They still share the live
 *     candle commit that is welded to the viewport's prepend sequencing (and
 *     the study pane is created by their own effect), so they stay in
 *     ProTerminalChart for this phase.
 *   • drawings, markers, price lines of the trading overlays and the HUD.
 *
 * ## Lifecycle ordering (must not be reordered)
 *
 * ProTerminalChart drives the sequence explicitly:
 *
 *     ChartSurface creates chart
 *          ↓
 *     ProTerminalChart resets + attaches ViewportController
 *          ↓
 *     SeriesRenderer.attach()          ← price + volume series
 *          ↓
 *     IndicatorRenderer.attach(chart)  ← binds the instance only
 *          ↓
 *     viewport subscriptions / wiring
 *          ↓
 *     data commit (candles / volume / VWAP / EMA)
 *          ↓
 *     IndicatorRenderer.syncLayers()   ← creates/removes the indicator series
 *          ↓
 *     IndicatorRenderer.setData()      ← feeds the calculated arrays
 *
 * Two deliberate details:
 *
 *   1. `attach()` binds the chart instance but creates NOTHING. The indicator
 *      panes have to be appended in the component's existing effect order: the
 *      layer effect is declared *after* the Pine-study effect, so a study pane
 *      present at mount stacks above the RSI/MACD/… panes exactly as it did
 *      before. Creating the panes in the mount effect would flip that order.
 *   2. `syncLayers()` is idempotent (create-if-absent / remove-if-off), which
 *      is how the single call site serves both the initial mount and every
 *      later layer toggle.
 *
 * ## Handle contract
 *
 * The series handles stay as React refs owned by ProTerminalChart and are
 * handed in through `IndicatorSeriesRefs`, exactly like the Phase 3B
 * `PriceSeriesRefs`. That preserves the existing access contract: the parent's
 * data feed reads them to decide which calculations to run, and the viewport
 * smoke probe discovers series through the mounted React tree. Ref identities
 * are stable and the refs are already the parent's accessor, so this is an
 * explicit handle interface — not a shared mutable context.
 */

import {
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    LineStyle,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type UTCTimestamp,
} from "lightweight-charts";
import type { RefObject } from "react";
import { isLayerOn, type ChartLayerId } from "./chart-layers";
import type { ChartSettings } from "./chart-settings";
import type { Candle } from "./ProTerminalChart";

/** One aligned indicator series: same length as the candle array, NaN/null = no plot. */
export type IndicatorValues = Array<number | null>;

/**
 * The parent's indicator-series slots. These refs are the access contract:
 * ProTerminalChart (and the viewport smoke probe) read the mounted series
 * through them, so the renderer is constructed with them and is their only
 * writer.
 */
export type IndicatorSeriesRefs = {
    /** Bollinger bands (basis / upper / lower). */
    bb: RefObject<{ basis: ISeriesApi<"Line">; upper: ISeriesApi<"Line">; lower: ISeriesApi<"Line"> } | null>;
    /** Keltner channels (mid / upper / lower). */
    kc: RefObject<{ mid: ISeriesApi<"Line">; upper: ISeriesApi<"Line">; lower: ISeriesApi<"Line"> } | null>;
    /** Donchian channels (upper / lower / mid). */
    dc: RefObject<{ upper: ISeriesApi<"Line">; lower: ISeriesApi<"Line">; mid: ISeriesApi<"Line"> } | null>;
    /** Supertrend line + the pane it lives in. */
    supertrend: RefObject<{ line: ISeriesApi<"Line">; pane: number | null } | null>;
    supertrendPane: RefObject<number | null>;
    /** Heikin-Ashi candles (main pane). */
    heikinAshi: RefObject<ISeriesApi<"Candlestick"> | null>;
    /** RSI line, its pane and its guide price lines. */
    rsi: RefObject<{ rsi: ISeriesApi<"Line">; pane: number | null; lines: IPriceLine[] } | null>;
    rsiPane: RefObject<number | null>;
    /** MACD + signal lines and their pane. */
    macd: RefObject<{ macd: ISeriesApi<"Line">; signal: ISeriesApi<"Line">; pane: number | null } | null>;
    macdPane: RefObject<number | null>;
    /** EMA/SMA overlay vocabulary: layer id → its line series. */
    ma: RefObject<Record<string, ISeriesApi<"Line">> | null>;
    /** Ichimoku cloud edges (span A / span B). */
    ichimoku: RefObject<{ spanA: ISeriesApi<"Line">; spanB: ISeriesApi<"Line"> } | null>;
    /** Stochastic %K/%D, its pane and its guide price lines. */
    stochastic: RefObject<{ k: ISeriesApi<"Line">; d: ISeriesApi<"Line">; pane: number | null; lines: IPriceLine[] } | null>;
    stochasticPane: RefObject<number | null>;
    /** ATR line + its pane. */
    atr: RefObject<{ line: ISeriesApi<"Line">; pane: number | null } | null>;
    atrPane: RefObject<number | null>;
    /** Estimated-delta pane: per-bar histogram + cumulative line. */
    delta: RefObject<{ hist: ISeriesApi<"Histogram">; line: ISeriesApi<"Line"> } | null>;
    deltaPane: RefObject<number | null>;
};

/** Layer/config inputs the parent resolves before asking for a reconciliation. */
export type IndicatorLayerOptions = {
    /** The chart's layer flags — only an explicit `true` renders (isLayerOn). */
    layers: Partial<Record<ChartLayerId, boolean>>;
    /** Heikin-Ashi candle colors from the resolved view settings. */
    colors: ChartSettings["colors"];
    /** Active symbol price precision (Heikin-Ashi priceFormat). */
    pricePrecision: number;
    /**
     * MA-overlay vocabulary owned by the parent: layer id → series color. The
     * parent also uses this table to pick the core-indicator calculation, so it
     * stays its single definition.
     */
    maLayers: Record<string, { color: string }>;
};

/**
 * One data commit for the indicator layers. Every family is optional: the
 * parent only sends the families whose series exist (so a layer that is off
 * costs no calculation), and the renderer only mutates the series it owns.
 */
export type IndicatorSeriesData = {
    /** Time axis every aligned value array is indexed against. */
    candles: Candle[];
    bollinger?: { basis: IndicatorValues; upper: IndicatorValues; lower: IndicatorValues };
    keltner?: { mid: IndicatorValues; upper: IndicatorValues; lower: IndicatorValues };
    donchian?: { upper: IndicatorValues; lower: IndicatorValues; mid: IndicatorValues };
    supertrend?: IndicatorValues;
    heikinAshi?: { open: IndicatorValues; high: IndicatorValues; low: IndicatorValues; close: IndicatorValues };
    rsi?: IndicatorValues;
    macd?: { macd: IndicatorValues; signal: IndicatorValues };
    /** Aligned values per MA layer id (only the layers whose series exist). */
    ma?: Record<string, IndicatorValues>;
    ichimoku?: { spanA: IndicatorValues; spanB: IndicatorValues };
    stochastic?: { k: IndicatorValues; d: IndicatorValues };
    atr?: IndicatorValues;
    delta?: {
        hist: Array<{ time: UTCTimestamp; value: number; color: string }>;
        line: Array<{ time: UTCTimestamp; value: number }>;
    };
};

/** Pane stretch factors — the existing per-layer values, unchanged. */
const PANE_STRETCH = {
    supertrend: 0.25,
    rsi: 0.3,
    macd: 0.3,
    stochastic: 0.3,
    atr: 0.25,
    delta: 0.25,
} as const;

export class IndicatorRenderer {
    private readonly refs: IndicatorSeriesRefs;
    private chart: IChartApi | null = null;

    constructor(refs: IndicatorSeriesRefs) {
        this.refs = refs;
    }

    /** True once the renderer is bound to a live chart instance. */
    isAttached(): boolean {
        return this.chart !== null;
    }

    // ── lifecycle ───────────────────────────────────────────────────────────
    /**
     * Bind the renderer to the chart instance it will draw into. Called once
     * per chart, in the chart-creation effect, at the same point the price and
     * volume series are attached — but it intentionally creates no series and
     * no pane (see the class docs: pane order is fixed by the layer effect).
     */
    attach(chart: IChartApi): void {
        this.chart = chart;
    }

    /**
     * Drop every indicator handle. The chart instance is owned by ChartSurface,
     * whose own cleanup removes it (and with it every series), so the renderer
     * nulls the parent's refs without calling removeSeries.
     */
    detach(): void {
        this.chart = null;
        this.refs.bb.current = null;
        this.refs.kc.current = null;
        this.refs.dc.current = null;
        this.refs.supertrend.current = null;
        this.refs.supertrendPane.current = null;
        this.refs.heikinAshi.current = null;
        this.refs.rsi.current = null;
        this.refs.rsiPane.current = null;
        this.refs.macd.current = null;
        this.refs.macdPane.current = null;
        this.refs.ma.current = null;
        this.refs.ichimoku.current = null;
        this.refs.stochastic.current = null;
        this.refs.stochasticPane.current = null;
        this.refs.atr.current = null;
        this.refs.atrPane.current = null;
        this.refs.delta.current = null;
        this.refs.deltaPane.current = null;
    }

    // ── layer reconciliation ────────────────────────────────────────────────
    /**
     * Create/remove the indicator series so they match the current layer flags.
     * Idempotent: a series is created only when its layer is on and no handle
     * exists, removed only when its layer is off and a handle exists — the same
     * create-once/toggle semantics the parent had, so nothing here invents a new
     * visibility rule. Called from the parent's layer effect, at the position
     * the series were previously created in, and again on every layer toggle.
     */
    syncLayers(options: IndicatorLayerOptions): void {
        const chart = this.chart;
        if (!chart) return;
        const { layers } = options;

        const removeIf = (ref: RefObject<Record<string, ISeriesApi<"Line"> | ISeriesApi<"Candlestick">> | null>) => {
            const group = ref.current;
            if (!group) return;
            for (const key of Object.keys(group)) {
                const s = group[key];
                if (s && typeof s === "object" && "applyOptions" in s) {
                    try {
                        chart.removeSeries(s);
                    } catch {
                        // already gone with the chart
                    }
                }
            }
            ref.current = null;
        };

        // ── Bollinger bands (SMA ± 2σ, 20) ──
        if (!layers.bollingerBands) {
            removeIf(this.refs.bb as RefObject<Record<string, ISeriesApi<"Line"> | ISeriesApi<"Candlestick">> | null>);
        } else if (!this.refs.bb.current) {
            const basis = this.addHiddenLine(chart, 0, "#94a3b8");
            const upper = this.addHiddenLine(chart, 0, "#60a5fa");
            const lower = this.addHiddenLine(chart, 0, "#60a5fa");
            this.refs.bb.current = { basis, upper, lower };
        }

        // ── Keltner channels (EMA ± ATR, 20/2) ──
        if (!layers.keltnerChannels) {
            removeIf(this.refs.kc as RefObject<Record<string, ISeriesApi<"Line"> | ISeriesApi<"Candlestick">> | null>);
        } else if (!this.refs.kc.current) {
            const mid = this.addHiddenLine(chart, 0, "#f97316");
            const upper = this.addHiddenLine(chart, 0, "rgba(249, 115, 22, 0.55)");
            const lower = this.addHiddenLine(chart, 0, "rgba(249, 115, 22, 0.55)");
            this.refs.kc.current = { mid, upper, lower };
        }

        // ── Donchian channels (20-bar high/low envelope) ──
        if (!layers.donchianChannels) {
            removeIf(this.refs.dc as RefObject<Record<string, ISeriesApi<"Line"> | ISeriesApi<"Candlestick">> | null>);
        } else if (!this.refs.dc.current) {
            const upper = this.addHiddenLine(chart, 0, "#22d3ee");
            const lower = this.addHiddenLine(chart, 0, "#22d3ee");
            const mid = this.addHiddenLine(chart, 0, "rgba(34, 211, 238, 0.5)");
            this.refs.dc.current = { upper, lower, mid };
        }

        // ── Supertrend (ATR trailing stop line, own pane) ──
        if (!layers.supertrend) {
            if (this.refs.supertrend.current) {
                try {
                    chart.removeSeries(this.refs.supertrend.current.line);
                } catch {
                    // already gone
                }
                this.refs.supertrend.current = null;
            }
            if (this.refs.supertrend.current === null && this.refs.supertrendPane.current !== null) {
                try {
                    chart.removePane(this.refs.supertrendPane.current);
                } catch {
                    // pane may hold other series
                }
                this.refs.supertrendPane.current = null;
            }
        } else if (!this.refs.supertrend.current) {
            let paneIndex = 0;
            try {
                paneIndex = chart.panes().length;
                chart.addPane();
                this.refs.supertrendPane.current = paneIndex;
                chart.panes()[paneIndex]?.setStretchFactor(PANE_STRETCH.supertrend);
            } catch {
                paneIndex = 0;
                this.refs.supertrendPane.current = null;
            }
            const line = this.addHiddenLine(chart, paneIndex, "#f472b6", 2);
            this.refs.supertrend.current = { line, pane: paneIndex };
        }

        // ── Heikin-Ashi candles (main pane) ──
        if (!layers.heikinAshi) {
            if (this.refs.heikinAshi.current) {
                try {
                    chart.removeSeries(this.refs.heikinAshi.current);
                } catch {
                    // already gone
                }
                this.refs.heikinAshi.current = null;
            }
        } else if (!this.refs.heikinAshi.current) {
            this.refs.heikinAshi.current = chart.addSeries(CandlestickSeries, {
                upColor: options.colors.bull,
                downColor: options.colors.bear,
                borderUpColor: options.colors.bull,
                borderDownColor: options.colors.bear,
                wickUpColor: "#26a69a",
                wickDownColor: "#ef5350",
                priceLineVisible: false,
                lastValueVisible: false,
                priceFormat: { type: "price", precision: options.pricePrecision, minMove: 10 ** -options.pricePrecision },
            });
        }

        // ── RSI pane (14, 30/70 guides) ──
        if (!layers.rsiPane) {
            if (this.refs.rsi.current) {
                try {
                    chart.removeSeries(this.refs.rsi.current.rsi);
                } catch {
                    // already gone
                }
                for (const l of this.refs.rsi.current.lines) {
                    try {
                        this.refs.rsi.current.rsi.removePriceLine(l);
                    } catch {
                        // already gone
                    }
                }
                this.refs.rsi.current = null;
            }
            if (this.refs.rsi.current === null && this.refs.rsiPane.current !== null) {
                try {
                    chart.removePane(this.refs.rsiPane.current);
                } catch {
                    // pane may hold other series
                }
                this.refs.rsiPane.current = null;
            }
        } else if (!this.refs.rsi.current) {
            let paneIndex = 0;
            try {
                paneIndex = chart.panes().length;
                chart.addPane();
                this.refs.rsiPane.current = paneIndex;
                chart.panes()[paneIndex]?.setStretchFactor(PANE_STRETCH.rsi);
            } catch {
                paneIndex = 0;
                this.refs.rsiPane.current = null;
            }
            const rsi = this.addHiddenLine(chart, paneIndex, "#c084fc");
            // 30/70 guides are part of the layer itself — created once with
            // the series, never recreated per tick.
            const guides = [30, 70].map((v) =>
                rsi.createPriceLine({
                    price: v,
                    color: "rgba(148, 163, 184, 0.6)",
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: false,
                    title: `RSI ${v}`,
                })
            );
            this.refs.rsi.current = { rsi, pane: paneIndex, lines: guides };
        }

        // ── Estimated delta pane (histogram + cumulative line) ──
        if (!layers.delta && !layers.cumulativeDelta) {
            if (this.refs.delta.current) {
                try {
                    chart.removeSeries(this.refs.delta.current.hist);
                    chart.removeSeries(this.refs.delta.current.line);
                } catch {
                    // already gone
                }
                this.refs.delta.current = null;
            }
            if (this.refs.delta.current === null && this.refs.deltaPane.current !== null) {
                try {
                    chart.removePane(this.refs.deltaPane.current);
                } catch {
                    // pane may hold other series
                }
                this.refs.deltaPane.current = null;
            }
        } else if (!this.refs.delta.current) {
            let paneIndex = 0;
            try {
                paneIndex = chart.panes().length;
                chart.addPane();
                this.refs.deltaPane.current = paneIndex;
            } catch {
                paneIndex = 0;
                this.refs.deltaPane.current = null;
            }
            chart.panes()[paneIndex]?.setStretchFactor(PANE_STRETCH.delta);
            const hist = chart.addSeries(
                HistogramSeries,
                {
                    priceFormat: { type: "volume" },
                    priceLineVisible: false,
                    lastValueVisible: false,
                },
                paneIndex
            );
            const line = chart.addSeries(
                LineSeries,
                {
                    color: "#eab308",
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false,
                },
                paneIndex
            );
            this.refs.delta.current = { hist, line };
        }

        // ── MACD pane (12/26/9 histogram-less lines + zero guide) ──
        if (!layers.macdPane) {
            if (this.refs.macd.current) {
                try {
                    chart.removeSeries(this.refs.macd.current.macd);
                    chart.removeSeries(this.refs.macd.current.signal);
                } catch {
                    // already gone
                }
                this.refs.macd.current = null;
            }
            if (this.refs.macd.current === null && this.refs.macdPane.current !== null) {
                try {
                    chart.removePane(this.refs.macdPane.current);
                } catch {
                    // pane may hold other series
                }
                this.refs.macdPane.current = null;
            }
        } else if (!this.refs.macd.current) {
            let paneIndex = 0;
            try {
                paneIndex = chart.panes().length;
                chart.addPane();
                this.refs.macdPane.current = paneIndex;
            } catch {
                paneIndex = 0;
                this.refs.macdPane.current = null;
            }
            chart.panes()[paneIndex]?.setStretchFactor(PANE_STRETCH.macd);
            const macd = this.addHiddenLine(chart, paneIndex, "#38bdf8");
            const signal = this.addHiddenLine(chart, paneIndex, "#f59e0b");
            this.refs.macd.current = { macd, signal, pane: paneIndex };
        }

        // ── EMA 50 / 200 + SMA 20 / 50 / 200 overlays (Phase 0) ──
        // Real renderers for the previously silent layers: values fold
        // through the ONE core indicator engine in the parent's data feed.
        const maGroup = this.refs.ma.current ?? {};
        for (const layerId of Object.keys(options.maLayers)) {
            const spec = options.maLayers[layerId];
            const on = isLayerOn(layers, layerId as ChartLayerId);
            if (!on && maGroup[layerId]) {
                try {
                    chart.removeSeries(maGroup[layerId]);
                } catch {
                    // already gone with the chart
                }
                delete maGroup[layerId];
            } else if (on && !maGroup[layerId]) {
                maGroup[layerId] = this.addHiddenLine(chart, 0, spec.color);
            }
        }
        this.refs.ma.current = maGroup;

        // ── Ichimoku cloud edges (span A / span B on the price pane) ──
        // The two boundary lines ARE the cloud's rendered form here; the
        // shaded fill is a later-phase rendering concern (lightweight-charts
        // has no between-two-lines fill primitive), never fabricated data.
        if (!layers.ichimokuCloud) {
            if (this.refs.ichimoku.current) {
                try {
                    chart.removeSeries(this.refs.ichimoku.current.spanA);
                    chart.removeSeries(this.refs.ichimoku.current.spanB);
                } catch {
                    // already gone with the chart
                }
                this.refs.ichimoku.current = null;
            }
        } else if (!this.refs.ichimoku.current) {
            this.refs.ichimoku.current = {
                spanA: this.addHiddenLine(chart, 0, "#34d399"),
                spanB: this.addHiddenLine(chart, 0, "#f472b6"),
            };
        }

        // ── Stochastic pane (%K / %D with 20/80 guides) ──
        if (!layers.stochasticPane) {
            if (this.refs.stochastic.current) {
                try {
                    chart.removeSeries(this.refs.stochastic.current.k);
                    chart.removeSeries(this.refs.stochastic.current.d);
                } catch {
                    // already gone
                }
                for (const l of this.refs.stochastic.current.lines) {
                    try {
                        this.refs.stochastic.current.k.removePriceLine(l);
                    } catch {
                        // already gone
                    }
                }
                this.refs.stochastic.current = null;
            }
            if (this.refs.stochastic.current === null && this.refs.stochasticPane.current !== null) {
                try {
                    chart.removePane(this.refs.stochasticPane.current);
                } catch {
                    // pane may hold other series
                }
                this.refs.stochasticPane.current = null;
            }
        } else if (!this.refs.stochastic.current) {
            let paneIndex = 0;
            try {
                paneIndex = chart.panes().length;
                chart.addPane();
                this.refs.stochasticPane.current = paneIndex;
                chart.panes()[paneIndex]?.setStretchFactor(PANE_STRETCH.stochastic);
            } catch {
                paneIndex = 0;
                this.refs.stochasticPane.current = null;
            }
            const k = this.addHiddenLine(chart, paneIndex, "#38bdf8");
            const d = this.addHiddenLine(chart, paneIndex, "#f59e0b");
            const guides = [20, 80].map((v) =>
                k.createPriceLine({
                    price: v,
                    color: "rgba(148, 163, 184, 0.6)",
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: false,
                    title: `STOCH ${v}`,
                })
            );
            this.refs.stochastic.current = { k, d, pane: paneIndex, lines: guides };
        }

        // ── ATR pane (volatility, own pane) ──
        if (!layers.atrPane) {
            if (this.refs.atr.current) {
                try {
                    chart.removeSeries(this.refs.atr.current.line);
                } catch {
                    // already gone
                }
                this.refs.atr.current = null;
            }
            if (this.refs.atr.current === null && this.refs.atrPane.current !== null) {
                try {
                    chart.removePane(this.refs.atrPane.current);
                } catch {
                    // pane may hold other series
                }
                this.refs.atrPane.current = null;
            }
        } else if (!this.refs.atr.current) {
            let paneIndex = 0;
            try {
                paneIndex = chart.panes().length;
                chart.addPane();
                this.refs.atrPane.current = paneIndex;
                chart.panes()[paneIndex]?.setStretchFactor(PANE_STRETCH.atr);
            } catch {
                paneIndex = 0;
                this.refs.atrPane.current = null;
            }
            const line = this.addHiddenLine(chart, paneIndex, "#a78bfa", 2);
            this.refs.atr.current = { line, pane: paneIndex };
        }
    }

    // ── data ────────────────────────────────────────────────────────────────
    /**
     * Commit the calculated indicator values. Only the families the parent sent
     * are touched, and only for series that currently exist — an off layer
     * therefore costs no series write. Values are aligned 1:1 with the candle
     * array; non-finite entries are skipped (that is what produced the gaps in
     * these plots before the extraction).
     *
     * The estimated-delta pane is the one family with a "blank it" path: the
     * parent sends empty arrays when the estimated-delta source is absent, which
     * reproduces the previous explicit clear.
     */
    setData(data: IndicatorSeriesData): void {
        const { candles } = data;

        const bb = this.refs.bb.current;
        if (bb && data.bollinger) {
            this.feedLine(bb.basis, candles, data.bollinger.basis);
            this.feedLine(bb.upper, candles, data.bollinger.upper);
            this.feedLine(bb.lower, candles, data.bollinger.lower);
        }

        const kc = this.refs.kc.current;
        if (kc && data.keltner) {
            this.feedLine(kc.mid, candles, data.keltner.mid);
            this.feedLine(kc.upper, candles, data.keltner.upper);
            this.feedLine(kc.lower, candles, data.keltner.lower);
        }

        const dc = this.refs.dc.current;
        if (dc && data.donchian) {
            this.feedLine(dc.upper, candles, data.donchian.upper);
            this.feedLine(dc.lower, candles, data.donchian.lower);
            this.feedLine(dc.mid, candles, data.donchian.mid);
        }

        const st = this.refs.supertrend.current;
        if (st && data.supertrend) {
            this.feedLine(st.line, candles, data.supertrend);
        }

        const ha = this.refs.heikinAshi.current;
        if (ha && data.heikinAshi) {
            const { open, high, low, close } = data.heikinAshi;
            ha.setData(
                candles
                    .map((c, i) => ({
                        time: Math.floor(c.timestamp / 1000) as UTCTimestamp,
                        open: open[i],
                        high: high[i],
                        low: low[i],
                        close: close[i],
                    }))
                    .filter((d) => Number.isFinite(d.open) && Number.isFinite(d.close))
            );
        }

        const rsi = this.refs.rsi.current;
        if (rsi && data.rsi) {
            this.feedLine(rsi.rsi, candles, data.rsi);
        }

        const macd = this.refs.macd.current;
        if (macd && data.macd) {
            this.feedLine(macd.macd, candles, data.macd.macd);
            this.feedLine(macd.signal, candles, data.macd.signal);
        }

        const maGroup = this.refs.ma.current;
        if (maGroup && data.ma) {
            for (const layerId of Object.keys(data.ma)) {
                const series = maGroup[layerId];
                if (!series) continue;
                this.feedLine(series, candles, data.ma[layerId]);
            }
        }

        const ichi = this.refs.ichimoku.current;
        if (ichi && data.ichimoku) {
            this.feedLine(ichi.spanA, candles, data.ichimoku.spanA);
            this.feedLine(ichi.spanB, candles, data.ichimoku.spanB);
        }

        const stoch = this.refs.stochastic.current;
        if (stoch && data.stochastic) {
            this.feedLine(stoch.k, candles, data.stochastic.k);
            this.feedLine(stoch.d, candles, data.stochastic.d);
        }

        const atr = this.refs.atr.current;
        if (atr && data.atr) {
            this.feedLine(atr.line, candles, data.atr);
        }

        const delta = this.refs.delta.current;
        if (delta && data.delta) {
            delta.hist.setData(data.delta.hist);
            delta.line.setData(data.delta.line);
        }
    }

    // ── internals ───────────────────────────────────────────────────────────
    /**
     * Instantiate a hidden line series in the given pane — the parent's old
     * `addHiddenLine`, unchanged (color, width, no price line, no last value,
     * no crosshair marker).
     */
    private addHiddenLine(chart: IChartApi, paneIndex = 0, color = "#94a3b8", width: 1 | 2 = 1): ISeriesApi<"Line"> {
        return chart.addSeries(
            LineSeries,
            {
                color,
                lineWidth: width,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
            },
            paneIndex
        );
    }

    /** Aligned points for one indicator series (candles 1:1, non-finite skipped). */
    private lineData(candles: Candle[], values: IndicatorValues): Array<{ time: UTCTimestamp; value: number }> {
        const data: Array<{ time: UTCTimestamp; value: number }> = [];
        candles.forEach((c, i) => {
            const v = values[i];
            if (v !== null && v !== undefined && Number.isFinite(v)) {
                data.push({ time: Math.floor(c.timestamp / 1000) as UTCTimestamp, value: v });
            }
        });
        return data;
    }

    /** Push a series of values (NaN/null → skipped) onto the chart, aligned 1:1 with candles. */
    private feedLine(series: ISeriesApi<"Line">, candles: Candle[], values: IndicatorValues): void {
        series.setData(this.lineData(candles, values));
    }
}
