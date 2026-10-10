"use client";

/**
 * DrawingRenderer — owner of the Pro Terminal *drawing* rendering surface.
 *
 * Phase 3E ownership extraction. The module owns the last separable slice of
 * the chart's visual layers:
 *
 *   • the SVG drawing surface (the `<svg>` root, its arrow `<defs>`, the
 *     committed-drawing groups, the selection outline + endpoint handles and
 *     the live gesture preview)
 *   • the market→pixel projection of every drawing (time → x, price → y) and
 *     the derived per-tool geometry (ray extension, triangle vertices, the
 *     Fibonacci level lines, the ruler's box and delta)
 *   • the visual styling of that geometry (colour, stroke width, dash pattern,
 *     font sizes, the horizontal price label)
 *   • the render/update lifecycle: attach to the chart's transforms, project
 *     the authoritative drawing list on every pass, drop everything on detach
 *
 * It deliberately does NOT own anything the parent already owns:
 *
 *   • drawing state. `DrawingItem[]` stays a prop/state of ProTerminalChart;
 *     this module never stores, mutates, persists or re-IDs a drawing. It is
 *     handed the list and returns pixels. In particular it never calls
 *     `onDrawingsChange`.
 *   • interaction. No pointer handlers, no hit-testing, no active tool, no
 *     drag/creation gesture, no keyboard shortcuts, no undo/redo, no deletion
 *     commands and no crosshair ownership live here. The parent remains the
 *     interaction authority and merely hands over its results
 *     (`selectedDrawingId`, the live preview).
 *   • viewport policy. It never imports ViewportController, never touches a
 *     logical range, never fits/scrolls/follows, never compensates a prepend
 *     and never subscribes to a range change. It READS the chart's own
 *     `timeToCoordinate` / `priceToCoordinate` transforms (through
 *     `drawing-utils`, the same helpers the parent's hit-test uses) and
 *     nothing else. A pan, zoom or resize reaches it only as new pixel
 *     coordinates on the next projection.
 *   • market data and trading. No candles, no feed, no API, no chart creation,
 *     no positions/orders, no Smart Money. If a coordinate cannot resolve, the
 *     object is simply not drawn this frame.
 *
 * ## Coordinate contract (Phase 0, preserved exactly)
 *
 * Drawings live in MARKET coordinates ({time, price}). Screen coordinates are
 * derived state, recomputed on every projection — never stored. When a
 * transform cannot resolve an axis the helper returns NULL and the object is
 * skipped for that frame; a missing coordinate is NEVER substituted with 0
 * (no pinning to the left/top edge, no origin jump). The stored market data is
 * never mutated, so the object renders again by itself once the transform
 * resolves (timeframe switch back, price scale ready).
 *
 * ## Lifecycle ordering (must not be reordered)
 *
 * ProTerminalChart keeps the sequence explicit and calls into this module at
 * exactly two points:
 *
 *     ChartSurface creates chart
 *          ↓
 *     ProTerminalChart resets/attaches ViewportController
 *          ↓
 *     SeriesRenderer.attach()          ← price + volume series
 *          ↓
 *     IndicatorRenderer.attach()
 *          ↓
 *     DrawingRenderer.attach(chart, candleSeries)   ← bind the transforms
 *          ↓
 *     viewport subscriptions / interaction wiring
 *          ↓
 *     DrawingRenderer.render(drawings, context)     ← project + paint
 *
 * `attach` only records the transforms: before it runs, a projection resolves
 * nothing (the chart handle is absent), so the drawing surface can never be
 * painted ahead of the coordinate system it depends on. The SVG layer itself
 * is a pure function of the projected scene — no effects, no state — so there
 * is no child-effect ordering hazard to reason about.
  */

import { createElement, type ReactElement, type ReactNode } from "react";
import type { DrawingItem, DrawingTool } from "./ProTerminalChart";
import type { ChartSettings } from "./chart-settings";
import { fmtPrice } from "./terminal-utils";
import {
    extendRayToBounds,
    resolveMarketPointToPixel,
    resolvePriceY,
    resolveTimeX,
    resolvedFiboLevels,
    triangleVertices,
    type MarketPriceTransform,
    type MarketTimeTransform,
} from "./drawing-utils";

// ── inputs ────────────────────────────────────────────────────────────────

/**
 * The candle series' transform as the drawing surface reads it: price → y for
 * every tool, plus the inverse y → price that the live preview's *measurement*
 * labels need (the ruler's Δ, the Fibonacci retracement being dragged).
  */
export type DrawingSeriesTransform = MarketPriceTransform & {
    coordinateToPrice?(y: number): number | null;
};

/** The parent's resolved drawing style/drag pixel anchors (see `ChartSettings`). */
export type DrawingToolSettings = ChartSettings["tools"];

/**
 * The live gesture preview the parent's interaction layer owns while a tool is
 * being dragged. It is deliberately in PIXEL space: it is transient UI, never
 * persisted, and the committed drawing is derived from market coordinates by
 * the parent on pointer-up.
  */
export type DrawingPreviewState = {
    tool: DrawingTool;
    startX: number;
    startY: number;
    startPrice: number;
    startTime: number;
    curX: number;
    curY: number;
};

/** Everything the parent supplies for one projection pass. */
export type DrawingRenderContext = {
    /** Chart container width in CSS pixels (pixel math + full-span tools). */
    width: number;
    /** Chart container height in CSS pixels. */
    height: number;
    /** The resolved view configuration; only `cfg.tools` is read here. */
    cfg: ChartSettings;
    /** Active symbol — the horizontal line's price label precision. */
    symbol: string;
    /** The parent's single selected drawing id (visual state only). */
    selectedDrawingId: string | null;
    /** The parent's in-progress gesture preview, if any. */
    preview: DrawingPreviewState | null;
};

// ── projected geometry (what the SVG layer paints) ────────────────────────

/** One fully resolved committed drawing. `id` is the drawing's stable identity. */
export type DrawingVisual =
    | {
          kind: "horizontal";
          id: string;
          y: number;
          width: number;
          color: string;
          strokeWidth: number;
          dash?: string;
          fontSize: number;
          label: string;
      }
    | {
          kind: "vertical";
          id: string;
          x: number;
          height: number;
          color: string;
          strokeWidth: number;
          dash?: string;
      }
    | {
          kind: "trendline";
          id: string;
          x1: number;
          y1: number;
          x2: number;
          y2: number;
          color: string;
          strokeWidth: number;
          dash?: string;
      }
    | {
          kind: "ray";
          id: string;
          x1: number;
          y1: number;
          /** The container-boundary end, from `extendRayToBounds`. */
          endX: number;
          endY: number;
          color: string;
          strokeWidth: number;
          dash?: string;
      }
    | {
          kind: "arrow";
          id: string;
          x1: number;
          y1: number;
          x2: number;
          y2: number;
          color: string;
          strokeWidth: number;
          dash?: string;
      }
    | {
          kind: "rectangle";
          id: string;
          x: number;
          y: number;
          w: number;
          h: number;
          color: string;
          strokeWidth: number;
      }
    | {
          kind: "triangle";
          id: string;
          /** The three vertices, the third derived by `triangleVertices`. */
          points: Array<[number, number]>;
          color: string;
          strokeWidth: number;
          dash?: string;
      }
    | {
          kind: "fibo";
          id: string;
          left: number;
          right: number;
          /** Resolved level → y, shared with the parent's hit-test. */
          levels: Array<{ level: number; y: number }>;
          color: string;
          labelSize: number;
      }
    | {
          kind: "ruler";
          id: string;
          x1: number;
          y1: number;
          x2: number;
          y2: number;
          /** Pre-formatted |price p2 − price p1|, as the label renders it. */
          delta: string;
          color: string;
          strokeWidth: number;
          dash?: string;
          labelSize: number;
      }
    | {
          kind: "text";
          id: string;
          x: number;
          y: number;
          text: string;
          color: string;
          fontSize: number;
      };

/** The selection outline + endpoint handles of the parent's selected drawing. */
export type DrawingSelectionVisual = {
    /** The drawing's own first anchor, for the parent's HTML overlays. */
    anchorX: number;
    anchorY: number;
    box: { x: number; y: number; w: number; h: number };
    /** Endpoint control points — empty for full-span tools and text. */
    handles: Array<{ x: number; y: number }>;
};

/** The live, pixel-space shape of the parent's in-progress gesture. */
export type DrawingPreviewVisual =
    | { kind: "horizontal"; y: number; width: number; color: string; strokeWidth: number }
    | { kind: "vertical"; x: number; height: number; color: string; strokeWidth: number }
    | { kind: "rectangle"; x: number; y: number; w: number; h: number; color: string; strokeWidth: number }
    | {
          kind: "fibo";
          left: number;
          right: number;
          levels: Array<{ level: number; y: number }>;
          color: string;
          labelSize: number;
      }
    | {
          kind: "ruler";
          x1: number;
          y1: number;
          x2: number;
          y2: number;
          delta: string;
          color: string;
          strokeWidth: number;
          labelSize: number;
      }
    | { kind: "arrow"; x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth: number }
    | { kind: "triangle"; points: Array<[number, number]>; color: string; strokeWidth: number }
    | { kind: "ray"; x1: number; y1: number; endX: number; endY: number; color: string; strokeWidth: number }
    | { kind: "trendline"; x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth: number };

/** One projection pass: everything the SVG surface paints, already in pixels. */
export type DrawingScene = {
    width: number;
    height: number;
    /** False while the container has no measurable width (surface hidden). */
    visible: boolean;
    drawings: DrawingVisual[];
    selection: DrawingSelectionVisual | null;
    preview: DrawingPreviewVisual | null;
};

/** Resolved pixel anchors of one drawing (both axes or nothing). */
export type DrawingScreenPosition = { x1: number; y1: number; x2: number; y2: number };

const EMPTY_SCENE: DrawingScene = {
    width: 0,
    height: 0,
    visible: false,
    drawings: [],
    selection: null,
    preview: null,
};

// ── renderer ──────────────────────────────────────────────────────────────

export class DrawingRenderer {
    private attached = false;
    private chart: MarketTimeTransform | null = null;
    private series: DrawingSeriesTransform | null = null;
    private lastScene: DrawingScene = EMPTY_SCENE;

    /** True once the chart's transforms have been bound (after the viewport). */
    isAttached(): boolean {
        return this.attached;
    }

    /**
     * Bind the chart's time→x and price→y transforms. Called once per chart
     * instance, in the chart effect, after the viewport, the series and the
     * indicators — never before them. Binds nothing else: no range
     * subscription, no data, no policy.
     */
    attach(chart: MarketTimeTransform | null, series: DrawingSeriesTransform | null): void {
        this.chart = chart;
        this.series = series;
        this.attached = true;
    }

    /**
     * Release every binding and the last projected scene. The drawings
     * themselves are the parent's state and are untouched; the SVG surface is
     * unmounted by React (the chart instance is removed by ChartSurface).
     */
    detach(): void {
        this.attached = false;
        this.chart = null;
        this.series = null;
        this.lastScene = EMPTY_SCENE;
    }

    /** The most recent projection (empty before the first render pass). */
    scene(): DrawingScene {
        return this.lastScene;
    }

    /**
     * Resolve one drawing's pixel anchors — null when a REQUIRED axis is
     * unresolvable, so callers hide the object for that frame instead of
     * pinning it to a fabricated pixel. Horizontal lines only need the price
     * axis (their cross-axis span is the container by definition); vertical
     * lines only need the time axis. The stored market data is never mutated.
     */
    screenPosition(d: DrawingItem | null | undefined): DrawingScreenPosition | null {
        if (!d) return null;
        const { width, height } = this.lastScene;
        return this.anchors(d, width, height);
    }

    /**
     * Project the authoritative drawing state onto the SVG surface and return
     * the scene the layer paints. Re-entrant and side-effect free apart from
     * remembering the last scene: the parent calls it on every render, so a
     * pan/zoom/resize (new metrics), an add/update/delete (new list) and a
     * selection change (new id) all produce fresh geometry from the chart's
     * current transforms. No screen coordinate is ever cached.
     */
    render(drawings: readonly DrawingItem[], context: DrawingRenderContext): DrawingScene {
        if (!this.attached) {
            // Not bound to a chart yet: nothing can resolve, but the surface
            // still reports the container metrics so it mounts at the right
            // size (hidden while the width is unknown) — the same shape the
            // inline SVG had before the extraction.
            this.lastScene = {
                width: context.width,
                height: context.height,
                visible: context.width > 0,
                drawings: [],
                selection: null,
                preview: null,
            };
            return this.lastScene;
        }

        const { width, height, cfg, symbol } = context;

        const visuals: DrawingVisual[] = [];
        for (const drawing of drawings) {
            const visual = this.project(drawing, cfg, symbol, width, height);
            if (visual) visuals.push(visual);
        }

        const selected = context.selectedDrawingId
            ? drawings.find((d) => d.id === context.selectedDrawingId) ?? null
            : null;

        this.lastScene = {
            width,
            height,
            visible: width > 0,
            drawings: visuals,
            selection: selected ? this.projectSelection(selected, width, height) : null,
            preview: context.preview ? this.projectPreview(context.preview, cfg, width, height) : null,
        };
        return this.lastScene;
    }

    // ── projection (market coordinates → pixels) ───────────────────────────

    /**
     * The one place a drawing's two anchors become pixels. Both the committed
     * drawing and the selection outline go through here, so the outline can
     * never drift from the object it frames. `?? 0` never appears: an
     * unresolvable axis yields null and the object is skipped.
     */
    private anchors(d: DrawingItem, width: number, height: number): DrawingScreenPosition | null {
        const chart = this.chart;
        const cs = this.series;
        if (!chart || !cs || d.points.length < 2) return null;
        try {
            const p1 = d.points[0];
            const p2 = d.points[1];
            if (d.type === "horizontal") {
                const y = resolvePriceY(p1.price, cs);
                if (y === null) return null;
                return { x1: 0, y1: y, x2: width, y2: y };
            }
            if (d.type === "vertical") {
                const x = resolveTimeX(p1.time, chart);
                if (x === null) return null;
                return { x1: x, y1: 0, x2: x, y2: height };
            }
            const a = resolveMarketPointToPixel(p1, chart, cs);
            const b = resolveMarketPointToPixel(p2, chart, cs);
            if (!a || !b) return null;
            return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        } catch {
            return null;
        }
    }

    /**
     * One committed drawing → its SVG geometry. Null means "not drawable this
     * frame" (unresolvable coordinate, or a tool that paints nothing yet); the
     * stored drawing is untouched and will render again once it resolves.
     */
    private project(
        d: DrawingItem,
        cfg: ChartSettings,
        symbol: string,
        width: number,
        height: number
    ): DrawingVisual | null {
        const anchors = this.anchors(d, width, height);
        if (!anchors) return null;
        const { x1, y1, x2, y2 } = anchors;
        const p1 = d.points[0];
        const p2 = d.points[1];
        const color = d.color ?? cfg.tools.color;
        const strokeWidth = d.width ?? cfg.tools.lineWidth;
        const lineStyle = (d.lineStyle ?? cfg.tools.lineStyle) as "solid" | "dashed" | "dotted";
        const dash = lineStyle === "dashed" ? "6,3" : lineStyle === "dotted" ? "2,3" : undefined;
        const labelSize = Math.max(8, cfg.tools.fontSize - 3);

        if (d.type === "horizontal") {
            return {
                kind: "horizontal",
                id: d.id,
                y: y1,
                width,
                color,
                strokeWidth,
                dash,
                fontSize: cfg.tools.fontSize,
                label: fmtPrice(p1.price, symbol),
            };
        }
        if (d.type === "vertical") {
            return { kind: "vertical", id: d.id, x: x1, height, color, strokeWidth, dash };
        }
        if (d.type === "trendline") {
            return { kind: "trendline", id: d.id, x1, y1, x2, y2, color, strokeWidth, dash };
        }
        if (d.type === "ray") {
            // True ray: anchored at the FIRST market coordinate and extended
            // through the second point's direction to the container boundary on
            // every render — the direction comes only from the two stored
            // market points, so the ray follows candles through pan/zoom.
            const end = extendRayToBounds(x1, y1, x2, y2, width, height);
            if (!end) return null;
            return { kind: "ray", id: d.id, x1, y1, endX: end.x, endY: end.y, color, strokeWidth, dash };
        }
        if (d.type === "arrow") {
            return { kind: "arrow", id: d.id, x1, y1, x2, y2, color, strokeWidth, dash };
        }
        if (d.type === "rectangle") {
            return {
                kind: "rectangle",
                id: d.id,
                x: Math.min(x1, x2),
                y: Math.min(y1, y2),
                w: Math.abs(x2 - x1),
                h: Math.abs(y2 - y1),
                color,
                strokeWidth,
            };
        }
        if (d.type === "triangle") {
            // Deterministic third vertex from the two stored market points
            // (same time as p1, same price as p2): a real closed polygon, not a
            // faked primitive.
            return {
                kind: "triangle",
                id: d.id,
                points: triangleVertices(x1, y1, x2, y2),
                color,
                strokeWidth,
                dash,
            };
        }
        if (d.type === "fibo") {
            // Shared source of truth with the hit-test: one resolved level set.
            const levels = resolvedFiboLevels(d, cfg.tools.fiboLevels);
            const p1p = p1.price;
            const p2p = p2.price;
            if (p1p == null || p2p == null) return null;
            const priceDiff = p2p - p1p;
            const lines: Array<{ level: number; y: number }> = [];
            for (const lvl of levels) {
                const yLvl = resolvePriceY(p1p + priceDiff * lvl, this.series);
                if (yLvl === null) continue;
                lines.push({ level: lvl, y: yLvl });
            }
            return {
                kind: "fibo",
                id: d.id,
                left: Math.min(x1, x2),
                right: Math.max(x1, x2),
                levels: lines,
                color,
                labelSize,
            };
        }
        if (d.type === "ruler") {
            const p1p = p1.price;
            const p2p = p2.price;
            if (p1p == null || p2p == null) return null;
            return {
                kind: "ruler",
                id: d.id,
                x1,
                y1,
                x2,
                y2,
                delta: Math.abs(p2p - p1p).toFixed(2),
                color,
                strokeWidth,
                dash,
                labelSize,
            };
        }
        if (d.type === "text") {
            // Empty label = mid-edit or cancelled — the inline input is the
            // visible editor for it.
            if (!d.label) return null;
            return { kind: "text", id: d.id, x: x1, y: y1, text: d.label, color, fontSize: cfg.tools.fontSize };
        }
        return null;
    }

    /** The selection outline + endpoint handles for the selected drawing. */
    private projectSelection(d: DrawingItem, width: number, height: number): DrawingSelectionVisual | null {
        const pos = this.anchors(d, width, height);
        if (!pos) return null;
        let box: { x: number; y: number; w: number; h: number };
        if (d.type === "horizontal") {
            box = { x: 0, y: pos.y1 - 7, w: width, h: 14 };
        } else if (d.type === "vertical") {
            box = { x: pos.x1 - 7, y: 0, w: 14, h: height };
        } else {
            const minX = Math.min(pos.x1, pos.x2);
            const maxX = Math.max(pos.x1, pos.x2);
            const minY = Math.min(pos.y1, pos.y2);
            const maxY = Math.max(pos.y1, pos.y2);
            box = {
                x: minX - 7,
                y: minY - 7,
                w: Math.max(14, maxX - minX + 14),
                h: Math.max(14, maxY - minY + 14),
            };
        }
        const withPoints = d.type !== "horizontal" && d.type !== "vertical" && d.type !== "text";
        return {
            anchorX: pos.x1,
            anchorY: pos.y1,
            box,
            handles: withPoints ? [{ x: pos.x1, y: pos.y1 }, { x: pos.x2, y: pos.y2 }] : [],
        };
    }

    /**
     * The live gesture preview. It is already in pixels (the parent's
     * interaction layer owns the pointer math); only the two measurement
     * labels read the price scale back, exactly as before.
     */
    private projectPreview(
        dp: DrawingPreviewState,
        cfg: ChartSettings,
        width: number,
        height: number
    ): DrawingPreviewVisual | null {
        const color = cfg.tools.color;
        const strokeWidth = cfg.tools.lineWidth;
        const labelSize = Math.max(8, cfg.tools.fontSize - 3);

        if (dp.tool === "horizontal") {
            return { kind: "horizontal", y: dp.startY, width, color, strokeWidth };
        }
        if (dp.tool === "vertical") {
            return { kind: "vertical", x: dp.startX, height, color, strokeWidth };
        }
        if (dp.tool === "rectangle") {
            return {
                kind: "rectangle",
                x: Math.min(dp.startX, dp.curX),
                y: Math.min(dp.startY, dp.curY),
                w: Math.abs(dp.curX - dp.startX),
                h: Math.abs(dp.curY - dp.startY),
                color,
                strokeWidth,
            };
        }
        if (dp.tool === "fibo") {
            const chart = this.chart;
            const cs = this.series;
            if (!chart || !cs) return null;
            const startP = dp.startPrice;
            const endP = (() => {
                try {
                    return cs.coordinateToPrice?.(dp.curY) ?? startP;
                } catch {
                    return startP;
                }
            })();
            const diff = endP - startP;
            // Same resolved levels the committed drawing and its hit-test use.
            const levels = resolvedFiboLevels(null, cfg.tools.fiboLevels);
            const lines: Array<{ level: number; y: number }> = [];
            for (const lvl of levels) {
                const yLvl = resolvePriceY(startP + diff * lvl, cs);
                if (yLvl === null) continue;
                lines.push({ level: lvl, y: yLvl });
            }
            return {
                kind: "fibo",
                left: Math.min(dp.startX, dp.curX),
                right: Math.max(dp.startX, dp.curX),
                levels: lines,
                color,
                labelSize,
            };
        }
        if (dp.tool === "ruler") {
            const cs = this.series;
            // A measurement LABEL, not a stored coordinate: an unready price
            // scale reads as 0 here exactly as it did inline (the drawing
            // itself is never derived from this value).
            const p1p = cs ? cs.coordinateToPrice?.(dp.startY) ?? 0 : 0;
            const p2p = cs ? cs.coordinateToPrice?.(dp.curY) ?? 0 : 0;
            return {
                kind: "ruler",
                x1: dp.startX,
                y1: dp.startY,
                x2: dp.curX,
                y2: dp.curY,
                delta: Math.abs(p2p - p1p).toFixed(2),
                color,
                strokeWidth,
                labelSize,
            };
        }
        if (dp.tool === "arrow") {
            return { kind: "arrow", x1: dp.startX, y1: dp.startY, x2: dp.curX, y2: dp.curY, color, strokeWidth };
        }
        if (dp.tool === "triangle") {
            return {
                kind: "triangle",
                points: triangleVertices(dp.startX, dp.startY, dp.curX, dp.curY),
                color,
                strokeWidth,
            };
        }
        if (dp.tool === "ray") {
            // Preview the same extension the committed ray will render.
            const end = extendRayToBounds(dp.startX, dp.startY, dp.curX, dp.curY, width, height);
            if (!end) return null;
            return { kind: "ray", x1: dp.startX, y1: dp.startY, endX: end.x, endY: end.y, color, strokeWidth };
        }
        // Default: trendline.
        return { kind: "trendline", x1: dp.startX, y1: dp.startY, x2: dp.curX, y2: dp.curY, color, strokeWidth };
    }
}

// ── SVG surface ───────────────────────────────────────────────────────────

/**
 * The drawing surface. A pure function of the projected scene: no state, no
 * effects, no refs, no memoization. Everything it paints is already resolved
 * geometry, so it cannot re-derive a coordinate or fall back to a fabricated
 * pixel, and it renders identically on the server and the client.
 *
 * ## Why `createElement` instead of JSX
 *
 * This module must stay importable by the repository's plain `jiti` test runner
 * (`npx jiti tests/…`), which transforms `.tsx` files as TypeScript unless
 * `JITI_JSX` is set — JSX syntax is a parse error there. The SVG tree below is
 * therefore built with `createElement` and the tree it produces is
 * element-for-element the same one the inline JSX produced.
 *
 * `children` are painted between the committed drawings/selection and the live
 * preview, which is exactly where the parent's AI direction badge sat before the
 * extraction — passing it through keeps the paint order byte-for-byte.
  */
const el = createElement;

/** One committed drawing → its SVG element. Identity comes from the drawing id. */
function drawingElement(v: DrawingVisual): ReactElement {
    switch (v.kind) {
        case "horizontal":
            return el(
              "g",
                { key: v.id },
                el("line", { x1: 0, y1: v.y, x2: v.width, y2: v.y, stroke: v.color, strokeWidth: v.strokeWidth, strokeDasharray: v.dash }),
                el("text", { x: 4, y: v.y - 4, fill: v.color, fontSize: v.fontSize, fontFamily: "monospace" }, v.label)
            );
        case "vertical":
            return el(
              "g",
                { key: v.id },
                el("line", { x1: v.x, y1: 0, x2: v.x, y2: v.height, stroke: v.color, strokeWidth: v.strokeWidth, strokeDasharray: v.dash })
            );
        case "trendline":
            return el("line", { key: v.id, x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, stroke: v.color, strokeWidth: v.strokeWidth, strokeDasharray: v.dash });
        case "ray":
            return el("line", { key: v.id, x1: v.x1, y1: v.y1, x2: v.endX, y2: v.endY, stroke: v.color, strokeWidth: v.strokeWidth, strokeDasharray: v.dash, markerEnd: "url(#arrow)" });
        case "arrow":
            return el(
              "g",
                { key: v.id },
                el("line", { x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, stroke: v.color, strokeWidth: v.strokeWidth, strokeDasharray: v.dash, markerEnd: "url(#arrow)" }),
                el("polygon", { points: `${v.x2},${v.y2 - 4} ${v.x2 - 4},${v.y2 + 3} ${v.x2 + 4},${v.y2 + 3}`, fill: v.color, opacity: 0.85 })
            );
        case "rectangle":
            return el("rect", { key: v.id, x: v.x, y: v.y, width: v.w, height: v.h, stroke: v.color, strokeWidth: v.strokeWidth, fill: `${v.color}18` });
        case "triangle":
            return el("polygon", {
                key: v.id,
                points: v.points.map((point) => `${point[0]},${point[1]}`).join(" "),
                stroke: v.color,
                strokeWidth: v.strokeWidth,
                strokeDasharray: v.dash,
                fill: `${v.color}18`,
            });
        case "fibo":
            return el(
              "g",
                { key: v.id },
                v.levels.map((lv) =>
                    el(
                      "g",
                        { key: lv.level },
                        el("line", { x1: v.left, y1: lv.y, x2: v.right, y2: lv.y, stroke: v.color, strokeWidth: 1, strokeDasharray: "4,3", opacity: 0.8 }),
                        el("text", { x: v.right + 4, y: lv.y + 4, fill: v.color, fontSize: v.labelSize, fontFamily: "monospace" }, `${(lv.level * 100).toFixed(1)}%`)
                    )
                )
            );
        case "ruler":
            return el(
              "g",
                { key: v.id },
                el("line", { x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, stroke: v.color, strokeWidth: v.strokeWidth, strokeDasharray: v.dash }),
                el("line", { x1: v.x1, y1: v.y1, x2: v.x1, y2: v.y2, stroke: v.color, strokeWidth: 1, opacity: 0.5 }),
                el("line", { x1: v.x1, y1: v.y2, x2: v.x2, y2: v.y2, stroke: v.color, strokeWidth: 1, opacity: 0.5 }),
                el(
                    "text",
                    { x: (v.x1 + v.x2) / 2, y: Math.min(v.y1, v.y2) - 4, fill: v.color, fontSize: v.labelSize, fontFamily: "monospace", textAnchor: "middle" },
                    `Δ ${v.delta}`
                )
            );
        case "text":
            return el("text", { key: v.id, x: v.x, y: v.y, fill: v.color, fontSize: v.fontSize, fontFamily: "monospace", fontWeight: "bold" }, v.text);
    }
}

/** The selection outline + endpoint handles, or null when nothing is selected. */
function selectionElement(selection: DrawingSelectionVisual | null): ReactElement | null {
    if (!selection) return null;
    const box = selection.box;
    const handles = selection.handles;
    return el(
      "g",
        null,
        el("rect", { x: box.x, y: box.y, width: box.w, height: box.h, rx: 4, fill: "none", stroke: "#38bdf8", strokeWidth: 1, strokeDasharray: "4,3", opacity: 0.9 }),
        handles.length === 2
            ? el(
              "g",
                  null,
                  el("circle", { cx: handles[0].x, cy: handles[0].y, r: 3.5, fill: "#38bdf8" }),
                  el("circle", { cx: handles[1].x, cy: handles[1].y, r: 3.5, fill: "#38bdf8" })
              )
            : null
    );
}

/** The live gesture preview, or null while no tool is being dragged. */
function previewElement(pv: DrawingPreviewVisual): ReactElement {
    switch (pv.kind) {
        case "horizontal":
            return el("line", { x1: 0, y1: pv.y, x2: pv.width, y2: pv.y, stroke: pv.color, strokeWidth: pv.strokeWidth, strokeDasharray: "5,3", opacity: 0.8 });
        case "vertical":
            return el("line", { x1: pv.x, y1: 0, x2: pv.x, y2: pv.height, stroke: pv.color, strokeWidth: pv.strokeWidth, strokeDasharray: "5,3", opacity: 0.8 });
        case "rectangle":
            return el("rect", { x: pv.x, y: pv.y, width: pv.w, height: pv.h, stroke: pv.color, strokeWidth: pv.strokeWidth, fill: `${pv.color}18`, opacity: 0.85 });
        case "fibo":
            return el(
              "g",
                { opacity: 0.8 },
                pv.levels.map((lv) =>
                    el(
                      "g",
                        { key: lv.level },
                        el("line", { x1: pv.left, y1: lv.y, x2: pv.right, y2: lv.y, stroke: pv.color, strokeWidth: 1, strokeDasharray: "4,3" }),
                        el("text", { x: pv.right + 4, y: lv.y + 4, fill: pv.color, fontSize: pv.labelSize, fontFamily: "monospace" }, `${(lv.level * 100).toFixed(1)}%`)
                    )
                )
            );
        case "ruler":
            return el(
              "g",
                { opacity: 0.85 },
                el("line", { x1: pv.x1, y1: pv.y1, x2: pv.x2, y2: pv.y2, stroke: pv.color, strokeWidth: pv.strokeWidth, strokeDasharray: "6,2" }),
                el("line", { x1: pv.x1, y1: pv.y1, x2: pv.x1, y2: pv.y2, stroke: pv.color, strokeWidth: 1, opacity: 0.5 }),
                el("line", { x1: pv.x1, y1: pv.y2, x2: pv.x2, y2: pv.y2, stroke: pv.color, strokeWidth: 1, opacity: 0.5 }),
                el(
                    "text",
                    { x: (pv.x1 + pv.x2) / 2, y: Math.min(pv.y1, pv.y2) - 4, fill: pv.color, fontSize: pv.labelSize, fontFamily: "monospace", textAnchor: "middle" },
                    `Δ ${pv.delta}`
                )
            );
        case "arrow":
            return el(
              "g",
                { opacity: 0.85 },
                el("line", { x1: pv.x1, y1: pv.y1, x2: pv.x2, y2: pv.y2, stroke: pv.color, strokeWidth: pv.strokeWidth, markerEnd: "url(#arrow)" }),
                el("polygon", { points: `${pv.x2},${pv.y2 - 4} ${pv.x2 - 4},${pv.y2 + 3} ${pv.x2 + 4},${pv.y2 + 3}`, fill: pv.color, opacity: 0.85 })
            );
        case "triangle":
            return el("polygon", {
                points: pv.points.map((point) => `${point[0]},${point[1]}`).join(" "),
                stroke: pv.color,
                strokeWidth: pv.strokeWidth,
                fill: `${pv.color}18`,
                opacity: 0.85,
            });
        case "ray":
            return el("line", { x1: pv.x1, y1: pv.y1, x2: pv.endX, y2: pv.endY, stroke: pv.color, strokeWidth: pv.strokeWidth, markerEnd: "url(#arrow)", opacity: 0.85 });
        case "trendline":
            return el("line", { x1: pv.x1, y1: pv.y1, x2: pv.x2, y2: pv.y2, stroke: pv.color, strokeWidth: pv.strokeWidth, opacity: 0.85 });
    }
}

export function DrawingSvgLayer({
    scene,
    children,
}: {
    scene: DrawingScene;
    children?: ReactNode;
}): ReactElement {
    return el(
        "svg",
        {
            className: "pointer-events-none absolute inset-0 z-30 overflow-visible",
            width: scene.width,
            height: scene.height,
            style: { opacity: scene.visible ? 1 : 0 },
        },
        el(
            "defs",
            null,
            el("marker", { id: "arrow", markerWidth: 10, markerHeight: 10, refX: 8, refY: 3, orient: "auto" }, el("polygon", { points: "0 0, 10 3, 0 6", fill: "#38bdf8" })),
            el("marker", { id: "arrow-red", markerWidth: 10, markerHeight: 10, refX: 8, refY: 3, orient: "auto" }, el("polygon", { points: "0 0, 10 3, 0 6", fill: "#f43f5e" }))
        ),
        // Committed drawings — paint order = the parent's list order.
        scene.drawings.map((visual) => drawingElement(visual)),
        selectionElement(scene.selection),
        // Parent-owned overlays that live on the drawing surface (AI badge).
        children,
        scene.preview ? previewElement(scene.preview) : null
    );
}
