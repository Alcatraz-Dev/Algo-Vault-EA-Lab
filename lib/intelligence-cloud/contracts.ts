/**
 * Intelligence Cloud — Canonical Intelligence Contract (Phase 13)
 *
 * ONE contract for every delivery channel: consumer app, mobile, public API,
 * SDK, webhooks, B2B and white-label. The API layer is a delivery mechanism,
 * never a source of truth — every field below is populated from a canonical
 * engine (market-data, market-core indicators, smart-money, strategy-engine,
 * research, risk, AI router).
 *
 * Design rules enforced here:
 *  - No undocumented fields. Anything not in this file is not contract.
 *  - Every response states its own limitations. Silence about limits is a lie.
 *  - Every response is traceable: engineVersions + dataLineage + optional
 *    snapshotId answer "what did AlgoVault know when this was generated?".
 *  - No field may claim guaranteed performance, certainty or future outcomes.
 */

/** Current public intelligence contract version. Path is `/api/v1/*`. */
export const INTELLIGENCE_API_VERSION = "v1" as const;
/** Internal (non-public) facade version, used by the unversioned `/api/intelligence/v2` routes. */
export const INTELLIGENCE_LEGACY_API_VERSION = "v2" as const;

export type IntelligenceApiVersion =
    | typeof INTELLIGENCE_API_VERSION
    | typeof INTELLIGENCE_LEGACY_API_VERSION;

/** All versioned API roots that are currently served. `/api/v2` may be added here later. */
export const SUPPORTED_API_VERSIONS = [INTELLIGENCE_API_VERSION] as const;
export type SupportedApiVersion = (typeof SUPPORTED_API_VERSIONS)[number];

// ── Instrument ──────────────────────────────────────────────────────────────

export interface InstrumentContext {
    symbol: string;
    timeframe: string;
    /** Exchange/venue label when the data provider discloses one. */
    exchange?: string;
    /** Data provider that actually served the numbers (e.g. "biquote", "twelvedata"). */
    dataSource?: string;
}

// ── Market state ────────────────────────────────────────────────────────────

/**
 * Freshness classification of the underlying data.
 * `unavailable` and `stale` must surface as errors on freshness-sensitive
 * endpoints rather than being silently served as current intelligence.
 */
export type FreshnessStatus = "fresh" | "stale" | "unavailable";

export interface MarketState {
    /** Price at dataTimestamp. Mid price when bid/ask are unavailable. */
    price?: number;
    bid?: number;
    ask?: number;
    spread?: number;
    /** ms epoch of the last candle/quote that backs this response. */
    timestamp: number;
    /** Age of the backing data at response time (ms). */
    dataAgeMs?: number;
    freshness?: FreshnessStatus;
    trend?: "bullish" | "bearish" | "neutral" | "unknown";
    session?: string;
    sessionState?: "pre" | "open" | "close" | "post" | "unknown";
    marketStatus?: "open" | "closed" | "pre_market" | "post_market";
}

// ── Structure / liquidity ───────────────────────────────────────────────────

export interface StructureState {
    bias?: "bullish" | "bearish" | "neutral" | "unknown";
    label?: string;
    /** Most recent structural event, e.g. "BOS", "CHOCH". */
    lastEvent?: string;
    lastEventAt?: number;
    higherHighs?: number;
    higherLows?: number;
    lowerHighs?: number;
    lowerLows?: number;
    /** Timestamps of the swings that define the current structure leg. */
    lastSwingHigh?: number;
    lastSwingLow?: number;
}

export interface LiquidityState {
    /** Detected liquidity pools, ordered by proximity to price. */
    pools?: Array<{ price: number; side: "high" | "low"; strength?: number; detectedAt: number }>;
    sweeps?: Array<{ side: "high" | "low"; price: number; timestamp: number; strength?: number }>;
    state?: "tight" | "normal" | "expanding" | "contracting" | "unknown";
    fvgActive?: number;
    orderBlocksActive?: number;
}

// ── Indicators ──────────────────────────────────────────────────────────────

export type IndicatorSignal = "buy" | "sell" | "neutral" | "none";

export interface IndicatorSnapshot {
    /** Indicator registry id, e.g. "rsi", "macd", "vwap". */
    name: string;
    /** Definition version used for this computation (reproducibility). */
    version?: string;
    /** Latest value; `null` while the series is still warming up. */
    value?: number | null;
    /** Named outputs for multi-output indicators (e.g. macd → line/signal/histogram). */
    outputs?: Record<string, number | null>;
    signal?: IndicatorSignal;
    params?: Record<string, number>;
    /** Candle timestamp the value belongs to. */
    timestamp?: number;
}

// ── Smart money ─────────────────────────────────────────────────────────────

export interface SmartMoneySnapshot {
    engineVersion?: string;
    bias?: "bullish" | "bearish" | "neutral" | "unknown";
    premiumDiscount?: "premium" | "discount" | "equilibrium" | "unknown";
    dealingRange?: { high: number; low: number; equilibrium?: number } | null;
    primarySession?: string;
    activeSessions?: string[];
    fvgZones?: number;
    orderBlocks?: number;
    liquidityPools?: number;
    /** Highest-strength active zone price, when one exists. */
    nearestZone?: { price: number; direction: string; status: string } | null;
}

// ── Regime ──────────────────────────────────────────────────────────────────

export interface MarketRegime {
    /** Engine-assigned regime label. */
    regime?: string;
    /**
     * Engine confidence 0..1 in the classification — NOT a probability of profit.
     * Consumers must not read this as an outcome forecast.
     */
    confidence?: number;
    /** Volatility bucket derived from the same engine pass. */
    volatility?: "low" | "normal" | "high" | "extreme" | "unknown";
    description?: string;
}

// ── Setups ──────────────────────────────────────────────────────────────────

export type SetupStatus = "forming" | "confirmed" | "invalidated" | "expired";

/**
 * A setup is an observation with evidence, never a prediction or a promise.
 * `quality` is a rule-based score from the deterministic detector, and
 * `limitations` always accompanies it.
 */
export interface SetupSnapshot {
    setupId: string;
    strategyId?: string;
    strategyVersion?: string;
    symbol: string;
    timeframe: string;
    direction: "long" | "short";
    status: SetupStatus;
    /** Rule-based quality score 0..100 from the detector. Not a success probability. */
    quality?: number;
    entryContext?: Record<string, unknown>;
    /** Price/condition that proves the setup wrong. */
    invalidation?: Record<string, unknown>;
    /** Deterministic facts that produced this setup. */
    evidence?: Array<{ kind: string; detail: string; timestamp?: number }>;
    createdAt: number;
    updatedAt?: number;
    limitations?: string[];
}

// ── Risk ────────────────────────────────────────────────────────────────────

export interface RiskState {
    /** Account-level risk envelope, only present when the caller may read risk. */
    maxRiskPercent?: number;
    currentRiskPercent?: number;
    openPositions?: number;
    dailyLossUsedPercent?: number;
    /** Hard blocks currently enforced by the risk engine. */
    blocks?: string[];
    asOf?: number;
}

// ── Lineage ─────────────────────────────────────────────────────────────────

/** One row per canonical engine that contributed to the response. */
export interface DataLineageEntry {
    /** Registry id from the engine version registry (e.g. "market-data", "smart-money"). */
    source: string;
    engineVersion: string;
    /** Oldest and newest market datum the computation consumed. */
    dataPeriodStart: number;
    dataPeriodEnd: number;
    /** When this intelligence layer produced the derived value. */
    transformedAt: number;
    /** Explicit assumptions/approximations, e.g. "VWAP anchored to session open". */
    assumptions?: string[];
}

export interface EngineVersions {
    market: string;
    indicators: string;
    smartMoney: string;
    strategy?: string;
    risk?: string;
    intelligence?: string;
    research?: string;
    aiRouter?: string;
}

// ── Cost metadata ───────────────────────────────────────────────────────────

/**
 * Relative compute cost of an operation. Used for quota enforcement, job
 * scheduling and caching — never to trade away correctness.
 */
export type ComputationCost = "LOW" | "MEDIUM" | "HIGH";

export interface CostMetadata {
    cost: ComputationCost;
    /** Billable unit weight (1 = one low-cost call). Always actual, never invented. */
    units: number;
    /** True when the response was served from a deterministic cache. */
    cached?: boolean;
}

// ── Request / response ──────────────────────────────────────────────────────

/** Which optional intelligence blocks the caller asked for. */
export interface IntelligenceRequestContext {
    indicators?: string[];
    smartMoney?: boolean;
    structure?: boolean;
    liquidity?: boolean;
    regime?: boolean;
    volatility?: boolean;
    session?: boolean;
    setupDetection?: boolean;
    risk?: boolean;
}

export interface IntelligenceRequest {
    symbol: string;
    timeframe: string;
    /** ms epoch to evaluate as-of. Defaults to now. Must not exceed now. */
    timestamp?: number;
    context?: IntelligenceRequestContext;
    /** Include `dataLineage` (default true). */
    includeLineage?: boolean;
    /** Persist and return an immutable `snapshotId` (default true). */
    includeSnapshot?: boolean;
}

/**
 * The single canonical intelligence response.
 *
 * `limitations` is required and must be non-empty whenever any block was
 * degraded, approximated, or omitted. Consumers are expected to surface it.
 */
export interface IntelligenceResponse {
    requestId: string;
    /** ms epoch when the API produced this envelope. */
    timestamp: number;
    /** ms epoch of the newest market datum behind the intelligence. */
    dataTimestamp: number;
    /**
     * Earliest ms epoch at which this result may be treated as valid
     * (e.g. next candle close for forming-candle intelligence). Absent when
     * the result does not depend on a forming candle.
     */
    availableAt?: number;
    instrument: InstrumentContext;
    marketState: MarketState;
    structure?: StructureState;
    liquidity?: LiquidityState;
    indicators?: IndicatorSnapshot[];
    smartMoney?: SmartMoneySnapshot;
    regime?: MarketRegime;
    setups?: SetupSnapshot[];
    risk?: RiskState;
    /** Non-empty whenever anything was degraded, approximated or omitted. */
    limitations: string[];
    engineVersions: EngineVersions;
    dataLineage?: DataLineageEntry[];
    /** Immutable snapshot reference answering "what did AlgoVault know?". */
    snapshotId?: string;
    cost?: CostMetadata;
    apiVersion: string;
}

// ── Strategy validation ─────────────────────────────────────────────────────

export interface StrategyValidationRequest {
    definition: unknown;
    symbol?: string;
    timeframe?: string;
    context?: { backtestRange?: string; oosRange?: string };
}

export interface StrategyValidationResult {
    valid: boolean;
    issues: Array<{ code: string; message: string; severity: "info" | "warning" | "error" }>;
    engineVersions: EngineVersions;
    validatedAt: number;
    /** True when the result can be reproduced from stored inputs + engine versions. */
    reproducible: boolean;
    dataPeriod?: string;
    limitations?: string[];
}

// ── Research ────────────────────────────────────────────────────────────────

export type ResearchJobType = "backtest" | "walk-forward" | "monte-carlo" | "oos";

export interface ResearchJobRequest {
    type: ResearchJobType;
    symbol: string;
    timeframe: string;
    strategyDefinition?: unknown;
    config?: Record<string, unknown>;
}

/**
 * Real asynchronous job state. Progress is only ever derived from work
 * actually observed by the runner — never estimated or invented.
 */
export type JobStatus = "QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface ResearchJobStatus {
    jobId: string;
    tenantId: string;
    type: ResearchJobType;
    symbol: string;
    timeframe: string;
    status: JobStatus;
    /** 0..100, only present once real progress has been observed. */
    progress?: number;
    /** Human-readable stage derived from runner state, e.g. "fold 3/10". */
    stage?: string;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    expiresAt?: number;
    error?: { code: string; message: string };
    /** Set only on COMPLETED. */
    resultRef?: string;
    engineVersions?: EngineVersions;
}

// ── Certification ───────────────────────────────────────────────────────────

export type CertificationStatusLevel =
    | "UNVERIFIED"
    | "TESTED"
    | "OOS_VERIFIED"
    | "ROBUST"
    | "CERTIFIED"
    | "REVIEW_REQUIRED"
    | "EXPIRED"
    | "SUSPENDED"
    | "REVOKED";

export interface CertificationStatus {
    status: CertificationStatusLevel;
    certifiedAt?: number;
    expiresAt?: number;
    reviewedAt?: number;
    dataPeriod?: string;
    engineVersions?: EngineVersions;
    /** Evidence-backed criteria that were actually evaluated. */
    testsPassed?: string[];
    limitations?: string[];
    /** Immutable snapshot backing this certification. */
    snapshotId?: string;
}

// ── Marketplace intelligence ────────────────────────────────────────────────

/**
 * Due diligence for a strategy listing.
 *
 * `verificationStatus` separates what the seller asserted from what AlgoVault
 * independently executed. Any metric that was not computed by an engine MUST be
 * absent — never zero-filled, never defaulted.
 */
export interface MarketplaceDueDiligence {
    strategyId: string;
    strategyVersion?: string;
    verificationStatus: "algovault-verified" | "seller-provided" | "unverified";
    verificationMethod?: string;
    certificationStatus?: CertificationStatus;
    /** Engine-computed metrics. Absent when the test was never run. */
    backtest?: {
        trades: number;
        netReturnPercent?: number;
        maxDrawdownPercent?: number;
        profitFactor?: number;
        expectancy?: number;
        dataPeriodStart?: number;
        dataPeriodEnd?: number;
    };
    oos?: { passed: boolean; netReturnPercent?: number; dataPeriodStart?: number; dataPeriodEnd?: number };
    walkForward?: { windows: number; stability?: number };
    monteCarlo?: { runs: number; survivorshipRate?: number; medianDrawdownPercent?: number };
    robustness?: { passed: boolean; sensitivities?: Array<{ parameter: string; delta: number; netReturnPercent: number }> };
    executionSensitivity?: { passed: boolean; slippageScenarios?: Array<{ slippagePips: number; netReturnPercent: number }> };
    regimePerformance?: Array<{ regime: string; trades: number; netReturnPercent: number }>;
    sampleSize?: number;
    certificationDate?: number;
    reviewDate?: number;
    methodology?: string;
    /** Required. Explains what the evidence does and does not establish. */
    limitations: string[];
}
