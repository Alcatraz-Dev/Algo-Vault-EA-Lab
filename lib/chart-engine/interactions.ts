import {
    DEFAULT_BAR_WIDTH,
    isAtLiveEdge,
    panByPixels,
    zoomAt,
    type ChartViewport,
} from "./viewport";

/**
 * InteractionController — Phase 11 interaction state machine.
 *
 * Framework-agnostic: the React layer wires DOM events onto these handlers
 * and reads back the (pure) viewport. Wheel zoom anchors at the cursor,
 * drag pans horizontally, pinch zooms on touch, and the follow/live rule is
 * centralized: any manual pan away from the newest candle disengages live
 * following; only `goToLive` (or panning back to the edge) re-engages it.
 */

export type Crosshair = { x: number; y: number } | null;

export interface InteractionState {
    viewport: ChartViewport;
    crosshair: Crosshair;
    dragging: boolean;
    /** Pinch in progress (touch). */
    pinching: boolean;
}

export class InteractionController {
    private state: InteractionState;
    private dragStart: { x: number; scrollFromRight: number } | null = null;
    private pinchStart: { dist: number; barWidth: number } | null = null;
    private onFollowChange: (following: boolean) => void;
    private wasFollowing: boolean;

    constructor(opts?: { viewport?: ChartViewport; onFollowChange?: (following: boolean) => void }) {
        this.state = {
            viewport: opts?.viewport ?? {
                barWidth: DEFAULT_BAR_WIDTH,
                rightOffsetBars: 5,
                scrollFromRightPx: 0,
                autoFitY: true,
            },
            crosshair: null,
            dragging: false,
            pinching: false,
        };
        this.onFollowChange = opts?.onFollowChange ?? (() => {});
        this.wasFollowing = isAtLiveEdge(this.state.viewport);
    }

    getState(): InteractionState {
        return this.state;
    }

    getViewport(): ChartViewport {
        return this.state.viewport;
    }

    isFollowingLive(): boolean {
        return isAtLiveEdge(this.state.viewport);
    }

    private commitViewport(next: ChartViewport): void {
        this.state.viewport = next;
        const following = isAtLiveEdge(next);
        if (following !== this.wasFollowing) {
            this.wasFollowing = following;
            this.onFollowChange(following);
        }
    }

    /** Wheel zoom anchored at the cursor X (px from plot left). */
    wheelZoom(deltaY: number, anchorX: number, plotWidth: number): void {
        if (deltaY === 0) return;
        const factor = deltaY < 0 ? 1.15 : 1 / 1.15;
        const anchorFromRight = plotWidth - anchorX;
        this.commitViewport(zoomAt(this.state.viewport, factor, anchorFromRight));
    }

    /** Drag pan; returns true when the viewport changed. */
    dragStart_(x: number): void {
        this.dragStart = { x, scrollFromRight: this.state.viewport.scrollFromRightPx };
        this.state.dragging = true;
    }

    dragMove(x: number): void {
        if (!this.dragStart) return;
        const dx = x - this.dragStart.x; // dragging content right (x grows) reveals older candles
        const next = panByPixels(
            { ...this.state.viewport, scrollFromRightPx: this.dragStart.scrollFromRight },
            dx,
        );
        this.commitViewport(next);
    }

    dragEnd(): void {
        this.dragStart = null;
        this.state.dragging = false;
    }

    /** Touch pinch zoom (distance between touches, anchor at midpoint). */
    pinchMove(dist: number, anchorX: number, plotWidth: number): void {
        if (this.pinchStart === null) {
            this.pinchStart = { dist, barWidth: this.state.viewport.barWidth };
            this.state.pinching = true;
            return;
        }
        const ratio = dist / Math.max(1, this.pinchStart.dist);
        const targetBar = this.pinchStart.barWidth * ratio;
        const factor = targetBar / this.state.viewport.barWidth;
        const anchorFromRight = plotWidth - anchorX;
        this.commitViewport(zoomAt(this.state.viewport, factor, anchorFromRight));
    }

    pinchEnd(): void {
        this.pinchStart = null;
        this.state.pinching = false;
    }

    /** Single-touch drag pan (mobile) — same as mouse drag. */
    touchPanStart(x: number): void {
        this.dragStart_(x);
    }

    touchPanMove(x: number): void {
        this.dragMove(x);
    }

    touchPanEnd(): void {
        this.dragEnd();
    }

    moveCrosshair(x: number, y: number): void {
        this.state.crosshair = { x, y };
    }

    clearCrosshair(): void {
        this.state.crosshair = null;
    }

    /** Explicit Go-to-Live: jump viewport to the newest candle. */
    goToLive(): void {
        this.commitViewport({ ...this.state.viewport, scrollFromRightPx: 0 });
    }

    /** Double-click: reset zoom to a sensible default and go live. */
    doubleClickReset(): void {
        this.commitViewport({
            ...this.state.viewport,
            barWidth: DEFAULT_BAR_WIDTH,
            scrollFromRightPx: 0,
        });
    }

    /** Zoom-to-fit: shrink bar width so the whole series fits the plot. */
    fit(seriesLength: number, plotWidth: number): void {
        if (seriesLength <= 0 || plotWidth <= 0) return;
        const target = Math.max(2, Math.min(60, Math.floor(plotWidth / seriesLength)));
        this.commitViewport({ ...this.state.viewport, barWidth: target });
    }

    /** Apply a fully external viewport (kept for keyboard / programmatic control). */
    setViewport(vp: ChartViewport): void {
        this.commitViewport(vp);
    }

    setAutoFitY(v: boolean): void {
        this.state.viewport.autoFitY = v;
    }
}
