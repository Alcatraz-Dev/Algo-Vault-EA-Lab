// ─────────────────────────────────────────────────────────────────────────────
// Quant validation tests — deterministic, no network, no Math.random.
//
// Run: npm run test:quant
//   or: node scripts/jiti-tsrun.mjs lib/quant/validation/tests/run-quant-tests.ts
// ─────────────────────────────────────────────────────────────────────────────

import {
    cscvPbo,
    combinatorialPurgedCV,
    composeVerdict,
    createExperimentRecord,
    deflatedSharpeRatio,
    expectedMaxSharpe,
    normalCdf,
    normalPpf,
    purgedKFold,
    runPurgedValidation,
    sharpeRatio,
    trialSharpeVariance,
} from "../index";
import { expectedValuePerTrade, kellyResult, simulateRuin } from "../../risk-of-ruin";

let failures = 0;
function check(cond: boolean, label: string, detail?: unknown): void {
    if (cond) {
        console.log(`  PASS: ${label}`);
    } else {
        failures++;
        console.error(`  FAIL: ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
    }
}

function section(name: string): void {
    console.log(`\n${name}`);
}

// ── Statistical primitives ─────────────────────────────────────────────────
section("stats");
check(Math.abs(normalCdf(0) - 0.5) < 1e-9, "normalCdf(0) = 0.5");
check(Math.abs(normalCdf(1.96) - 0.975) < 1e-4, "normalCdf(1.96) ≈ 0.975", normalCdf(1.96));
check(Math.abs(normalPpf(0.975) - 1.959964) < 1e-5, "normalPpf(0.975) ≈ 1.95996", normalPpf(0.975));
check(Math.abs(normalCdf(normalPpf(0.3)) - 0.3) < 1e-6, "normalCdf ∘ normalPpf round-trips");
check(sharpeRatio([0.01, 0.01, 0.01]) === null, "zero dispersion → Sharpe undefined, not infinity");
check(Math.abs((sharpeRatio([0.01, -0.01, 0.02, -0.02, 0.01, -0.01]) ?? 0)) < 1e-12, "symmetric returns → Sharpe ≈ 0");

// ── Deflated Sharpe Ratio ─────────────────────────────────────────────────
section("deflated sharpe");
const baseReturns = [0.01, -0.005, 0.02, -0.01, 0.015, 0.0, -0.002, 0.008];
const dsrSingle = deflatedSharpeRatio({ returns: baseReturns, trials: 1 });
check(dsrSingle.available, "DSR available for 8 observations with 1 trial");
if (dsrSingle.available) {
    check(dsrSingle.dsr > 0.5 && dsrSingle.dsr < 1, "positive Sharpe with one trial → DSR > 0.5", dsrSingle.dsr);
    check(dsrSingle.expectedMaxSharpe === 0, "one trial → expected max Sharpe is 0");
}

const dsrSameSingle = deflatedSharpeRatio({ returns: baseReturns, trials: 1 });
check(
    JSON.stringify(dsrSingle) === JSON.stringify(dsrSameSingle),
    "DSR is deterministic for identical input",
);

check(
    deflatedSharpeRatio({ returns: baseReturns, trials: 20 }).available === false,
    "trials > 1 without trialSharpeVariance → unavailable (no guessed bias)",
);

const variance = trialSharpeVariance([
    baseReturns,
    baseReturns.map((r) => r * 0.9),
    baseReturns.map((r, i) => r + (i % 2 === 0 ? 0.001 : -0.001)),
]);
check(variance !== null && variance > 0, "trialSharpeVariance computed from trial series", variance);

const dsrMulti = deflatedSharpeRatio({ returns: baseReturns, trials: 20, trialSharpeVariance: variance ?? 0.01 });
check(dsrMulti.available, "DSR available with trials + variance");
if (dsrSingle.available && dsrMulti.available) {
    check(dsrMulti.dsr < dsrSingle.dsr, "more trials lowers the DSR (selection bias)", { one: dsrSingle.dsr, many: dsrMulti.dsr });
    check(dsrMulti.expectedMaxSharpe > 0, "expected max Sharpe > 0 for N > 1");
}
check(
    (expectedMaxSharpe(10, 0.01) ?? 0) > (expectedMaxSharpe(2, 0.01) ?? 0),
    "expected max Sharpe increases with trial count",
);
check(
    deflatedSharpeRatio({ returns: [0.01, -0.01], trials: 1 }).available === false,
    "fewer than 3 observations → unavailable",
);
check(
    deflatedSharpeRatio({ returns: [0.001, 0.001, 0.001], trials: 1 }).available === false,
    "constant returns → unavailable",
);
check(
    deflatedSharpeRatio({ returns: [0.01, Number.NaN, 0.02], trials: 1 }).available === false,
    "NaN in returns → unavailable",
);

const stronger = deflatedSharpeRatio({ returns: baseReturns.map((r) => r + 0.004), trials: 1 });
if (dsrSingle.available && stronger.available) {
    check(stronger.dsr > dsrSingle.dsr, "higher mean return raises DSR");
}

// ── PBO / CSCV ────────────────────────────────────────────────────────────
section("pbo");
const T = 40;
const half = T / 2;
// Adversarial fixture: each configuration wins one half and loses the other,
// so the in-sample winner is always the out-of-sample loser.
const flipA = Array.from({ length: T }, (_, t) => (t < half ? 0.01 : -0.01) + 0.0005 * Math.sin(t));
const flipB = Array.from({ length: T }, (_, t) => (t < half ? -0.01 : 0.01) + 0.0005 * Math.sin(t));
const pboAdversarial = cscvPbo({ returnsByConfig: [flipA, flipB], blocks: 2 });
check(pboAdversarial.available, "PBO available for 2 configurations × 40 observations");
if (pboAdversarial.available) {
    check(pboAdversarial.pbo === 1, "IS winner loses OOS in every split → PBO = 1", pboAdversarial.pbo);
    check(pboAdversarial.combinationsEvaluated === 2, "C(2,1) = 2 combinations", pboAdversarial.combinationsEvaluated);
    check(pboAdversarial.blocks === 2 && pboAdversarial.configurations === 2, "shape reported back");
}

const stableGood = Array.from({ length: T }, (_, t) => 0.01 + 0.0005 * Math.sin(t));
const stableBad = Array.from({ length: T }, (_, t) => -0.01 + 0.0005 * Math.sin(t));
const pboAligned = cscvPbo({ returnsByConfig: [stableGood, stableBad], blocks: 2 });
check(pboAligned.available && pboAligned.pbo === 0, "IS winner also wins OOS → PBO = 0", pboAligned.available ? pboAligned.pbo : pboAligned.reason);

const ties = [Array.from({ length: T }, (_, t) => 0.01 + 0.0005 * Math.sin(t)), Array.from({ length: T }, (_, t) => 0.01 + 0.0005 * Math.sin(t))];
const pboTiesA = cscvPbo({ returnsByConfig: ties, blocks: 2 });
const pboTiesB = cscvPbo({ returnsByConfig: ties, blocks: 2 });
check(
    pboTiesA.available && pboTiesB.available && pboTiesA.pbo === pboTiesB.pbo,
    "identical configurations → deterministic tie handling",
);

check(cscvPbo({ returnsByConfig: [stableGood] }).available === false, "one configuration → unavailable");
check(
    cscvPbo({ returnsByConfig: [stableGood, [0.01, 0.02]] }).available === false,
    "mismatched series lengths → unavailable",
);
check(cscvPbo({ returnsByConfig: [stableGood, stableBad], blocks: 7 }).available === false, "odd block count → unavailable");
check(cscvPbo({ returnsByConfig: [stableGood, stableBad], blocks: 4, maxCombinations: 2 }).available === false, "combination cap enforced");
check(
    cscvPbo({ returnsByConfig: [Array.from({ length: 4 }, () => 0.01), Array.from({ length: 4 }, () => 0.02)], blocks: 2 }).available === false,
    "zero-dispersion series → unavailable rather than infinite Sharpe",
);

// ── Purged CV + embargo ───────────────────────────────────────────────────
section("purged cv");
const plain = purgedKFold(10, 2, { labelSpan: 1 });
check(plain.available, "purged K-fold available");
if (plain.available) {
    check(JSON.stringify(plain.folds[0]) === JSON.stringify({ train: [5, 6, 7, 8, 9], test: [0, 1, 2, 3, 4] }), "point labels: no purge", plain.folds[0]);
    check(plain.purgeCount === 0 && plain.embargoCount === 0, "no purge/embargo for point labels");
}

const span3 = purgedKFold(10, 2, { labelSpan: 3 });
check(span3.available && span3.purgeCount === 2, "labelSpan=3 purges the 2 labels overlapping the test block", span3.available ? span3.purgeCount : span3.reason);
if (span3.available) {
    check(JSON.stringify(span3.folds[1].train) === JSON.stringify([0, 1, 2]), "overlapping train labels removed before the test block", span3.folds[1].train);
}

const embargoed = purgedKFold(12, 3, { labelSpan: 1, embargoSamples: 2 });
check(embargoed.available && embargoed.embargoCount === 4, "embargo removes 2 observations after each of 2 later blocks", embargoed.available ? embargoed.embargoCount : embargoed.reason);
if (embargoed.available) {
    const fold1 = embargoed.folds[1];
    check(!fold1.train.includes(6) && !fold1.train.includes(7), "observations inside the embargo are excluded", fold1.train);
    check(!fold1.train.some((i) => fold1.test.includes(i)), "train and test never intersect");
}

const span5 = purgedKFold(10, 2, { labelSpan: 5 });
if (span5.available) {
    check(JSON.stringify(span5.folds[1].train) === JSON.stringify([0]), "long labels purge everything that reaches into the test block", span5.folds[1].train);
}

check(purgedKFold(10, 1, { labelSpan: 1 }).available === false, "one fold → unavailable");
check(purgedKFold(10, 2, { labelSpan: 0 }).available === false, "labelSpan < 1 → unavailable");
check(purgedKFold(10, 2, { labelSpan: 1, embargoPct: 1.5 }).available === false, "embargoPct > 1 → unavailable");

// ── CPCV ──────────────────────────────────────────────────────────────────
section("cpcv");
const cpcv = combinatorialPurgedCV(12, 3, 1, { labelSpan: 1 });
check(cpcv.available, "CPCV available");
if (cpcv.available) {
    check(cpcv.folds.length === 3, "C(3,1) = 3 folds");
    check(JSON.stringify(cpcv.folds[0].test) === JSON.stringify([0, 1, 2, 3]), "first group is the test set", cpcv.folds[0].test);
    check(cpcv.folds.every((f) => f.train.every((i) => !f.test.includes(i))), "no fold leaks a test index into train");
}

const cpcv2 = combinatorialPurgedCV(12, 3, 2, { labelSpan: 1 });
check(cpcv2.available && cpcv2.folds.length === 3, "C(3,2) = 3 folds with two test groups");
if (cpcv2.available) {
    check(cpcv2.folds[0].test.length === 8, "two of three groups tested", cpcv2.folds[0].test.length);
}

const cpcvPurged = combinatorialPurgedCV(20, 4, 1, { labelSpan: 3, embargoSamples: 1 });
check(cpcvPurged.available && cpcvPurged.purgeCount > 0, "CPCV applies purge around every test group", cpcvPurged.available ? cpcvPurged.purgeCount : cpcvPurged.reason);

check(combinatorialPurgedCV(12, 3, 3, { labelSpan: 1 }).available === false, "kTestGroups = nGroups → unavailable");
check(combinatorialPurgedCV(12, 3, 1, { labelSpan: 1 }, 2).available === false, "fold cap enforced");

// ── Experiment records + composite verdict ────────────────────────────────
section("experiment + verdict");
const expA = createExperimentRecord({
    method: "DSR",
    parameters: { trials: 5, blocks: 4 },
    dataFingerprint: "abc123",
    seed: 42,
    createdAt: 1_700_000_000_000,
});
const expB = createExperimentRecord({
    method: "DSR",
    parameters: { blocks: 4, trials: 5 }, // different key order, same content
    dataFingerprint: "abc123",
    seed: 42,
    createdAt: 1_700_000_000_000,
});
check(expA.experimentId === expB.experimentId, "parameter key order does not change the experiment id");
check(expA.assumptions.length > 0, "assumptions are recorded");
check(expA.reproducible === true, "record marked reproducible");

const folds = purgedKFold(40, 2, { labelSpan: 1 });
if (folds.available) {
    const ran = runPurgedValidation({
        folds: folds.folds,
        evaluate: (fold) => ({
            trainTrades: 2,
            testTrades: 1,
            testReturns: fold.test.length > 0 ? [0.01, -0.004] : [],
        }),
        trials: 1,
    });
    check(ran.totalTestTrades === foldedTestTotal(folds.folds), "purged runner totals test trades across folds");
    check(ran.dsr.available === true, "pooled OOS returns produce a DSR");
    check(ran.composite.verdict !== "SUPPORTED" || ran.dsr.available, "composite verdict never supersedes evidence");
    check(ran.experiment.method === "PURGED_KFOLD", "experiment record identifies the method");
}

const noTrials = runPurgedValidation({
    folds: [{ train: [2, 3], test: [0, 1] }],
    evaluate: () => ({ trainTrades: 1, testTrades: 1, testReturns: [0.01, -0.002, 0.003] }),
});
check(noTrials.dsr.available === false, "no recorded trials → no DSR");
check(
    noTrials.composite.verdict === "NO_EVIDENCE" || noTrials.composite.verdict === "INCONCLUSIVE",
    "missing DSR cannot yield a supported verdict",
    noTrials.composite.verdict,
);

const overfit = composeVerdict({ dsr: 0.2, pbo: 0.7, observations: 500, hasOosTrades: true });
check(overfit.verdict === "OVERFIT_RISK" && overfit.label === "overfitting risk", "low DSR + high PBO → overfitting risk");
const supported = composeVerdict({ dsr: 0.99, pbo: 0.05, observations: 500, hasOosTrades: true });
check(supported.verdict === "SUPPORTED" && supported.label === "statistically supported", "high DSR + low PBO → statistically supported (never 'validated')");
const noOos = composeVerdict({ dsr: 0.99, pbo: 0.05, hasOosTrades: false });
check(noOos.verdict === "NO_EVIDENCE", "no OOS trades → no evidence regardless of metrics");

// ── Risk of ruin / Kelly ─────────────────────────────────────────────────
section("risk of ruin");
const kelly = kellyResult({ winRate: 0.5, riskReward: 2, accountSize: 10_000 });
check(kelly !== null && Math.abs(kelly.kellyFraction - 0.25) < 1e-9, "Kelly = wr − (1−wr)/RR = 0.25", kelly);
check(kelly !== null && Math.abs(kelly.halfKellyFraction - 0.125) < 1e-9, "half-Kelly = 0.125");
check(kelly !== null && kelly.kellyRiskAmount === 1250, "half-Kelly dollar risk on 10 000 = 1 250");
check(Math.abs((kellyResult({ winRate: 0.4, riskReward: 1 })?.kellyFraction ?? 0) + 0.2) < 1e-9, "negative edge → negative Kelly fraction");
check(kellyResult({ winRate: 0, riskReward: 1 }) === null, "win rate 0 → unavailable");

const ev = expectedValuePerTrade({ winRate: 0.5, riskReward: 2, riskPerTradePct: 2, accountSize: 10_000 });
check(ev !== null && Math.abs(ev.expectedR - 0.5) < 1e-9, "EV = 0.5R for 50% / 2R");
check(ev !== null && ev.expectedValue === 100, "EV in $ = 0.5 × 2% × 10 000", ev);

const simA = simulateRuin({ winRate: 0.55, riskReward: 1.5, riskPerTradePct: 2, ruinDrawdownPct: 25, paths: 300, tradesPerPath: 200, seed: 7 });
const simB = simulateRuin({ winRate: 0.55, riskReward: 1.5, riskPerTradePct: 2, ruinDrawdownPct: 25, paths: 300, tradesPerPath: 200, seed: 7 });
check(simA !== null && JSON.stringify(simA) === JSON.stringify(simB), "same seed → identical ruin simulation");
check(simA !== null && simA.paths === 300 && simA.ruinProbability >= 0 && simA.ruinProbability <= 1, "ruin probability in [0,1]");
check(simA !== null && simA.maxDrawdown.p95 >= simA.maxDrawdown.median, "p95 drawdown ≥ median drawdown");
check(simulateRuin({ winRate: 0.5, riskReward: 1, riskPerTradePct: 0, ruinDrawdownPct: 20 }) === null, "zero risk → unavailable");

console.log(`\n${failures === 0 ? "🎉 ALL QUANT TESTS PASSED" : `❌ ${failures} QUANT TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

function foldedTestTotal(f: Array<{ test: number[] }>): number {
    return f.length; // one test trade per fold in this fixture
}
