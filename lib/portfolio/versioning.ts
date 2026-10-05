/**
 * AlgoVault — Portfolio Intelligence engine versions (Phase 15).
 *
 * Every portfolio output carries the versions of the deterministic engines
 * that produced it. A version string that does not come from the engine file
 * itself is a lie, so each constant lives next to the implementation and is
 * re-exported here as the single place the registry reads from.
 */

/** Contract version of the canonical PortfolioSnapshot shape. */
export const PORTFOLIO_CONTRACT_VERSION = "1.0.0";

/** Deterministic exposure engine (gross/net/symbol/asset-class/currency/direction/strategy). */
export const PORTFOLIO_EXPOSURE_ENGINE_VERSION = "1.0.0";

/** Deterministic statistical correlation service (Pearson/Spearman, rolling, multi-window). */
export const PORTFOLIO_CORRELATION_ENGINE_VERSION = "1.0.0";

/** Deterministic concentration engine (HHI + percentage concentration). */
export const PORTFOLIO_CONCENTRATION_ENGINE_VERSION = "1.0.0";

/** Deterministic risk-budget engine. */
export const PORTFOLIO_RISK_BUDGET_ENGINE_VERSION = "1.0.0";

/** Deterministic portfolio health aggregator. */
export const PORTFOLIO_HEALTH_ENGINE_VERSION = "1.0.0";

/** Deterministic portfolio regime classifier. */
export const PORTFOLIO_REGIME_ENGINE_VERSION = "1.0.0";

/** Deterministic allocation engine. */
export const PORTFOLIO_ALLOCATION_ENGINE_VERSION = "1.0.0";

/** Deterministic stress-test engine. */
export const PORTFOLIO_STRESS_ENGINE_VERSION = "1.0.0";

/** Portfolio Monte Carlo (resampling over observed portfolio outcomes). */
export const PORTFOLIO_MONTE_CARLO_ENGINE_VERSION = "1.0.0";

/** Portfolio decision + trade pre-check engine. */
export const PORTFOLIO_DECISION_ENGINE_VERSION = "1.0.0";

/** Strategy-to-portfolio overlap intelligence. */
export const PORTFOLIO_STRATEGY_INTELLIGENCE_VERSION = "1.0.0";

/** Snapshot builder — assembles authoritative portfolio state from account data. */
export const PORTFOLIO_SNAPSHOT_ENGINE_VERSION = "1.0.0";

/** Risk Engine this layer builds on (single source of truth for order-intent risk). */
export const PORTFOLIO_RISK_ENGINE_VERSION = "1.0.0";

/** Every engine version a portfolio decision can reference. */
export const PORTFOLIO_ENGINE_VERSIONS = {
    "portfolio-contract": PORTFOLIO_CONTRACT_VERSION,
    "portfolio-snapshot": PORTFOLIO_SNAPSHOT_ENGINE_VERSION,
    "portfolio-exposure": PORTFOLIO_EXPOSURE_ENGINE_VERSION,
    "portfolio-correlation": PORTFOLIO_CORRELATION_ENGINE_VERSION,
    "portfolio-concentration": PORTFOLIO_CONCENTRATION_ENGINE_VERSION,
    "portfolio-risk-budget": PORTFOLIO_RISK_BUDGET_ENGINE_VERSION,
    "portfolio-health": PORTFOLIO_HEALTH_ENGINE_VERSION,
    "portfolio-regime": PORTFOLIO_REGIME_ENGINE_VERSION,
    "portfolio-allocation": PORTFOLIO_ALLOCATION_ENGINE_VERSION,
    "portfolio-stress": PORTFOLIO_STRESS_ENGINE_VERSION,
    "portfolio-monte-carlo": PORTFOLIO_MONTE_CARLO_ENGINE_VERSION,
    "portfolio-decision": PORTFOLIO_DECISION_ENGINE_VERSION,
    "portfolio-strategy-intelligence": PORTFOLIO_STRATEGY_INTELLIGENCE_VERSION,
    "risk-engine": PORTFOLIO_RISK_ENGINE_VERSION,
} as const;

export type PortfolioEngineId = keyof typeof PORTFOLIO_ENGINE_VERSIONS;

export interface EngineVersionReference {
    id: string;
    version: string;
    sourcePath?: string;
}
