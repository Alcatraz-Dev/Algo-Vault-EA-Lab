/**
 * Bar-close countdown — pure helpers shared by the chart and its tests.
 *
 * The terminal runs the same candle clock everywhere (chart footer, the
 * moving countdown line, the workspace toolbar), so the arithmetic lives
 * here instead of being re-derived inside React effects.
 *
 * Contract:
 *   • A bar's window is aligned to the *interval grid*, not to the first
 *     candle the feed happened to return — `floor(now / interval) * interval`.
 *     That keeps the countdown aligned with the exchange's own boundaries.
 *   • Crossing zero rolls straight into the next bar: the countdown never
 *     sticks at 00:00:00 waiting for a re-render (the bug this replaced).
 *   • `formatCountdown` always emits `HH:MM:SS`, zero-padded, so the label
 *     does not jitter between `0:04` and `00:04:00` as the interval changes.
 */

export interface BarCountdown {
    /** Start of the bar currently forming (ms, interval-grid aligned). */
    barStart: number;
    /** When that bar closes (ms) — always `barStart + intervalMs`. */
    closeAt: number;
    /** Milliseconds left, clamped to `[0, intervalMs]`. */
    remainingMs: number;
    /** Whole seconds left, floored — what a countdown label renders. */
    remainingSeconds: number;
}

/** Guard against a zero/NaN interval making the arithmetic meaningless. */
function safeInterval(intervalMs: number): number {
    return Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 60_000;
}

/**
 * Countdown state for the bar that contains `nowMs`.
 *
 * Returns null only when the inputs cannot describe a bar at all (a
 * non-finite clock). A zero `remainingMs` means "this bar is closing now"
 * and the next call rolls over — callers do not have to special-case it.
 */
export function barCloseCountdown(nowMs: number, intervalMs: number): BarCountdown | null {
    if (!Number.isFinite(nowMs)) return null;
    const interval = safeInterval(intervalMs);
    const barStart = Math.floor(nowMs / interval) * interval;
    const closeAt = barStart + interval;
    // A bar is 0..interval-1 ms in, so this lands in [0, interval] with the
    // exact grid boundary producing a full interval (the bar just opened).
    const raw = closeAt - nowMs;
    const remainingMs = Math.min(interval, Math.max(0, raw));
    return {
        barStart,
        closeAt,
        remainingMs,
        remainingSeconds: Math.ceil(remainingMs / 1000),
    };
}

/**
 * `HH:MM:SS` for a millisecond duration. Rolls hours past 99 rather than
 * truncating, so a long session never shows a wrong-looking `HH`.
 */
export function formatCountdown(remainingMs: number): string {
    const safe = Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : 0;
    const totalSeconds = Math.ceil(safe / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** "M5" → 5 min. Resolves through `TIMEFRAME_MS`, falling back to 60 s. */
export function intervalMsForTimeframe(
    timeframe: string,
    timeframes: Record<string, number>
): number {
    return safeInterval(timeframes[timeframe]);
}
