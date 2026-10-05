/**
 * trendProjection — least-squares extension of the observed closes.
 *
 * This is the honest version of the dashed "projection" line on the reference
 * dashboard: it fits a straight line through the most recent closes and
 * extends it a few bars into the empty right margin. It is a description of
 * the trend that *was* there — not a forecast — and nothing is invented: every
 * number comes from candles the feed actually returned.
 */

/** Only the close is read, so any candle shape with a numeric close fits. */
export type TrendSample = { readonly close: number };

export type TrendProjection = {
    /** Projected close `horizon` bars past the last observed candle. */
    price: number;
    /** Price change per bar implied by the fit. */
    slope: number;
    /** Coefficient of determination, 0…1 — how straight the observed run was. */
    rSquared: number;
    direction: "up" | "down" | "flat";
    /** Number of candles actually used for the fit. */
    bars: number;
    /** The last observed close, so callers can show the gap without re-reading. */
    lastClose: number;
};

const DEFAULT_LOOKBACK = 30;
const DEFAULT_HORIZON = 8;
const MIN_POINTS = 8;

/**
 * Fit a least-squares line over the tail of `samples` and extend it.
 *
 * @param samples   closes in chronological order (oldest first)
 * @param lookback  how many of the most recent closes to fit
 * @param horizon   how many bars past the last candle to project
 * @returns the projection, or null when there is not enough data to fit
 */
export function trendProjection(
    samples: readonly TrendSample[],
    { lookback = DEFAULT_LOOKBACK, horizon = DEFAULT_HORIZON }: { lookback?: number; horizon?: number } = {}
): TrendProjection | null {
    if (!Array.isArray(samples) || !Number.isFinite(lookback) || !Number.isFinite(horizon)) return null;

    const window = samples.slice(Math.max(0, samples.length - Math.max(MIN_POINTS, Math.floor(lookback))));
    const usable = window.filter((s) => Number.isFinite(s?.close));
    if (usable.length < MIN_POINTS) return null;

    const n = usable.length;
    const lastClose = usable[n - 1].close;

    // Straightforward simple linear regression on the index → close pairs.
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += usable[i].close;
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
        const dx = i - meanX;
        const dy = usable[i].close - meanY;
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
    }

    if (sxx === 0) return null; // every index identical — cannot fit a slope

    const slope = sxy / sxx;
    const intercept = meanY - slope * meanX;
    const price = intercept + slope * (n - 1 + horizon);

    // r² = 1 - SSres/SStot; a perfectly flat series has no variance to
    // explain, so it is a perfect fit only when the residuals are zero too.
    let rSquared: number;
    if (syy === 0) {
        rSquared = 0;
    } else {
        let ssRes = 0;
        for (let i = 0; i < n; i++) {
            const residual = usable[i].close - (intercept + slope * i);
            ssRes += residual * residual;
        }
        rSquared = Math.max(0, Math.min(1, 1 - ssRes / syy));
    }

    const eps = Math.max(1e-9, Math.abs(lastClose) * 1e-6);
    const direction: TrendProjection["direction"] =
        slope > eps ? "up" : slope < -eps ? "down" : "flat";

    return {
        price: Number.isFinite(price) ? price : lastClose,
        slope,
        rSquared,
        direction,
        bars: n,
        lastClose,
    };
}
