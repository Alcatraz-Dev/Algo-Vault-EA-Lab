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
import type { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
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
    /** Always false from the engine: research only, never execution. */
    executionEnabled: false;
}

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
    hypothesisCount: number;
    compiledCount: number;
    rejectedCount: number;
    survivorCount: number;
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

export interface CandidateEvaluation {
    backtest: {
        metrics: BacktestMetrics;
        config: BacktestConfig;
        executedAt: number;
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
}

export type CandidateLifecycle =
    | "hypothesis"
    | "compiled"
    | "backtested"
    | "validated"
    | "stress_tested"
    | "ranked"
    | "survivor"
    | "incubated"
    | "rejected";

export type RejectionReason =
    | "compile_failed"
    | "insufficient_trades"
    | "oos_failed"
    | "walk_forward_unstable"
    | "monte_carlo_fragile"
    | "overfit_detected"
    | "below_score_threshold";

export interface ResearchCandidate {
    id: string;
    missionId: string;
    uid: string;
    hypothesis: StrategyHypothesis;
    compilation: CompilationReport;
    strategy: Strategy | null;
    evaluation: CandidateEvaluation | null;
    score: ResearchScore | null;
    lifecycle: CandidateLifecycle;
    rejectedReason: RejectionReason | null;
    rejectedNotes: string[];
    knowledgeEdges: string[];
    memoryRecordId: string | null;
    incubationStrategyId: string | null;
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

export interface ResearchEvent {
    id: string;
    missionId: string;
    stage: MissionStage;
    level: "info" | "warn" | "error";
    message: string;
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
