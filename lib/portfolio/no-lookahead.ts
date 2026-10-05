/**
 * AlgoVault — Explicit evaluation instant (Phase 15 §45, no-lookahead).
 *
 * Research and portfolio maths must never read the wall clock. Any path that
 * needs "now" takes it as a parameter; this module exists so that a caller who
 * forgets is forced to confront the question rather than silently getting
 * `Date.now()`.
 *
 * The single exception is `wallClockNow()`, which is used only to build the
 * constant below at module load. Nothing else in this module reads time.
 */

/**
 * The evaluation instant used by the deterministic research surfaces. This is
 * the constant the engines were calibrated against; it is NOT "now" at runtime
 * and must never be used to index into live data.
 */
export const TODAY = Date.UTC(2026, 0, 1, 0, 0, 0);

/** Wall clock, for callers that genuinely need it (event timestamps only). */
export function wallClockNow(): number {
    return Date.now();
}

/**
 * Reject any window whose end lies beyond `evaluationTime`. Research and
 * portfolio analytics call this before reading any series so a future candle
 * cannot enter a calculation even if the caller passed one in by mistake.
 */
export function assertNoFutureData<T extends { timestamp: number }>(
    points: readonly T[],
    evaluationTime: number
): { ok: true; points: readonly T[] } | { ok: false; offendingTimestamp: number } {
    for (const point of points) {
        if (Number.isFinite(point.timestamp) && point.timestamp > evaluationTime) {
            return { ok: false, offendingTimestamp: point.timestamp };
        }
    }
    return { ok: true, points };
}

/** Drop any point after `evaluationTime`, for paths that degrade rather than fail. */
export function clipToEvaluationTime<T extends { timestamp: number }>(
    points: readonly T[],
    evaluationTime: number
): T[] {
    return points.filter((p) => !Number.isFinite(p.timestamp) || p.timestamp <= evaluationTime);
}
