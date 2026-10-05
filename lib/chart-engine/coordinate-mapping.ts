/**
 * Pure mapping helpers shared by chart renderers and their tests.
 *
 * Candle-index mapping follows the renderer's discrete timeline, not wall-clock
 * interval arithmetic across closed sessions/gaps. A timestamp between two
 * observed bars maps fractionally between their indices; beyond the loaded
 * range it extrapolates by the nominal timeframe interval.
 */

export interface TimedBar {
    timestamp: number;
}

export interface LogicalRange {
    from: number;
    to: number;
}

export function barIndexForTime(
    bars: readonly TimedBar[],
    timeMs: number,
    intervalMs: number,
): number {
    if (bars.length === 0 || !Number.isFinite(timeMs) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
        return Number.NaN;
    }
    const first = bars[0].timestamp;
    const last = bars[bars.length - 1].timestamp;
    if (!Number.isFinite(first) || !Number.isFinite(last)) return Number.NaN;
    for (let i = 1; i < bars.length; i++) {
        if (!Number.isFinite(bars[i].timestamp) || bars[i].timestamp <= bars[i - 1].timestamp) return Number.NaN;
    }
    if (timeMs < first) return (timeMs - first) / intervalMs;
    if (timeMs > last) return bars.length - 1 + (timeMs - last) / intervalMs;

    let lo = 0;
    let hi = bars.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const stamp = bars[mid].timestamp;
        if (stamp === timeMs) return mid;
        if (stamp < timeMs) lo = mid + 1;
        else hi = mid - 1;
    }
    const left = Math.max(0, hi);
    const right = Math.min(bars.length - 1, lo);
    const span = bars[right].timestamp - bars[left].timestamp;
    if (span <= 0) return left;
    return left + (timeMs - bars[left].timestamp) / span;
}

/** Shift a logical viewport by the number of genuinely prepended bars. */
export function shiftLogicalRangeForPrepend(
    range: LogicalRange,
    previousCount: number,
    nextCount: number,
): LogicalRange {
    const added = Math.max(0, Math.floor(nextCount) - Math.floor(previousCount));
    return { from: range.from + added, to: range.to + added };
}

/** Find the exact prefix length before the previously loaded first timestamp. */
export function countPrependedBars<T extends { time: number }>(
    bars: readonly T[],
    previousFirstTime: number,
): number {
    if (!Number.isFinite(previousFirstTime)) return 0;
    let count = 0;
    while (count < bars.length && bars[count].time < previousFirstTime) count += 1;
    return count;
}
