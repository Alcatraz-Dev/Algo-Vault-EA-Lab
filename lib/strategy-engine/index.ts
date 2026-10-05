/**
 * AlgoVault Strategy Engine — public API (Phase 4).
 *
 *   STRATEGY DEFINITION → STRATEGY ENGINE → { BACKTEST | REPLAY | PAPER }
 *                                             └────── LIVE ADAPTER ─────┘
 *
 * Define once, validate, backtest, replay, paper trade, monitor, live trade,
 * review, research, improve — all through this one module.
 */

// Types
export * from "./types";

// Canonical decisions (shared by backtest / forward / replay / paper)
export {
    buildSeriesMap,
    evaluateEntry,
    evaluateRule,
    evaluateRules,
    resolveFeatureAt,
    type EntryEvaluation,
    type EntryGateState,
    type EvaluateEntryInput,
    type FeatureSeries,
    type SeriesMap,
} from "./decisions";

// Simulation mechanics (stops, sizing, costs, exits)
export * from "./simulation";

// Orders / account / risk
export * from "./orders";
export * from "./account";
export {
    evaluateAccountHalt,
    evaluateRisk,
    riskLimitsFromStrategy,
    tradeRiskPct,
    type RiskCheckInput,
} from "./risk";

// Adapters (the only place environment differences live)
export { LiveAdapter, PaperAdapter, SimulationAdapter, type LiveGateway, type PaperAdapterOptions, type PendingQuote, type SimulationAdapterOptions } from "./adapters";

// Engine
export { createManualOnlyStrategy, StrategyEngine, type EngineBarResult, type PendingEntry, type StrategyEngineOptions } from "./engine";

// Context (what a strategy may see)
export { buildStrategyContext, smartMoneyContext, type BuildContextInput } from "./context";

// Traces / debug
export { buildDecisionTrace, formatTrace, TraceBuffer, type BuildTraceInput } from "./trace";

// Validation
export { validateStrategyDefinition, type StrategyValidation, type ValidationIssue } from "./validation";

// Versioning / experiments
export {
    buildExperimentRecord,
    ENGINE_VERSIONS,
    experimentId,
    EXECUTION_MODEL_VERSION,
    INDICATOR_ENGINE_VERSION,
    isReproducible,
    STRATEGY_ENGINE_VERSION,
    strategyVersionManifest,
} from "./versioning";

// Backtest (unified research runner)
export {
    RELIABILITY,
    runResearchBacktest,
    SIMULATION_ASSUMPTIONS,
    type ResearchBacktestAnalytics,
    type ResearchBacktestRequest,
    type ResearchBacktestResult,
} from "./backtest";

// Analytics
export * from "./analytics";

// Replay
export { ReplaySession, type ReplayFrame, type ReplaySessionOptions } from "./replay";

// Paper trading
export { PAPER_TRADING_LABEL, PaperTradingSession, type PaperSessionOptions, type PaperSessionStatus } from "./paper";

// Charts
export { buildStrategyMarkers, DEFAULT_MARKER_TOGGLES, markersForStrategy, type BuildMarkersInput } from "./chart-markers";

// Alerts
export { buildStrategyAlert, strategyAlertConditions, type AlertConditionDescriptor, type BuildAlertInput, type StrategyAlert } from "./alerts";
