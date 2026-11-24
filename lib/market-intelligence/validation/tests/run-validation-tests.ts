// ─────────────────────────────────────────────────────────────────────────────
// Validation-integrity tests.
//
// The contract under test: a stage is COMPLETED only when real engine output
// was supplied for this run. A referenced result id, a missing engine or a
// canned object must never become COMPLETED.
//
// Run: npm run test:validation
// ─────────────────────────────────────────────────────────────────────────────

import {
    deriveCandidateStatus,
    runBacktest,
    runMonteCarlo,
    runOOS,
    runRobustness,
    runValidationPipeline,
    runWalkForward,
} from "../pipeline";
import { buildEvidenceReport } from "../evidence-report";

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

const candidate = { id: "cand-1", backtestResultId: "bt-existing", oosResultId: "oos-existing" };

const backtest = {
    id: "bt-real-1",
    metrics: { totalTrades: 42, netProfit: 1250.5, maxDrawdownPct: 8.2 },
    trades: Array.from({ length: 42 }, () => ({ pnlGross: 10 })),
};
const outcome = {
    id: "val-real-1",
    inSample: { metrics: { totalTrades: 60 }, trades: 60 },
    outOfSample: { metrics: { totalTrades: 24 }, trades: 24 },
    verdict: "marginal",
    degradation: { overall: 6.4 },
    walkForward: { enabled: true, windows: [{}, {}, {}], stable: true, stabilityScore: 82.5 },
};
const robustness = [{ testId: "execution_stress", status: "completed" }, { testId: "param_perturbation", status: "completed" }];
const monteCarlo = { seed: 42, simulationsCompleted: 1000, sourceTradeCount: 42, profitProbability: 0.58, drawdownP95: 0.19 };

// ── Backtest stage ────────────────────────────────────────────────────────
section("backtest stage");
const missingBacktest = runBacktest(candidate);
check(missingBacktest.status === "UNAVAILABLE", "a referenced resultId alone is NOT a completed stage", missingBacktest);
check(missingBacktest.evidence === undefined, "no evidence is fabricated for an unattested stage");

const realBacktest = runBacktest(candidate, () => backtest);
check(realBacktest.status === "COMPLETED", "supplied engine output → COMPLETED");
check(!!realBacktest.evidence?.executionId && realBacktest.evidence.executionId.length > 0, "completed stage carries an execution id", realBacktest.evidence);
check(realBacktest.evidence?.engine.includes("backtestStrategy") === true, "evidence names the real engine", realBacktest.evidence?.engine);
check(realBacktest.evidence?.resultId === "bt-real-1", "result id is the engine's own id, not 'existing'");
check(realBacktest.evidence?.observations.some((o) => o.includes("42")) === true, "observations record measured counts", realBacktest.evidence?.observations);
check(realBacktest.executedAt > 0, "stage carries a timestamp");

const throwing = runBacktest(candidate, () => {
    throw new Error("engine exploded");
});
check(throwing.status === "FAILED" && (throwing.note ?? "").includes("engine exploded"), "engine exception → FAILED, never COMPLETED", throwing);

const malformed = runBacktest(candidate, () => ({ id: "x" } as never));
check(malformed.status === "FAILED", "malformed output → FAILED", malformed);

const zeroTrades = runBacktest(candidate, () => ({ id: "bt-zero", metrics: { totalTrades: 0 }, trades: [] }));
check(zeroTrades.status === "COMPLETED", "zero-trade run is a real completed run");
check(zeroTrades.limitations.some((l) => l.includes("zero trades")), "zero-trade run carries an explicit limitation");

const nullProbe = runBacktest(candidate, () => undefined);
check(nullProbe.status === "UNAVAILABLE" && (nullProbe.note ?? "").includes("no result"), "adapter returning nothing → UNAVAILABLE", nullProbe);

// ── OOS / walk-forward ────────────────────────────────────────────────────
section("oos + walk-forward");
check(runOOS(candidate).status === "UNAVAILABLE", "OOS without output is unavailable");
const oos = runOOS(candidate, outcome as never);
check(oos.status === "COMPLETED", "OOS with real metrics is completed");
check(oos.evidence?.observations.includes("outOfSampleTrades=24") === true, "OOS evidence records the test trade count", oos.evidence?.observations);

check(runWalkForward(candidate, { ...outcome, walkForward: { enabled: true, windows: [] } } as never).status === "UNAVAILABLE", "no windows → UNAVAILABLE");
check(runWalkForward(candidate, { ...outcome, walkForward: { enabled: false, windows: [] } } as never).status === "UNAVAILABLE", "disabled walk-forward → UNAVAILABLE");
const wf = runWalkForward(candidate, outcome as never);
check(wf.status === "COMPLETED" && wf.evidence?.metrics?.windows === 3, "walk-forward windows attested", wf.evidence?.metrics);

// ── Robustness / Monte Carlo ──────────────────────────────────────────────
section("robustness + monte carlo");
check(runRobustness(candidate).status === "UNAVAILABLE", "robustness without output is unavailable");
check(runRobustness(candidate, []).status === "UNAVAILABLE", "empty robustness list is unavailable, not completed");
check(
    runRobustness(candidate, [{ testId: "a", status: "failed" }, { testId: "b", status: "failed" }]).status === "FAILED",
    "every robustness test failing → FAILED",
);
const robust = runRobustness(candidate, robustness);
check(robust.status === "COMPLETED" && robust.evidence?.observations.includes("tests=2") === true, "executed robustness tests attested", robust.evidence?.observations);

check(runMonteCarlo(candidate).status === "UNAVAILABLE", "Monte Carlo without output is unavailable");
check(
    runMonteCarlo(candidate, { seed: 1, simulationsCompleted: 0, sourceTradeCount: 10 }).status === "UNAVAILABLE",
    "zero simulations → UNAVAILABLE",
);
check(
    runMonteCarlo(candidate, { seed: 1, simulationsCompleted: 1000, sourceTradeCount: 1 }).status === "UNAVAILABLE",
    "one source trade → UNAVAILABLE (no fabricated trades)",
);
const mc = runMonteCarlo(candidate, monteCarlo);
check(mc.status === "COMPLETED" && mc.evidence?.metrics?.simulations === 1000, "real simulations attested", mc.evidence?.metrics);
check(mc.evidence?.metrics?.profitProbability === 0.58, "measured probability preserved");

// ── Pipeline result ───────────────────────────────────────────────────────
section("pipeline");
const emptyPipeline = runValidationPipeline(candidate, {}, () => 1_780_000_000_000);
check(emptyPipeline.evidenceStatus === "INCOMPLETE", "no engines → INCOMPLETE");
check(emptyPipeline.unavailableStages.length === 5, "all five stages reported unavailable", emptyPipeline.unavailableStages);
check(emptyPipeline.candidateStatus === "DEFINED", "candidate does not advance without evidence", emptyPipeline.candidateStatus);
check(emptyPipeline.certifications.profitable === false && emptyPipeline.certifications.validated === false, "pipeline certifies nothing");

const fullPipeline = runValidationPipeline(
    candidate,
    {
        backtest: () => backtest,
        oos: () => outcome as never,
        walkForward: () => outcome as never,
        robustness: () => robustness,
        monteCarlo: () => monteCarlo,
    },
    () => 1_780_000_000_000,
);
check(fullPipeline.evidenceStatus === "EVIDENCE_COMPLETE", "all stages executed → evidence complete");
check(fullPipeline.completedStages.length === 5, "five completed stages");
check(fullPipeline.candidateStatus === "COMPLETED", "candidate advances to COMPLETED status", fullPipeline.candidateStatus);
check(fullPipeline.certifications.validated === false, "even complete evidence is not a validation certificate");
check(new Set(fullPipeline.stages.map((s) => s.evidence?.executionId)).size === 5, "each stage has a distinct execution id");

const partial = runValidationPipeline(candidate, { backtest: () => backtest, oos: () => outcome as never }, () => 1);
check(partial.evidenceStatus === "INCOMPLETE", "partial evidence → INCOMPLETE");
check(
    partial.candidateStatus === "WALK_FORWARD_VALIDATED",
    "one ValidationOutcome legitimately feeds both OOS and walk-forward",
    partial.candidateStatus,
);

const oosOnly = runValidationPipeline(
    candidate,
    { backtest: () => backtest, oos: () => ({ ...outcome, walkForward: { enabled: false, windows: [] } }) as never },
    () => 1,
);
check(oosOnly.candidateStatus === "OOS_VALIDATED", "candidate stops at the last contiguous completed stage", oosOnly.candidateStatus);

const failedPipeline = runValidationPipeline(candidate, { backtest: () => { throw new Error("boom"); } }, () => 1);
check(failedPipeline.evidenceStatus === "FAILED", "engine failure dominates the pipeline status");

check(
    deriveCandidateStatus([
        { stage: "BACKTEST", status: "COMPLETED", executedAt: 1, limitations: [] },
        { stage: "OOS", status: "UNAVAILABLE", executedAt: 1, limitations: [] },
        { stage: "WALK_FORWARD", status: "COMPLETED", executedAt: 1, limitations: [] },
    ]) === "BACKTESTED",
    "a later completed stage cannot skip an unavailable one",
);

// ── Evidence report ───────────────────────────────────────────────────────
section("evidence report");
const report = buildEvidenceReport(candidate, fullPipeline.stages, fullPipeline);
check(report.evidenceStatus === "EVIDENCE_COMPLETE", "report carries the derived evidence status");
check(report.stages.every((s: { executionId: string | null }) => typeof s.executionId === "string"), "every stage line is traceable to an execution id");
check(report.validationId === fullPipeline.validationId, "report links to the validation run");
check(
    report.limitations.some((l: string) => l.includes("not a certification")),
    "report states that completion is not a profitability certification",
);

console.log(`\n${failures === 0 ? "🎉 ALL VALIDATION-INTEGRITY TESTS PASSED" : `❌ ${failures} VALIDATION TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
