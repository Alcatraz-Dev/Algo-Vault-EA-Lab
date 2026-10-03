// ─────────────────────────────────────────────────────────────────────────────
// Autonomous Strategy Research Engine — public surface.
//
// Orchestration ONLY: every evaluation is delegated to the existing
// deterministic engines (Strategy Lab backtest/OOS/walk-forward/robustness,
// Monte Carlo runner, Setup Memory, Knowledge Graph). No execution surface is
// exported — this domain cannot place orders by construction.
// ─────────────────────────────────────────────────────────────────────────────

export * from "./types";
export {
    MISSION_LIMITS,
    BUDGET_LIMITS,
    validateMissionSpec,
    validateMissionName,
    isCoercibleMission,
    emptyStageStates,
} from "./validation";
export {
    createMission,
    applyMissionControl,
    nextStage,
    RESEARCH_LINEAGE_NOTE,
} from "./mission";
export {
    advanceMission,
    runMissionToCompletion,
} from "./orchestrator";
export {
    generateHypotheses,
    buildLocalHypotheses,
} from "./hypothesis";
export {
    compileHypothesis,
    verifyHypothesis,
    hierarchyFromTimeframes,
} from "./compiler";
export {
    evaluateCandidate,
    prepareRun,
    runBacktestStep,
    runValidationStep,
    runMonteCarloStep,
    runExecutionVariationStep,
    computeTradeDistribution,
    researchBacktestConfig,
    seedFromString,
} from "./runner";
export {
    buildResearchWarnings,
    buildRobustnessReport,
} from "./robustness";
export {
    scoreCandidate,
    decideLifecycle,
    detectOverfitting,
    SURVIVOR_THRESHOLD,
} from "./scoring";
export {
    strategyFingerprint,
    canonicalStrategyStructure,
    isStructurallyIdentical,
    stableHash,
} from "./fingerprint";
export {
    buildCandidateEdges,
    buildCandidateLineage,
    validateResearchEdges,
    missionNode,
    hypothesisNode,
    strategyNode,
} from "./knowledge";
export type { LineageEntry } from "./knowledge";
export {
    buildCandidateMemoryRecord,
    persistCandidateMemory,
} from "./memory";
export { incubateCandidate } from "./incubation";
export type { IncubationOutcome } from "./incubation";
