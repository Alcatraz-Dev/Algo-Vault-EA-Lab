/**
 * AlgoVault — statistical primitives for quantitative validation.
 *
 * Deliberately small and dependency-free: every function here is used by the
 * overfitting layer (DSR / PBO) and covered by deterministic tests. Missing or
 * degenerate inputs return `null` (or a documented fallback) instead of NaN, so
 * a caller can never mistake "not computable" for "zero" or "significant".
 */

export function mean(values: readonly number[]): number {
    if (values.length === 0) return 0;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}

/** Sample variance (ddof = 1). Returns 0 for fewer than two observations. */
export function variance(values: readonly number[], ddof = 1): number {
    const n = values.length;
    if (n - ddof <= 0) return 0;
    const m = mean(values);
    let acc = 0;
    for (const v of values) acc += (v - m) * (v - m);
    return acc / (n - ddof);
}

export function stdDev(values: readonly number[], ddof = 1): number {
    return Math.sqrt(variance(values, ddof));
}

/**
 * Per-observation Sharpe ratio: mean / sample standard deviation.
 * Not annualised — the DSR formula is defined on per-observation Sharpe.
 * Returns `null` when the dispersion is zero (undefined ratio, not infinity).
 */
export function sharpeRatio(returns: readonly number[]): number | null {
    if (returns.length < 3) return null;
    const sd = stdDev(returns, 1);
    if (!(sd > 0)) return null;
    return mean(returns) / sd;
}

/** Population skewness (third standardised moment). 0 for < 3 observations. */
export function skewness(values: readonly number[]): number {
    const n = values.length;
    if (n < 3) return 0;
    const m = mean(values);
    let m2 = 0;
    let m3 = 0;
    for (const v of values) {
        const d = v - m;
        m2 += d * d;
        m3 += d * d * d;
    }
    m2 /= n;
    m3 /= n;
    if (!(m2 > 0)) return 0;
    return m3 / Math.pow(m2, 1.5);
}

/**
 * Population kurtosis (fourth standardised moment, NON-excess).
 * A normal distribution returns ~3. 3 for < 4 observations.
 */
export function kurtosis(values: readonly number[]): number {
    const n = values.length;
    if (n < 4) return 3;
    const m = mean(values);
    let m2 = 0;
    let m4 = 0;
    for (const v of values) {
        const d = v - m;
        const d2 = d * d;
        m2 += d2;
        m4 += d2 * d2;
    }
    m2 /= n;
    m4 /= n;
    if (!(m2 > 0)) return 3;
    return m4 / (m2 * m2);
}

/** Linear-interpolated percentile, p in [0, 1]. */
export function percentile(values: readonly number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const clamped = Math.min(1, Math.max(0, p));
    const pos = clamped * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Standard normal CDF — Hart (1968) double-precision rational approximation,
 * |error| ≈ 1e-15 over the practical range.
 *
 * The DSR is a probability that is compared against thresholds (0.90, 0.95),
 * so a 1e-7 approximation (Abramowitz & Stegun 7.1.26, used previously) was
 * not good enough near those boundaries.
 *
 * Reference values: Φ(0)=0.5, Φ(1.96)=0.9750021048517796,
 * Φ(−2.5758293035489004)=0.005.
 */
export function normalCdf(z: number): number {
    if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
    const x = Math.abs(z);
    let tail: number;
    if (x > 37) {
        tail = 0;
    } else {
        const expo = Math.exp((-x * x) / 2);
        if (x < 7.07106781186547) {
            let b = 3.52624965998911e-2 * x + 0.700383064443688;
            b = b * x + 6.37396220353165;
            b = b * x + 33.912866078383;
            b = b * x + 112.079291497871;
            b = b * x + 221.213596169931;
            b = b * x + 220.206867912376;
            let c = 8.83883476483184e-2 * x + 1.75566716318264;
            c = c * x + 16.064177579207;
            c = c * x + 86.7807322029461;
            c = c * x + 296.564248779674;
            c = c * x + 637.333633378831;
            c = c * x + 793.826512519948;
            c = c * x + 440.413735824752;
            tail = (expo * b) / c;
        } else {
            let b = x + 0.65;
            b = x + 4 / b;
            b = x + 3 / b;
            b = x + 2 / b;
            b = x + 1 / b;
            tail = expo / (b * 2.506628274631);
        }
    }
    return z > 0 ? 1 - tail : tail;
}

/**
 * Standard normal quantile (inverse CDF) — Acklam's rational approximation,
 * relative error < 1.15e-9 over (0, 1).
 */
export function normalPpf(p: number): number {
    if (!(p > 0 && p < 1)) {
        if (p <= 0) return Number.NEGATIVE_INFINITY;
        if (p >= 1) return Number.POSITIVE_INFINITY;
        return Number.NaN;
    }
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pLow = 0.02425;
    const pHigh = 1 - pLow;
    let q: number;
    let x: number;
    if (p < pLow) {
        q = Math.sqrt(-2 * Math.log(p));
        x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p > pHigh) {
        q = Math.sqrt(-2 * Math.log(1 - p));
        x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else {
        q = p - 0.5;
        const r = q * q;
        x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }

    // One Newton step against the high-accuracy CDF (Acklam's approximation
    // alone is ~1e-9, which perturbs DSR thresholds at the 0.95 boundary).
    const pdf = Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
    if (pdf > 0 && Number.isFinite(pdf)) {
        const refined = x - (normalCdf(x) - p) / pdf;
        if (Number.isFinite(refined)) return refined;
    }
    return x;
}

/** logit(r) = ln(r / (1 - r)); ±Infinity at the boundaries (documented). */
export function logit(r: number): number {
    if (r <= 0) return Number.NEGATIVE_INFINITY;
    if (r >= 1) return Number.POSITIVE_INFINITY;
    return Math.log(r / (1 - r));
}

/** Deterministic LCG (same generator family as the existing Monte Carlo runner). */
export function seededRandom(seed: number): () => number {
    let s = Number.isFinite(seed) && seed > 0 ? Math.floor(seed) % 2147483647 : 1;
    if (s === 0) s = 1;
    return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
}
