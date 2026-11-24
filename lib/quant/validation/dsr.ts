/**
 * Deflated Sharpe Ratio (Bailey & López de Prado, 2014).
 *
 * A Sharpe ratio computed on a strategy that was selected from N trials is
 * upward-biased: the best of N noisy estimates looks good even when every
 * trial has zero true edge. The DSR discounts the observed Sharpe by the
 * Sharpe that the *luckiest* of N trials would be expected to produce, then
 * reports the probability that the true Sharpe exceeds the benchmark.
 *
 *   SR0 = sqrt(Var(SR_n)) · [ (1-γ)·Φ⁻¹(1 - 1/N) + γ·Φ⁻¹(1 - 1/(N·e)) ]
 *   DSR = Φ[ (SR - SR0)·√(T-1) / √(1 - γ3·SR + ((γ4-1)/4)·SR²) ]
 *
 * γ  = Euler–Mascheroni constant
 * γ3 = skewness of returns, γ4 = kurtosis (non-excess)
 * T  = number of return observations
 *
 * Honesty rules enforced by this module:
 *   • no result without the number of trials (selection bias cannot be
 *     "assumed away" with N = 1 unless the caller explicitly says so);
 *   • no result for degenerate return series (zero dispersion, too few obs);
 *   • a high DSR is evidence against overfitting, never a promise of profit.
 */

import { kurtosis, mean, normalCdf, normalPpf, sharpeRatio, skewness, variance } from "./stats";

const EULER_MASCHERONI = 0.5772156649015329;

export interface DsrInput {
    /** Per-observation strategy returns (not annualised). */
    returns: readonly number[];
    /** Number of independent configurations/trials the strategy was selected from. */
    trials: number;
    /**
     * Variance of the per-observation Sharpe ratios across those trials.
     * Required when trials > 1 — without it SR0 cannot be estimated and the
     * result is reported unavailable rather than guessed.
     */
    trialSharpeVariance?: number;
    /** Benchmark Sharpe to beat (per-observation). Default 0. */
    benchmarkSharpe?: number;
}

export type DsrResult =
    | {
          available: true;
          /** Probability the true Sharpe exceeds the benchmark, in [0, 1]. */
          dsr: number;
          sharpe: number;
          expectedMaxSharpe: number;
          benchmarkSharpe: number;
          trials: number;
          observations: number;
          skewness: number;
          kurtosis: number;
          /** Human-readable interpretation. Never a profit claim. */
          interpretation: string;
          /** Sample assumptions a reader must know to use this number. */
          assumptions: string[];
      }
    | { available: false; reason: string };

/** Expected maximum of N independent standard-normal draws (per-observation SR). */
export function expectedMaxSharpe(trials: number, trialSharpeVariance: number): number | null {
    if (!Number.isFinite(trials) || trials < 1) return null;
    if (!Number.isFinite(trialSharpeVariance) || trialSharpeVariance < 0) return null;
    if (trials === 1) return 0;
    const scale = Math.sqrt(trialSharpeVariance);
    const upper = normalPpf(1 - 1 / trials);
    const lower = normalPpf(1 - 1 / (trials * Math.E));
    return scale * ((1 - EULER_MASCHERONI) * upper + EULER_MASCHERONI * lower);
}

export function deflatedSharpeRatio(input: DsrInput): DsrResult {
    const { returns, trials } = input;
    const benchmarkSharpe = input.benchmarkSharpe ?? 0;

    if (!Array.isArray(returns) || returns.length < 3) {
        return { available: false, reason: "At least 3 return observations are required for a DSR." };
    }
    if (returns.some((r) => !Number.isFinite(r))) {
        return { available: false, reason: "Return series contains non-finite values." };
    }
    if (!Number.isFinite(trials) || trials < 1) {
        return { available: false, reason: "The number of trials must be a recorded positive integer." };
    }
    const sr = sharpeRatio(returns);
    if (sr === null) {
        return { available: false, reason: "Return dispersion is zero — Sharpe ratio is undefined." };
    }

    let sr0 = 0;
    if (trials > 1) {
        const varianceInput = input.trialSharpeVariance;
        if (varianceInput === undefined || !Number.isFinite(varianceInput) || varianceInput < 0) {
            return {
                available: false,
                reason: "trialSharpeVariance is required when more than one trial was run (selection bias cannot be estimated without it).",
            };
        }
        const expected = expectedMaxSharpe(trials, varianceInput);
        if (expected === null) {
            return { available: false, reason: "Could not estimate the expected maximum Sharpe for the trial count." };
        }
        sr0 = expected;
    }

    const g3 = skewness(returns);
    const g4 = kurtosis(returns);
    const T = returns.length;
    const radicand = 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr;
    // A negative radicand means the higher-moment adjustment is not defined
    // for this sample; refusing is more honest than taking |·| silently.
    if (!(radicand > 0)) {
        return {
            available: false,
            reason: "Higher-moment variance adjustment is non-positive for this sample — DSR is undefined.",
        };
    }
    const z = ((sr - sr0) * Math.sqrt(T - 1)) / Math.sqrt(radicand);
    const dsr = normalCdf(z);

    return {
        available: true,
        dsr: Math.round(dsr * 1e6) / 1e6,
        sharpe: Math.round(sr * 1e6) / 1e6,
        expectedMaxSharpe: Math.round(sr0 * 1e6) / 1e6,
        benchmarkSharpe,
        trials: Math.floor(trials),
        observations: T,
        skewness: Math.round(g3 * 1e4) / 1e4,
        kurtosis: Math.round(g4 * 1e4) / 1e4,
        interpretation: interpretDsr(dsr),
        assumptions: [
            "Sharpe is per-observation (mean / sample SD), not annualised.",
            "The trial count and trial-Sharpe variance must describe the ACTUAL selection process; a guessed N understates the deflation.",
            "Skewness and kurtosis are sample moments; the higher-moment adjustment is approximate for short samples.",
            "A DSR probability is evidence about selection bias, not a forecast of live returns.",
        ],
    };
}

function interpretDsr(dsr: number): string {
    if (dsr >= 0.95) {
        return "Strong evidence the observed Sharpe is not explained by selection across the recorded trials.";
    }
    if (dsr >= 0.9) {
        return "Moderate evidence against a pure selection artefact; still not a guarantee of future performance.";
    }
    if (dsr >= 0.5) {
        return "Weak evidence — the observed Sharpe is consistent with selection bias across the recorded trials.";
    }
    return "The observed Sharpe is more likely a product of multiple-testing than a genuine edge.";
}

/** Convenience: derive the trial-Sharpe variance from a matrix of trial returns. */
export function trialSharpeVariance(trialReturns: readonly (readonly number[])[]): number | null {
    if (!Array.isArray(trialReturns) || trialReturns.length < 2) return null;
    const ratios: number[] = [];
    for (const series of trialReturns) {
        const sr = sharpeRatio(series);
        if (sr === null) return null;
        ratios.push(sr);
    }
    return variance(ratios, 1);
}

/** Mean per-observation return, exported for experiment records. */
export function meanReturn(returns: readonly number[]): number {
    return mean(returns);
}
