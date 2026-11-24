// ─────────────────────────────────────────────────────────────────────────────
// Quantitative validation — independent reference checks.
//
// Every expected value here is computed by an implementation written in this
// file (explicit loops / series), not by calling the module under test. The
// fixtures are synthetic and deterministic.
//
// Run: npm run test:quant:reference
// ─────────────────────────────────────────────────────────────────────────────

import {
    kurtosis,
    mean,
    normalCdf,
    normalPpf,
    percentile,
    sharpeRatio,
    skewness,
    stdDev,
    variance,
} from "../stats";
import { deflatedSharpeRatio, expectedMaxSharpe, trialSharpeVariance } from "../dsr";
import { cscvPbo } from "../pbo";
import { combinatorialPurgedCV, purgedKFold } from "../purged-cv";
import { kellyFraction, kellyResult, simulateRuin } from "../../risk-of-ruin";
import { seededRandom } from "../stats";

let failures = 0;
function check(cond: boolean, label: string, detail?: unknown): void {
    if (cond) console.log(`  PASS: ${label}`);
    else {
        failures++;
        console.error(`  FAIL: ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
    }
}
function close(actual: number, expected: number, tolerance: number, label: string): void {
    const diff = Math.abs(actual - expected);
    check(diff <= tolerance, label, { actual, expected, diff, tolerance });
}
function section(name: string): void {
    console.log(`\n${name}`);
}

// ── Independent primitives ───────────────────────────────────────────────
/** erf via its Maclaurin series (independent of the module's rational form). */
function erfSeries(x: number): number {
    // erf(x) = 2/√π Σ (-1)^n x^(2n+1) / (n! (2n+1))
    let term = x;
    let sum = x;
    for (let n = 1; n < 120; n++) {
        term *= (-x * x) / n;
        const contribution = term / (2 * n + 1);
        sum += contribution;
        if (Math.abs(contribution) < 1e-18) break;
    }
    return (2 / Math.sqrt(Math.PI)) * sum;
}
function phiSeries(z: number): number {
    return 0.5 * (1 + erfSeries(z / Math.SQRT2));
}
function meanOf(values: readonly number[]): number {
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}
function sampleSd(values: readonly number[]): number {
    const m = meanOf(values);
    let acc = 0;
    for (const v of values) acc += (v - m) ** 2;
    return Math.sqrt(acc / (values.length - 1));
}
function popSkew(values: readonly number[]): number {
    const n = values.length;
    const m = meanOf(values);
    let m2 = 0;
    let m3 = 0;
    for (const v of values) {
        m2 += (v - m) ** 2;
        m3 += (v - m) ** 3;
    }
    m2 /= n;
    m3 /= n;
    return m3 / Math.pow(m2, 1.5);
}
function popKurt(values: readonly number[]): number {
    const n = values.length;
    const m = meanOf(values);
    let m2 = 0;
    let m4 = 0;
    for (const v of values) {
        m2 += (v - m) ** 2;
        m4 += (v - m) ** 4;
    }
    m2 /= n;
    m4 /= n;
    return m4 / (m2 * m2);
}

// ── Normal distribution ──────────────────────────────────────────────────
section("normal CDF / quantile");
close(normalCdf(0), 0.5, 1e-15, "Φ(0) = 0.5");
close(normalCdf(1), 0.8413447460685429, 1e-14, "Φ(1) reference");
close(normalCdf(1.96), 0.9750021048517796, 1e-13, "Φ(1.96) reference (the 95% boundary)");
close(normalCdf(-1.96), 0.0249978951482204, 1e-13, "Φ(−1.96) is symmetric");
close(normalCdf(2.5758293035489004), 0.995, 1e-12, "Φ(2.5758) = 0.995");
close(normalCdf(-2.5758293035489004), 0.005, 1e-12, "Φ(−2.5758) = 0.005");
close(normalCdf(3), 0.9986501019683699, 1e-13, "Φ(3) reference");
close(normalCdf(0.5), 0.6914624612740131, 1e-13, "Φ(0.5) reference");
for (const z of [-3.2, -1.1, 0.3, 1.7, 2.9]) {
    close(normalCdf(z), phiSeries(z), 1e-10, `Φ(${z}) matches an independent erf series`);
}
close(normalPpf(0.975), 1.959963984540054, 1e-9, "Φ⁻¹(0.975) reference");
close(normalPpf(0.5), 0, 1e-12, "Φ⁻¹(0.5) = 0");
close(normalPpf(normalCdf(1.234)), 1.234, 1e-9, "Φ⁻¹ ∘ Φ is the identity");

// ── Moments ──────────────────────────────────────────────────────────────
section("moments");
const fixture = [0.004, -0.002, 0.006, -0.003, 0.001, 0.005, -0.001, 0.002];
close(mean(fixture), meanOf(fixture), 1e-15, "mean matches an explicit sum");
close(stdDev(fixture, 1), sampleSd(fixture), 1e-15, "sample SD (ddof 1) matches");
close(skewness(fixture), popSkew(fixture), 1e-15, "population skewness matches");
close(kurtosis(fixture), popKurt(fixture), 1e-14, "non-excess kurtosis matches");
check(sharpeRatio([0.01, 0.01, 0.01]) === null, "zero dispersion → undefined Sharpe (null, never Infinity)");
check(variance([1]) === 0, "variance of one observation is 0, not NaN");
close(percentile([4, 1, 3, 2], 0.5), 2.5, 1e-12, "percentile interpolates");
check(percentile([], 0.5) === 0, "empty percentile is 0 (documented fallback)");

// ── DSR vs an independent implementation ─────────────────────────────────
section("deflated Sharpe ratio");
const returns = [
    0.012, -0.006, 0.004, 0.009, -0.003, 0.011, -0.008, 0.005, 0.007, -0.002,
    0.013, -0.004, 0.002, 0.006, -0.007, 0.01, 0.003, -0.005, 0.008, 0.001,
];
const trials = 12;
const trialVar = 0.015;

const independentSr = meanOf(returns) / sampleSd(returns);
const g3 = popSkew(returns);
const g4 = popKurt(returns);
const EULER = 0.5772156649015329;
const sr0Independent =
    Math.sqrt(trialVar) *
    ((1 - EULER) * normalPpfReference(1 - 1 / trials) + EULER * normalPpfReference(1 - 1 / (trials * Math.E)));
const radicandIndependent = 1 - g3 * independentSr + ((g4 - 1) / 4) * independentSr * independentSr;
const zIndependent = ((independentSr - sr0Independent) * Math.sqrt(returns.length - 1)) / Math.sqrt(radicandIndependent);
const dsrIndependent = phiSeries(zIndependent);

const dsr = deflatedSharpeRatio({ returns, trials, trialSharpeVariance: trialVar });
check(dsr.available, "DSR is available for a complete input", dsr);
if (dsr.available) {
    close(dsr.sharpe, independentSr, 1e-6, "observed Sharpe matches");
    close(dsr.expectedMaxSharpe, sr0Independent, 1e-6, "SR0 matches the independent expected-maximum formula");
    close(dsr.dsr, dsrIndependent, 1e-6, "DSR probability matches the independent formula");
    check(dsr.assumptions.length >= 3, "DSR exposes its assumptions to the caller");
    check(/not annualised/i.test(dsr.assumptions.join(" ")), "the annualisation assumption is stated");
}

/** Independent inverse normal (bisection on phiSeries) — no shared code. */
function normalPpfReference(p: number): number {
    let lo = -8;
    let hi = 8;
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (phiSeries(mid) < p) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

check(expectedMaxSharpe(1, 0.02) === 0, "one trial has zero expected-maximum deflation");
check(expectedMaxSharpe(0, 0.02) === null, "zero trials is not a trial count");
check(expectedMaxSharpe(5, -1) === null, "negative trial variance is rejected");

const missingVariance = deflatedSharpeRatio({ returns, trials: 5 });
check(!missingVariance.available && /trialSharpeVariance/.test(missingVariance.reason), "trials > 1 without variance is unavailable");

const singleTrial = deflatedSharpeRatio({ returns, trials: 1 });
const multiTrial = deflatedSharpeRatio({ returns, trials: 50, trialSharpeVariance: trialVar });
check(singleTrial.available && multiTrial.available, "both single- and multi-trial DSR compute");
if (singleTrial.available && multiTrial.available) {
    check(multiTrial.dsr < singleTrial.dsr, "more trials deflate the same Sharpe further", {
        single: singleTrial.dsr,
        multi: multiTrial.dsr,
    });
}
check(!deflatedSharpeRatio({ returns: [0.01, 0.01, 0.01], trials: 2, trialSharpeVariance: 0.01 }).available, "degenerate series is unavailable");
check(!deflatedSharpeRatio({ returns: [0.01, Number.NaN, 0.02], trials: 2, trialSharpeVariance: 0.01 }).available, "non-finite return is unavailable");
check(trialSharpeVariance([returns, returns.map((r) => r * 0.9)]) !== null, "trial variance derives from trial return series");

// ── PBO ──────────────────────────────────────────────────────────────────
section("PBO / CSCV");
function series(seed: number, n: number, drift: number, noise: number): number[] {
    const rand = seededRandom(seed);
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(drift + (rand() - 0.5) * 2 * noise);
    return out;
}

const dominant = [
    series(11, 240, 0.01, 0.002),
    series(12, 240, 0, 0.01),
    series(13, 240, 0, 0.01),
];
const dominantPbo = cscvPbo({ returnsByConfig: dominant });
check(dominantPbo.available, "PBO computes for a dominant configuration", dominantPbo);
if (dominantPbo.available) {
    check(dominantPbo.pbo === 0, "a genuinely dominant configuration has PBO 0", dominantPbo.pbo);
    check(dominantPbo.configurations === 3, "the configuration count is reported");
    check(dominantPbo.combinationsEvaluated === dominantPbo.combinationsTotal, "all CSCV splits were evaluated");
    check(dominantPbo.assumptions.length >= 3, "PBO exposes its assumptions");
}

const noise = [series(21, 300, 0, 0.01), series(22, 300, 0, 0.01), series(23, 300, 0, 0.01), series(24, 300, 0, 0.01)];
const noiseA = cscvPbo({ returnsByConfig: noise });
const noiseB = cscvPbo({ returnsByConfig: noise });
check(JSON.stringify(noiseA) === JSON.stringify(noiseB), "PBO is deterministic for identical input");
if (noiseA.available) {
    check(noiseA.pbo > 0.1, "pure-noise selection shows overfitting risk", noiseA.pbo);
    check(noiseA.pbo <= 1, "PBO is a probability");
}

check(!cscvPbo({ returnsByConfig: [series(1, 100, 0.01, 0.01)] }).available, "one configuration is insufficient");
check(!cscvPbo({ returnsByConfig: [series(1, 100, 0.01, 0.01), series(2, 99, 0, 0.01)] }).available, "unequal series lengths are rejected");
check(!cscvPbo({ returnsByConfig: [series(1, 100, 0.01, 0.01), series(2, 100, 0, 0.01)], blocks: 3 }).available, "odd block count is rejected");
check(!cscvPbo({ returnsByConfig: [series(1, 3, 0.01, 0.01), series(2, 3, 0, 0.01)] }).available, "too few observations are rejected");
const capped = cscvPbo({ returnsByConfig: noise, maxCombinations: 100 });
check(!capped.available && /cap/.test(capped.reason), "an expensive CSCV is refused rather than silently truncated", capped);

// ── Purged K-fold / embargo ──────────────────────────────────────────────
section("purged K-fold + embargo");
const n = 120;
const span = 5;
const embargo = 4;
const kfold = purgedKFold(n, 6, { labelSpan: span, embargoSamples: embargo });
check(kfold.available, "purged K-fold produces folds");
if (kfold.available) {
    let covered = 0;
    let overlap = false;
    let leaked = false;
    let embargoLeak = false;
    for (const fold of kfold.folds) {
        const testStart = fold.test[0];
        const testEnd = fold.test[fold.test.length - 1] + 1;
        covered += fold.test.length;
        const testSet = new Set(fold.test);
        for (const i of fold.train) {
            if (testSet.has(i)) overlap = true;
            // A training label at i spans [i, i+span-1]; it must not reach into test.
            if (i + span - 1 >= testStart && i <= testEnd - 1) leaked = true;
            if (i >= testEnd && i < testEnd + embargo) embargoLeak = true;
        }
    }
    check(covered === n, "the test blocks cover every observation exactly once", covered);
    check(!overlap, "no index is both train and test");
    check(!leaked, "no training label overlaps a test interval (purging includes labels that START before test)");
    check(!embargoLeak, "no training observation sits inside the embargo window after a test block");
    check(kfold.purgeCount > 0 && kfold.embargoCount > 0, "purge/embargo counts are reported");
}

const noOverlap = purgedKFold(n, 6, { labelSpan: 1 });
check(noOverlap.available && noOverlap.purgeCount === 0, "point labels purge nothing (span 1 has no overlap)");
check(!purgedKFold(10, 20, { labelSpan: 1 }).available, "more folds than observations is rejected");
check(!purgedKFold(50, 5, { labelSpan: 0 }).available, "labelSpan 0 is rejected");
check(!purgedKFold(50, 5, { labelSpan: 1, embargoPct: 1.5 }).available, "embargo fraction outside [0,1] is rejected");

// ── CPCV ─────────────────────────────────────────────────────────────────
section("combinatorial purged CV");
const cpcv = combinatorialPurgedCV(120, 6, 2, { labelSpan: 3, embargoSamples: 2 });
check(cpcv.available, "CPCV produces folds");
if (cpcv.available) {
    check(cpcv.folds.length === 15, "C(6,2) = 15 splits", cpcv.folds.length);
    const counts = new Array<number>(120).fill(0);
    let overlap = false;
    for (const fold of cpcv.folds) {
        const testSet = new Set(fold.test);
        for (const t of fold.test) counts[t]++;
        for (const i of fold.train) if (testSet.has(i)) overlap = true;
    }
    check(!overlap, "train and test are always disjoint");
    check(counts.every((c) => c === 5), "every observation is tested C(5,1)=5 times", counts.find((c) => c !== 5));
}
const stable = combinatorialPurgedCV(120, 6, 2, { labelSpan: 3, embargoSamples: 2 });
check(
    stable.available && cpcv.available && JSON.stringify(stable.folds) === JSON.stringify(cpcv.folds),
    "CPCV fold order is deterministic",
);
check(!combinatorialPurgedCV(100, 6, 6, { labelSpan: 1 }).available, "kTestGroups must be < nGroups");
check(!combinatorialPurgedCV(100, 6, 2, { labelSpan: 1 }, 5).available, "a fold cap is enforced");

// ── Monte Carlo ruin ─────────────────────────────────────────────────────
section("Monte Carlo risk of ruin");
const base = { winRate: 0.5, riskReward: 2, riskPerTradePct: 2, ruinDrawdownPct: 30, paths: 300, tradesPerPath: 100, seed: 7 };
const mcA = simulateRuin(base);
const mcB = simulateRuin(base);
check(mcA !== null && mcB !== null, "the simulation returns a result");
check(JSON.stringify(mcA) === JSON.stringify(mcB), "the same seed produces an identical result (reproducible)");
if (mcA) {
    check(mcA.ruinProbability >= 0 && mcA.ruinProbability <= 1, "ruin probability is a probability");
    check(mcA.endings.worst > 0, "no simulated path goes non-positive at 2% risk");
    check(mcA.medianEquityMultiple > 0, "median equity multiple is positive");
    check(mcA.limitations.length >= 2, "the simulation states its limitations");
}
const higherRisk = simulateRuin({ ...base, riskPerTradePct: 20, ruinDrawdownPct: 30 });
check(higherRisk !== null && mcA !== null && higherRisk.ruinProbability > mcA.ruinProbability, "higher risk raises ruin frequency");
const impossibleRuin = simulateRuin({ ...base, riskPerTradePct: 0.1, ruinDrawdownPct: 99.9, tradesPerPath: 10 });
check(impossibleRuin !== null && impossibleRuin.ruinProbability === 0, "a threshold the paths cannot reach yields 0");
check(simulateRuin({ ...base, winRate: 1.5 }) === null, "win rate outside [0,1] is rejected");
check(simulateRuin({ ...base, riskReward: 0 }) === null, "zero reward:risk is rejected");
check(simulateRuin({ ...base, riskPerTradePct: 0 }) === null, "zero risk per trade is rejected");

// ── Kelly ────────────────────────────────────────────────────────────────
section("Kelly / half-Kelly");
close(kellyFraction(0.6, 2) ?? Number.NaN, 0.4, 1e-12, "f* = p − q/b (0.6, 2R → 0.4)");
close(kellyFraction(0.5, 2) ?? Number.NaN, 0.25, 1e-12, "50% at 2R → 0.25");
close(kellyFraction(0.4, 1) ?? Number.NaN, -0.2, 1e-12, "no edge → negative Kelly");
const kelly = kellyResult({ winRate: 0.6, riskReward: 2, accountSize: 10_000 });
check(kelly !== null, "Kelly result is produced");
if (kelly) {
    close(kelly.halfKellyFraction, 0.2, 1e-12, "half Kelly");
    close(kelly.recommendedRiskFraction, 0.2, 1e-12, "recommended fraction is half Kelly");
    close(kelly.edgePerTrade, 0.8, 1e-12, "edge per trade = p·b − q");
    close(kelly.kellyRiskAmount ?? 0, 2_000, 1e-9, "half-Kelly amount on a 10k account");
}
const noEdge = kellyResult({ winRate: 0.4, riskReward: 1 });
check(noEdge !== null && noEdge.recommendedRiskFraction === 0, "negative edge floors the recommendation at 0");
check(kellyFraction(1, 2) === null, "a certain win has no Kelly fraction");

console.log(`\n${failures === 0 ? "🎉 ALL QUANT REFERENCE TESTS PASSED" : `❌ ${failures} QUANT REFERENCE TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
