/**
 * AlgoVault Strategy Lab — evolution constants (leaf module).
 *
 * These are the vocabulary of the evolutionary loop: the stage list, its
 * labels, the survivor thresholds and the work caps. They are declared here,
 * in a module with **zero imports**, for two reasons:
 *
 *   1. **Single source of truth.** `evolution.ts` re-exports every symbol below,
 *      so server code keeps importing from one place and there is no second
 *      copy of a threshold that could drift.
 *   2. **Client boundary.** The DNA & Evolution tab needs to render the stage
 *      list and the thresholds. Importing them from `evolution.ts` would pull
 *      the backtester, feature extractor, validator and robustness scorer —
 *      ~1,500 lines of pure server computation — into the browser bundle.
 *      `import type` cannot help here because these are values, so the leaf
 *      module is the only clean answer.
 *
 * Nothing in this file computes anything. The values are the same ones the
 * engine enforces; a threshold displayed in the UI is therefore the threshold
 * that was actually applied.
 */

/** The stages of the lab pipeline, in execution order. */
export const PIPELINE_STAGES = [
    "market_data",
    "feature_extraction",
    "strategy_generator",
    "backtest",
    "risk_evaluation",
    "out_of_sample",
    "survivor_selection",
    "mutation",
    "next_generation",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Record<PipelineStage, string> = {
    market_data: "Market Data",
    feature_extraction: "Feature Extraction",
    strategy_generator: "Strategy Generator",
    backtest: "Backtest",
    risk_evaluation: "Risk Evaluation",
    out_of_sample: "Out-of-Sample Validation",
    survivor_selection: "Survivor Selection",
    mutation: "Mutation",
    next_generation: "Next Generation",
};

export type StageStatus = "completed" | "skipped" | "failed";

/** Explicit, not magic numbers scattered through the code. */
export const SURVIVOR_THRESHOLDS = {
    /** Minimum closed trades for a metric set to be considered. */
    minTrades: 20,
    /** Minimum profit factor. */
    minProfitFactor: 1.1,
    /** Minimum expectancy in R. */
    minExpectancyR: 0.05,
    /** Maximum acceptable drawdown, percent. */
    maxDrawdownPct: 35,
} as const;

/** Hard caps so a single request cannot trigger unbounded backtesting. */
export const LIMITS = {
    maxSeeds: 24,
    maxChildrenPerGeneration: 24,
    maxGenerations: 6,
    /** Stop early once the population is this small — no point evolving further. */
    minPopulation: 4,
} as const;
