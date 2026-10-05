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

import type { DrawingItem, DrawingTool } from "./ProTerminalChart";

/** Tools whose prices snap to candle OHLC when the magnet is on. */
export const MAGNET_TOOLS: ReadonlySet<DrawingTool> = new Set<DrawingTool>([
    "trendline",
    "arrow",
    "ray",
    "horizontal",
    "fibo",
    "rectangle",
]);

export interface OhlcCandle {
    open: number;
    high: number;
    low: number;
    close: number;
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
        case "ray":
        case "ruler":
            return distToSegment(x, y, g.x1, g.y1, g.x2, g.y2) <= threshold;
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
            const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
            const diff = g.y2 - g.y1;
            return levels.some((lvl) => Math.abs(y - (g.y1 + diff * lvl)) <= threshold);
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
    return {
        ...drawing,
        points: drawing.points.map((point) => ({
            ...point,
            ...(point.time !== undefined ? { time: point.time + deltaTimeMs } : {}),
            price: point.price + deltaPrice,
        })),
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
