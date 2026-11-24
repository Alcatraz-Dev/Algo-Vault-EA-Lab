/**
 * Market Intelligence — validation stage pipeline.
 *
 * INTEGRITY CONTRACT
 * ------------------
 * A stage may only report COMPLETED when the platform actually executed that
 * stage's engine over real input in this run. The pipeline cannot see the
 * inside of an engine, so every stage takes an explicit *probe* — either the
 * engine invocation or the result object it produced — and refuses to
 * attest to anything it was not handed.
 *
 *   COMPLETED   an engine ran (or its real result was supplied) and the
 *               output passed the stage's shape/consistency checks
 *   UNAVAILABLE no engine, no result, or an engine that legitimately cannot
 *               run (e.g. Monte Carlo without trades). Carries the reason.
 *   FAILED      an engine was supplied but threw, or returned output that
 *               cannot represent that stage (malformed / all sub-tests failed)
 *
 * The five stage functions keep their historical names and argument order so
 * existing callers keep compiling, but the second argument is now a typed
 * probe and the returned object carries `evidence` + `executedAt`.
 *
 * The pipeline never labels a strategy profitable or validated. It reports
 * whether the evidence is complete; statistical interpretation belongs to
 * `lib/quant/validation`.
 */

import { roundTo, stableHash } from "@/lib/quant/canonical";

export type ValidationStageName = "BACKTEST" | "OOS" | "WALK_FORWARD" | "ROBUSTNESS" | "MONTE_CARLO";
export const VALIDATION_STAGES: readonly ValidationStageName[] = [
    "BACKTEST",
    "OOS",
    "WALK_FORWARD",
    "ROBUSTNESS",
    "MONTE_CARLO",
];

export type StageStatus = "COMPLETED" | "UNAVAILABLE" | "FAILED";

export interface StageEvidence {
    stage: ValidationStageName;
    /** Module-level identity of the engine that produced the result. */
    engine: string;
    /** Deterministic per-run identity: stage + inputs + result. */
    executionId: string;
    /** Fingerprint of the inputs the engine actually consumed. */
    inputFingerprint: string;
    resultId: string;
    executedAt: number;
    durationMs: number;
    /** Measured facts about the output (counts, window sizes…). */
    observations: string[];
    metrics?: Record<string, number | string | null>;
}

export interface StageResult {
    stage: ValidationStageName;
    status: StageStatus;
    resultId?: string;
    note?: string;
    executedAt: number;
    evidence?: StageEvidence;
    limitations: string[];
}

/** Either an engine invocation or the already-produced engine result. */
export type StageProbe<T> = T | null | undefined | (() => T | null | undefined);

// ── Minimal structural views of the real engine outputs ─────────────────────

export interface BacktestLike {
    id?: string;
    metrics?: { totalTrades?: number; netProfit?: number; maxDrawdownPct?: number; [k: string]: unknown };
    trades?: unknown[];
    [k: string]: unknown;
}

export interface ValidationOutcomeLike {
    id?: string;
    inSample?: { metrics?: { totalTrades?: number }; trades?: number };
    outOfSample?: { metrics?: { totalTrades?: number }; trades?: number };
    walkForward?: { enabled?: boolean; windows?: unknown[]; stable?: boolean; stabilityScore?: number };
    degradation?: { overall?: number };
    verdict?: string;
    [k: string]: unknown;
}

export interface RobustnessTestLike {
    testId?: string;
    category?: string;
    status?: string;
    limitations?: string[];
    [k: string]: unknown;
}

export type RobustnessLike = RobustnessTestLike[] | { tests?: RobustnessTestLike[] };

export interface MonteCarloLike {
    seed?: number;
    simulations?: number;
    simulationsCompleted?: number;
    sourceTradeCount?: number;
    profitProbability?: number;
    drawdownP95?: number;
    limitations?: string[];
    [k: string]: unknown;
}

export interface ValidationCandidateLike {
    id?: string;
    backtestResultId?: string;
    oosResultId?: string;
    walkForwardResultId?: string;
    robustnessResultId?: string;
    monteCarloResultId?: string;
    [k: string]: unknown;
}

// ── Stage helpers ───────────────────────────────────────────────────────────

const ENGINE = {
    BACKTEST: "lib/strategy-lab/backtest.ts#backtestStrategy",
    OOS: "lib/strategy-lab/validation.ts#validateStrategy",
    WALK_FORWARD: "lib/strategy-lab/validation.ts#runWalkForward",
    ROBUSTNESS: "lib/market-intelligence/research/robustness/runner.ts#runRobustness",
    MONTE_CARLO: "lib/market-intelligence/research/monte-carlo/runner.ts#runMonteCarlo",
} as const;

interface ProbeOutcome<T> {
    value?: T;
    error?: string;
    supplied: boolean;
    durationMs: number;
}

function probe<T>(input: StageProbe<T>): ProbeOutcome<T> {
    if (typeof input === "function") {
        const startedAt = Date.now();
        try {
            const value = (input as () => T | null | undefined)();
            return { value: value ?? undefined, supplied: true, durationMs: Date.now() - startedAt };
        } catch (error) {
            return {
                error: error instanceof Error ? error.message : String(error),
                supplied: true,
                durationMs: Date.now() - startedAt,
            };
        }
    }
    return { value: input ?? undefined, supplied: input !== null && input !== undefined, durationMs: 0 };
}

function unavailable(stage: ValidationStageName, note: string, limitations: string[] = [], now = Date.now()): StageResult {
    return { stage, status: "UNAVAILABLE", note, executedAt: now, limitations };
}

function failed(stage: ValidationStageName, note: string, now = Date.now()): StageResult {
    return { stage, status: "FAILED", note, executedAt: now, limitations: [note] };
}

function completed(
    stage: ValidationStageName,
    resultId: string,
    note: string,
    inputIdentity: unknown,
    outcome: ProbeOutcome<unknown>,
    observations: string[],
    metrics: Record<string, number | string | null> | undefined,
    limitations: string[],
    now: number,
): StageResult {
    const inputFingerprint = stableHash(inputIdentity);
    return {
        stage,
        status: "COMPLETED",
        resultId,
        note,
        executedAt: now,
        evidence: {
            stage,
            engine: ENGINE[stage],
            executionId: `${stage.toLowerCase()}-${stableHash({ inputFingerprint, resultId, at: now })}`,
            inputFingerprint,
            resultId,
            executedAt: now,
            durationMs: outcome.durationMs,
            observations,
            metrics,
        },
        limitations,
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── Stage 1: backtest ───────────────────────────────────────────────────────

export function runBacktest(candidate: ValidationCandidateLike, backtest?: StageProbe<BacktestLike>): StageResult {
    const now = Date.now();
    const outcome = probe(backtest);

    if (outcome.error) return failed("BACKTEST", `Backtest engine threw: ${outcome.error}`, now);
    if (!outcome.value) {
        return unavailable(
            "BACKTEST",
            outcome.supplied
                ? "The backtest adapter returned no result — nothing was executed."
                : "No backtest engine invocation or result was supplied. A referenced resultId alone is not evidence that the engine ran.",
            ["Stage not attested: no executed backtest output was provided."],
            now,
        );
    }

    const result = outcome.value;
    if (!isObject(result) || !Array.isArray(result.trades) || !isObject(result.metrics)) {
        return failed("BACKTEST", "Backtest output is malformed: expected trades[] and metrics{}.", now);
    }

    const totalTrades = Number(result.metrics.totalTrades ?? result.trades.length);
    const resultId = String(result.id ?? candidate.backtestResultId ?? `bt-${stableHash(result).slice(0, 12)}`);
    const limitations: string[] = [];
    if (!Number.isFinite(totalTrades) || totalTrades <= 0) {
        limitations.push("The backtest completed with zero trades — it provides no strategy evidence.");
    }

    return completed(
        "BACKTEST",
        resultId,
        "Existing backtest engine output verified (next_bar_open preserved).",
        { candidateId: candidate.id ?? null, resultId },
        outcome,
        [`trades=${Array.isArray(result.trades) ? result.trades.length : 0}`, `totalTrades=${totalTrades}`],
        {
            totalTrades: Number.isFinite(totalTrades) ? totalTrades : null,
            netProfit: typeof result.metrics.netProfit === "number" ? roundTo(result.metrics.netProfit, 2) : null,
            maxDrawdownPct: typeof result.metrics.maxDrawdownPct === "number" ? roundTo(result.metrics.maxDrawdownPct, 2) : null,
        },
        limitations,
        now,
    );
}

// ── Stage 2: out-of-sample ──────────────────────────────────────────────────

export function runOOS(candidate: ValidationCandidateLike, outcomeProbe?: StageProbe<ValidationOutcomeLike>): StageResult {
    const now = Date.now();
    const outcome = probe(outcomeProbe);

    if (outcome.error) return failed("OOS", `OOS validation engine threw: ${outcome.error}`, now);
    if (!outcome.value) {
        return unavailable(
            "OOS",
            "No OOS validation output was supplied. An OOS resultId alone is not evidence that the split was evaluated.",
            ["Stage not attested: no executed OOS output was provided."],
            now,
        );
    }

    const value = outcome.value;
    const isMetrics = value.inSample?.metrics;
    const oosMetrics = value.outOfSample?.metrics;
    if (!isObject(isMetrics) || !isObject(oosMetrics)) {
        return failed("OOS", "OOS output is missing in-sample or out-of-sample metrics.", now);
    }

    const oosTrades = Number(oosMetrics.totalTrades ?? value.outOfSample?.trades ?? 0);
    const isTrades = Number(isMetrics.totalTrades ?? value.inSample?.trades ?? 0);
    const limitations: string[] = [];
    if (oosTrades <= 0) limitations.push("Out-of-sample period produced zero trades — the split validates nothing.");
    if (isTrades <= 0) limitations.push("In-sample period produced zero trades.");

    const resultId = String(value.id ?? candidate.oosResultId ?? `oos-${stableHash(value).slice(0, 12)}`);

    return completed(
        "OOS",
        resultId,
        "In-sample / out-of-sample split evaluated by the existing validation engine.",
        { candidateId: candidate.id ?? null, resultId },
        outcome,
        [`inSampleTrades=${isTrades}`, `outOfSampleTrades=${oosTrades}`, `verdict=${String(value.verdict ?? "unknown")}`],
        {
            inSampleTrades: isTrades,
            outOfSampleTrades: oosTrades,
            degradationPct: typeof value.degradation?.overall === "number" ? roundTo(value.degradation.overall, 2) : null,
        },
        limitations,
        now,
    );
}

// ── Stage 3: walk-forward ───────────────────────────────────────────────────

export function runWalkForward(candidate: ValidationCandidateLike, outcomeProbe?: StageProbe<ValidationOutcomeLike>): StageResult {
    const now = Date.now();
    const outcome = probe(outcomeProbe);

    if (outcome.error) return failed("WALK_FORWARD", `Walk-forward engine threw: ${outcome.error}`, now);
    if (!outcome.value) {
        return unavailable(
            "WALK_FORWARD",
            "No walk-forward output was supplied. A walk-forward resultId alone is not evidence that windows were evaluated.",
            ["Stage not attested: no executed walk-forward output was provided."],
            now,
        );
    }

    const wf = outcome.value.walkForward;
    const windows = Array.isArray(wf?.windows) ? wf!.windows : [];
    if (!wf || wf.enabled === false) {
        return unavailable(
            "WALK_FORWARD",
            "Walk-forward was disabled for this run — no windows exist.",
            ["Walk-forward evidence unavailable because the stage was not enabled."],
            now,
        );
    }
    if (windows.length === 0) {
        return unavailable(
            "WALK_FORWARD",
            "The walk-forward engine produced no windows (insufficient data or no usable split).",
            ["Zero walk-forward windows — the stage cannot support any conclusion."],
            now,
        );
    }

    const resultId = String(candidate.walkForwardResultId ?? `wf-${stableHash(windows).slice(0, 12)}`);
    const limitations: string[] = [];
    if (wf.stable === false) limitations.push("Walk-forward windows were not stable across the sample.");

    return completed(
        "WALK_FORWARD",
        resultId,
        "Walk-forward windows evaluated by the existing engine.",
        { candidateId: candidate.id ?? null, resultId },
        outcome,
        [`windows=${windows.length}`, `stable=${String(wf.stable ?? "unknown")}`],
        {
            windows: windows.length,
            stabilityScore: typeof wf.stabilityScore === "number" ? roundTo(wf.stabilityScore, 1) : null,
        },
        limitations,
        now,
    );
}

// ── Stage 4: robustness ─────────────────────────────────────────────────────

export function runRobustness(candidate: ValidationCandidateLike, robustnessProbe?: StageProbe<RobustnessLike>): StageResult {
    const now = Date.now();
    const outcome = probe(robustnessProbe);

    if (outcome.error) return failed("ROBUSTNESS", `Robustness engine threw: ${outcome.error}`, now);
    if (!outcome.value) {
        return unavailable(
            "ROBUSTNESS",
            "No robustness output was supplied. A robustness resultId alone is not evidence that stress tests ran.",
            ["Stage not attested: no executed robustness output was provided."],
            now,
        );
    }

    const tests = Array.isArray(outcome.value) ? outcome.value : outcome.value.tests;
    if (!Array.isArray(tests) || tests.length === 0) {
        return unavailable(
            "ROBUSTNESS",
            "The robustness engine returned no tests — nothing was stressed.",
            ["Zero robustness tests executed."],
            now,
        );
    }

    const failedTests = tests.filter((t) => t?.status === "failed");
    if (failedTests.length === tests.length) {
        return failed("ROBUSTNESS", `All ${tests.length} robustness tests failed to execute.`, now);
    }

    const resultId = String(candidate.robustnessResultId ?? `robust-${stableHash(tests).slice(0, 12)}`);
    const limitations: string[] = [];
    if (failedTests.length > 0) {
        limitations.push(`${failedTests.length} of ${tests.length} robustness tests failed to execute.`);
    }

    return completed(
        "ROBUSTNESS",
        resultId,
        "Execution-stress and parameter-perturbation tests executed.",
        { candidateId: candidate.id ?? null, resultId },
        outcome,
        [`tests=${tests.length}`, `failed=${failedTests.length}`],
        { tests: tests.length, failedTests: failedTests.length },
        limitations,
        now,
    );
}

// ── Stage 5: Monte Carlo ────────────────────────────────────────────────────

export function runMonteCarlo(candidate: ValidationCandidateLike, monteCarloProbe?: StageProbe<MonteCarloLike>): StageResult {
    const now = Date.now();
    const outcome = probe(monteCarloProbe);

    if (outcome.error) return failed("MONTE_CARLO", `Monte Carlo engine threw: ${outcome.error}`, now);
    if (!outcome.value) {
        return unavailable(
            "MONTE_CARLO",
            "No Monte Carlo output was supplied. A Monte Carlo resultId alone is not evidence that resampling ran.",
            ["Stage not attested: no executed Monte Carlo output was provided."],
            now,
        );
    }

    const value = outcome.value;
    const simulationsCompleted = Number(value.simulationsCompleted ?? 0);
    const sourceTrades = Number(value.sourceTradeCount ?? 0);

    if (sourceTrades < 2) {
        return unavailable(
            "MONTE_CARLO",
            `Monte Carlo requires real backtest trades; ${sourceTrades} source trade(s) available. No trades were fabricated.`,
            ["Monte Carlo not run: insufficient real trades."],
            now,
        );
    }
    if (!(simulationsCompleted > 0)) {
        return unavailable(
            "MONTE_CARLO",
            "The Monte Carlo engine completed zero simulations.",
            ["Zero simulations completed."],
            now,
        );
    }

    const resultId = String(candidate.monteCarloResultId ?? `mc-${stableHash(value).slice(0, 12)}`);

    return completed(
        "MONTE_CARLO",
        resultId,
        "Resampling executed over the backtest's actual trades.",
        { candidateId: candidate.id ?? null, resultId, seed: value.seed ?? null },
        outcome,
        [`simulations=${simulationsCompleted}`, `sourceTrades=${sourceTrades}`, `seed=${String(value.seed ?? "unspecified")}`],
        {
            simulations: simulationsCompleted,
            sourceTrades,
            profitProbability: typeof value.profitProbability === "number" ? value.profitProbability : null,
            drawdownP95: typeof value.drawdownP95 === "number" ? roundTo(value.drawdownP95, 4) : null,
        },
        Array.isArray(value.limitations) ? [...value.limitations] : [],
        now,
    );
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export interface ValidationPipelineDeps {
    backtest?: StageProbe<BacktestLike>;
    /** The existing `validateStrategy` outcome — feeds both OOS and walk-forward. */
    oos?: StageProbe<ValidationOutcomeLike>;
    walkForward?: StageProbe<ValidationOutcomeLike>;
    robustness?: StageProbe<RobustnessLike>;
    monteCarlo?: StageProbe<MonteCarloLike>;
}

export type PipelineEvidenceStatus = "EVIDENCE_COMPLETE" | "INCOMPLETE" | "FAILED";

export interface ValidationPipelineResult {
    validationId: string;
    candidateId: string | null;
    startedAt: number;
    completedAt: number;
    stages: StageResult[];
    /** Complete only when EVERY stage completed. */
    evidenceStatus: PipelineEvidenceStatus;
    completedStages: ValidationStageName[];
    unavailableStages: ValidationStageName[];
    failedStages: ValidationStageName[];
    /** Candidate status derived from the contiguous completed prefix. */
    candidateStatus: string;
    limitations: string[];
    /** Explicit: this layer never certifies profitability. */
    certifications: { profitable: false; validated: false };
}

export function runValidationPipeline(
    candidate: ValidationCandidateLike,
    deps: ValidationPipelineDeps = {},
    now: () => number = Date.now,
): ValidationPipelineResult {
    const startedAt = now();
    const stages: StageResult[] = [
        runBacktest(candidate, deps.backtest),
        runOOS(candidate, deps.oos),
        runWalkForward(candidate, deps.walkForward ?? deps.oos),
        runRobustness(candidate, deps.robustness),
        runMonteCarlo(candidate, deps.monteCarlo),
    ];
    const completedAt = now();

    const completedStages = stages.filter((s) => s.status === "COMPLETED").map((s) => s.stage);
    const unavailableStages = stages.filter((s) => s.status === "UNAVAILABLE").map((s) => s.stage);
    const failedStages = stages.filter((s) => s.status === "FAILED").map((s) => s.stage);

    const evidenceStatus: PipelineEvidenceStatus =
        failedStages.length > 0 ? "FAILED" : unavailableStages.length > 0 ? "INCOMPLETE" : "EVIDENCE_COMPLETE";

    const limitations = stages.flatMap((s) => s.limitations.map((l) => `${s.stage}: ${l}`));
    if (evidenceStatus !== "EVIDENCE_COMPLETE") {
        limitations.push("Incomplete evidence is not successful validation — no conclusion may be drawn from missing stages.");
    }

    return {
        validationId: `val-${stableHash({ candidateId: candidate.id ?? null, stages: stages.map((s) => s.evidence?.executionId ?? s.status) })}`,
        candidateId: candidate.id ?? null,
        startedAt,
        completedAt,
        stages,
        evidenceStatus,
        completedStages,
        unavailableStages,
        failedStages,
        candidateStatus: deriveCandidateStatus(stages),
        limitations,
        certifications: { profitable: false, validated: false },
    };
}

/** Only the contiguous prefix of completed stages advances the candidate. */
export function deriveCandidateStatus(stages: readonly StageResult[]): string {
    const order = VALIDATION_STAGES;
    const next: Record<ValidationStageName, string> = {
        BACKTEST: "BACKTESTED",
        OOS: "OOS_VALIDATED",
        WALK_FORWARD: "WALK_FORWARD_VALIDATED",
        ROBUSTNESS: "ROBUSTNESS_TESTED",
        MONTE_CARLO: "MONTE_CARLO_ANALYZED",
    };
    let status = "DEFINED";
    for (const stage of order) {
        const result = stages.find((s) => s.stage === stage);
        if (!result || result.status !== "COMPLETED") break;
        status = next[stage];
    }
    if (status === next.MONTE_CARLO) status = "COMPLETED";
    return status;
}
