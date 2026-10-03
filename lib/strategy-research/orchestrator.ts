// ─────────────────────────────────────────────────────────────────────────────
// Research Pipeline Orchestrator — one central, durable work unit at a time.
//
// Pipeline:  data → hypotheses → compile → backtest → validate → monte_carlo
//            → rank → done
//
// Design rules:
//   • One `advance` call = ONE work unit. The mission lease (RTDB transaction)
//     guarantees no duplicate execution of the same research stage.
//   • Stage handlers only SEQUENCE existing engines (loadDataBundle,
//     backtestStrategy, validateStrategy, runMonteCarlo, computeRobustness);
//     no second simulation engine exists here.
//   • Fail-closed: missing data / invalid specs / engine failures produce
//     explicit states (DATA_UNAVAILABLE, BACKTEST_FAILED, BUDGET_EXHAUSTED…)
//     and NEVER fabricated numbers.
//   • Budget: hypotheses/AI/backtests/duration ceilings are charged honestly;
//     when exhausted the mission marks BUDGET_EXHAUSTED and finishes what it
//     already has instead of failing ambiguously.
//   • Cancellation: mission status is re-read between units; pause/cancel
//     propagates at the next unit boundary.
//   • executionEnabled is structurally false — nothing here touches the
//     execution gateway or broker APIs.
// ─────────────────────────────────────────────────────────────────────────────

import { loadDataBundle } from "@/lib/strategy-lab/market-data";
import { saveBacktest, getBacktest } from "@/lib/strategy-lab/storage";
import type { BacktestTrade, DataBundle } from "@/lib/strategy-lab/types";
import type { SupportedSymbol } from "@/lib/market-data/types";
import {
    MISSION_STAGES,
    AdvanceResult,
    CandidateLifecycle,
    DataQualityReport,
    MissionStage,
    ResearchMission,
    ResearchMissionSpec,
} from "./types";
import {
    claimMissionLease,
    getMission,
    listCandidates,
    listHypotheses,
    logEvent,
    newResearchId,
    releaseMissionLease,
    saveCandidate,
    saveHypothesis,
    saveKnowledgeEdges,
    stageStatesAfter,
    updateMission,
} from "./storage";
import { nextStage } from "./mission";
import { generateHypotheses } from "./hypothesis";
import { compileHypothesis, hierarchyFromTimeframes } from "./compiler";
import {
    CandidateRunContext,
    prepareRun,
    runBacktestStep,
    runExecutionVariationStep,
    runMonteCarloStep,
    runValidationStep,
} from "./runner";
import { buildRobustnessReport } from "./robustness";
import { decideLifecycle, scoreCandidate } from "./scoring";
import { strategyFingerprint } from "./fingerprint";
import { buildCandidateEdges } from "./knowledge";
import { persistCandidateMemory } from "./memory";
import { incubateCandidate } from "./incubation";

const MIN_SETUP_BARS = 60;
const WORKER_ID = `worker_${process.pid}_${Date.now().toString(36)}`;

const TERMINAL_CANDIDATE_LIFECYCLES: CandidateLifecycle[] = ["rejected", "incubated", "forward_testing", "failed"];

type Candidate = Awaited<ReturnType<typeof listCandidates>>[number];

// ── Helpers ──────────────────────────────────────────────────────────────────

interface UnitOutcome {
    didWork: boolean;
    message: string;
    /** Complete the current stage and move to the next. */
    advanceStage?: boolean;
    /** Jump directly to this stage (budget exhaustion → finish ranking). */
    jumpToStage?: MissionStage;
    processed?: number;
    failState?: ResearchMission["failState"];
    failMission?: boolean;
}

function budgetExhausted(mission: ResearchMission): boolean {
    const used = mission.budgetUsed ?? { hypotheses: 0, backtests: 0, aiRequests: 0, startedAt: mission.createdAt };
    return Date.now() - used.startedAt > mission.spec.budget.maxDurationMs;
}

function backtestBudgetLeft(mission: ResearchMission): number {
    const used = mission.budgetUsed ?? { hypotheses: 0, backtests: 0, aiRequests: 0, startedAt: mission.createdAt };
    return Math.max(0, mission.spec.budget.maxBacktests - used.backtests);
}

async function chargeBudget(
    mission: ResearchMission,
    charge: Partial<NonNullable<ResearchMission["budgetUsed"]>>
): Promise<void> {
    const used = mission.budgetUsed ?? { hypotheses: 0, backtests: 0, aiRequests: 0, startedAt: mission.createdAt };
    const next = {
        hypotheses: used.hypotheses + (charge.hypotheses ?? 0),
        backtests: used.backtests + (charge.backtests ?? 0),
        aiRequests: used.aiRequests + (charge.aiRequests ?? 0),
        startedAt: used.startedAt,
    };
    mission.budgetUsed = next;
    await updateMission(mission.uid, mission.id, { budgetUsed: next });
}

async function markStage(
    mission: ResearchMission,
    stage: MissionStage,
    status: "running" | "completed" | "failed" | "skipped",
    error?: string
): Promise<void> {
    const stages = stageStatesAfter(mission.stages, stage, status, error ? { error } : undefined);
    mission.stages = stages;
    await updateMission(mission.uid, mission.id, { stages });
}

async function completeStage(mission: ResearchMission, stage: MissionStage): Promise<void> {
    const next = nextStage(stage);
    const stages = stageStatesAfter(mission.stages, stage, "completed");
    mission.stages = stages;
    mission.currentStage = next ?? "done";
    await updateMission(mission.uid, mission.id, { stages, currentStage: mission.currentStage });
}

async function setLifecycle(
    mission: ResearchMission,
    candidate: Candidate,
    lifecycle: CandidateLifecycle
): Promise<void> {
    candidate.lifecycle = lifecycle;
    candidate.updatedAt = Date.now();
    await saveCandidate(candidate);
}

async function failCandidate(
    mission: ResearchMission,
    candidateId: string,
    reason: "data_unavailable",
    notes: string[]
): Promise<void> {
    const candidates = await listCandidates(mission.uid, mission.id);
    const candidate = candidates.find((c) => c.id === candidateId);
    if (!candidate) return;
    candidate.lifecycle = "failed";
    candidate.rejectedReason = reason;
    candidate.rejectedNotes = notes.slice(0, 6);
    candidate.updatedAt = Date.now();
    await saveCandidate(candidate);
}

async function nextCandidateFor(
    mission: ResearchMission,
    predicate: (c: Candidate) => boolean
): Promise<Candidate | null> {
    const candidates = await listCandidates(mission.uid, mission.id);
    return candidates.filter(predicate).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
}

async function contextFor(mission: ResearchMission, market: SupportedSymbol): Promise<CandidateRunContext | null> {
    try {
        const bundle = await loadDataBundle(
            market,
            mission.spec.historicalPeriod,
            hierarchyFromTimeframes(mission.spec.timeframes)
        );
        return { market, bundle, spec: mission.spec };
    } catch (err) {
        await logEvent(
            mission.uid, mission.id, mission.currentStage, "error",
            `Data load failed for ${market}: ${err instanceof Error ? err.message : "provider error"}`,
            undefined, "DATA_UNAVAILABLE"
        );
        return null;
    }
}

// ── Stage: data ──────────────────────────────────────────────────────────────

function qualityFromBundle(
    symbol: SupportedSymbol,
    spec: ResearchMissionSpec,
    bundle: DataBundle
): DataQualityReport {
    const hierarchy = hierarchyFromTimeframes(spec.timeframes);
    const barsByTimeframe: DataQualityReport["barsByTimeframe"] = {};
    const limitations: string[] = [];
    let availableFrom: number | undefined;
    let availableTo: number | undefined;

    for (const tf of spec.timeframes) {
        const candles = bundle.candles[tf];
        const count = Array.isArray(candles) ? candles.length : 0;
        barsByTimeframe[tf] = count;
        if (count === 0) {
            limitations.push(`No ${tf} bars available from the data provider.`);
        } else if (count < MIN_SETUP_BARS) {
            limitations.push(`${tf} has only ${count} bars (< ${MIN_SETUP_BARS} usable).`);
        }
        if (count > 0 && candles) {
            const first = candles[0].timestamp;
            const last = candles[count - 1].timestamp;
            availableFrom = availableFrom === undefined ? first : Math.min(availableFrom, first);
            availableTo = availableTo === undefined ? last : Math.max(availableTo, last);
        }
    }

    const setupBars = barsByTimeframe[hierarchy.setup] ?? 0;
    return {
        symbol,
        timeframes: spec.timeframes,
        barsByTimeframe,
        ...(availableFrom !== undefined ? { availableFrom } : {}),
        ...(availableTo !== undefined ? { availableTo } : {}),
        source: bundle.dataSource?.kind ?? "unknown",
        sufficient: setupBars >= MIN_SETUP_BARS,
        limitations,
    };
}

async function runDataStage(mission: ResearchMission): Promise<UnitOutcome> {
    const spec = mission.spec;
    const reports: Partial<Record<SupportedSymbol, DataQualityReport>> = {};

    for (const market of spec.markets) {
        try {
            const bundle = await loadDataBundle(market, spec.historicalPeriod, hierarchyFromTimeframes(spec.timeframes));
            reports[market] = qualityFromBundle(market, spec, bundle);
        } catch (err) {
            reports[market] = {
                symbol: market,
                timeframes: spec.timeframes,
                barsByTimeframe: {},
                source: "error",
                sufficient: false,
                limitations: [err instanceof Error ? err.message : "Data provider failure."],
            };
        }
    }

    const anySufficient = Object.values(reports).some((r) => r?.sufficient);
    const primary = reports[spec.markets[0]] ?? null;

    await updateMission(mission.uid, mission.id, { dataQuality: primary, dataQualityByMarket: reports });
    mission.dataQuality = primary;
    mission.dataQualityByMarket = reports;

    if (!anySufficient) {
        await logEvent(
            mission.uid, mission.id, "data", "error",
            "No market returned enough historical data to run research.",
            { markets: spec.markets.join(",") }, "DATA_UNAVAILABLE"
        );
        return {
            didWork: true,
            message: "DATA_UNAVAILABLE: insufficient historical market data for every requested market.",
            failState: "DATA_UNAVAILABLE",
            failMission: true,
        };
    }

    const limited = Object.values(reports).filter((r) => r && !r.sufficient);
    await logEvent(
        mission.uid, mission.id, "data", limited.length > 0 ? "warn" : "info",
        limited.length > 0
            ? `Data loaded with limitations — ${limited.map((r) => `${r!.symbol}: ${r!.limitations.join("; ")}`).join(" | ")}`
            : "Historical data loaded and verified.",
        { markets: spec.markets.join(",") }, "DATA_LOADED"
    );

    return {
        didWork: true,
        message: limited.length > 0 ? `Data loaded (limitations recorded for ${limited.length} market(s)).` : "Data loaded.",
        advanceStage: true,
    };
}

// ── Stage: hypotheses ────────────────────────────────────────────────────────

async function runHypothesesStage(mission: ResearchMission): Promise<UnitOutcome> {
    const spec = mission.spec;
    const existing = await listHypotheses(mission.uid, mission.id);
    const used = mission.budgetUsed ?? { hypotheses: 0, backtests: 0, aiRequests: 0, startedAt: mission.createdAt };
    const remainingBudget = Math.max(0, spec.budget.maxHypotheses - used.hypotheses);

    if (remainingBudget <= 0) {
        await logEvent(mission.uid, mission.id, "hypotheses", "warn", "Hypothesis budget exhausted before generating new ideas.", undefined, "BUDGET_EXHAUSTED");
        if (existing.length === 0) {
            return {
                didWork: true,
                message: "BUDGET_EXHAUSTED: no hypothesis budget left and no hypotheses exist.",
                failState: "BUDGET_EXHAUSTED",
                failMission: true,
            };
        }
        return { didWork: true, message: "Hypothesis budget exhausted — using existing hypotheses.", advanceStage: true };
    }

    let generated = 0;
    let aiRequests = 0;
    const aiErrors: string[] = [];

    for (const market of spec.markets) {
        const alreadyForMarket = existing.filter((h) => h.market === market).length;
        const perMarket = Math.ceil(Math.min(remainingBudget, spec.maxCandidates) / spec.markets.length);
        const want = Math.max(0, perMarket - alreadyForMarket);
        if (want === 0) continue;

        const useAI = spec.budget.maxAIRequests - used.aiRequests - aiRequests > 0;
        const result = await generateHypotheses(spec, mission.id, market, want, { useAI });
        if (result.aiUsed) aiRequests += 1;
        if (result.aiError) aiErrors.push(result.aiError);

        for (const hypothesis of result.hypotheses) {
            await saveHypothesis(mission.uid, mission.id, hypothesis);
            generated += 1;
        }
        if (result.aiUsed && result.source === "local") {
            await logEvent(
                mission.uid, mission.id, "hypotheses", "warn",
                `AI hypothesis generation unavailable for ${market} — deterministic generator used.`,
                { market }, "HYPOTHESIS_GENERATED"
            );
        }
    }

    if (generated > 0 || aiRequests > 0) {
        await chargeBudget(mission, { hypotheses: generated, aiRequests });
    }

    const total = (await listHypotheses(mission.uid, mission.id)).length;
    await updateMission(mission.uid, mission.id, { hypothesisCount: total });
    mission.hypothesisCount = total;

    if (total === 0) {
        const detail = aiErrors.length > 0 ? ` AI errors: ${aiErrors.join("; ")}` : "";
        await logEvent(mission.uid, mission.id, "hypotheses", "error", `No hypotheses could be generated.${detail}`, undefined, "RESEARCH_FAILED");
        return {
            didWork: true,
            message: aiErrors.length > 0
                ? "AI_UNAVAILABLE: hypothesis generation failed and no deterministic hypotheses were produced."
                : "No hypotheses produced.",
            failState: aiErrors.length > 0 ? "AI_UNAVAILABLE" : "VALIDATION_FAILED",
            failMission: true,
        };
    }

    await logEvent(
        mission.uid, mission.id, "hypotheses", "info",
        `${total} hypotheses ready (${generated} new this run).`,
        { total, new: generated }, "HYPOTHESIS_GENERATED"
    );
    return { didWork: true, message: `${total} hypotheses ready.`, advanceStage: true, processed: generated };
}

// ── Stage: compile ───────────────────────────────────────────────────────────

async function runCompileStage(mission: ResearchMission): Promise<UnitOutcome> {
    const spec = mission.spec;
    const hypotheses = await listHypotheses(mission.uid, mission.id);
    const existingCandidates = await listCandidates(mission.uid, mission.id);
    const compiledHypothesisIds = new Set(existingCandidates.map((c) => c.hypothesis.id));
    const byFingerprint = new Map<string, string>();
    for (const candidate of existingCandidates) {
        if (candidate.fingerprint) byFingerprint.set(candidate.fingerprint, candidate.id);
    }

    let compiled = 0;
    let rejected = 0;
    let duplicates = 0;
    const maxCandidates = Math.min(spec.maxCandidates, spec.budget.maxHypotheses);

    for (const hypothesis of hypotheses) {
        if (compiledHypothesisIds.has(hypothesis.id)) continue;
        if (existingCandidates.length + compiled + rejected >= maxCandidates) break;

        const now = Date.now();
        const outcome = compileHypothesis(hypothesis, spec);

        if ("strategy" in outcome) {
            const fingerprint = strategyFingerprint(outcome.strategy);
            const duplicateOf = byFingerprint.get(fingerprint) ?? null;
            const candidate: Candidate = {
                id: outcome.strategy.id,
                missionId: mission.id,
                uid: mission.uid,
                hypothesis,
                compilation: outcome.report,
                strategy: outcome.strategy,
                evaluation: null,
                score: null,
                warnings: [],
                robustnessReport: null,
                fingerprint,
                linkedTo: duplicateOf,
                lifecycle: duplicateOf ? "rejected" : "compiled",
                rejectedReason: duplicateOf ? "duplicate" : null,
                rejectedNotes: duplicateOf
                    ? [`Structurally identical to candidate ${duplicateOf} — linked instead of duplicated.`]
                    : [],
                knowledgeEdges: [],
                memoryRecordId: null,
                incubationStrategyId: null,
                forwardTestId: null,
                createdAt: now,
                updatedAt: now,
            };
            await saveCandidate(candidate);
            compiledHypothesisIds.add(hypothesis.id);
            compiled += 1;
            if (duplicateOf) {
                duplicates += 1;
                await logEvent(
                    mission.uid, mission.id, "compile", "info",
                    `Candidate ${candidate.id} linked to ${duplicateOf} (identical structure).`,
                    { fingerprint }, "STRATEGY_DEDUPLICATED"
                );
            } else {
                byFingerprint.set(fingerprint, candidate.id);
                await logEvent(
                    mission.uid, mission.id, "compile", "info",
                    `Hypothesis ${hypothesis.id} compiled into strategy ${candidate.id}.`,
                    undefined, "STRATEGY_COMPILED"
                );
            }
        } else {
            const candidate: Candidate = {
                id: newResearchId("cand"),
                missionId: mission.id,
                uid: mission.uid,
                hypothesis,
                compilation: outcome.report,
                strategy: null,
                evaluation: null,
                score: null,
                warnings: [],
                robustnessReport: null,
                fingerprint: "",
                linkedTo: null,
                lifecycle: "rejected",
                rejectedReason: "compile_failed",
                rejectedNotes: [
                    ...outcome.report.errors,
                    ...outcome.report.unsupportedFeatures.map((f) => `unsupported: ${f}`),
                ],
                knowledgeEdges: [],
                memoryRecordId: null,
                incubationStrategyId: null,
                forwardTestId: null,
                createdAt: now,
                updatedAt: now,
            };
            await saveCandidate(candidate);
            compiledHypothesisIds.add(hypothesis.id);
            rejected += 1;
            await logEvent(
                mission.uid, mission.id, "compile", "warn",
                `Hypothesis ${hypothesis.id} rejected by compiler: ${outcome.report.errors.slice(0, 2).join("; ")}${outcome.report.unsupportedFeatures.length > 0 ? ` (unsupported: ${outcome.report.unsupportedFeatures.join(", ")})` : ""}`,
                undefined, "HYPOTHESIS_REJECTED"
            );
        }
    }

    const all = await listCandidates(mission.uid, mission.id);
    const validCount = all.filter((c) => c.compilation.valid).length;
    const rejectedCount = all.filter((c) => c.rejectedReason === "compile_failed" || c.rejectedReason === "duplicate").length;
    await updateMission(mission.uid, mission.id, { compiledCount: validCount, rejectedCount });
    mission.compiledCount = validCount;
    mission.rejectedCount = rejectedCount;

    if (validCount === 0) {
        await logEvent(mission.uid, mission.id, "compile", "error", "Every hypothesis failed compilation — nothing testable.", undefined, "RESEARCH_FAILED");
        return {
            didWork: true,
            message: "VALIDATION_FAILED: no hypothesis compiled into a valid strategy specification.",
            failState: "VALIDATION_FAILED",
            failMission: true,
        };
    }

    return {
        didWork: true,
        message: `${validCount} candidate(s) compiled${duplicates > 0 ? `, ${duplicates} duplicate(s) linked` : ""}${rejected > 0 ? `, ${rejected} rejected` : ""}.`,
        advanceStage: true,
        processed: compiled + rejected,
    };
}

// ── Stage: backtest ──────────────────────────────────────────────────────────

async function runBacktestStage(mission: ResearchMission): Promise<UnitOutcome> {
    const candidate = await nextCandidateFor(
        mission,
        (c) => c.compilation.valid && !c.evaluation?.backtest && c.linkedTo === null && !c.rejectedReason
    );
    if (!candidate || !candidate.strategy) {
        return { didWork: true, message: "No candidates awaiting backtest.", advanceStage: true };
    }
    if (backtestBudgetLeft(mission) < 1 || budgetExhausted(mission)) {
        return {
            didWork: true,
            message: "BUDGET_EXHAUSTED: backtest budget or duration reached — skipping to ranking.",
            failState: "BUDGET_EXHAUSTED",
            jumpToStage: "rank",
        };
    }

    const ctx = await contextFor(mission, candidate.hypothesis.market);
    if (!ctx) {
        return {
            didWork: true,
            message: "DATA_UNAVAILABLE: market data could not be loaded for backtest.",
            failState: "DATA_UNAVAILABLE",
            failMission: true,
        };
    }
    const { prepared, errors: prepErrors } = prepareRun(candidate.strategy, ctx);
    if (!prepared) {
        await failCandidate(mission, candidate.id, "data_unavailable", prepErrors);
        await logEvent(mission.uid, mission.id, "backtest", "error", `Candidate ${candidate.id}: ${prepErrors.join("; ")}`, undefined, "BACKTEST_FAILED");
        return { didWork: true, message: `Candidate ${candidate.id} failed (insufficient data).`, processed: 1 };
    }

    await markStage(mission, "backtest", "running");
    await setLifecycle(mission, candidate, "backtesting");
    await logEvent(mission.uid, mission.id, "backtest", "info", `Backtest started for ${candidate.id}.`, undefined, "BACKTEST_STARTED");

    const step = runBacktestStep(candidate.id, candidate.strategy, ctx, prepared);
    if (!step.backtest || !step.fullResult) {
        await failCandidate(mission, candidate.id, "data_unavailable", step.errors);
        await logEvent(mission.uid, mission.id, "backtest", "error", `Backtest failed for ${candidate.id}: ${step.errors.join("; ")}`, undefined, "BACKTEST_FAILED");
        return { didWork: true, message: `Backtest failed for ${candidate.id}.`, processed: 1 };
    }

    // Persist the FULL engine result through the EXISTING Strategy Lab store —
    // trades/equity live there once; the candidate only references the id.
    let backtestId: string | null = null;
    try {
        backtestId = await saveBacktest(mission.uid, {
            ...step.fullResult,
            id: newResearchId("bt"),
            generatedAt: Date.now(),
        });
    } catch {
        backtestId = null; // non-fatal: metrics already live on the candidate
    }

    candidate.evaluation = {
        backtest: { ...step.backtest, backtestId },
        validation: null,
        monteCarlo: null,
        robustness: null,
        executionVariation: null,
    };
    candidate.lifecycle = "backtested";
    candidate.updatedAt = Date.now();
    await saveCandidate(candidate);

    await chargeBudget(mission, { backtests: step.backtestsUsed });

    const m = step.backtest.metrics;
    await logEvent(
        mission.uid, mission.id, "backtest", "info",
        `Backtest completed for ${candidate.id}: ${m.totalTrades} trades, PF ${m.profitFactor.toFixed(2)}, DD ${m.maxDrawdownPct.toFixed(1)}%.`,
        { trades: m.totalTrades }, "BACKTEST_COMPLETED"
    );
    return { didWork: true, message: `Backtested ${candidate.id}.`, processed: 1 };
}

// ── Stage: validate (OOS + walk-forward) ─────────────────────────────────────

async function runValidateStage(mission: ResearchMission): Promise<UnitOutcome> {
    if (!mission.spec.requireOOS && !mission.spec.requireWalkForward) {
        await markStage(mission, "validate", "skipped");
        mission.currentStage = "monte_carlo";
        await updateMission(mission.uid, mission.id, { currentStage: "monte_carlo" });
        return { didWork: true, message: "OOS/walk-forward not required by this mission." };
    }

    const candidate = await nextCandidateFor(
        mission,
        (c) => Boolean(c.evaluation?.backtest) && !c.evaluation?.validation && c.linkedTo === null && !c.rejectedReason
    );
    if (!candidate || !candidate.strategy) {
        return { didWork: true, message: "No candidates awaiting validation.", advanceStage: true };
    }
    if (budgetExhausted(mission)) {
        return {
            didWork: true,
            message: "BUDGET_EXHAUSTED: research duration reached — skipping to ranking.",
            failState: "BUDGET_EXHAUSTED",
            jumpToStage: "rank",
        };
    }

    const ctx = await contextFor(mission, candidate.hypothesis.market);
    if (!ctx) {
        return { didWork: true, message: "DATA_UNAVAILABLE: market data unavailable for validation.", failState: "DATA_UNAVAILABLE", failMission: true };
    }
    const { prepared, errors: prepErrors } = prepareRun(candidate.strategy, ctx);
    if (!prepared) {
        await failCandidate(mission, candidate.id, "data_unavailable", prepErrors);
        return { didWork: true, message: `Validation could not run for ${candidate.id}.`, processed: 1 };
    }

    await markStage(mission, "validate", "running");
    await setLifecycle(mission, candidate, "oos_testing");
    await logEvent(mission.uid, mission.id, "validate", "info", `OOS validation started for ${candidate.id}.`, undefined, "OOS_STARTED");

    const step = runValidationStep(candidate.strategy, ctx, prepared);
    if (!step.validation || !candidate.evaluation) {
        await failCandidate(mission, candidate.id, "data_unavailable", step.errors);
        await logEvent(mission.uid, mission.id, "validate", "error", `Validation failed for ${candidate.id}: ${step.errors.join("; ")}`, undefined, "RESEARCH_FAILED");
        return { didWork: true, message: `Validation failed for ${candidate.id}.`, processed: 1 };
    }

    candidate.evaluation = { ...candidate.evaluation, validation: step.validation };
    const wf = step.validation.outcome.walkForward;
    if (wf.enabled && wf.windows.length > 0) {
        candidate.lifecycle = "walk_forward";
    }
    candidate.updatedAt = Date.now();
    await saveCandidate(candidate);

    await chargeBudget(mission, { backtests: step.backtestsUsed });

    const outcome = step.validation.outcome;
    await logEvent(
        mission.uid, mission.id, "validate", outcome.verdict === "fragile" ? "warn" : "info",
        `OOS completed for ${candidate.id}: verdict=${outcome.verdict}, degradation=${outcome.degradation.overall}${wf.enabled ? `, walk-forward windows=${wf.windows.length} stable=${wf.stable}` : ""}.`,
        { degradation: outcome.degradation.overall }, "OOS_COMPLETED"
    );
    if (wf.enabled) {
        await logEvent(
            mission.uid, mission.id, "validate", wf.stable ? "info" : "warn",
            `Walk-forward completed for ${candidate.id}: ${wf.windows.length} window(s), stable=${wf.stable}.`,
            { windows: wf.windows.length }, "WALK_FORWARD_COMPLETED"
        );
    }
    return { didWork: true, message: `Validated ${candidate.id} (verdict ${outcome.verdict}).`, processed: 1 };
}

// ── Stage: monte_carlo (+ execution variation) ───────────────────────────────

async function runMonteCarloStage(mission: ResearchMission): Promise<UnitOutcome> {
    if (!mission.spec.requireMonteCarlo) {
        await markStage(mission, "monte_carlo", "skipped");
        mission.currentStage = "rank";
        await updateMission(mission.uid, mission.id, { currentStage: "rank" });
        return { didWork: true, message: "Monte Carlo not required by this mission." };
    }

    const target = await nextCandidateFor(
        mission,
        (c) =>
            Boolean(c.evaluation?.backtest) &&
            !c.evaluation?.monteCarlo &&
            (mission.spec.requireOOS ? Boolean(c.evaluation?.validation) : true) &&
            c.linkedTo === null &&
            !c.rejectedReason
    );
    if (!target || !target.strategy || !target.evaluation) {
        return { didWork: true, message: "No candidates awaiting Monte Carlo analysis.", advanceStage: true };
    }
    if (budgetExhausted(mission)) {
        return { didWork: true, message: "BUDGET_EXHAUSTED: duration reached — skipping to ranking.", failState: "BUDGET_EXHAUSTED", jumpToStage: "rank" };
    }

    await markStage(mission, "monte_carlo", "running");
    await setLifecycle(mission, target, "monte_carlo");
    await logEvent(mission.uid, mission.id, "monte_carlo", "info", `Monte Carlo started for ${target.id}.`, undefined, "MONTE_CARLO_STARTED");

    // Monte Carlo resamples the PERSISTED backtest trades — no re-simulation.
    let trades: BacktestTrade[] = [];
    const backtestId = target.evaluation.backtest?.backtestId ?? null;
    if (backtestId) {
        const stored = await getBacktest(mission.uid, backtestId);
        trades = stored?.trades ?? [];
    }
    if (trades.length === 0) {
        // Fallback: re-run once to obtain trades (charged to the budget).
        if (backtestBudgetLeft(mission) < 1) {
            return { didWork: true, message: "BUDGET_EXHAUSTED: cannot re-run backtest for Monte Carlo source trades.", failState: "BUDGET_EXHAUSTED", jumpToStage: "rank" };
        }
        const ctx = await contextFor(mission, target.hypothesis.market);
        if (!ctx) return { didWork: true, message: "DATA_UNAVAILABLE for Monte Carlo source trades.", failState: "DATA_UNAVAILABLE", failMission: true };
        const { prepared, errors } = prepareRun(target.strategy, ctx);
        if (!prepared) {
            await failCandidate(mission, target.id, "data_unavailable", errors);
            return { didWork: true, message: `INSUFFICIENT_DATA for Monte Carlo source trades (${target.id}).`, processed: 1 };
        }
        const rerun = runBacktestStep(target.id, target.strategy, ctx, prepared);
        trades = rerun.fullResult?.trades ?? [];
        await chargeBudget(mission, { backtests: rerun.backtestsUsed });
    }

    const mcStep = runMonteCarloStep(target.id, trades, mission.spec);

    let executionVariation = target.evaluation.executionVariation ?? null;
    if (target.strategy && backtestBudgetLeft(mission) >= 3) {
        const ctx = await contextFor(mission, target.hypothesis.market);
        if (ctx) {
            const { prepared } = prepareRun(target.strategy, ctx);
            if (prepared) {
                const evStep = runExecutionVariationStep(target.strategy, ctx, prepared);
                executionVariation = evStep.executionVariation;
                await chargeBudget(mission, { backtests: evStep.backtestsUsed });
            }
        }
    }

    target.evaluation = {
        ...target.evaluation,
        monteCarlo: mcStep.monteCarlo,
        executionVariation,
    };
    target.lifecycle = "robustness_analysis";
    target.robustnessReport = buildRobustnessReport(target.id, target.evaluation, mission.spec);
    target.warnings = target.robustnessReport.warnings;
    target.updatedAt = Date.now();
    await saveCandidate(target);

    const mc = mcStep.monteCarlo?.summary;
    await logEvent(
        mission.uid, mission.id, "monte_carlo", mc && mc.simulations > 0 ? "info" : "warn",
        `Monte Carlo completed for ${target.id}: ${mc?.simulations ?? 0} simulations, profitProbability=${mc && mc.profitProbability !== null ? (mc.profitProbability * 100).toFixed(0) + "%" : "n/a"}${target.robustnessReport ? `, robustness=${target.robustnessReport.status}` : ""}.`,
        { simulations: mc?.simulations ?? 0 }, "MONTE_CARLO_COMPLETED"
    );
    await logEvent(
        mission.uid, mission.id, "monte_carlo", "info",
        `Robustness analysis completed for ${target.id}.`,
        { warnings: target.warnings.length }, "ROBUSTNESS_COMPLETED"
    );
    return { didWork: true, message: `Monte Carlo + robustness completed for ${target.id}.`, processed: 1 };
}

// ── Stage: rank (score, memory, knowledge, incubation) ───────────────────────

async function runRankStage(mission: ResearchMission): Promise<UnitOutcome> {
    const candidates = await listCandidates(mission.uid, mission.id);
    const pending = candidates.filter(
        (c) => !TERMINAL_CANDIDATE_LIFECYCLES.includes(c.lifecycle)
    );

    if (pending.length === 0) {
        return finalizeMission(mission, candidates, 0);
    }

    let processed = 0;

    for (const candidate of pending) {
        // Ensure warnings/report exist even when the Monte Carlo stage was skipped.
        if (candidate.evaluation?.backtest && !candidate.robustnessReport) {
            candidate.robustnessReport = buildRobustnessReport(candidate.id, candidate.evaluation, mission.spec);
            candidate.warnings = candidate.robustnessReport.warnings;
        }
        if (candidate.evaluation) {
            candidate.score = scoreCandidate(candidate.evaluation, mission.spec).score;
        }

        const { lifecycle, rejectedReason, notes } = decideLifecycle(candidate, mission.spec);
        candidate.lifecycle = lifecycle;
        candidate.rejectedReason = rejectedReason;
        candidate.rejectedNotes = notes;

        if (lifecycle === "survivor") {
            const incubation = await incubateCandidate(mission, candidate);
            if (incubation.ok) {
                candidate.incubationStrategyId = incubation.strategyId;
                candidate.forwardTestId = incubation.forwardTestId;
                candidate.lifecycle = incubation.forwardTestId ? "forward_testing" : "incubated";
                await logEvent(
                    mission.uid, mission.id, "rank", "info",
                    `Candidate ${candidate.id} moved to Strategy Lab incubation${incubation.forwardTestId ? " with signal-only forward test" : ""}.`,
                    { strategyId: incubation.strategyId ?? "" }, "STRATEGY_INCUBATING"
                );
            } else {
                await logEvent(
                    mission.uid, mission.id, "rank", "warn",
                    `Incubation failed for ${candidate.id}: ${incubation.error ?? "unknown"} (kept as survivor for retry).`,
                    undefined, "RESEARCH_FAILED"
                );
            }
        } else if (lifecycle === "rejected") {
            await logEvent(
                mission.uid, mission.id, "rank", "warn",
                `Candidate ${candidate.id} rejected (${rejectedReason ?? "unspecified"}): ${notes.slice(0, 2).join("; ")}`,
                undefined, "STRATEGY_REJECTED"
            );
        }

        // Knowledge Graph edges (existing builders + extended relation types).
        try {
            const edges = buildCandidateEdges(mission, candidate);
            if (edges.length > 0) {
                await saveKnowledgeEdges(mission.uid, mission.id, edges);
                candidate.knowledgeEdges = edges.map((e) => e.id);
            }
        } catch (err) {
            console.error("[strategy-research] knowledge edges failed:", err);
        }

        // Strategy/Setup Memory — survivors AND rejections are remembered.
        try {
            candidate.memoryRecordId = await persistCandidateMemory(mission, candidate);
        } catch (err) {
            console.error("[strategy-research] memory record failed:", err);
        }

        candidate.updatedAt = Date.now();
        await saveCandidate(candidate);
        processed += 1;
    }

    const all = await listCandidates(mission.uid, mission.id);
    return finalizeMission(mission, all, processed);
}

async function finalizeMission(
    mission: ResearchMission,
    all: Candidate[],
    processed: number
): Promise<UnitOutcome> {
    const survivors = all.filter((c) => ["incubated", "forward_testing"].includes(c.lifecycle)).length;
    const rejected = all.filter((c) => c.rejectedReason !== null).length;
    await updateMission(mission.uid, mission.id, {
        survivorCount: survivors,
        rejectedCount: rejected,
        compiledCount: all.filter((c) => c.compilation.valid).length,
    });
    mission.survivorCount = survivors;
    mission.rejectedCount = rejected;
    return {
        didWork: true,
        message: `Research complete: ${survivors} incubated, ${rejected} rejected, ${all.length} candidates total.`,
        advanceStage: true,
        processed,
    };
}

// ── Stage dispatch ───────────────────────────────────────────────────────────

async function runStage(mission: ResearchMission, stage: MissionStage): Promise<UnitOutcome> {
    switch (stage) {
        case "data":
            return runDataStage(mission);
        case "hypotheses":
            return runHypothesesStage(mission);
        case "compile":
            return runCompileStage(mission);
        case "backtest":
            return runBacktestStage(mission);
        case "validate":
            return runValidateStage(mission);
        case "monte_carlo":
            return runMonteCarloStage(mission);
        case "rank":
            return runRankStage(mission);
        case "done":
            return { didWork: false, message: "Mission already complete." };
        default:
            return { didWork: false, message: `Unknown stage ${stage}.` };
    }
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Advances one durable work unit. Safe to call concurrently: the lease
 * (RTDB transaction) admits a single worker, stage guards make re-execution
 * idempotent, and mission status (pause/cancel) is re-read every call.
 */
export async function advanceMission(
    uid: string,
    missionId: string,
    workerId: string = WORKER_ID
): Promise<AdvanceResult> {
    const mission = await getMission(uid, missionId);
    if (!mission) {
        return {
            missionId, status: "failed", stage: "data", didWork: false, completed: false,
            message: "Mission not found.",
        };
    }

    if (mission.status !== "running") {
        return {
            missionId,
            status: mission.status,
            stage: mission.currentStage,
            didWork: false,
            completed: mission.status === "completed" || mission.status === "cancelled",
            message:
                mission.status === "completed"
                    ? "Mission already completed."
                    : mission.status === "cancelled"
                        ? "Mission cancelled — no further work will run."
                        : `Mission ${mission.status} — resume to continue.`,
        };
    }

    const claimed = await claimMissionLease(uid, missionId, workerId);
    if (!claimed) {
        return {
            missionId,
            status: mission.status,
            stage: mission.currentStage,
            didWork: false,
            completed: false,
            message: "Another worker holds the research lease — duplicate execution prevented.",
        };
    }

    let stage = mission.currentStage;
    try {
        // Re-read inside the lease: status may have changed while waiting.
        const fresh = await getMission(uid, missionId);
        if (!fresh || fresh.status !== "running") {
            return {
                missionId,
                status: fresh?.status ?? "failed",
                stage: fresh?.currentStage ?? stage,
                didWork: false,
                completed: fresh?.status === "completed" || fresh?.status === "cancelled",
                message: `Mission ${fresh?.status ?? "missing"} — unit skipped.`,
            };
        }
        Object.assign(mission, fresh);
        stage = mission.currentStage;

        // Duration budget: stop gracefully before starting new work.
        if (budgetExhausted(mission) && stage !== "rank" && stage !== "done") {
            await logEvent(uid, missionId, stage, "warn", "Research duration budget exhausted.", undefined, "BUDGET_EXHAUSTED");
            const stages = mission.stages.map((s) => {
                const si = MISSION_STAGES.indexOf(s.stage);
                if (s.stage === stage) return { ...s, status: "completed" as const, completedAt: Date.now() };
                if (s.stage === "rank" || s.stage === "done") return { ...s, status: "pending" as const };
                return si > MISSION_STAGES.indexOf(stage) ? { ...s, status: "skipped" as const } : s;
            });
            await updateMission(uid, missionId, { stages, currentStage: "rank", failState: "BUDGET_EXHAUSTED" });
            mission.stages = stages;
            mission.currentStage = "rank";
            mission.failState = "BUDGET_EXHAUSTED";
            stage = "rank";
        }

        const wasStage = stage;
        const outcome = await runStage(mission, stage);

        if (outcome.failMission) {
            const stages = stageStatesAfter(mission.stages, wasStage, "failed", { error: outcome.message });
            await updateMission(uid, missionId, {
                stages,
                status: "failed",
                failState: outcome.failState ?? null,
                error: outcome.message,
                completedAt: Date.now(),
            });
            await logEvent(uid, missionId, wasStage, "error", outcome.message, undefined, "RESEARCH_FAILED");
            return {
                missionId, status: "failed", stage: wasStage, didWork: true, completed: false,
                message: outcome.message, processedCandidates: outcome.processed,
            };
        }

        if (outcome.jumpToStage) {
            const jump = outcome.jumpToStage;
            const stages = mission.stages.map((s) => {
                const si = MISSION_STAGES.indexOf(s.stage);
                if (s.stage === wasStage) return { ...s, status: "completed" as const, completedAt: Date.now() };
                if (s.stage === jump || s.stage === "done") return { ...s, status: "pending" as const };
                if (si > MISSION_STAGES.indexOf(wasStage)) return { ...s, status: "skipped" as const };
                return s;
            });
            await updateMission(uid, missionId, {
                stages,
                currentStage: jump,
                ...(outcome.failState ? { failState: outcome.failState } : {}),
            });
            mission.stages = stages;
            mission.currentStage = jump;
            return {
                missionId, status: mission.status, stage: jump, didWork: true, completed: false,
                message: outcome.message, processedCandidates: outcome.processed,
            };
        }

        if (outcome.advanceStage) {
            await completeStage(mission, wasStage);
            if (mission.currentStage === "done") {
                await updateMission(uid, missionId, {
                    status: "completed",
                    completedAt: Date.now(),
                    ...(mission.failState ? { failState: mission.failState } : {}),
                });
                await logEvent(uid, missionId, "rank", "info", `Research complete — ${outcome.message}`, undefined, "RESEARCH_COMPLETED");
                return {
                    missionId, status: "completed", stage: "done", didWork: true, completed: true,
                    message: outcome.message, processedCandidates: outcome.processed,
                };
            }
        }

        return {
            missionId,
            status: mission.status,
            stage: mission.currentStage,
            didWork: outcome.didWork,
            completed: false,
            message: outcome.message,
            processedCandidates: outcome.processed,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Research work unit failed.";
        console.error("[strategy-research/orchestrator]", err);
        try {
            const stages = stageStatesAfter(mission.stages, stage, "failed", { error: message });
            await updateMission(uid, missionId, { stages, status: "failed", error: message, completedAt: Date.now() });
            await logEvent(uid, missionId, stage, "error", message, undefined, "RESEARCH_FAILED");
        } catch {
            // failure-handling persistence failed; report below regardless
        }
        return { missionId, status: "failed", stage, didWork: true, completed: false, message };
    } finally {
        await releaseMissionLease(uid, missionId, workerId).catch(() => undefined);
    }
}

/** Runs units until completion, pause, budget stop, failure, or the cap. */
export async function runMissionToCompletion(
    uid: string,
    missionId: string,
    maxUnits = 200
): Promise<AdvanceResult> {
    let last: AdvanceResult | null = null;
    for (let i = 0; i < maxUnits; i++) {
        const result = await advanceMission(uid, missionId);
        last = result;
        if (result.completed || !result.didWork) return result;
    }
    return last ?? {
        missionId, status: "failed", stage: "data", didWork: false, completed: false,
        message: "No unit ran.",
    };
}
