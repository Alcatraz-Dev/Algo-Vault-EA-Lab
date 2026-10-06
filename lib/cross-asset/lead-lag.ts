/**
 * AlgoVault — Lead-Lag Analysis (Phase 16 §9).
 *
 * PURE + DETERMINISTIC + POINT-IN-TIME. Given two aligned return series and an
 * `asOf` stamp, it measures whether one series' past returns co-move with the
 * other's returns `k` bars later, for k ∈ {1, 2, 3, 5, 10} by default.
 *
 * What it does NOT do:
 *   • it does not claim predictive power — a lead-lag observation from one
 *     historical window is an OBSERVATION, and the result always ships with
 *     `limitations` (§9);
 *   • it does not establish causality (§56);
 *   • it does not use a single bar beyond `asOf` (§10).
 *
 * Statistics: Pearson ρ at each lag with a two-sided Student-t p-value
 * (regularised incomplete beta — no dependencies). Stability is checked by
 * re-running the lag search on both half-samples and comparing winners.
 */

import { alignReturns, pearson, toReturns, type PriceSeries } from "@/lib/portfolio/correlation";
import type { LeadLagLagResult, LeadLagResult, RelationshipWindow } from "./types";
import { truncateAt } from "./relationships";
import { LEAD_LAG_ENGINE_VERSION } from "./versions";

/** Lags tested, in bars (§9). */
export const DEFAULT_LAGS = [1, 2, 3, 5, 10] as const;

/** Minimum paired observations for ANY lag coefficient. */
export const MIN_LEAD_LAG_OBSERVATIONS = 30;

/** |ρ| below this at the best lag → no lead-lag relationship is reported. */
export const LEAD_LAG_MIN_COEFFICIENT = 0.2;

/** p-value ceiling for the headline lag (documented, conservative). */
export const LEAD_LAG_MAX_PVALUE = 0.05;

/* ── Student-t two-sided p-value (numerically stable, no deps) ────────────── */

const LOG_GAMMA_C = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
];

function logGamma(x: number): number {
    let y = x;
    let tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j += 1) {
        y += 1;
        ser += LOG_GAMMA_C[j] / y;
    }
    return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
    const MAX_IT = 200;
    const EPS = 3e-12;
    const FPMIN = 1e-300;
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAX_IT; m += 1) {
        const m2 = 2 * m;
        let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < FPMIN) d = FPMIN;
        c = 1 + aa / c;
        if (Math.abs(c) < FPMIN) c = FPMIN;
        d = 1 / d;
        h *= d * c;
        aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < FPMIN) d = FPMIN;
        c = 1 + aa / c;
        if (Math.abs(c) < FPMIN) c = FPMIN;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < EPS) break;
    }
    return h;
}

/** Regularised incomplete beta I_x(a, b). */
function regularizedIncompleteBeta(a: number, b: number, x: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const front = Math.exp(
        logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
    );
    if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a;
    return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Two-sided p-value for Pearson r with `n` paired observations. */
export function pearsonPValue(r: number | null, n: number): number | null {
    if (r === null || !Number.isFinite(r) || n < 3) return null;
    const rr = Math.max(-0.999999, Math.min(0.999999, r));
    const df = n - 2;
    if (df <= 0) return null;
    const t = (rr * Math.sqrt(df)) / Math.sqrt(1 - rr * rr);
    return regularizedIncompleteBeta(df / 2, 0.5, df / (df + t * t));
}

/* ── Lag scan ─────────────────────────────────────────────────────────────── */

interface LagScanPoint {
    lag: number;
    coefficient: number | null;
    pValue: number | null;
    sampleSize: number;
}

/**
 * Correlate `leading` returns at t with `trailing` returns at t+lag.
 * Only data ≤ the last bar of each series is used (both series are already
 * truncated by the caller's `asOf`).
 */
function scanLags(leading: number[], trailing: number[], lags: number[]): LagScanPoint[] {
    const out: LagScanPoint[] = [];
    for (const lag of lags) {
        if (lag <= 0 || lag >= leading.length) {
            out.push({ lag, coefficient: null, pValue: null, sampleSize: 0 });
            continue;
        }
        const x = leading.slice(0, leading.length - lag);
        const y = trailing.slice(lag);
        const n = x.length;
        if (n < MIN_LEAD_LAG_OBSERVATIONS) {
            out.push({ lag, coefficient: null, pValue: null, sampleSize: n });
            continue;
        }
        const coefficient = pearson(x, y);
        out.push({ lag, coefficient, pValue: pearsonPValue(coefficient, n), sampleSize: n });
    }
    return out;
}

function bestOf(scan: LagScanPoint[]): LagScanPoint | null {
    let best: LagScanPoint | null = null;
    for (const point of scan) {
        if (point.coefficient === null) continue;
        if (!best || Math.abs(point.coefficient) > Math.abs(best.coefficient as number)) best = point;
    }
    return best;
}

function toLagResults(scan: LagScanPoint[]): LeadLagLagResult[] {
    return scan.map((p) => ({
        lag: p.lag,
        coefficient: p.coefficient,
        pValue: p.pValue,
        sampleSize: p.sampleSize,
    }));
}

/* ── Public API ───────────────────────────────────────────────────────────── */

export interface ComputeLeadLagInput {
    a: PriceSeries;
    b: PriceSeries;
    window: RelationshipWindow;
    /** Absolute cutoff — no bar after this timestamp may be used (§10). */
    asOf: number;
    calculatedAt: number;
    lags?: number[];
}

/**
 * Measure the observed lead-lag relationship in BOTH directions and keep the
 * stronger one. Returns `null` when the window cannot support a claim.
 */
export function computeLeadLag(input: ComputeLeadLagInput): LeadLagResult | null {
    const lags = [...(input.lags ?? DEFAULT_LAGS)];
    const left = truncateAt(input.a, input.asOf);
    const right = truncateAt(input.b, input.asOf);
    const aligned = alignReturns(toReturns(left, "log"), toReturns(right, "log"));

    const takeLast = (values: number[]): number[] => values.slice(-input.window.bars);
    const x = takeLast(aligned.x);
    const y = takeLast(aligned.y);
    const stamps = takeLast(aligned.timestamps);
    if (x.length < MIN_LEAD_LAG_OBSERVATIONS + Math.max(...lags)) return null;

    const aLeads = scanLags(x, y, lags);
    const bLeads = scanLags(y, x, lags);

    const bestA = bestOf(aLeads);
    const bestB = bestOf(bLeads);
    if (!bestA && !bestB) return null;

    const useA = bestA && (!bestB || Math.abs(bestA.coefficient as number) >= Math.abs(bestB.coefficient as number));
    const scan = useA ? aLeads : bLeads;
    const best = (useA ? bestA : bestB) as LagScanPoint;
    const leader = useA ? input.a.symbol : input.b.symbol;
    const follower = useA ? input.b.symbol : input.a.symbol;

    const coefficient = best.coefficient;
    if (coefficient === null || Math.abs(coefficient) < LEAD_LAG_MIN_COEFFICIENT) return null;

    /* Stability: same winning lag + same sign in both half-samples? */
    const mid = Math.floor(x.length / 2);
    const half1 = useA
        ? scanLags(x.slice(0, mid), y.slice(0, mid), lags)
        : scanLags(y.slice(0, mid), x.slice(0, mid), lags);
    const half2 = useA
        ? scanLags(x.slice(mid), y.slice(mid), lags)
        : scanLags(y.slice(mid), x.slice(mid), lags);
    const w1 = bestOf(half1);
    const w2 = bestOf(half2);
    const stable =
        !!w1 &&
        !!w2 &&
        w1.lag === w2.lag &&
        w1.coefficient !== null &&
        w2.coefficient !== null &&
        w1.coefficient * w2.coefficient > 0;
    const stabilityNote = stable
        ? `Lag ${best.lag} ranked first with the same sign in both half-samples (${w1?.coefficient?.toFixed(2)}, ${w2?.coefficient?.toFixed(2)}).`
        : w1 && w2
          ? `Half-samples disagreed (lag ${w1.lag} ρ=${w1.coefficient?.toFixed(2)} vs lag ${w2.lag} ρ=${w2.coefficient?.toFixed(2)}) — treat the lead-lag as unstable.`
          : "Half-sample winners could not be computed.";

    const from = stamps[0] ?? 0;
    const to = stamps[stamps.length - 1] ?? 0;

    return {
        leader,
        follower,
        lag: best.lag,
        coefficient,
        pValue: best.pValue,
        sampleSize: best.sampleSize,
        period: { from, to },
        lagsTested: lags,
        perLag: toLagResults(scan),
        stable,
        stabilityNote,
        limitations: [
            `Measured on ${best.sampleSize} paired ${input.window.timeframe} observations over ${lags.length} tested lags — multiple lags were tested, so the best lag is an in-sample maximum (§9).`,
            "An observed lead-lag is a historical association, not proof that one market causes or predicts the other (§56, §57).",
            "Relationships can differ by session and regime; this measurement pools the whole window.",
            `Engine ${LEAD_LAG_ENGINE_VERSION}; computed with data ≤ ${new Date(input.asOf).toISOString()}.`,
        ],
    };
}
