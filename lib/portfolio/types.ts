/**
 * AlgoVault — Canonical Portfolio Intelligence domain models (Phase 15).
 *
 * This is the ONE contract for portfolio-level intelligence. It layers above
 * the existing deterministic engines (Risk Engine, Strategy Engine, Backtest /
 * Monte Carlo, market data) and never replaces them.
 *
 * Hard rules encoded in these types:
 *  - The deterministic layer computes financial truth (equity, exposure, PnL,
 *    margin, correlation, risk). AI interprets it; it never replaces it.
 *  - Every numeric field that could be fabricated carries provenance and a
 *    `UNAVAILABLE` alternative rather than a silent estimate.
 *  - Every decision is traceable: evidence, engine versions, data timestamps
 *    and an explicit limitations list.
 *  - Nothing here performs I/O.
 */

import type { EngineVersionReference } from "./versioning";

/* ── Value / provenance primitives ────────────────────────────────────────── */

/**
 * A measured value that always carries when it was measured and how fresh it
 * is. `UNAVAILABLE` is a first-class answer — never an estimate.
 */
export type PortfolioValue<T> =
    | { status: "AVAILABLE"; value: T; calculatedAt: number; dataTimestamp: number }
    | { status: "UNAVAILABLE"; reason: string; calculatedAt: number };

export type FreshnessStatus = "FRESH" | "STALE" | "UNAVAILABLE";

export interface DataFreshness {
    /** ms epoch of the newest underlying datum (quote / position / balance). */
    dataTimestamp: number;
    /** ms epoch when the deterministic calculation ran. */
    calculatedAt: number;
    /** Age of the newest underlying datum in ms at calculation time. */
    dataAgeMs: number;
    freshness: FreshnessStatus;
    /** Human-readable sources and their ages, e.g. "market:XAUUSD H1 · 2s". */
    sources: FreshnessSource[];
    /** Set when freshness is not FRESH. */
    reason?: string;
}

export interface FreshnessSource {
    source: string;
    ageMs: number;
}

/* ── Instruments & asset classes ──────────────────────────────────────────── */

/**
 * Asset classes AlgoVault can reason about. Membership here does NOT mean the
 * platform has data for the class — `supported` reports what actually exists
 * in the instrument registry.
 */
export const ASSET_CLASSES = [
    "FX",
    "METALS",
    "INDICES",
    "COMMODITIES",
    "CRYPTO",
    "EQUITIES",
    "ETFS",
    "OTHER",
] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export interface InstrumentMetadata {
    symbol: string;
    /** `UNAVAILABLE` when the instrument is not in the canonical spec registry. */
    assetClass: AssetClass | "UNAVAILABLE";
    /** ISO-4217 account currency the instrument settles in. */
    currency: string | null;
    /** ISO-4217 currencies the instrument's P&L is exposed to, ordered [base, quote]. */
    currencyPair: [string, string] | null;
    contractSize: number | null;
    /** Unit of value per 1.0 price move for one contract (currency-neutral notional). */
    quoteCurrency: string | null;
}

/* ── Portfolio & accounts ─────────────────────────────────────────────────── */

export type PortfolioKind =
    | "PERSONAL"
    | "STRATEGY"
    | "PAPER"
    | "CHALLENGE"
    | "B2B";

export type AccountKind =
    | "LIVE"
    | "PAPER"
    | "CHALLENGE"
    | "DEMO"
    | "SIMULATOR";

export type AutomationMode =
    | "OBSERVE"
    | "ANALYZE"
    | "RECOMMEND"
    | "APPROVAL_REQUIRED"
    | "PAPER"
    | "AUTOMATED";

/**
 * A Portfolio is NOT a user and NOT an account. One user may own many
 * portfolios; one portfolio spans many accounts, strategies and assets.
 */
export interface Portfolio {
    portfolioId: string;
    userId: string;
    tenantId?: string;
    name: string;
    kind: PortfolioKind;
    baseCurrency: string;
    /** Monotonic version of the *configuration* (allocation, budgets, rules). */
    version: number;
    automationMode: AutomationMode;
    accountIds: string[];
    createdAt: number;
    updatedAt: number;
}

/** Risk budgets are percentages of equity unless stated otherwise. */
export interface PortfolioRiskBudget {
    budgetId: string;
    scope: "PORTFOLIO" | "STRATEGY" | "ASSET_CLASS" | "SYMBOL" | "ACCOUNT";
    /** Scope key: strategyId / asset class / symbol / accountId. Empty for PORTFOLIO. */
    scopeKey: string;
    kind: RiskBudgetKind;
    /** Percent of portfolio equity this budget may consume. */
    limitPercent: number;
    enabled: boolean;
    updatedAt: number;
    updatedBy: string;
}

export type RiskBudgetKind =
    | "DAILY_LOSS"
    | "PORTFOLIO_RISK"
    | "STRATEGY_RISK"
    | "ASSET_CLASS"
    | "SYMBOL"
    | "DRAWDOWN"
    | "CORRELATION"
    | "MARGIN"
    | "GROSS_EXPOSURE";

export interface RiskBudgetUsage {
    budgetId: string;
    scope: PortfolioRiskBudget["scope"];
    scopeKey: string;
    kind: RiskBudgetKind;
    limitPercent: number;
    /** Percent of equity actually consumed right now. */
    usedPercent: number;
    utilization: number; // usedPercent / limitPercent (0..n)
    status: "OK" | "WATCH" | "BREACHED" | "UNKNOWN";
    note?: string;
}

/* ── Accounts ─────────────────────────────────────────────────────────────── */

/**
 * A normalized account inside a portfolio. Built by the snapshot builder from
 * real RTDB gateway records — never synthesized.
 */
export interface PortfolioAccount {
    accountId: string;
    portfolioId: string;
    userId: string;
    kind: AccountKind;
    broker: string | null;
    server: string | null;
    currency: string;
    balance: number;
    equity: number;
    marginUsed: number;
    freeMargin: number;
    leverage: number;
    unrealizedPnL: number;
    drawdownPercent: number;
    /** ms epoch of the last heartbeat / gateway push. */
    dataTimestamp: number;
    connected: boolean;
    status: "ACTIVE" | "OFFLINE" | "SUSPENDED" | "UNKNOWN";
}

/* ── Positions ────────────────────────────────────────────────────────────── */

export interface PortfolioPosition {
    positionId: string;
    accountId: string;
    symbol: string;
    side: "LONG" | "SHORT";
    /** Lots. */
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    /** Cash risk to stop, in account currency. Null when no SL is recorded. */
    riskAmount: number | null;
    unrealizedPnL: number;
    marginUsed: number;
    /** Notional value at current price, in account currency. */
    notional: number;
    /** Notional as a fraction of portfolio equity. */
    equityWeight: number;
    assetClass: AssetClass | "UNAVAILABLE";
    /** Account/strategy attribution; "MANUAL" when no strategy is recorded. */
    strategyId: string;
    accountCurrency: string;
    /** Account currency exposure implied by this position, signed by side. */
    currencyExposures: Array<{ currency: string; signedEquityWeight: number }>;
    openedAt: number;
    dataTimestamp: number;
}

/* ── Exposure ─────────────────────────────────────────────────────────────── */

export interface PortfolioExposureSlice {
    key: string;
    label: string;
    /** Absolute notional share of gross exposure (0..1). */
    grossWeight: number;
    /** Signed share of gross exposure (-1..1); null for non-directional axes. */
    signedWeight: number | null;
    grossNotional: number;
    signedNotional: number;
    positionCount: number;
    status: "AVAILABLE" | "UNAVAILABLE";
    reason?: string;
}

export interface PortfolioExposure {
    portfolioId: string;
    calculatedAt: number;
    dataTimestamp: number;
    /** Σ |notional| across open positions. */
    grossExposure: number;
    /** Σ signed notional (long - short). */
    netExposure: number;
    /** grossExposure / equity. Null when equity is unknown. */
    grossToEquity: number | null;
    netToEquity: number | null;
    positionCount: number;
    bySymbol: PortfolioExposureSlice[];
    byAssetClass: PortfolioExposureSlice[];
    byCurrency: PortfolioExposureSlice[];
    byStrategy: PortfolioExposureSlice[];
    byAccount: PortfolioExposureSlice[];
    byDirection: PortfolioExposureSlice[];
    /** Asset classes the platform has instruments for. */
    supportedAssetClasses: AssetClass[];
    unsupportedAssetClasses: AssetClass[];
    freshness: DataFreshness;
    limitations: string[];
}

/* ── Correlation ──────────────────────────────────────────────────────────── */

export type CorrelationMethod = "pearson" | "spearman";

export interface CorrelationPair {
    a: string;
    b: string;
    timeframe: string;
    window: number;
    method: CorrelationMethod;
    /** Observations actually paired (after alignment). */
    observations: number;
    /** null when the pair cannot be computed honestly (insufficient data). */
    coefficient: number | null;
    status: "AVAILABLE" | "INSUFFICIENT_DATA" | "UNAVAILABLE";
    reason?: string;
    /** Classification of the measured relationship. */
    relationship: "STRONG_POSITIVE" | "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "STRONG_NEGATIVE" | "UNKNOWN";
    /** Change vs the previous stored window for the same pair/method/window. */
    previousCoefficient?: number | null;
    /** |Δ| against the previous window. */
    delta?: number | null;
    /** Std-dev of the coefficient across the multi-window set — stability proxy. */
    stability?: number | null;
}

export interface CorrelationMatrix {
    portfolioId: string;
    symbols: string[];
    timeframe: string;
    window: number;
    method: CorrelationMethod;
    /** Matrix[i][j] === pairs for symbols[i] vs symbols[j]; null = not computable. */
    matrix: Array<Array<number | null>>;
    pairs: CorrelationPair[];
    calculatedAt: number;
    dataTimestamp: number;
    freshness: DataFreshness;
    limitations: string[];
}

/** Separate the four epistemic levels the spec demands. */
export interface CorrelationInterpretation {
    kind: "OBSERVED" | "CALCULATED" | "INFERRED" | "HYPOTHESIS";
    text: string;
    evidenceIds: string[];
}

/* ── Correlation risk ─────────────────────────────────────────────────────── */

export interface PortfolioCorrelationRisk {
    portfolioId: string;
    calculatedAt: number;
    /** Number of active positions in the correlated cluster. */
    clusterSize: number;
    /** Share of gross exposure held by the largest positively-correlated cluster. */
    clusteredExposureWeight: number;
    /** Mean pairwise correlation inside the largest cluster (0..1 signed). */
    meanCorrelation: number;
    /** Correlations whose magnitude moved more than the configured threshold. */
    shiftingPairs: Array<{ pair: string; from: number; to: number; delta: number }>;
    severity: "LOW" | "MODERATE" | "HIGH" | "UNKNOWN";
    clusters: CorrelationCluster[];
    evidence: CorrelationInterpretation[];
    limitations: string[];
}

export interface CorrelationCluster {
    symbols: string[];
    meanCorrelation: number;
    exposureWeight: number;
    grossNotional: number;
}

/* ── Concentration ────────────────────────────────────────────────────────── */

export interface ConcentrationAxis {
    axis: "SYMBOL" | "ASSET_CLASS" | "STRATEGY" | "DIRECTION" | "CURRENCY" | "ACCOUNT";
    entries: Array<{ key: string; weight: number; notional: number }>;
    /** Herfindahl–Hirschman Index of the weights (0..1, 1 = fully concentrated). */
    hhi: number;
    /** Effective number of independent bets: 1 / HHI. */
    effectiveCount: number;
    maxEntry: { key: string; weight: number } | null;
    topShare: number;
    /** Share held by the top-3 entries (0..1). */
    topThreeShare: number;
    status: "AVAILABLE" | "UNAVAILABLE";
    reason?: string;
}

export interface PortfolioConcentration {
    portfolioId: string;
    calculatedAt: number;
    dataTimestamp: number;
    axes: ConcentrationAxis[];
    /** Mean HHI across the available axes — documented, not an "AI score". */
    concentrationScore: number;
    maxAxis: ConcentrationAxis["axis"] | null;
    severity: "LOW" | "MODERATE" | "HIGH" | "UNKNOWN";
    limitations: string[];
}

/* ── Regime ───────────────────────────────────────────────────────────────── */

export const PORTFOLIO_REGIMES = [
    "NORMAL",
    "TRENDING",
    "RANGE",
    "HIGH_VOLATILITY",
    "LOW_VOLATILITY",
    "RISK_ON",
    "RISK_OFF",
    "CORRELATION_BREAK",
    "LIQUIDITY_STRESS",
    "UNKNOWN",
] as const;
export type PortfolioRegime = (typeof PORTFOLIO_REGIMES)[number];

export interface PortfolioRegimeState {
    regime: PortfolioRegime;
    /** Deterministic 0..1 support for the active regime. */
    confidence: number;
    /** Every deterministic fact that voted for this regime. */
    evidence: Array<{ id: string; metric: string; observed: number; threshold: number; supports: string }>;
    /** Alternative regimes that scored, for transparency. */
    alternatives: Array<{ regime: PortfolioRegime; score: number }>;
    /** Regimes that could NOT be activated and why (honest negatives). */
    notSupported: string[];
    calculatedAt: number;
    dataTimestamp: number;
}

/* ── Health ───────────────────────────────────────────────────────────────── */

export type HealthRating = "GOOD" | "WATCH" | "WARNING" | "CRITICAL" | "UNKNOWN";

export const PORTFOLIO_HEALTH_COMPONENTS = [
    "RISK",
    "EXPOSURE",
    "CONCENTRATION",
    "CORRELATION",
    "STRATEGY",
    "EXECUTION",
    "DRAWDOWN",
    "DIVERSIFICATION",
    "REGIME",
] as const;
export type PortfolioHealthComponent = (typeof PORTFOLIO_HEALTH_COMPONENTS)[number];

export interface PortfolioHealthComponentState {
    component: PortfolioHealthComponent;
    rating: HealthRating;
    /** 0..1 — how healthy. Documented formula per component, never an AI number. */
    score: number;
    reasons: string[];
    evidence: string[];
}

export interface PortfolioHealth {
    portfolioId: string;
    calculatedAt: number;
    /** Explicitly NOT collapsed to one number; exposed for transparency. */
    components: PortfolioHealthComponentState[];
    /** Worst component rating. */
    overall: HealthRating;
    worstComponents: PortfolioHealthComponent[];
    unavailableComponents: PortfolioHealthComponent[];
    limitations: string[];
}

/* ── Risk snapshot ────────────────────────────────────────────────────────── */

export interface PortfolioRiskSnapshot {
    portfolioId: string;
    calculatedAt: number;
    dataTimestamp: number;
    equity: number | null;
    balance: number | null;
    unrealizedPnL: number | null;
    realizedPnL: number | null;
    /** Σ cash-at-risk of open positions with a recorded stop, in equity currency. */
    openRisk: number | null;
    /** openRisk / equity. */
    openRiskPercent: number | null;
    /** Floating + max(stored, intraday) drawdown in equity currency. */
    drawdown: number | null;
    drawdownPercent: number | null;
    dailyLoss: number | null;
    dailyLossPercent: number | null;
    marginUsed: number | null;
    freeMargin: number | null;
    marginLevelPercent: number | null;
    riskBudgetUsage: RiskBudgetUsage[];
    warnings: PortfolioWarning[];
    freshness: DataFreshness;
    limitations: string[];
}

export type PortfolioWarningCode =
    | "HIGH_CORRELATION"
    | "HIGH_CONCENTRATION"
    | "RISK_BUDGET_NEAR_LIMIT"
    | "RISK_BUDGET_BREACHED"
    | "DRAWDOWN_WARNING"
    | "MARGIN_WARNING"
    | "REGIME_CHANGE"
    | "STRATEGY_OVERLAP"
    | "STALE_DATA"
    | "ACCOUNT_OFFLINE"
    | "POSITION_STATE_INCONSISTENT";

export interface PortfolioWarning {
    code: PortfolioWarningCode;
    severity: "INFO" | "WATCH" | "WARNING" | "CRITICAL";
    message: string;
    detail?: string;
    affectedPositions: string[];
    affectedStrategies: string[];
    dataTimestamp: number;
}

/* ── Canonical snapshot ───────────────────────────────────────────────────── */

/**
 * The authoritative, deterministic input to every portfolio intelligence
 * surface (UI, agents, API, chat, workflows). AI reads this; AI never writes it.
 */
export interface PortfolioSnapshot {
    portfolioId: string;
    timestamp: number;
    equity: number;
    balance: number;
    unrealizedPnL: number;
    realizedPnL: number;
    grossExposure: number;
    netExposure: number;
    marginUsed: number;
    freeMargin: number;
    leverage: number;
    drawdown: number;
    dailyLoss: number;
    positionCount: number;
    strategyCount: number;
    assetCount: number;
    concentrationScore: number;
    correlationRiskScore: number;
    portfolioRiskScore: number;
    regime: PortfolioRegime;
    riskBudgetUsage: RiskBudgetUsage[];
    health: PortfolioHealth;

    /* ── extensions required to make the snapshot self-sufficient ───────── */
    baseCurrency: string;
    accounts: PortfolioAccount[];
    positions: PortfolioPosition[];
    exposure: PortfolioExposure;
    concentration: PortfolioConcentration;
    correlation: PortfolioCorrelationRisk;
    correlationMatrix: CorrelationMatrix | null;
    regimeState: PortfolioRegimeState;
    risk: PortfolioRiskSnapshot;
    /** Per-strategy portfolio state, projected from strategy intelligence. */
    strategyStates: StrategyPortfolioState[];
    freshness: DataFreshness;
    engineVersions: EngineVersionReference[];
    limitations: string[];
}

/* ── Allocation ───────────────────────────────────────────────────────────── */

export type AllocationMethod =
    | "EQUAL"
    | "RISK_BASED"
    | "VOLATILITY_ADJUSTED"
    | "RISK_PARITY"
    | "STRATEGY_BUDGET"
    | "USER_DEFINED";

export interface AllocationInput {
    strategyId: string;
    /** Current capital share (0..1). */
    currentWeight: number;
    /** Realized + unrealized P&L contribution over the measured window. */
    pnlContribution: number | null;
    /** Annualized-ish return volatility of the strategy's realized P&L series. */
    volatility: number | null;
    maxDrawdownPercent: number | null;
    /** OOS-verified Sharpe, or null when no OOS evidence exists. */
    oosSharpe: number | null;
    /** Trade count behind the statistics. */
    sampleSize: number;
    correlationToPortfolio: number | null;
    health: HealthRating;
    active: boolean;
}

export interface AllocationLine {
    strategyId: string;
    method: AllocationMethod;
    targetWeight: number;
    currentWeight: number;
    deltaWeight: number;
    rationale: string[];
    limitations: string[];
}

export interface PortfolioAllocation {
    portfolioId: string;
    method: AllocationMethod;
    inputs: AllocationInput[];
    constraints: AllocationConstraint[];
    lines: AllocationLine[];
    /** Target weights always sum to 1 when a complete input set exists. */
    normalized: boolean;
    calculatedAt: number;
    limitations: string[];
}

export interface AllocationConstraint {
    kind: "MAX_WEIGHT" | "MIN_WEIGHT" | "MIN_SAMPLE_SIZE" | "MAX_CORRELATION" | "HEALTH_FLOOR";
    value: number;
    scope?: string;
    note: string;
}

export type AllocationRecommendationAction =
    | "INCREASE"
    | "MAINTAIN"
    | "REDUCE"
    | "PAUSE"
    | "REVIEW";

export interface PortfolioAllocationRecommendation {
    portfolioId: string;
    generatedAt: number;
    strategyId: string;
    action: AllocationRecommendationAction;
    targetWeight: number;
    currentWeight: number;
    confidence: number;
    rationale: string[];
    evidence: Array<{ id: string; metric: string; observed: number | string; note: string }>;
    /** Always true: allocation output is advice, never an execution instruction. */
    requiresApproval: true;
    permissionRequired: AgentPermissionLevel;
    limitations: string[];
}

/* ── Strategy-to-portfolio intelligence ───────────────────────────────────── */

export type OverlapKind =
    | "STRATEGY"
    | "SIGNAL"
    | "POSITION"
    | "RISK"
    | "CORRELATION"
    | "DRAWDOWN"
    | "REGIME";

export interface StrategyOverlap {
    a: string;
    b: string;
    kind: OverlapKind;
    /** 0..1 overlap magnitude, formula documented per kind. */
    overlap: number;
    detail: string;
    evidence: string[];
    /** Only set when both sides are individually healthy but combine badly. */
    harmfulCombination: boolean;
}

export interface StrategyPortfolioState {
    strategyId: string;
    name: string | null;
    active: boolean;
    openPositions: number;
    grossNotional: number;
    equityWeight: number;
    unrealizedPnL: number;
    maxDrawdownPercent: number | null;
    health: HealthRating;
    oosSharpe: number | null;
    sampleSize: number;
    correlationToPortfolio: number | null;
    dataTimestamp: number;
    limitations: string[];
}

export interface PortfolioStrategyIntelligence {
    portfolioId: string;
    calculatedAt: number;
    strategies: StrategyPortfolioState[];
    overlaps: StrategyOverlap[];
    /** True when every strategy is healthy individually yet the pair overlaps. */
    hiddenConcentrationDetected: boolean;
    limitations: string[];
}

/* ── Stress testing ───────────────────────────────────────────────────────── */

export type ScenarioKind =
    | "VOLATILITY_EXPANSION"
    | "SPREAD_WIDENING"
    | "SLIPPAGE_INCREASE"
    | "CORRELATION_SPIKE"
    | "MARKET_GAP"
    | "DRAWDOWN_SHOCK"
    | "ADVERSE_TREND"
    | "LIQUIDITY_REDUCTION"
    | "SYMBOL_SHOCK";

export type ScenarioBasis = "HISTORICAL" | "SIMULATED";

export interface PortfolioScenario {
    scenarioId: string;
    kind: ScenarioKind;
    name: string;
    basis: ScenarioBasis;
    /** Historical window the shock was measured from, when basis = HISTORICAL. */
    historicalWindow?: { from: number; to: number; symbol: string; source: string };
    parameters: Record<string, number>;
    methodology: string;
}

export interface PortfolioStressTest {
    portfolioId: string;
    stressTestId: string;
    generatedAt: number;
    dataTimestamp: number;
    scenarios: Array<{
        scenario: PortfolioScenario;
        equityBefore: number;
        equityAfter: number;
        pnlImpact: number;
        pnlImpactPercent: number;
        marginAfter: number;
        marginLevelAfterPercent: number | null;
        affectedPositions: Array<{ positionId: string; symbol: string; pnlImpact: number }>;
        breach: boolean;
        breaches: string[];
    }>;
    worstCase: { scenarioId: string; pnlImpact: number; pnlImpactPercent: number } | null;
    method: "HISTORICAL_REPLAY" | "SIMULATED_SHOCK";
    limitations: string[];
}

/* ── Monte Carlo ──────────────────────────────────────────────────────────── */

export interface PortfolioMonteCarloInput {
    /** Observed per-trade portfolio P&L in equity currency. */
    tradePnL: Array<{ netPnL: number; strategyId?: string; regime?: string }>;
    startingEquity: number;
    /** Optional per-strategy P&L used for correlated strategy simulation. */
    strategySeries?: Record<string, number[]>;
}

export interface PortfolioMonteCarloResult {
    portfolioId: string;
    seed: number;
    simulations: number;
    simulationsCompleted: number;
    sourceTradeCount: number;
    method: "shuffle" | "bootstrap" | "correlated_bootstrap";
    endingEquity: DistributionSummary;
    drawdown: DistributionSummary;
    lossStreak: DistributionSummary;
    /** Probability of breaching a drawdown threshold (0..1). */
    thresholdBreachProbability: number | null;
    threshold?: number;
    percentiles: Record<string, number>;
    /** Always present. Monte Carlo is a simulation, never a forecast. */
    disclaimer: "SIMULATION — NOT FORECAST";
    limitations: string[];
}

export interface DistributionSummary {
    min: number;
    p5: number;
    p25: number;
    median: number;
    p75: number;
    p95: number;
    max: number;
    mean: number;
    count: number;
}

/* ── Decisions ────────────────────────────────────────────────────────────── */

export type PortfolioDecisionType =
    | "ALLOW"
    | "ALLOW_WITH_WARNING"
    | "BLOCK"
    | "REVIEW"
    | "REBALANCE_RECOMMENDATION";

export type AgentPermissionLevel =
    | "READ_ONLY"
    | "LOW_RISK"
    | "USER_CONFIRMATION"
    | "HIGH_RISK"
    | "LIVE_TRADING";

export interface PortfolioDecisionEvidence {
    id: string;
    kind: "OBSERVED" | "CALCULATED" | "INFERRED" | "SIMULATED" | "RECOMMENDATION";
    source: string;
    detail: string;
    value?: number | string;
    /** Engine that produced the underlying number. */
    engine?: string;
}

export interface RiskImpact {
    rating: "LOW" | "MODERATE" | "HIGH" | "SEVERE" | "UNKNOWN";
    incrementalRiskAmount: number | null;
    incrementalRiskPercent: number | null;
    budgetsAtRisk: string[];
    drawdownImpactPercent: number | null;
}

export interface PortfolioImpact {
    incrementalGrossExposure: number | null;
    incrementalNetExposure: number | null;
    grossExposureAfter: number | null;
    grossToEquityAfter: number | null;
    concentrationAfter: number | null;
    correlationAfter: number | null;
    marginAfter: number | null;
    affectedCurrencies: string[];
    affectedAssetClasses: string[];
}

export interface PortfolioDecision {
    portfolioId: string;
    decisionId: string;
    decision: PortfolioDecisionType;
    confidence: number;
    evidence: PortfolioDecisionEvidence[];
    affectedPositions: string[];
    affectedStrategies: string[];
    riskImpact: RiskImpact;
    portfolioImpact: PortfolioImpact;
    limitations: string[];
    generatedAt: number;
    dataTimestamp: number;
    engineVersions: EngineVersionReference[];
    permissionRequired: AgentPermissionLevel;
    /** Set when the deterministic layer could not produce a confident answer. */
    degraded?: boolean;
    degradedReason?: string;
}

/* ── Trade pre-check ──────────────────────────────────────────────────────── */

export type TradePreCheckVerdict =
    | "TRADE_ACCEPTABLE"
    | "TRADE_WARNING"
    | "TRADE_BLOCKED"
    | "TRADE_REQUIRES_APPROVAL";

export interface ProposedTrade {
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    entryPrice: number;
    stopLoss?: number | null;
    strategyId?: string;
    accountId?: string;
}

export interface PortfolioTradePreCheck {
    portfolioId: string;
    verdict: TradePreCheckVerdict;
    individualTradeRisk: "LOW" | "MODERATE" | "HIGH" | "UNKNOWN";
    portfolioImpact: "LOW" | "MODERATE" | "HIGH" | "UNKNOWN";
    reasons: string[];
    blockingReasons: string[];
    warningReasons: string[];
    decision: PortfolioDecision;
    dataTimestamp: number;
    freshness: DataFreshness;
}

/* ── Agents ───────────────────────────────────────────────────────────────── */

export interface PortfolioAgentRun {
    runId: string;
    portfolioId: string;
    agentId: string;
    agentVersion: string;
    status: "success" | "failed" | "skipped" | "blocked";
    permission: AgentPermissionLevel;
    summary: string;
    confidence: number;
    findings: Array<{ id: string; title: string; detail: string; evidence: string[] }>;
    evidence: Array<{ id: string; source: string; value: number | string; note: string }>;
    limitations: string[];
    startedAt: number;
    completedAt: number;
    dataTimestamp: number;
}

export interface PortfolioAgentTeamResult {
    portfolioId: string;
    generatedAt: number;
    dataTimestamp: number;
    agents: PortfolioAgentRun[];
    /** Supervisor's synthesized recommendation. */
    recommendations: PortfolioAllocationRecommendation[];
    decisions: PortfolioDecision[];
    warnings: PortfolioWarning[];
    permissionRequired: AgentPermissionLevel;
    requiresApproval: boolean;
    limitations: string[];
}

/* ── Memory & journal ─────────────────────────────────────────────────────── */

export type PortfolioMemoryKind =
    | "PORTFOLIO_STATE"
    | "RECURRING_CONCENTRATION"
    | "RECURRING_CORRELATION"
    | "SUCCESSFUL_ALLOCATION"
    | "FAILED_ALLOCATION"
    | "RISK_PREFERENCE"
    | "PORTFOLIO_DECISION"
    | "REGIME_RESPONSE";

export interface PortfolioMemoryEntry {
    memoryId: string;
    portfolioId: string;
    kind: PortfolioMemoryKind;
    /** Structured facts only. Free-text speculation is rejected at write time. */
    facts: Record<string, string | number | boolean>;
    /** Outcome validation state — speculation can never become permanent truth. */
    validation: "UNVALIDATED" | "VALIDATED" | "REJECTED";
    observedAt: number;
    /** When the entry last matched reality. */
    lastConfirmedAt?: number;
    occurrences: number;
}

/** Historical record of a portfolio decision — never rewritten by hindsight. */
export interface PortfolioJournalEntry {
    entryId: string;
    portfolioId: string;
    type:
        | "PORTFOLIO_DECISION"
        | "ALLOCATION_CHANGE"
        | "RISK_WARNING"
        | "TRADE_REJECTED"
        | "TRADE_APPROVED"
        | "STRESS_TEST"
        | "STRATEGY_INTERACTION"
        | "REGIME_CHANGE"
        | "DRAWDOWN_EVENT"
        | "ALLOCATION_RECOMMENDATION"
        | "USER_OVERRIDE";
    whatAlgoVaultRecommended: string;
    whatTheUserDid: string;
    whatHappenedAfter: string | null;
    evidenceAtDecision: PortfolioDecisionEvidence[];
    /** User's retrospective note about whether the call held up. */
    outcomeAssessment: "SUPPORTED" | "NOT_SUPPORTED" | "PENDING" | "UNKNOWN";
    createdAt: number;
    dataTimestamp: number;
}

/* ── Immutable snapshots & events ─────────────────────────────────────────── */

export type PortfolioSnapshotTrigger =
    | "PORTFOLIO_CREATED"
    | "TRADE_OPENED"
    | "TRADE_CLOSED"
    | "ALLOCATION_CHANGED"
    | "RISK_LIMIT_CHANGED"
    | "DRAWDOWN_THRESHOLD"
    | "REGIME_CHANGE"
    | "STRESS_TEST"
    | "STRATEGY_ADDED"
    | "STRATEGY_REMOVED";

/**
 * Immutable record written on major events. Never updated, never deleted —
 * this is what makes future B2B certification and audit possible.
 */
export interface ImmutablePortfolioSnapshot {
    snapshotId: string;
    portfolioId: string;
    userId: string;
    trigger: PortfolioSnapshotTrigger;
    timestamp: number;
    dataTimestamp: number;
    engineVersions: EngineVersionReference[];
    portfolioVersion: number;
    /** Portfolio configuration as it stood at this instant. */
    configuration: {
        automationMode: AutomationMode;
        riskBudgets: PortfolioRiskBudget[];
        allocation: PortfolioAllocation | null;
    };
    state: PortfolioSnapshot;
}

/** Event freshness metadata shared by every portfolio event. */
export interface PortfolioEventMeta {
    eventId: string;
    portfolioId: string;
    userId: string;
    type: PortfolioEventType;
    eventCreatedAt: number;
    dataTimestamp: number;
    availableAt: number;
    confirmedAt?: number;
    payload: Record<string, unknown>;
}

export type PortfolioEventType =
    | "POSITION_OPENED"
    | "POSITION_CLOSED"
    | "ORDER_FILLED"
    | "PRICE_UPDATE"
    | "CANDLE_COMPLETED"
    | "STRATEGY_SIGNAL"
    | "RISK_THRESHOLD"
    | "DRAWDOWN_CHANGE"
    | "CORRELATION_CHANGE"
    | "REGIME_CHANGE"
    | "STRATEGY_HEALTH_CHANGE"
    | "ACCOUNT_BALANCE_CHANGE"
    | "PORTFOLIO_ALLOCATION_CHANGED"
    | "PORTFOLIO_HEALTH_DEGRADED";

/* ── Chat / AI output contract ────────────────────────────────────────────── */

export interface PortfolioIntelligenceBrief {
    summary: string;
    currentState: string[];
    evidence: PortfolioDecisionEvidence[];
    portfolioImpact: string[];
    risks: string[];
    scenarios: string[];
    recommendation: string[];
    limitations: string[];
    dataFreshness: DataFreshness;
    /** True when AI narration could not be produced and the deterministic core stands. */
    deterministicOnly: boolean;
}
