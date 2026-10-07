import { candleOpenTime, TIMEFRAME_MS, type ChartTimeframe } from "./timeframe";
import { barIndexForTime, type LogicalRange } from "./coordinate-mapping";

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

// ────────────────────────────────────────────────────────────────────────────
// Phase 2 — viewport state machine
//
// The controller above orchestrates the NATIVE lightweight-charts time scale;
// it never replaces it and never touches market data. The renderer translates
// data commits into handle*/capture/restore calls; lightweight-charts remains
// the actual viewport implementation. Every instance is per-chart: pooled
// data engines are shared, mutable viewport state never is.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Explicit viewport phases. Transitions are deterministic:
 *
 *   INITIAL ──initialFit()──▶ FITTING ──▶ FOLLOWING_LIVE | USER_PANNED
 *   FOLLOWING_LIVE ──range change past tolerance──▶ USER_PANNED (user pan)
 *   USER_PANNED ──enterLiveFollow()/range change at edge──▶ FOLLOWING_LIVE
 *   any ──reset("symbol"|"timeframe")──▶ RESETTING_* ──initialFit()──▶ FITTING
 *   capture()/prependStarted()──▶ RESTORING|PREPENDING ──restore()──▶ evaluated
 *   focus()──▶ FOCUSING ──▶ FOLLOWING_LIVE | USER_PANNED (explicit)
 *
 * While a programmatic phase is in flight (RESETTING_*, FITTING, RESTORING,
 * PREPENDING, FOCUSING) incoming range events update the cached range but do
 * NOT reclassify follow state — the operation itself evaluates exactly once.
 */
export type ViewportPhase =
    | "INITIAL"
    | "FITTING"
    | "FOLLOWING_LIVE"
    | "USER_PANNED"
    | "RESTORING"
    | "PREPENDING"
    | "FOCUSING"
    | "RESETTING_SYMBOL"
    | "RESETTING_TIMEFRAME";

/** The minimal native time-scale surface the controller orchestrates. */
export interface ViewportTimeScaleLike {
    getVisibleLogicalRange(): LogicalRange | null;
    setVisibleLogicalRange(range: LogicalRange): void;
    fitContent(): void;
    scrollToRealTime(): void;
}

/**
 * Market-anchored snapshot taken before a data mutation. Both edges are
 * recorded so restore() can preserve the side that matters: the live (right)
 * edge while following live, the left edge while the user is panned.
 * `epoch` ties the snapshot to the viewport context it was taken in — stale
 * snapshots from before a symbol/timeframe reset are ignored.
 */
export interface ViewportSnapshot {
    epoch: number;
    range: LogicalRange;
    /** Index of the leftmost visible bar in the pre-mutation series. */
    leftIndex: number;
    /** Timestamp of the leftmost visible bar in the pre-mutation series. */
    leftTime: number;
    /** Index of the rightmost visible bar in the pre-mutation series. */
    rightIndex: number;
    /** Timestamp of the rightmost visible bar in the pre-mutation series. */
    rightTime: number;
}

/**
 * Logical bars the viewport's right edge may fall short of the dataset end by
 * before live-follow disengages. Purely logical (never pixel-based), so the
 * rule behaves identically across zoom levels, candle counts and resizes.
 */
export const LIVE_EDGE_TOLERANCE_BARS = 1.5;

/** Bars kept on each side of a focus target (matches the legacy ±12-bar view). */
export const FOCUS_HALF_BARS = 12;

/**
 * Is the viewport sufficiently close to the latest logical bar for live
 * follow? `barCount - tolerance` is expressed in the dataset's own logical
 * coordinates, mirroring the renderer's historical `range.to >= bars - 1.5`
 * rule but with a named, testable semantic.
 */
export function isNearLiveEdge(
    range: LogicalRange,
    barCount: number,
    toleranceBars: number = LIVE_EDGE_TOLERANCE_BARS,
): boolean {
    if (barCount <= 0) return true;
    if (!Number.isFinite(range.to)) return false;
    return range.to >= barCount - toleranceBars;
}

/** Exact binary lookup; falls back to the first bar superseding the target. */
function findBarIndex(times: readonly number[], target: number): number | null {
    if (times.length === 0 || !Number.isFinite(target)) return null;
    let lo = 0;
    let hi = times.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = times[mid];
        if (t === target) return mid;
        if (t < target) lo = mid + 1;
        else hi = mid - 1;
    }
    // Not found (anchor bar dropped by reconciliation): lower bound — the
    // first bar that supersedes it — keeps the shift equivalent.
    return lo < times.length ? lo : null;
}

/**
 * ViewportController — the single viewport authority for one chart instance.
 *
 * Invariants documented for the renderer:
 *  - fitContent() is only ever called by initialFit()/refit() (context reset or
 *    an explicit toolbar Fit — never an append, prepend, repair or quote tick).
 *  - While FOLLOWING_LIVE, appends re-assert the live edge; while USER_PANNED,
 *    data mutations perform zero mutating viewport calls.
 *  - Prepend/repair preservation is one market-anchored compensation per
 *    canonical data commit, never per page.
 *  - detach() makes every subsequent operation a no-op on the chart.
 */
export class ViewportController {
    private ts: ViewportTimeScaleLike | null = null;
    private phase: ViewportPhase = "INITIAL";
    private epoch = 0;
    private barCount = 0;
    private following = true;
    private lastRange: LogicalRange | null = null;
    private readonly listeners = new Set<(following: boolean) => void>();
    private readonly toleranceBars: number;

    constructor(opts?: { liveEdgeToleranceBars?: number }) {
        this.toleranceBars = opts?.liveEdgeToleranceBars ?? LIVE_EDGE_TOLERANCE_BARS;
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    attach(ts: ViewportTimeScaleLike): void {
        this.ts = ts;
    }

    detach(): void {
        this.ts = null;
        this.unlockPhase();
    }

    isAttached(): boolean {
        return this.ts !== null;
    }

    getPhase(): ViewportPhase {
        return this.phase;
    }

    getEpoch(): number {
        return this.epoch;
    }

    getBarCount(): number {
        return this.barCount;
    }

    isFollowingLive(): boolean {
        return this.following;
    }

    getVisibleRange(): LogicalRange | null {
        return this.lastRange;
    }

    /** True while a programmatic viewport op owns classification. */
    isProgrammatic(): boolean {
        return (
            this.phase === "RESETTING_SYMBOL" ||
            this.phase === "RESETTING_TIMEFRAME" ||
            this.phase === "FITTING" ||
            this.phase === "RESTORING" ||
            this.phase === "PREPENDING" ||
            this.phase === "FOCUSING"
        );
    }

    /** Notified only when the follow flag actually flips — never per pan frame. */
    subscribe(listener: (following: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    // ── context resets (symbol / timeframe) ─────────────────────────────────

    /**
     * New viewport context: cancels stale generations, forgets the old
     * logical range, and establishes live-follow for the incoming dataset.
     * Returns the new epoch so async work can detect staleness.
     */
    reset(context: "symbol" | "timeframe" | "initial"): number {
        this.epoch += 1;
        this.barCount = 0;
        this.lastRange = null;
        this.phase =
            context === "symbol"
                ? "RESETTING_SYMBOL"
                : context === "timeframe"
                    ? "RESETTING_TIMEFRAME"
                    : "INITIAL";
        this.setFollowing(true);
        return this.epoch;
    }

    // ── fitting ─────────────────────────────────────────────────────────────

    private doFit(): void {
        const ts = this.ts;
        if (!ts) return;
        this.phase = "FITTING";
        ts.fitContent();
        const range = ts.getVisibleLogicalRange();
        if (range) {
            this.lastRange = range;
            this.evaluate(range);
        } else {
            // No readable range (empty dataset): a fresh context starts at live.
            this.lastRange = null;
            this.phase = "FOLLOWING_LIVE";
            this.setFollowing(true);
        }
    }

    /** Deterministic initial view: fit the loaded dataset, then follow live. */
    initialFit(): void {
        this.doFit();
    }

    /** Explicit user-initiated refit (toolbar Fit). */
    refit(): void {
        this.doFit();
    }

    // ── live follow ─────────────────────────────────────────────────────────

    enterLiveFollow(): void {
        this.phase = "FOLLOWING_LIVE";
        this.setFollowing(true);
        const ts = this.ts;
        if (!ts) return;
        ts.scrollToRealTime();
        const range = ts.getVisibleLogicalRange();
        if (range) this.lastRange = range;
    }

    leaveLiveFollow(): void {
        this.phase = "USER_PANNED";
        this.setFollowing(false);
    }

    // ── range events ────────────────────────────────────────────────────────

    handleRangeChange(range: LogicalRange | null): void {
        if (range === null || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return;
        this.lastRange = range;
        if (this.isProgrammatic()) return;
        this.evaluate(range);
    }

    // ── data commits ────────────────────────────────────────────────────────

    setBarCount(count: number): void {
        this.barCount = Math.max(0, Math.floor(count));
    }

    /**
     * Bars were appended at the right edge. While following, the live edge is
     * re-asserted; while user-panned, no mutating viewport call is made — the
     * user's chosen area is preserved. Never fits.
     */
    handleDataAppend(_prevBarCount: number, nextBarCount: number): void {
        this.barCount = Math.max(0, Math.floor(nextBarCount));
        const ts = this.ts;
        if (!ts) return;
        if (this.phase === "INITIAL") {
            // First data for a context that never fit — establish the view once.
            this.doFit();
            return;
        }
        if (!this.following || this.isProgrammatic()) return;
        ts.scrollToRealTime();
        const range = ts.getVisibleLogicalRange();
        if (range) {
            this.lastRange = range;
            this.phase = "FOLLOWING_LIVE";
        }
    }

    /**
     * Reconciliation / gap repair / corrected candles / duplicate rows: the
     * viewport is deliberately untouched. Preservation across the actual data
     * swap is capture()+restore()'s job; this only tracks the dataset length.
     */
    handleDataMutation(nextBarCount: number): void {
        this.barCount = Math.max(0, Math.floor(nextBarCount));
    }

    // ── market-anchored preservation (prepend / repair) ─────────────────────

    private captureSnapshot(previousBarTimes: readonly number[]): ViewportSnapshot | null {
        const ts = this.ts;
        if (!ts || previousBarTimes.length === 0) return null;
        const range = ts.getVisibleLogicalRange();
        if (!range) return null;
        const leftIndex = Math.min(Math.max(0, Math.floor(range.from)), previousBarTimes.length - 1);
        const rightIndex = Math.min(Math.max(0, Math.ceil(range.to) - 1), previousBarTimes.length - 1);
        this.lastRange = range;
        return {
            epoch: this.epoch,
            range,
            leftIndex,
            leftTime: previousBarTimes[leftIndex],
            rightIndex,
            rightTime: previousBarTimes[rightIndex],
        };
    }

    /** Capture before a general data mutation (reconciliation, repair, batch append). */
    capture(previousBarTimes: readonly number[]): ViewportSnapshot | null {
        const snapshot = this.captureSnapshot(previousBarTimes);
        if (snapshot) this.phase = "RESTORING";
        return snapshot;
    }

    /** Capture before an older-history prepend — one snapshot per canonical commit. */
    prependStarted(previousBarTimes: readonly number[]): ViewportSnapshot | null {
        const snapshot = this.captureSnapshot(previousBarTimes);
        if (snapshot) this.phase = "PREPENDING";
        return snapshot;
    }

    /**
     * Apply the single compensation after the new bars are committed. The
     * market anchor (right edge when following, left edge when panned) is
     * located in the new series and the visible range shifted by exactly its
     * index delta — multi-page batches commit once and compensate once.
     * Returns the applied logical shift (0 = no viewport mutation).
     */
    private applySnapshot(snapshot: ViewportSnapshot, newBarTimes: readonly number[]): number {
        if (snapshot.epoch !== this.epoch) return 0; // stale generation ignored
        const ts = this.ts;
        if (!ts) {
            this.unlockPhase();
            return 0;
        }
        const useRight = this.following;
        const anchorIndex = useRight ? snapshot.rightIndex : snapshot.leftIndex;
        const anchorTime = useRight ? snapshot.rightTime : snapshot.leftTime;
        const newAnchorIndex = findBarIndex(newBarTimes, anchorTime);
        const shift = newAnchorIndex === null ? 0 : newAnchorIndex - anchorIndex;
        const shifted = { from: snapshot.range.from + shift, to: snapshot.range.to + shift };
        if (shift !== 0) {
            ts.setVisibleLogicalRange(shifted);
        }
        const range = ts.getVisibleLogicalRange() ?? shifted;
        this.lastRange = range;
        this.evaluate(range);
        return shift;
    }

    restore(snapshot: ViewportSnapshot, newBarTimes: readonly number[]): number {
        return this.applySnapshot(snapshot, newBarTimes);
    }

    prependCompleted(snapshot: ViewportSnapshot, newBarTimes: readonly number[]): number {
        return this.applySnapshot(snapshot, newBarTimes);
    }

    // ── focus ───────────────────────────────────────────────────────────────

    /**
     * Deterministic focus: targets a logical index, or a timestamp resolved
     * against the renderer's candle series. Focus that lands away from the
     * live edge explicitly transitions to USER_PANNED (never silently keeps a
     * stale follow flag); focusing the latest area re-evaluates to live.
     * `opts.epoch` rejects stale generations after a context reset.
     */
    focus(
        target:
            | { index: number }
            | { timeMs: number; bars: readonly { timestamp: number }[]; intervalMs: number },
        opts?: { halfBars?: number; epoch?: number },
    ): boolean {
        if (opts?.epoch !== undefined && opts.epoch !== this.epoch) return false;
        const ts = this.ts;
        if (!ts) return false;
        let index: number;
        if ("index" in target) {
            index = target.index;
        } else {
            index = barIndexForTime(target.bars, target.timeMs, target.intervalMs);
            if (!Number.isFinite(index)) return false;
        }
        const half = opts?.halfBars ?? FOCUS_HALF_BARS;
        const range: LogicalRange = { from: index - half, to: index + half };
        this.phase = "FOCUSING";
        ts.setVisibleLogicalRange(range);
        this.lastRange = range;
        this.evaluate(range);
        return true;
    }

    // ── resize ──────────────────────────────────────────────────────────────

    /**
     * Container resize: the native time scale keeps its logical range across
     * auto-size, so a panned viewport deliberately receives no viewport call.
     * While following, the live edge is re-asserted. Never fits, never resets.
     */
    handleResize(): void {
        const ts = this.ts;
        if (!ts || this.isProgrammatic()) return;
        const range = ts.getVisibleLogicalRange();
        if (range) this.lastRange = range;
        if (!this.following) return;
        ts.scrollToRealTime();
        const after = ts.getVisibleLogicalRange();
        if (after) this.lastRange = after;
        this.phase = "FOLLOWING_LIVE";
    }

    // ── internals ───────────────────────────────────────────────────────────

    private evaluate(range: LogicalRange): void {
        const atEdge = isNearLiveEdge(range, this.barCount, this.toleranceBars);
        this.phase = atEdge ? "FOLLOWING_LIVE" : "USER_PANNED";
        this.setFollowing(atEdge);
    }

    private setFollowing(next: boolean): void {
        if (next === this.following) return;
        this.following = next;
        for (const listener of [...this.listeners]) listener(next);
    }

    private unlockPhase(): void {
        if (this.isProgrammatic()) {
            this.phase = this.following ? "FOLLOWING_LIVE" : "USER_PANNED";
        }
    }
}
