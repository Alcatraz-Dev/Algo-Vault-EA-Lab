/**
 * Drawing utilities — the pure logic behind interacting with chart drawings.
 *
 * Kept free of React/chart instances so every behavior (where a click counts
 * as "on the drawing", how the magnet snaps, how a single object is removed)
 * is unit-testable:
 *
 *   • `hitTestDrawing` — screen-space distance tests used by the select tool
 *     to pick one object (so a single drawing can be selected and deleted
 *     instead of only "clear all").
 *   • `snapToOHLC` — the magnet: maps a raw cursor price to the nearest of
 *     the candle under the cursor (open/high/low/close), so lines land on
 *     real prices instead of arbitrary pixels.
 *   • `removeDrawingById` / `undoLastDrawing` / `updateDrawingLabel` /
 *     `updateDrawingColor` — immutable list operations used by the delete
 *     key, undo (Ctrl+Z), the text editor and the selection toolbar.
  */

import type { Time, UTCTimestamp } from "lightweight-charts";
import type { DrawingItem, DrawingPoint, DrawingTool } from "./ProTerminalChart";
import { DEFAULT_FIBO_LEVELS } from "./chart-settings";

/** Tools whose prices snap to candle OHLC when the magnet is on. */
export const MAGNET_TOOLS: ReadonlySet<DrawingTool> = new Set<DrawingTool>([
    "trendline",
    "arrow",
    "ray",
    "horizontal",
    "fibo",
    "rectangle",
    "long",
    "short",
]);

export interface OhlcCandle {
    open: number;
    high: number;
    low: number;
    close: number;
}

// ── long / short position plans (TradingView position tools) ────────────
//
// The "Enter Long" / "Enter Short" tools are two-point drawings: point 0 is
// the ENTRY (price + start time) and point 1 sets the size (end time + the
// vertical distance to the target). The stop is derived from the same drag at
// a fixed risk:reward, so both a take-profit box and a stop-loss box are drawn
// from exactly the two stored market points. No level is invented: a
// zero-distance drag collapses to entry === target === stop.

/** Default risk:reward for the position tools (2 ⇒ 1:2, risk half the reward). */
export const POSITION_RISK_REWARD = 2;

export type PositionSide = "long" | "short";

export interface PositionLevels {
    side: PositionSide;
    entry: number;
    stop: number;
    target: number;
    /** Reward distance |target − entry| (always ≥ 0). */
    reward: number;
    /** Risk distance |entry − stop| (always ≥ 0). */
    risk: number;
}

/**
 * Derive the entry/stop/target prices of a position plan from the two stored
 * market points. `entry` is point 0's price; the vertical distance to point 1
 * is the target distance, mirrored to the other side for the stop at the
 * configured risk:reward. The direction is fixed by the tool (long = profit up,
 * short = profit down) so a "backwards" drag still yields a coherent plan
 * rather than a box on the wrong side of the entry.
 */
export function positionLevels(
    entry: number,
    sizing: number,
    side: PositionSide,
    riskReward = POSITION_RISK_REWARD,
): PositionLevels {
    const dir = side === "long" ? 1 : -1;
    const reward =
        Number.isFinite(entry) && Number.isFinite(sizing) ? Math.abs(sizing - entry) : 0;
    const risk = riskReward > 0 ? reward / riskReward : 0;
    return {
        side,
        entry,
        target: entry + dir * reward,
        stop: entry - dir * risk,
        reward,
        risk,
    };
}

/** The three market prices of a position plan, plus the tool's side. */
export interface PositionPrices {
    side: PositionSide;
    entry: number;
    target: number;
    stop: number;
}

/**
 * The three prices of a position drawing. `points[0]` is the entry and
 * `points[1]` the target (the vertical drag distance IS the reward); the stop
 * is the drawing's own stored `stop` price once the user has dragged the SL
 * line, and otherwise the default risk:reward derivation. One resolver feeds
 * the painter, the hit-test and the R:R label, so they cannot disagree.
 */
export function positionPrices(d: DrawingItem): PositionPrices | null {
    if (d.type !== "long" && d.type !== "short") return null;
    const entryPoint = d.points[0];
    const targetPoint = d.points[1];
    if (!entryPoint || !targetPoint) return null;
    const entry = entryPoint.price;
    const target = targetPoint.price;
    if (!Number.isFinite(entry) || !Number.isFinite(target)) return null;
    const side: PositionSide = d.type === "long" ? "long" : "short";
    const stop =
        typeof d.stop === "number" && Number.isFinite(d.stop)
            ? d.stop
            : positionLevels(entry, target, side).stop;
    return { side, entry, target, stop };
}

/**
 * Move a position plan's stop to a new price, clamped to the risk side of the
 * entry (below for a long, above for a short) so the stop and target boxes can
 * never swap places. A non-position drawing or an unusable price returns the
 * drawing unchanged, so a stray drag is a no-op rather than a corrupt plan.
 */
export function setPositionStop(d: DrawingItem, stopPrice: number): DrawingItem {
    if ((d.type !== "long" && d.type !== "short") || !Number.isFinite(stopPrice)) return d;
    const entry = d.points[0]?.price;
    if (typeof entry !== "number" || !Number.isFinite(entry)) return d;
    const stop = d.type === "long" ? Math.min(stopPrice, entry) : Math.max(stopPrice, entry);
    return { ...d, stop };
}

/**
 * The R:R label a position plan shows. MEASURED from the plan's own prices —
 * |target − entry| over |entry − stop| — never a constant, so the tag stays
 * honest after the stop is dragged. A degenerate plan (zero reward or zero
 * risk) has no ratio and reads "—" instead of "1:∞".
 */
export function formatRiskReward(entry: number, target: number, stop: number): string {
    const reward = Math.abs(target - entry);
    const risk = Math.abs(entry - stop);
    if (!(reward > 0) || !(risk > 0)) return "—";
    const rounded = Math.round((reward / risk) * 100) / 100;
    return `1:${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}`;
}

// ── market → pixel resolution (the coordinate contract) ──────────────
//
// Every persistent chart object is stored in MARKET coordinates
// ({time, price}). The chart's own transforms convert those to pixels at
// render time. When a transform cannot resolve a value (timestamp not in the
// loaded data, price scale not ready) the helpers below return NULL — the
// caller hides the object for that frame. They NEVER substitute 0: pinning an
// unresolved object to x=0/y=0 draws it at the left/top edge, which is a lie
// about where the object is, and it corrupts hit-testing and drag math.

/** Structural view of the chart's time → x transform (lightweight-charts). */
export interface MarketTimeTransform {
    timeScale(): { timeToCoordinate(time: Time): number | null };
}

/** Structural view of a series' price → y transform (lightweight-charts). */
export interface MarketPriceTransform {
    priceToCoordinate(price: number): number | null;
}

/** Resolve a market time (ms) to an x pixel, or null when unresolvable. */
export function resolveTimeX(timeMs: number | undefined | null, chart: MarketTimeTransform | null | undefined): number | null {
    if (chart === null || chart === undefined) return null;
    if (timeMs === undefined || timeMs === null || !Number.isFinite(timeMs)) return null;
    try {
        const x = chart.timeScale().timeToCoordinate(Math.floor(timeMs / 1000) as UTCTimestamp);
        return x === null || x === undefined || !Number.isFinite(x) ? null : Number(x);
    } catch {
        return null;
    }
}

/** Resolve a market price to a y pixel, or null when unresolvable. */
export function resolvePriceY(price: number | undefined | null, series: MarketPriceTransform | null | undefined): number | null {
    if (series === null || series === undefined) return null;
    if (price === undefined || price === null || !Number.isFinite(price)) return null;
    try {
        const y = series.priceToCoordinate(price);
        return y === null || y === undefined || !Number.isFinite(y) ? null : Number(y);
    } catch {
        return null;
    }
}

/**
 * Resolve one stored market point to {x, y}. Returns null unless BOTH
 * coordinates resolve — the caller must then skip rendering, hit-testing and
 * selection for the object while leaving its market data untouched. Once the
 * same point becomes resolvable again the object renders automatically.
  */
export function resolveMarketPointToPixel(
    point: Pick<DrawingPoint, "time" | "price"> | null | undefined,
    chart: MarketTimeTransform | null | undefined,
    series: MarketPriceTransform | null | undefined,
): { x: number; y: number } | null {
    if (!point) return null;
    const x = resolveTimeX(point.time, chart);
    const y = resolvePriceY(point.price, series);
    if (x === null || y === null) return null;
    return { x, y };
}

/**
 * Magnet snap: return the candle component nearest to the raw price.
 * Returns null when there is no candle (caller keeps the raw price) — the
 * magnet never invents a price.
  */
export function snapToOHLC(candle: OhlcCandle | undefined | null, price: number): number | null {
    if (!candle || !Number.isFinite(price)) return null;
    const candidates = [candle.open, candle.high, candle.low, candle.close];
    let best: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
        if (!Number.isFinite(c)) continue;
        const d = Math.abs(c - price);
        if (d < bestDist) {
            bestDist = d;
            best = c;
        }
    }
    return best;
}

/** Screen-space geometry of one drawing, resolved from chart transforms. */
export interface DrawingGeom {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /** Chart container width (full-width lines). */
    width: number;
    /** Chart container height (full-height lines). */
    height: number;
    /** Current font size (text bounding box). */
    fontSize: number;
    /** The drawing's text label (text hit-box sizing). */
    label?: string;
    /**
     * Resolved Fibonacci levels for this drawing (renderer + hit-test share
     * this value through `resolvedFiboLevels` — never a hardcoded array).
     */
    fiboLevels?: readonly number[];
    /**
     * Long/short position levels in PIXELS, resolved by the caller from the
     * same `positionLevels` derivation the renderer uses (entry + both boxes
     * share one source of truth, so the hit area can never drift from the
     * painted boxes).
     */
    position?: { entryY: number; stopY: number; targetY: number };
}

// ── drawing-tool geometry (pure) ────────────────────────────────────────

/**
 * Does a pointer gesture with `tool` commit a persisted DrawingItem?
 *
 * The HAND tool is viewport-only (it pans the chart through lightweight-charts'
 * native scrolling) and the SELECT tool manipulates existing objects — neither
 * may ever create a drawing. Placement tools need a real drag (> 4px), except
 * the click-placed tools (horizontal / text) which commit on pointer-up
 * regardless of movement.
  */
export function toolCommitsDrawing(tool: DrawingTool, dragDistance: number): boolean {
    if (tool === "select" || tool === "hand") return false;
    if (tool === "horizontal" || tool === "text") return true;
    return Number.isFinite(dragDistance) && dragDistance > 4;
}

/**
 * Extend a ray anchored at (x1, y1) through (x2, y2) to the container
 * boundary — the ray's direction comes ONLY from the two market points, and
 * the extension is recomputed every render so it follows candles through pan
 * and zoom. Returns null for a degenerate direction (both points equal).
  */
export function extendRayToBounds(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    height: number,
): { x: number; y: number } | null {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (![dx, dy].every(Number.isFinite) || (dx === 0 && dy === 0)) return null;
    const candidates: number[] = [];
    if (dx > 0) candidates.push((width - x1) / dx);
    else if (dx < 0) candidates.push((0 - x1) / dx);
    if (dy > 0) candidates.push((height - y1) / dy);
    else if (dy < 0) candidates.push((0 - y1) / dy);
    const positive = candidates.filter((t) => Number.isFinite(t) && t > 0);
    if (positive.length === 0) return null;
    const t = Math.min(...positive);
    return { x: x1 + dx * t, y: y1 + dy * t };
}

/**
 * Triangle vertices for the two-point model: A = p1, B = p2 and a
 * deterministic third vertex C = (x1, y2) — same time as the start, same
 * price as the end — giving a right triangle anchored on the drag diagonal.
 * The third point is derived from MARKET coordinates every render (never
 * stored, never screen pixels), so it survives persistence, timeframe
 * switches and pan/zoom exactly like the two stored points do.
  */
export function triangleVertices(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
): Array<[number, number]> {
    return [[x1, y1], [x2, y2], [x1, y2]];
}

/**
 * One source of truth for a Fibonacci drawing's levels — consumed by BOTH the
 * renderer and the hit-test. Priority: a per-drawing override (when one is
 * ever stored), then the user's configured tool levels, then the documented
 * defaults. Invalid arrays (< 2 finite numbers) fall through instead of
 * rendering a broken retracement.
  */
export function resolvedFiboLevels(
    drawing: { fiboLevels?: readonly number[] } | null | undefined,
    configured?: readonly number[] | null,
): number[] {
    const sanitize = (levels: readonly number[] | undefined | null): number[] | null => {
        if (!Array.isArray(levels) || levels.length < 2) return null;
        const finite = levels.filter((l): l is number => Number.isFinite(l)).slice(0, 12);
        return finite.length >= 2 ? finite : null;
    };
    return sanitize(drawing?.fiboLevels) ?? sanitize(configured) ?? [...DEFAULT_FIBO_LEVELS];
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Does screen point (x, y) land on this drawing (within `threshold` px)?
 *
 * Design notes (encoded in the tests):
 *   • rectangles answer on their EDGES only — the interior stays free for
 *     chart panning;
 *   • horizontal/vertical lines test across the whole container;
 *   • text uses an estimated glyph box anchored at its placement point.
  */
export function hitTestDrawing(
    type: DrawingTool,
    g: DrawingGeom,
    x: number,
    y: number,
    threshold = 10
): boolean {
    switch (type) {
        case "horizontal":
            return Math.abs(y - g.y1) <= threshold;
        case "vertical":
            return Math.abs(x - g.x1) <= threshold;
        case "trendline":
        case "arrow":
        case "ruler":
            return distToSegment(x, y, g.x1, g.y1, g.x2, g.y2) <= threshold;
        case "ray": {
            // The ray renders extended to the container edge, so the hit-test
            // measures against the SAME extended geometry.
            const end = extendRayToBounds(g.x1, g.y1, g.x2, g.y2, g.width, g.height);
            if (!end) return false;
            return distToSegment(x, y, g.x1, g.y1, end.x, end.y) <= threshold;
        }
        case "triangle": {
            // Edges only, like rectangles: the interior stays free for chart
            // panning. The third vertex comes from the same deterministic
            // derivation the renderer uses.
            const [a, b, c] = triangleVertices(g.x1, g.y1, g.x2, g.y2);
            return (
                distToSegment(x, y, a[0], a[1], b[0], b[1]) <= threshold ||
                distToSegment(x, y, b[0], b[1], c[0], c[1]) <= threshold ||
                distToSegment(x, y, c[0], c[1], a[0], a[1]) <= threshold
            );
        }
        case "rectangle": {
            const left = Math.min(g.x1, g.x2);
            const right = Math.max(g.x1, g.x2);
            const top = Math.min(g.y1, g.y2);
            const bottom = Math.max(g.y1, g.y2);
            const onVertical =
                (Math.abs(x - left) <= threshold || Math.abs(x - right) <= threshold) &&
                y >= top - threshold &&
                y <= bottom + threshold;
            const onHorizontal =
                (Math.abs(y - top) <= threshold || Math.abs(y - bottom) <= threshold) &&
                x >= left - threshold &&
                x <= right + threshold;
            return onVertical || onHorizontal;
        }
        case "fibo": {
            const left = Math.min(g.x1, g.x2) - threshold;
            const right = Math.max(g.x1, g.x2) + threshold;
            if (x < left || x > right) return false;
            // Same source of truth as the renderer: the drawing's resolved
            // levels (caller supplies them via `g.fiboLevels`).
            const levels = g.fiboLevels ?? resolvedFiboLevels(null, null);
            const diff = g.y2 - g.y1;
            return levels.some((lvl) => Math.abs(y - (g.y1 + diff * lvl)) <= threshold);
        }
        case "long":
        case "short": {
            // Position plan: the entry line plus the edges of the two boxes
            // (entry↔stop and entry↔target). The interior stays free for
            // chart panning, exactly like the rectangle tool. The three pixel
            // levels come from the shared `positionLevels` derivation so the
            // hit area always matches the painted boxes.
            const pos = g.position;
            const left = Math.min(g.x1, g.x2);
            const right = Math.max(g.x1, g.x2);
            if (!pos) return false;
            const edgeHit = (yLine: number): boolean =>
                Math.abs(y - yLine) <= threshold && x >= left - threshold && x <= right + threshold;
            const sideHit = (yLine: number): boolean =>
                (Math.abs(x - left) <= threshold || Math.abs(x - right) <= threshold) &&
                y >= Math.min(yLine, pos.entryY) - threshold &&
                y <= Math.max(yLine, pos.entryY) + threshold;
            return (
                edgeHit(pos.entryY) ||
                edgeHit(pos.stopY) ||
                edgeHit(pos.targetY) ||
                sideHit(pos.stopY) ||
                sideHit(pos.targetY)
            );
        }
        case "text": {
            const fontSize = Math.max(8, g.fontSize);
            const text = g.label ?? "";
            const estWidth = Math.max(30, (text.length + 1) * fontSize * 0.62);
            return (
                x >= g.x1 - 4 &&
                x <= g.x1 + estWidth + 4 &&
                y >= g.y1 - fontSize - 4 &&
                y <= g.y1 + 6
            );
        }
        default:
            return false;
    }
}

// ── immutable list operations ──────────────────────────────────────────────

export function removeDrawingById(list: DrawingItem[], id: string): DrawingItem[] {
    return list.filter((d) => d.id !== id);
}

/**
 * Translate a drawing in market coordinates. Pointer pixels never become
 * stored state: the caller resolves the pointer's start/end through the
 * chart's time/price transforms and passes those market-coordinate deltas.
  */
export function translateDrawingByMarketDelta(
    drawing: DrawingItem,
    deltaTimeMs: number,
    deltaPrice: number,
): DrawingItem {
    if (!Number.isFinite(deltaTimeMs) || !Number.isFinite(deltaPrice)) return drawing;
    const translated: DrawingItem = {
        ...drawing,
        points: drawing.points.map((point) => ({
            ...point,
            ...(point.time !== undefined ? { time: point.time + deltaTimeMs } : {}),
            price: (point.price ?? 0) + deltaPrice,
        })),
    };
    // A position plan's stop is an absolute price alongside the two points, so
    // moving the whole plan must carry it along — otherwise the boxes tear apart.
    return typeof drawing.stop === "number" && Number.isFinite(drawing.stop)
        ? { ...translated, stop: drawing.stop + deltaPrice }
        : translated;
}

/**
 * Move a single point of a drawing by market-coordinate deltas (for resize).
 * If the point index is out of range, falls back to translating all points.
 */
export function moveDrawingPointByMarketDelta(
    drawing: DrawingItem,
    pointIndex: number,
    deltaTimeMs: number,
    deltaPrice: number,
): DrawingItem {
    if (!Number.isFinite(deltaTimeMs) || !Number.isFinite(deltaPrice)) return drawing;
    if (pointIndex < 0 || pointIndex >= drawing.points.length) {
        return translateDrawingByMarketDelta(drawing, deltaTimeMs, deltaPrice);
    }
    return {
        ...drawing,
        points: drawing.points.map((pt, idx) =>
            idx === pointIndex
                ? {
                    ...pt,
                    ...(pt.time !== undefined ? { time: pt.time + deltaTimeMs } : {}),
                    price: (pt.price ?? 0) + deltaPrice,
                }
                : pt
        ),
    };
}

/** Undo: drop the most recently placed drawing (no-op on an empty list). */
export function undoLastDrawing(list: DrawingItem[]): DrawingItem[] {
    return list.length === 0 ? list : list.slice(0, -1);
}

export function updateDrawingLabel(list: DrawingItem[], id: string, label: string): DrawingItem[] {
    return list.map((d) => (d.id === id ? { ...d, label } : d));
}

export function updateDrawingColor(list: DrawingItem[], id: string, color: string): DrawingItem[] {
    return list.map((d) => (d.id === id ? { ...d, color } : d));
}
