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
 *   • The countdown knows the market calendar: while the market is closed it
 *     counts to the next weekly open instead of to a bar close that will never
 *     come, so a weekend chart never shows a live-looking bar timer.
 */

import { isMarketTradableAt } from "./timeframe";

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

// ── session pause ───────────────────────────────────────────────────────────
//
// "Is the market open?" is TWO independent questions, and a chart that answers
// only one of them lies in both directions:
//
//   1. Calendar — is this inside the weekly trading week at all? (weekend /
//      Fri 21:00 UTC close). Purely a function of the clock.
//   2. Feed quiet — has anything actually traded recently? A metals or index
//      session can end mid-week without the calendar changing, and the only
//      honest evidence is silence: the chart engine already calls a feed with
//      no tick for `staleAfterMs` (120 s) "stale".
//
// Either one means there is nothing to draw, so the chart PAUSES — no live
// push, no scroll, no ticking clock. Crypto (24/7) never pauses on quietness:
// a silent crypto feed is a broken feed, not a closed market.

/** Why the chart is paused, or null while it is running. */
export type PauseReason = "calendar-close" | "feed-quiet" | "feed-gap" | null;

export interface SessionState {
    /** False → the chart must hold still (no pushes, no scroll, frozen clock). */
    open: boolean;
    reason: PauseReason;
}

export function resolveSession(args: {
    /** Inside the weekly trading window? */
    calendarOpen: boolean;
    /** Provider has sent no tick for the staleness window while the calendar says open? */
    feedStale?: boolean;
    /**
     * The engine found candle opens it cannot fill. A mid-week session break
     * (metals, indices) reads as a gap, not as silence — and the engine itself
     * excludes genuine market-closed periods from gap detection, so a gap here
     * is unusable data rather than a session boundary.
     */
    feedGap?: boolean;
    /** 24/7 instruments (crypto) are never paused by feed silence. */
    alwaysOpen?: boolean;
}): SessionState {
    if (!args.calendarOpen) return { open: false, reason: "calendar-close" };
    if (!args.alwaysOpen && args.feedGap) return { open: false, reason: "feed-gap" };
    if (!args.alwaysOpen && args.feedStale) return { open: false, reason: "feed-quiet" };
    return { open: true, reason: null };
}

// ── market hours ────────────────────────────────────────────────────────────
//
// The weekly boundary is NOT re-derived here: `isMarketTradableAt` in
// ./timeframe owns the forex/CFD rule (Sunday 21:00 UTC → Friday 21:00 UTC)
// and this module reuses it, so a countdown clock and the candle-gap engine can
// never disagree about a weekend. Only the *next boundary* arithmetic is new —
// a countdown clock needs to know when the market flips, not just where it
// currently is. Crypto exchanges never close, so callers dealing with
// crypto-only symbols pass `alwaysOpen`.

/** Minutes from midnight UTC at which the week opens/closes. */
const WEEK_OPEN_MIN = 21 * 60; // Sunday 21:00 UTC
const WEEK_CLOSE_MIN = 21 * 60; // Friday 21:00 UTC
const DAY_MIN = 1440;

export type MarketPhase = "open" | "closed";

export interface MarketStatus {
    /** True while the market accepts trades. */
    open: boolean;
    /** Which side of the weekly boundary the clock is on. */
    phase: MarketPhase;
    /**
     * When the phase next flips (ms epoch), or null for an always-open market
     * that has no boundary.
     */
    changeAt: number | null;
    /** Milliseconds until the phase flips (never negative). */
    untilChangeMs: number;
}

/** Days since the Unix epoch, UTC — independent of the viewer's timezone. */
function utcDayIndex(nowMs: number): number {
    return Math.floor(nowMs / (DAY_MIN * 60_000));
}

/**
 * Weekday of a UTC epoch-day index with 0 = Sunday. Epoch day 0 (1970-01-01)
 * was a Thursday, hence the +4 shift.
 */
function sundayIndexedDow(dayIndex: number): number {
    return (((dayIndex + 4) % 7) + 7) % 7;
}

/** Epoch ms for `minuteOfDay` UTC on the day `daysFromEpoch` away. */
function boundaryMs(daysFromEpoch: number, minuteOfDay: number): number {
    return (daysFromEpoch * DAY_MIN + minuteOfDay) * 60_000;
}

/**
 * Market open/closed state plus the exact boundary it flips at.
 *
 * Always-open (crypto) markets report `open: true` with a `null` boundary, so
 * a caller can render "always on" without a bogus countdown.
 */
export function marketStatusAt(
    nowMs: number,
    opts?: { alwaysOpen?: boolean }
): MarketStatus {
    if (!Number.isFinite(nowMs)) {
        return { open: true, phase: "open", changeAt: null, untilChangeMs: 0 };
    }
    if (opts?.alwaysOpen) {
        return { open: true, phase: "open", changeAt: null, untilChangeMs: 0 };
    }
    const dayIndex = utcDayIndex(nowMs);
    const dow = sundayIndexedDow(dayIndex);
    const open = isMarketTradableAt(nowMs);

    if (open) {
        // Next close: Friday 21:00 UTC — later this week, or next week when the
        // clock is already past Friday's close window (Sunday 21:00+).
        const closeDay = dayIndex + ((5 - dow + 7) % 7);
        const changeAt = boundaryMs(closeDay, WEEK_CLOSE_MIN);
        return { open: true, phase: "open", changeAt, untilChangeMs: Math.max(0, changeAt - nowMs) };
    }

    // Next open: Sunday 21:00 UTC — later today on a Sunday morning, otherwise
    // the coming Sunday (Saturday → +1 day, Friday evening → +2 days).
    const openDay = dow === 0 ? dayIndex : dayIndex + (dow === 6 ? 1 : 7 - dow);
    const changeAt = boundaryMs(openDay, WEEK_OPEN_MIN);
    return { open: false, phase: "closed", changeAt, untilChangeMs: Math.max(0, changeAt - nowMs) };
}

/** A countdown that respects the market calendar instead of the bar grid. */
export interface MarketCountdown {
    /** Whether the countdown currently runs (market open) or waits (closed). */
    open: boolean;
    /**
     * What the label counts down to: the forming bar's close while the market
     * trades, or the next weekly open once it does not.
     */
    target: "bar-close" | "market-open";
    /** Human label for the chart footer, e.g. "close 00:04:31". */
    label: string;
    /** Milliseconds left on the timer (frozen target while closed). */
    remainingMs: number;
    /** True inside the last `CLOSING_SOON_MS` before a scheduled close. */
    closingSoon: boolean;
}

/** A market inside this window of its close is flagged "closing soon". */
export const CLOSING_SOON_MS = 15 * 60_000;

/**
 * The chart's countdown: bar-close while the market trades, "opens in" once
 * it is closed. This is the single source both the moving price line and the
 * footer chip render, so they can never disagree — and a closed market can
 * never show a bar countdown ticking towards a close that will not happen.
 */
export function marketCountdown(
    nowMs: number,
    intervalMs: number,
    opts?: { alwaysOpen?: boolean }
): MarketCountdown {
    const status = marketStatusAt(nowMs, opts);
    if (!status.open) {
        const remainingMs = status.untilChangeMs;
        return {
            open: false,
            target: "market-open",
            label: `opens in ${formatCountdown(remainingMs)}`,
            remainingMs,
            closingSoon: false,
        };
    }
    const bar = barCloseCountdown(nowMs, intervalMs);
    const remainingMs = bar?.remainingMs ?? 0;
    const closingSoon =
        status.changeAt !== null && status.untilChangeMs <= CLOSING_SOON_MS;
    return {
        open: true,
        target: "bar-close",
        label: closingSoon
            ? `closes in ${formatCountdown(status.untilChangeMs)}`
            : `close ${formatCountdown(remainingMs)}`,
        remainingMs,
        closingSoon,
    };
}
