import type { ChartCandle } from "./candle";

/**
 * TailTracker — Phase 9 performance bridge between the canonical engine and
 * any bar-oriented renderer (lightweight-charts, canvas renderer, replay UI).
 *
 * Instead of re-`setData`-ing an entire series on every tick, renderers ask
 * "what changed?" and push only the difference. Handles:
 *   - updated forming candle  → 1 bar update
 *   - newly appended candle   → finalize previous + update new (2 pushes)
 *   - history prepend/replace → full reset (renderer re-seeds)
 *   - series switch           → full reset
 */
export class TailTracker {
    private length = 0;
    private lastKey = "";
    private oldestTime = Number.MAX_SAFE_INTEGER;
    private lastBar: { time: number; open: number; high: number; low: number; close: number; volume: number } | null = null;

    reset(): void {
        this.length = 0;
        this.lastKey = "";
        this.oldestTime = Number.MAX_SAFE_INTEGER;
        this.lastBar = null;
    }

    /** Call when the renderer re-seeded from a full snapshot. */
    seedFrom(candles: readonly ChartCandle[]): void {
        this.length = candles.length;
        this.lastKey = candles.length > 0 ? seriesKey(candles) : "";
        this.oldestTime = candles.length > 0 ? candles[0].timestamp : Number.MAX_SAFE_INTEGER;
        const last = candles[candles.length - 1];
        this.lastBar = last
            ? { time: last.timestamp, open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume ?? 0 }
            : null;
    }

    /**
     * Compute the minimal update for the given snapshot.
     * `fullReset` is true when the renderer must re-seed everything.
     */
    diff(next: readonly ChartCandle[], seriesId: string): { fullReset: boolean; updates: ChartCandle[] } {
        const keyChanged = this.lastKey !== "" && this.lastKey !== seriesId;
        if (
            keyChanged ||
            this.length === 0 ||
            next.length < this.length ||
            (next.length > 0 && this.length > 0 && next[0].timestamp < this.oldestTime)
        ) {
            // History was prepended, replaced, or the series switched.
            this.seedFrom(next);
            return { fullReset: true, updates: [] };
        }
        if (next.length === this.length) {
            const last = next[next.length - 1];
            if (this.lastBar && last.timestamp === this.lastBar.time) {
                if (
                    last.open === this.lastBar.open &&
                    last.high === this.lastBar.high &&
                    last.low === this.lastBar.low &&
                    last.close === this.lastBar.close &&
                    (last.volume ?? 0) === this.lastBar.volume
                ) {
                    return { fullReset: false, updates: [] };
                }
                const updates = [last];
                this.lastBar = { time: last.timestamp, open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume ?? 0 };
                return { fullReset: false, updates };
            }
            this.seedFrom(next);
            return { fullReset: true, updates: [] };
        }
        // Appended one (or more) candles.
        const updates = next.slice(this.length - 1 < 0 ? 0 : this.length - 1);
        this.seedFrom(next);
        return { fullReset: false, updates };
    }
}

function seriesKey(candles: readonly ChartCandle[]): string {
    if (candles.length === 0) return "";
    const first = candles[0];
    return `${first.symbol}|${first.timeframe}`;
}

/**
 * Keyed diff for legacy full-set consumers: returns true when the snapshot is
 * append/update-only relative to `prev` (safe for incremental pushes).
 */
export function isTailOnlyChange(prev: readonly ChartCandle[], next: readonly ChartCandle[]): boolean {
    if (next.length < prev.length) return false;
    if (prev.length === 0) return false;
    for (let i = 0; i < prev.length - 1; i++) {
        if (prev[i] !== next[i]) return false;
    }
    return true;
}
