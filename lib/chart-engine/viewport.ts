import { candleOpenTime, TIMEFRAME_MS, type ChartTimeframe } from "./timeframe";

/**
 * ChartViewport — Phases 5/6/18 geometry core.
 *
 * The viewport is RENDER state and lives entirely outside React: the engine
 * owns data, this owns geometry. Pure functions only, so interactions and
 * renderers are trivially testable.
 *
 * Coordinate contract (Phase 18): every overlay/drawing/smart-money layer
 * converts through `timeToX` / `xToTime` / `priceToY` / `yToPrice` — nothing
 * may invent its own mapping.
 */

export type FollowMode = "live" | "history";

export interface ChartViewport {
    /** Bar spacing in px (zoom level). */
    barWidth: number;
    /** Right edge of the newest visible candle as an offset in bars from the latest candle (0 = latest at right edge, positive = empty margin). */
    rightOffsetBars: number;
    /** Pixel scroll from the right edge (fractional; positive = older content revealed). */
    scrollFromRightPx: number;
    /** Vertical auto-fit. */
    autoFitY: boolean;
}

export interface ViewportWindow {
    /** First visible candle index into the series (-1 when none). */
    startIndex: number;
    /** One-past-last visible candle index. */
    endIndex: number;
    /** Timestamp of the slot just right of the newest visible candle. */
    rightEdgeTime: number;
    /** Bars of empty space right of the newest candle currently visible. */
    rightMarginBars: number;
}

export const DEFAULT_BAR_WIDTH = 8;
export const MIN_BAR_WIDTH = 2;
export const MAX_BAR_WIDTH = 60;
/** Bars of breathing room kept right of the live candle in live mode. */
export const LIVE_RIGHT_MARGIN_BARS = 5;

export function clampBarWidth(w: number): number {
    return Math.min(MAX_BAR_WIDTH, Math.max(MIN_BAR_WIDTH, w));
}

/**
 * Is the user effectively at the live edge? Tolerates small fractional
 * scrolls so an in-progress pan doesn't flicker follow mode.
 */
export function isAtLiveEdge(vp: ChartViewport, epsilonPx = 6): boolean {
    return vp.scrollFromRightPx <= epsilonPx;
}

/** Compute which candles fall inside the plot width for the current viewport. */
export function computeWindow(vp: ChartViewport, seriesLength: number, plotWidth: number, timeframe: ChartTimeframe): ViewportWindow {
    const bars = Math.max(1, Math.floor(plotWidth / vp.barWidth));
    const scrolledBars = vp.scrollFromRightPx / vp.barWidth;

    // Right-anchored model: at scroll 0 the window ends `rightOffsetBars`
    // slots past the newest candle; scrolling (scrollFromRightPx > 0) slides
    // the window toward index 0 (older history).
    const endIndex = Math.min(seriesLength, seriesLength + vp.rightOffsetBars - Math.floor(scrolledBars));
    const startIndex = Math.max(0, endIndex - bars);
    return {
        startIndex,
        endIndex,
        rightEdgeTime: candleOpenTime(Date.now(), timeframe) + vp.rightOffsetBars * TIMEFRAME_MS[timeframe],
        rightMarginBars: vp.rightOffsetBars,
    };
}

export function zoomAt(vp: ChartViewport, factor: number, anchorPxFromRight: number): ChartViewport {
    const oldBar = vp.barWidth;
    const newBar = clampBarWidth(oldBar * factor);
    if (newBar === oldBar) return vp;
    // Keep the candle under the cursor stationary: scale the pixel scroll by
    // the same ratio as the bar width.
    const scale = newBar / oldBar;
    return {
        ...vp,
        barWidth: newBar,
        scrollFromRightPx: (vp.scrollFromRightPx + anchorPxFromRight) * scale - anchorPxFromRight,
    };
}

export function panByPixels(vp: ChartViewport, dxPx: number): ChartViewport {
    // Dragging right (dx > 0) reveals older content (scroll grows).
    const next = vp.scrollFromRightPx + dxPx;
    if (next <= 0) {
        // Panning past the live edge clamps and re-engages follow.
        return { ...vp, scrollFromRightPx: 0 };
    }
    return { ...vp, scrollFromRightPx: next };
}

/**
 * Viewport compensation when live APPENDS happen while the user is away:
 * without it every appended candle would push the user's frozen view right.
 * Adding `appended` bars of scroll keeps their screen pixel-frozen.
 * (Prepends need no compensation in this right-anchored model: distances are
 * measured from the newest candle, so older candles keep their positions.)
 */
export function viewportAfterAppend(vp: ChartViewport, appended: number): ChartViewport {
    if (appended <= 0) return vp;
    return { ...vp, scrollFromRightPx: vp.scrollFromRightPx + appended * vp.barWidth };
}

/** Jump to the live edge (Go to Live). */
export function goToLive(vp: ChartViewport): ChartViewport {
    return { ...vp, scrollFromRightPx: 0 };
}

/** Pixel X (within the plot area) for a candle at `index` in the series. */
export function candleX(index: number, seriesLength: number, vp: ChartViewport, plotWidth: number): number {
    // Distance in bars between candle `index` and the right plot edge.
    const barsFromRight = seriesLength - index + vp.rightOffsetBars;
    // scrollFromRightPx pulls content RIGHT (revealing older history on the
    // left) — it is the pixel distance the user has panned away from live.
    return plotWidth - barsFromRight * vp.barWidth + vp.scrollFromRightPx;
}

/** Inverse mapping: pixel X → fractional candle index (may be out of range). */
export function xToCandleIndex(x: number, seriesLength: number, vp: ChartViewport, plotWidth: number): number {
    const barsFromRight = (plotWidth + vp.scrollFromRightPx - x) / vp.barWidth;
    return seriesLength + vp.rightOffsetBars - barsFromRight;
}

/**
 * Time → X for arbitrary timestamps (extends past the last candle into the
 * right margin). Stable contract for drawings, AI overlays, replay markers.
 */
export function timeToX(timeMs: number, seriesLength: number, lastCandleTime: number, vp: ChartViewport, plotWidth: number, timeframe: ChartTimeframe): number {
    if (seriesLength === 0) return plotWidth;
    const barsFromNewest = (timeMs - lastCandleTime) / TIMEFRAME_MS[timeframe];
    const barsFromRight = barsFromNewest + 1 + vp.rightOffsetBars;
    return plotWidth - barsFromRight * vp.barWidth + vp.scrollFromRightPx;
}

/** X → time (reverse contract). */
export function xToTime(x: number, seriesLength: number, lastCandleTime: number, vp: ChartViewport, plotWidth: number, timeframe: ChartTimeframe): number {
    if (seriesLength === 0) return lastCandleTime;
    const barsFromRight = (plotWidth + vp.scrollFromRightPx - x) / vp.barWidth;
    const barsFromNewest = barsFromRight - 1 - vp.rightOffsetBars;
    return lastCandleTime + barsFromNewest * TIMEFRAME_MS[timeframe];
}
