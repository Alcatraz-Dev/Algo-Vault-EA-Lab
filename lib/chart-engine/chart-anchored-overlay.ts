/**
 * ChartAnchoredOverlay — the coordinate bridge between market data and the
 * screen for lightweight-charts based AlgoVault charts.
 *
 * Contract (native chart spec, "single source of truth for chart
 * coordinates"): every chart-linked object — zones, profiles, markers,
 * annotations — MUST be positioned through the renderer's own coordinate
 * transformation. Nothing may compute independent DOM geometry that can
 * drift from the candles.
 *
 * Market coordinates go IN (times in ms since epoch, prices as numbers);
 * screen pixels come OUT via `chart.timeScale().logicalToCoordinate()` and
 * `series.priceToCoordinate()`. Geometry is recomputed on viewport/resize
 * changes and while the user is dragging, so panning, zooming, price
 * autoscale, resizing and live-tick updates re-anchor overlays automatically. DOM
 * writes are diffed — a frame where nothing moved costs a handful of
 * coordinate calls and zero style mutations.
 */

export type AnchoredItemStyle = {
    /** Fill color (CSS). */
    background: string;
    /** Optional outline (CSS border shorthand pieces). */
    borderTop?: string;
    borderBottom?: string;
    borderLeft?: string;
    borderRight?: string;
    /** Small text rendered inside the item's top-left corner. */
    label?: string;
    labelColor?: string;
};

/** A price/time rectangle (FVG, order block, session box, AI zone…). */
export type AnchoredZone = {
    id: string;
    kind: "zone";
    /** Left edge, ms since epoch. */
    fromTime: number;
    /** Right edge, ms since epoch (may exceed the newest candle). */
    toTime: number;
    top: number;
    bottom: number;
    style: AnchoredItemStyle;
};

/**
 * A price-anchored horizontal bar drawn from the right edge leftwards
 * (volume profile histogram). `widthFrac` ∈ [0,1] of the profile's max width.
 */
export type AnchoredHBar = {
    id: string;
    kind: "hbar";
    low: number;
    high: number;
    widthFrac: number;
    style: AnchoredItemStyle;
};

export type AnchoredItem = AnchoredZone | AnchoredHBar;

/** Fraction of the pane width the widest profile bar may occupy. */
const MAX_PROFILE_WIDTH_FRAC = 0.22;
/** Hide items whose rect leaves the pane by more than this margin (px). */
const CULL_MARGIN_PX = 24;

export interface ChartAnchoredOverlayDeps {
    /** The chart that owns the coordinate transforms. */
    chart: import("lightweight-charts").IChartApi;
    /** Series on the price scale overlays are anchored to (usually candles). */
    series: import("lightweight-charts").ISeriesApi<"Candlestick">;
    /** Pane index the overlay div is mounted into (0 = main price pane). */
    paneIndex?: number;
    /**
     * Convert a wall-clock time (ms) to a fractional bar index in the series.
     * Supplied by the consumer, which owns the candle array (bar indices are
     * NOT a linear function of time across market-closed gaps).
     */
    timeToBarIndex: (timeMs: number) => number;
}

type PositionedItem = {
    el: HTMLDivElement;
    labelEl: HTMLSpanElement | null;
    lastStyle: string;
    lastLabel: string;
    lastLabelColor: string;
    lastVisible: boolean;
};

export class ChartAnchoredOverlay {
    private deps: ChartAnchoredOverlayDeps | null = null;
    private container: HTMLDivElement | null = null;
    private items = new Map<string, AnchoredItem>();
    private nodes = new Map<string, PositionedItem>();
    private rafId: number | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private paneEl: HTMLElement | null = null;
    private originalPanePosition = "";
    private rangeChangeHandler: (() => void) | null = null;
    private sizeChangeHandler: (() => void) | null = null;
    private chartElement: HTMLDivElement | null = null;
    private startDragSync: (() => void) | null = null;
    private pointerMoveHandler: (() => void) | null = null;
    private stopDragSync: (() => void) | null = null;

    /** Mount the overlay container into the chart pane. */
    attach(deps: ChartAnchoredOverlayDeps): void {
        this.destroy();
        this.deps = deps;
        const paneEl = deps.chart.panes()[deps.paneIndex ?? 0]?.getHTMLElement();
        if (!paneEl) return;
        this.paneEl = paneEl;

        const container = document.createElement("div");
        container.className = "algovault-anchored-overlay";
        container.style.cssText =
            "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3;";
        // The pane element is the positioning context; lightweight-charts
        // keeps it laid out relative to the chart, but don't rely on it.
        const panePosition = getComputedStyle(paneEl).position;
        if (panePosition === "static") {
            this.originalPanePosition = paneEl.style.position;
            paneEl.style.position = "relative";
        }
        paneEl.appendChild(container);
        this.container = container;

        // Sync on actual viewport/size changes. Data changes call setItems(),
        // which schedules a frame as well. Pointer drags temporarily request
        // frame syncs so overlays track a pan/zoom gesture smoothly without
        // maintaining a permanent 60fps loop while idle.
        const timeScale = deps.chart.timeScale();
        this.rangeChangeHandler = () => this.scheduleSync();
        this.sizeChangeHandler = () => this.scheduleSync();
        timeScale.subscribeVisibleLogicalRangeChange(this.rangeChangeHandler);
        timeScale.subscribeSizeChange(this.sizeChangeHandler);
        this.chartElement = deps.chart.chartElement();
        this.startDragSync = () => {
            if (this.stopDragSync) return;
            this.pointerMoveHandler = () => this.scheduleSync();
            const stop = () => {
                if (!this.pointerMoveHandler) return;
                window.removeEventListener("pointermove", this.pointerMoveHandler);
                window.removeEventListener("pointerup", stop);
                window.removeEventListener("pointercancel", stop);
                this.pointerMoveHandler = null;
                this.stopDragSync = null;
            };
            this.stopDragSync = stop;
            window.addEventListener("pointermove", this.pointerMoveHandler, { passive: true });
            window.addEventListener("pointerup", stop, { once: true });
            window.addEventListener("pointercancel", stop, { once: true });
        };
        this.chartElement.addEventListener("pointerdown", this.startDragSync, { passive: true });
        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => this.scheduleSync());
            this.resizeObserver.observe(paneEl);
        }
        this.scheduleSync();
    }

    /** Replace the full item set (market coordinates in, pixels out). */
    setItems(items: AnchoredItem[]): void {
        const next = new Map<string, AnchoredItem>();
        for (const item of items) next.set(item.id, item);
        this.items = next;
        this.scheduleSync();
    }

    /** Detach from the chart and release DOM + rAF resources. */
    destroy(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.deps && this.rangeChangeHandler) {
            this.deps.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.rangeChangeHandler);
        }
        if (this.deps && this.sizeChangeHandler) {
            this.deps.chart.timeScale().unsubscribeSizeChange(this.sizeChangeHandler);
        }
        if (this.chartElement && this.startDragSync) {
            this.chartElement.removeEventListener("pointerdown", this.startDragSync);
        }
        this.stopDragSync?.();
        this.chartElement = null;
        this.startDragSync = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.container?.remove();
        this.container = null;
        if (this.paneEl && this.paneEl.style.position === "relative" && this.originalPanePosition !== "relative") {
            this.paneEl.style.position = this.originalPanePosition;
        }
        this.paneEl = null;
        this.originalPanePosition = "";
        this.rangeChangeHandler = null;
        this.sizeChangeHandler = null;
        this.nodes.clear();
        this.items.clear();
        this.deps = null;
    }

    private scheduleSync(): void {
        if (this.rafId !== null || typeof requestAnimationFrame === "undefined") return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this.sync();
        });
    }

    /**
     * Recompute every item's screen geometry from the chart's own transforms
     * and write only changed styles.
     */
    sync(): void {
        const deps = this.deps;
        const container = this.container;
        if (!deps || !container) return;
        const paneEl = deps.chart.panes()[deps.paneIndex ?? 0]?.getHTMLElement();
        const paneWidth = paneEl?.clientWidth ?? 0;
        const paneHeight = paneEl?.clientHeight ?? 0;
        if (paneWidth <= 0 || paneHeight <= 0) return;

        // Remove nodes for items that no longer exist.
        for (const [id, node] of this.nodes) {
            if (!this.items.has(id)) {
                node.el.remove();
                this.nodes.delete(id);
            }
        }

        const maxProfileWidthPx = paneWidth * MAX_PROFILE_WIDTH_FRAC;

        for (const item of this.items.values()) {
            let node = this.nodes.get(item.id);
            if (!node) {
                const el = document.createElement("div");
                el.style.cssText = "position:absolute;pointer-events:none;";
                let labelEl: HTMLSpanElement | null = null;
                if (item.style.label) {
                    labelEl = document.createElement("span");
                    labelEl.style.cssText =
                        "position:absolute;left:3px;top:2px;font-size:9px;line-height:1.1;font-weight:600;letter-spacing:0.02em;white-space:nowrap;opacity:0.9;";
                    el.appendChild(labelEl);
                }
                container.appendChild(el);
                node = { el, labelEl, lastStyle: "", lastLabel: "", lastLabelColor: "", lastVisible: false };
                this.nodes.set(item.id, node);
            }

            if (item.style.label && !node.labelEl) {
                const labelEl = document.createElement("span");
                labelEl.style.cssText =
                    "position:absolute;left:3px;top:2px;font-size:9px;line-height:1.1;font-weight:600;letter-spacing:0.02em;white-space:nowrap;opacity:0.9;";
                node.el.appendChild(labelEl);
                node.labelEl = labelEl;
            } else if (!item.style.label && node.labelEl) {
                node.labelEl.remove();
                node.labelEl = null;
                node.lastLabel = "";
                node.lastLabelColor = "";
            }
            const geometry = this.resolveGeometry(item, deps, paneWidth, paneHeight, maxProfileWidthPx);
            if (geometry === null) {
                if (node.lastVisible) {
                    node.el.style.display = "none";
                    node.lastVisible = false;
                }
                continue;
            }
            const { left, top, width, height, style } = geometry;
            if (width <= 0 || height <= 0.25) {
                if (node.lastVisible) {
                    node.el.style.display = "none";
                    node.lastVisible = false;
                }
                continue;
            }

            const css =
                `position:absolute;pointer-events:none;box-sizing:border-box;display:block;` +
                `left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;` +
                `width:${width.toFixed(1)}px;height:${height.toFixed(1)}px;` +
                `background:${style.background};` +
                (style.borderTop ? `border-top:${style.borderTop};` : "") +
                (style.borderBottom ? `border-bottom:${style.borderBottom};` : "") +
                (style.borderLeft ? `border-left:${style.borderLeft};` : "") +
                (style.borderRight ? `border-right:${style.borderRight};` : "");
            if (css !== node.lastStyle) {
                node.el.style.cssText = css;
                node.lastStyle = css;
            }
            if (node.labelEl) {
                const label = style.label ?? "";
                const labelColor = style.labelColor ?? "#94a3b8";
                if (node.lastLabel !== label) {
                    node.labelEl.textContent = label;
                    node.lastLabel = label;
                }
                if (node.lastLabelColor !== labelColor) {
                    node.labelEl.style.color = labelColor;
                    node.lastLabelColor = labelColor;
                }
            }
            node.lastVisible = true;
        }
    }

    /**
     * Resolve one item's screen rect in pane-local pixels using ONLY the
     * chart's own coordinate transforms. Returns null when the item cannot
     * be anchored (no data / off-pane).
     */
    private resolveGeometry(
        item: AnchoredItem,
        deps: ChartAnchoredOverlayDeps,
        paneWidth: number,
        paneHeight: number,
        maxProfileWidthPx: number,
    ): { left: number; top: number; width: number; height: number; style: AnchoredItemStyle } | null {
        const { chart, series } = deps;
        const timeScale = chart.timeScale();

        if (item.kind === "zone") {
            const fromBar = deps.timeToBarIndex(item.fromTime);
            const toBar = deps.timeToBarIndex(item.toTime);
            if (!Number.isFinite(fromBar) || !Number.isFinite(toBar)) return null;
            const x1 = this.barToX(fromBar, timeScale);
            const x2 = this.barToX(toBar, timeScale);
            const yTop = series.priceToCoordinate(item.top);
            const yBottom = series.priceToCoordinate(item.bottom);
            if (x1 === null || x2 === null || yTop === null || yBottom === null) return null;

            const left = Math.min(x1, x2);
            const right = Math.max(x1, x2);
            const top = Math.min(yTop, yBottom);
            const bottom = Math.max(yTop, yBottom);
            // Cull fully off-pane rects (keep partial overlaps, clamped).
            if (right < -CULL_MARGIN_PX || left > paneWidth + CULL_MARGIN_PX) return null;
            if (bottom < -CULL_MARGIN_PX || top > paneHeight + CULL_MARGIN_PX) return null;
            const clampedLeft = Math.max(-CULL_MARGIN_PX, left);
            const clampedRight = Math.min(paneWidth + CULL_MARGIN_PX, right);
            const clampedTop = Math.max(0, top);
            const clampedBottom = Math.min(paneHeight, bottom);
            return {
                left: clampedLeft,
                top: clampedTop,
                width: clampedRight - clampedLeft,
                height: clampedBottom - clampedTop,
                style: item.style,
            };
        }

        // hbar: price-anchored horizontal bar, right-aligned.
        if (item.high <= item.low) return null;
        const yLow = series.priceToCoordinate(item.low);
        const yHigh = series.priceToCoordinate(item.high);
        if (yLow === null || yHigh === null) return null;
        const top = Math.min(yLow, yHigh);
        const bottom = Math.max(yLow, yHigh);
        if (bottom < -CULL_MARGIN_PX || top > paneHeight + CULL_MARGIN_PX) return null;
        const width = Math.max(1, Math.min(1, Number.isFinite(item.widthFrac) ? Math.max(0, item.widthFrac) : 0) * maxProfileWidthPx);
        const clampedTop = Math.max(0, top);
        const clampedBottom = Math.min(paneHeight, bottom);
        return {
            left: paneWidth - width,
            top: clampedTop,
            width,
            height: clampedBottom - clampedTop,
            style: item.style,
        };
    }

    /**
     * Fractional bar index → X pixel, calibrated against the chart's own
     * logical→pixel mapping (two adjacent integer anchors give the exact
     * per-bar pixel scale, so fractional and extrapolated indices stay on
     * the chart's grid even outside the loaded data window).
     */
    private barToX(bar: number, timeScale: import("lightweight-charts").ITimeScaleApi<import("lightweight-charts").Time>): number | null {
        const range = timeScale.getVisibleLogicalRange();
        if (range === null) return null;
        const base = Math.floor(range.from);
        const c1 = timeScale.logicalToCoordinate(base as import("lightweight-charts").Logical);
        const c2 = timeScale.logicalToCoordinate((base + 1) as import("lightweight-charts").Logical);
        if (c1 === null || c2 === null) return null;
        const pxPerBar = c2 - c1;
        if (!Number.isFinite(pxPerBar) || pxPerBar === 0) return null;
        // c1 is the pixel of integer bar `base`; extend linearly.
        return c1 + (bar - base) * pxPerBar;
    }
}
