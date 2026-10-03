// ─────────────────────────────────────────────────────────────────────────────
// Autonomous Strategy Research Engine — domain types.
//
// This engine is an ORCHESTRATION layer on top of the existing AlgoVault
// systems (Strategy Lab backtest/validation/robustness, Monte Carlo runner,
// Setup Memory, Knowledge Graph). It defines no engines of its own.
//
// Core principle: AI proposes hypotheses as untrusted structured proposals;
// deterministic AlgoVault engines test them; the user stays in control and
// live broker execution is never touched by this engine.
// ─────────────────────────────────────────────────────────────────────────────

import type {
    BacktestConfig,
    BacktestMetrics,
    RobustnessScore,
    Strategy,
    ValidationOutcome,
} from "@/lib/strategy-lab/types";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import type { KnowledgeEdge } from "@/lib/market-intelligence/knowledge/types";
import type { SetupMemoryRecord } from "@/lib/market-intelligence/memory/types";

// ── Research mission ─────────────────────────────────────────────────────────

export const RESEARCH_CONCEPTS = [
    "smart_money",
    "liquidity",
    "fvg",
    "order_blocks",
    "vwap",
    "atr",
    "structure",
    "sessions",
    "momentum",
    "mean_reversion",
] as const;
export type ResearchConcept = (typeof RESEARCH_CONCEPTS)[number];

export const RESEARCH_TRADING_STYLES = ["scalping", "intraday", "swing"] as const;
export type ResearchTradingStyle = (typeof RESEARCH_TRADING_STYLES)[number];

export const RESEARCH_SESSIONS = ["asian", "london", "new_york", "overlap"] as const;
export type ResearchSession = (typeof RESEARCH_SESSIONS)[number];

export const RESEARCH_RISK_PROFILES = ["conservative", "moderate", "aggressive"] as const;
export type ResearchRiskProfile = (typeof RESEARCH_RISK_PROFILES)[number];

export const RESEARCH_PERIODS = ["3M", "6M", "1Y"] as const;
export type ResearchPeriod = (typeof RESEARCH_PERIODS)[number];

export interface ResearchMissionSpec {
    markets: SupportedSymbol[];
    timeframes: Timeframe[];
    tradingStyle: ResearchTradingStyle;
    concepts: ResearchConcept[];
    sessions: ResearchSession[];
    direction: "long" | "short" | "both";
    riskProfile: ResearchRiskProfile;
    historicalPeriod: ResearchPeriod;
    maxCandidates: number;
    requireOOS: boolean;
    requireWalkForward: boolean;
    requireMonteCarlo: boolean;
    /** Optional forward/paper tracking of survivors via the existing Strategy Lab forward-test harness. */
    forwardTesting: boolean;
    /** Configurable research budget — the mission stops gracefully when exhausted. */
    budget: ResearchBudget;
    /** Always false from the engine: research only, never execution. */
    executionEnabled: false;
}

/** Hard per-mission resource ceilings. Enforced deterministically by the orchestrator. */
export interface ResearchBudget {
    maxHypotheses: number;
    maxBacktests: number;
    /** AI (hypothesis/critique) requests; when exhausted the engine falls back to deterministic generation only. */
    maxAIRequests: number;
    maxDurationMs: number;
}

export interface BudgetUsage {
    hypotheses: number;
    backtests: number;
    aiRequests: number;
    startedAt: number;
}

/** Explicit fail-closed states — never fabricate results. */
export type ResearchFailState =
    | "DATA_UNAVAILABLE"
    | "INSUFFICIENT_DATA"
    | "VALIDATION_FAILED"
    | "AI_UNAVAILABLE"
    | "BACKTEST_FAILED"
    | "BUDGET_EXHAUSTED";

export type MissionStage =
    | "data"
    | "hypotheses"
    | "compile"
    | "backtest"
    | "validate"
    | "monte_carlo"
    | "rank"
    | "done";

export const MISSION_STAGES: MissionStage[] = [
    "data",
    "hypotheses",
    "compile",
    "backtest",
    "validate",
    "monte_carlo",
    "rank",
    "done",
];

export type MissionStatus = "draft" | "running" | "paused" | "completed" | "cancelled" | "failed";

export interface MissionStageState {
    stage: MissionStage;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    attempts: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
}

export interface DataQualityReport {
    symbol: SupportedSymbol;
    timeframes: Timeframe[];
    barsByTimeframe: Partial<Record<Timeframe, number>>;
    availableFrom?: number;
    availableTo?: number;
    source: string;
    sufficient: boolean;
    limitations: string[];
}

export interface ResearchMission {
    id: string;
    uid: string;
    name: string;
    spec: ResearchMissionSpec;
    status: MissionStatus;
    stages: MissionStageState[];
    currentStage: MissionStage;
    dataQuality: DataQualityReport | null;
    /** Per-market data quality for multi-market missions. */
    dataQualityByMarket?: Partial<Record<SupportedSymbol, DataQualityReport>>;
    hypothesisCount: number;
    compiledCount: number;
    rejectedCount: number;
    survivorCount: number;
    /** Set when the mission stopped for a fail-closed or budget reason. */
    failState?: ResearchFailState | null;
    budgetUsed: BudgetUsage;
    /** Locked while a work unit runs; RTDB transaction prevents duplicate jobs. */
    lease: { lockedBy: string; lockedAt: number } | null;
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
    lineageNote: string;
}

// ── Hypothesis (AI proposal — untrusted until compiled) ──────────────────────

export type HypothesisSource = "ai" | "local";

export interface StrategyHypothesis {
    id: string;
    missionId: string;
    market: SupportedSymbol;
    timeframes: Timeframe[];
    direction: "long" | "short";
    rationale: string;
    concepts: ResearchConcept[];
    /** Raw structured proposal — validated by the compiler before any use. */
    draft: Record<string, unknown>;
    source: HypothesisSource;
    createdAt: number;
}

// ── Compilation ──────────────────────────────────────────────────────────────

export interface CompilationReport {
    hypothesisId: string;
    valid: boolean;
    errors: string[];
    warnings: string[];
    unsupportedFeatures: string[];
    futureLeakageRisk: boolean;
    strategyId?: string;
}

export interface CompiledCandidate {
    id: string;
    missionId: string;
    hypothesisId: string;
    strategy: Strategy;
    compilation: CompilationReport;
    createdAt: number;
}

// ── Structural fingerprint (deduplication) ───────────────────────────────────

/**
 * Deterministic structural fingerprint of a compiled strategy. Two strategies
 * with the same fingerprint are substantially identical — the engine links
 * them instead of testing duplicates.
 */
export interface StrategyFingerprint {
    value: string;
    /** Candidate id this one was linked to because it is structurally identical. */
    linkedTo: string | null;
}

// ── Evaluation (existing engines' outputs) ───────────────────────────────────

export interface MonteCarloSummary {
    seed: number;
    simulations: number;
    sourceTradeCount: number;
    drawdownP95: number | null;
    returnP5: number | null;
    profitProbability: number | null;
    limitations: string[];
}

/** Deterministic trade-distribution evidence (concentration / regime dependence). */
export interface TradeDistribution {
    monthsCovered: number;
    /** Share of total positive PnL produced by the single best month (0–100). */
    topMonthSharePct: number;
    /** Share of net PnL produced by the single best market regime (0–100). */
    topRegimeSharePct: number;
    /** Fraction of traded months that were net-positive (0–1). */
    profitableMonthShare: number;
    longSharePct: number;
}

/** Execution-assumption sensitivity: same strategy, varied cost model. */
export interface ExecutionVariation {
    baseNet: number;
    spreadDoubledNet: number;
    slippageDoubledNet: number;
}

export interface CandidateEvaluation {
    backtest: {
        /** Reference to the full BacktestResult persisted in Strategy Lab storage. */
        backtestId: string | null;
        metrics: BacktestMetrics;
        config: BacktestConfig;
        executedAt: number;
        distribution: TradeDistribution | null;
        /** Exact window + assumptions recorded for reproducibility. */
        window: { from: number; to: number; bars: number; dataSource?: string } | null;
    } | null;
    validation: {
        outcome: ValidationOutcome;
        oosRequired: boolean;
        walkForwardRequired: boolean;
    } | null;
    monteCarlo: {
        summary: MonteCarloSummary;
        required: boolean;
    } | null;
    robustness: RobustnessScore | null;
    /** Spread/slippage variation runs (null when skipped for budget reasons). */
    executionVariation: ExecutionVariation | null;
}

// ── Research-quality warnings (deterministic; AI may only explain them) ──────

export const RESEARCH_WARNING_TYPES = [
    "parameter_sensitivity",
    "oos_degradation",
    "walk_forward_unstable",
    "insufficient_trades",
    "date_range_dependence",
    "regime_dependence",
    "return_concentration",
    "unrealistic_assumptions",
    "excessive_optimization",
    "missing_validation",
    "monte_carlo_fragile",
    "execution_sensitivity",
] as const;
export type ResearchWarningType = (typeof RESEARCH_WARNING_TYPES)[number];

export interface ResearchWarning {
    type: ResearchWarningType;
    severity: "low" | "medium" | "high";
    message: string;
    evidence: string[];
}

// ── Robustness report (multi-dimension, never hides negative results) ────────

export const ROBUSTNESS_DIMENSIONS = [
    "oos_degradation",
    "walk_forward_stability",
    "monte_carlo_tail",
    "parameter_sensitivity",
    "trade_sample",
    "execution_variation",
    "regime_coverage",
] as const;
export type RobustnessDimension = (typeof ROBUSTNESS_DIMENSIONS)[number];

export interface RobustnessDimensionResult {
    dimension: RobustnessDimension;
    status: "pass" | "concern" | "fail" | "skipped";
    detail: string;
    evidence: string[];
}

export interface RobustnessReport {
    candidateId: string;
    dimensions: RobustnessDimensionResult[];
    warnings: ResearchWarning[];
    /** Summary grade derived from the existing robustness engine + this report. */
    status: "robust" | "concerns" | "fragile" | "incomplete";
    generatedAt: number;
}

export type CandidateLifecycle =
    | "discovered"
    | "hypothesis"
    | "compiled"
    | "backtesting"
    | "backtested"
    | "oos_testing"
    | "walk_forward"
    | "monte_carlo"
    | "robustness_analysis"
    | "ranked"
    | "survivor"
    | "incubated"
    | "forward_testing"
    | "validated"
    | "rejected"
    | "failed"
    | "cancelled";

export type RejectionReason =
    | "compile_failed"
    | "insufficient_trades"
    | "oos_failed"
    | "walk_forward_unstable"
    | "monte_carlo_fragile"
    | "overfit_detected"
    | "below_score_threshold"
    | "duplicate"
    | "data_unavailable";

export interface ResearchCandidate {
    id: string;
    missionId: string;
    uid: string;
    hypothesis: StrategyHypothesis;
    compilation: CompilationReport;
    strategy: Strategy | null;
    evaluation: CandidateEvaluation | null;
    score: ResearchScore | null;
    /** Deterministic research-quality warnings (never hidden). */
    warnings: ResearchWarning[];
    robustnessReport: RobustnessReport | null;
    fingerprint: string;
    /** Set when a structurally identical candidate already exists in this mission. */
    linkedTo: string | null;
    lifecycle: CandidateLifecycle;
    rejectedReason: RejectionReason | null;
    rejectedNotes: string[];
    knowledgeEdges: string[];
    memoryRecordId: string | null;
    incubationStrategyId: string | null;
    forwardTestId: string | null;
    createdAt: number;
    updatedAt: number;
}

// ── Transparent research scoring (not investment advice) ─────────────────────

export interface ResearchScore {
    /** 0–100; deterministic weighted blend of measured factors only. */
    total: number;
    factors: {
        profitFactor: number;
        drawdown: number;
        consistency: number;
        outOfSample: number;
        walkForward: number;
        monteCarlo: number;
        robustness: number;
        sampleSize: number;
    };
    verdict: "strong" | "acceptable" | "weak" | "rejected";
    notes: string[];
}

// ── Mission event log (lineage / audit) ──────────────────────────────────────

/** Structured observability codes (see docs/strategy-research-architecture.md). */
export const RESEARCH_EVENT_CODES = [
    "RESEARCH_CREATED",
    "RESEARCH_STARTED",
    "RESEARCH_PAUSED",
    "RESEARCH_RESUMED",
    "RESEARCH_CANCELLED",
    "RESEARCH_FAILED",
    "RESEARCH_COMPLETED",
    "DATA_LOADED",
    "DATA_UNAVAILABLE",
    "HYPOTHESIS_GENERATED",
    "HYPOTHESIS_REJECTED",
    "STRATEGY_COMPILED",
    "STRATEGY_DEDUPLICATED",
    "BACKTEST_STARTED",
    "BACKTEST_COMPLETED",
    "BACKTEST_FAILED",
    "OOS_STARTED",
    "OOS_COMPLETED",
    "WALK_FORWARD_STARTED",
    "WALK_FORWARD_COMPLETED",
    "MONTE_CARLO_STARTED",
    "MONTE_CARLO_COMPLETED",
    "ROBUSTNESS_COMPLETED",
    "STRATEGY_RANKED",
    "STRATEGY_INCUBATING",
    "STRATEGY_REJECTED",
    "STRATEGY_VALIDATED",
    "BUDGET_EXHAUSTED",
] as const;
export type ResearchEventCode = (typeof RESEARCH_EVENT_CODES)[number];

export interface ResearchEvent {
    id: string;
    missionId: string;
    stage: MissionStage;
    level: "info" | "warn" | "error";
    message: string;
    code?: ResearchEventCode;
    data?: Record<string, string | number | boolean | null>;
    at: number;
}

// ── Knowledge / memory payloads ──────────────────────────────────────────────

export interface MissionKnowledge {
    missionId: string;
    edges: KnowledgeEdge[];
    updatedAt: number;
}

export interface ResearchMemoryLink {
    record: SetupMemoryRecord;
}

// ── Orchestrator result ──────────────────────────────────────────────────────

export interface AdvanceResult {
    missionId: string;
    status: MissionStatus;
    stage: MissionStage;
    didWork: boolean;
    completed: boolean;
    message: string;
    processedCandidates?: number;
}
