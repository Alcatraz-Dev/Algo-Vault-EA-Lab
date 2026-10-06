/**
 * AlgoVault — Global Cross-Asset Intelligence Graph (Phase 16 §3).
 *
 * PURE TYPES. This file is the canonical vocabulary for the relationship layer
 * that sits ABOVE the market-data, indicator, strategy, risk and portfolio
 * cores. Nothing here computes anything and nothing here invents data: every
 * value in these structures is produced by a deterministic engine elsewhere in
 * `lib/cross-asset/` from real market data, real portfolio state or an explicit
 * user configuration.
 *
 * Design rules encoded in these types:
 *   • every relationship carries `evidence` — a relationship with no evidence
 *     is not a relationship, it is a guess;
 *   • every calculation is stamped with BOTH `dataTimestamp` (the last market
 *     datum it used) and `calculatedAt` (when the engine ran), so point-in-time
 *     reproduction is possible;
 *   • anything that could not be computed is `null` / `INSUFFICIENT_DATA` /
 *     `UNKNOWN` — never zero, never a silent default;
 *   • user-declared links are always labelled `USER_DEFINED` and never mixed
 *     into measured values.
 */

import type { AssetClass } from "@/lib/portfolio/types";

/* ── Evidence (Phase 16 §5, §30) ──────────────────────────────────────────── */

/**
 * How a claim was produced. Mirrors the AI output contract (§30):
 * OBSERVED   — a raw measured value from market/portfolio data.
 * CALCULATED — derived deterministically from OBSERVED values.
 * CONFIGURED — came from an explicit configuration (thresholds, weights).
 * USER_DEFINED — declared by the user; never presented as measured.
 * INFERENCE  — an interpretation over OBSERVED/CALCULATED evidence only.
 * HISTORICAL — a point-in-time value replayed from a stored snapshot.
 */
export type EvidenceKind =
    | "OBSERVED"
    | "CALCULATED"
    | "CONFIGURED"
    | "USER_DEFINED"
    | "INFERENCE"
    | "HISTORICAL"
    /** A proposed action — always labelled as such, never as measured data. */
    | "RECOMMENDATION";

export interface Evidence {
    id: string;
    kind: EvidenceKind;
    /** One factual sentence. Must be recomputable from `source` inputs. */
    text: string;
    /** Engine or dataset that produced the claim, e.g. `relationship:pearson`. */
    source?: string;
    /** Last market datum used, ms. Absent for configuration evidence. */
    dataTimestamp?: number;
    /** Optional measured value backing the text (e.g. the coefficient). */
    value?: number;
}

/* ── Data quality (Phase 16 §45) ──────────────────────────────────────────── */

export type DataQualityStatus = "GOOD" | "DEGRADED" | "INSUFFICIENT_DATA" | "UNAVAILABLE";

export interface DataQuality {
    /** Paired observations actually used. */
    sampleSize: number;
    /** Bars the window asked for. */
    requiredBars: number;
    /** share of required bars that had aligned data, 0..1. */
    dataCoverage: number;
    /** requiredBars − sampleSize (≥ 0). */
    missingBars: number;
    status: DataQualityStatus;
    /** Human-readable reason whenever status is not GOOD. */
    reason?: string;
}

/* ── Nodes (Phase 16 §3) ──────────────────────────────────────────────────── */

/**
 * What kind of thing the node is. `INSTRUMENT` nodes are the only ones that
 * carry market prices; every other kind exists so the graph can express
 * structure (asset classes, currencies), derived concepts (factors, regimes)
 * and the user's own objects (portfolio, strategies).
 */
export type MarketNodeKind =
    | "INSTRUMENT"
    | "ASSET_CLASS"
    | "CURRENCY"
    | "FACTOR"
    | "REGIME"
    | "PORTFOLIO"
    | "STRATEGY"
    | "CLUSTER";

export interface MarketNode {
    id: string;
    kind: MarketNodeKind;
    /** Canonical symbol for INSTRUMENT nodes (upper case). */
    symbol?: string;
    assetClass?: AssetClass | "UNAVAILABLE";
    /** e.g. `EURUSD` → base currency EUR (instrument nodes only, when known). */
    currency?: string;
    /** ISO region code when real metadata exists (e.g. `US`), else absent. */
    region?: string;
    label: string;
    /** Metadata contract version — bumped when node construction changes. */
    metadataVersion: string;
    /** Whether this node can be a correlation endpoint (needs price series). */
    measurable: boolean;
}

/* ── Relationship windows (Phase 16 §6) ───────────────────────────────────── */

/** Rolling windows supported by the relationship engine (bars on a timeframe). */
export const RELATIONSHIP_WINDOWS = [20, 50, 100, 250, 500] as const;
export type RelationshipWindowBars = (typeof RELATIONSHIP_WINDOWS)[number];

/** Timeframes relationships may be computed on — only when real data exists. */
export const RELATIONSHIP_TIMEFRAMES = ["M5", "M15", "M30", "H1", "H4", "D1"] as const;
export type RelationshipTimeframe = (typeof RELATIONSHIP_TIMEFRAMES)[number];

export interface RelationshipWindow {
    timeframe: RelationshipTimeframe;
    bars: RelationshipWindowBars;
}

/** Term label derived from window length (§6). */
export type RelationshipTerm = "SHORT_TERM" | "MEDIUM_TERM" | "LONG_TERM" | "UNKNOWN";

export function relationshipTerm(bars: RelationshipWindowBars): RelationshipTerm {
    if (bars <= 50) return "SHORT_TERM";
    if (bars <= 250) return "MEDIUM_TERM";
    if (bars === 500) return "LONG_TERM";
    return "UNKNOWN";
}

/* ── Observations (Phase 16 §5) ───────────────────────────────────────────── */

/** One measured coefficient inside one window. */
export interface RelationshipObservation {
    id: string;
    /** Rolling window end (last bar used), ms — this IS the observation time. */
    observedAt: number;
    window: RelationshipWindow;
    method: "pearson" | "spearman";
    coefficient: number | null;
    sampleSize: number;
    dataQuality: DataQuality;
    note?: string;
}

/* ── Edges / relationships (Phase 16 §3, §4) ──────────────────────────────── */

export type MarketRelationshipType =
    | "CORRELATION"
    | "INVERSE_CORRELATION"
    | "LEAD_LAG"
    | "EXPOSURE"
    | "CURRENCY"
    | "SECTOR"
    | "ASSET_CLASS"
    | "USER_DEFINED";

/**
 * Stability of a relationship across consecutive rolling observations
 * (Phase 16 §7). Thresholds are documented in `relationships.ts`
 * (STABILITY_* constants) — they are printed, not hidden.
 */
export type RelationshipStability =
    | "STABLE"
    | "STRENGTHENING"
    | "WEAKENING"
    | "BREAKING"
    | "FLIPPING"
    | "UNKNOWN";

export interface MarketEdge {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    relationshipType: MarketRelationshipType;
    /** |coefficient| in 0..1 for measured edges; 1 for declared edges. */
    strength: number;
    /** Signed coefficient for measured correlation edges; null otherwise. */
    coefficient: number | null;
    window: RelationshipWindow;
    term: RelationshipTerm;
    stability: RelationshipStability;
    /** Last market datum used, ms. */
    dataTimestamp: number;
    calculatedAt: number;
    /** 0..1 — how much evidence backs this edge (measured edges only). */
    confidence: number;
    evidence: RelationshipObservation[];
    /** Narrative evidence lines (measured + configured + user). */
    claims: Evidence[];
    dataQuality: DataQuality;
    /** Present only for LEAD_LAG edges. */
    leadLag?: LeadLagResult;
    /** True when a human declared this edge. */
    userDefined: boolean;
}

/* ── Lead-lag (Phase 16 §9) ───────────────────────────────────────────────── */

export interface LeadLagLagResult {
    lag: number;
    coefficient: number | null;
    pValue: number | null;
    sampleSize: number;
}

export interface LeadLagResult {
    /** Symbol whose returns precede `target`. */
    leader: string;
    follower: string;
    lag: number;
    coefficient: number;
    pValue: number | null;
    sampleSize: number;
    period: { from: number; to: number };
    lagsTested: number[];
    perLag: LeadLagLagResult[];
    /** Same lag ranks first in both half-samples? */
    stable: boolean;
    stabilityNote: string;
    /** ALWAYS populated — lead-lag is observation, never prediction. */
    limitations: string[];
}

/* ── Stability / regime of a relationship (Phase 16 §7, §8) ───────────────── */

export type RelationshipRegime = "PERSISTENT" | "WEAKENING" | "BREAKING" | "FLIPPING" | "UNKNOWN";

/* ── Clusters (Phase 16 §11, §12) ─────────────────────────────────────────── */

export type ClusterMethod = "CORRELATION_DISTANCE_AVERAGE_LINKAGE";

export interface MarketCluster {
    id: string;
    label: string;
    memberNodeIds: string[];
    method: ClusterMethod;
    /** Distance cut used, 0..1 (distance = (1 − ρ)/2). */
    distanceThreshold: number;
    /** Mean pairwise coefficient inside the cluster, null when < 2 members. */
    meanCorrelation: number | null;
    window: RelationshipWindow;
    calculatedAt: number;
    dataTimestamp: number;
    dataQuality: DataQuality;
    evidence: Evidence[];
    limitations: string[];
}

/* ── Factors (Phase 16 §13, §14) ──────────────────────────────────────────── */

export type FactorKind = "OBSERVED" | "DERIVED";
export type FactorStatus = "AVAILABLE" | "INSUFFICIENT_DATA" | "UNAVAILABLE";

export interface FactorInput {
    nodeId: string;
    symbol: string;
    /** 0..1 weight used in the derivation (equal weights are declared). */
    weight: number;
    /** Contribution actually used this run (null when the input was missing). */
    used: boolean;
}

export interface MarketFactor {
    id: string;
    name: string;
    kind: FactorKind;
    status: FactorStatus;
    /** Plain-language definition of exactly what is measured. */
    definition: string;
    /** Deterministic formula, e.g. `mean(z(USD-leg returns))`. */
    formula: string;
    inputs: FactorInput[];
    /** Normalised value (z-score or −3..3); null when not computable. */
    value: number | null;
    unit: "ZSCORE" | "PERCENT" | "RATIO";
    window: RelationshipWindow;
    timestamp: number;
    dataTimestamp: number;
    /** 0..1 — fraction of declared inputs actually present. */
    confidence: number;
    evidence: Evidence[];
    limitations: string[];
}

/* ── Regime (Phase 16 §15, §16, §17) ──────────────────────────────────────── */

export type MarketRegimeState =
    | "RISK_ON"
    | "RISK_OFF"
    | "TRENDING"
    | "RANGING"
    | "HIGH_VOLATILITY"
    | "LOW_VOLATILITY"
    | "CORRELATION_EXPANSION"
    | "CORRELATION_COMPRESSION"
    | "LIQUIDITY_STRESS"
    | "DISLOCATION"
    | "TRANSITION"
    | "UNKNOWN";

export type RegimeAxis = "risk" | "volatility" | "correlation" | "trend" | "stress";

export interface RegimeClassification {
    axis: RegimeAxis;
    /** The state measured on this axis. `UNKNOWN` when evidence is missing. */
    state: MarketRegimeState;
    /** Rule confidence 0..1 (normalised rule strength — never a probability). */
    confidence: number;
    evidence: Evidence[];
    limitations: string[];
}

export interface MarketRegimeSnapshot {
    id: string;
    scope: string;
    /** A market can hold several simultaneous states (§15) — no single label. */
    axes: RegimeClassification[];
    /** Convenience: the active state per axis (or UNKNOWN). */
    states: Partial<Record<RegimeAxis, MarketRegimeState>>;
    activeStates: MarketRegimeState[];
    calculatedAt: number;
    dataTimestamp: number;
    window: RelationshipWindow;
    engineVersions: EngineVersions;
    /** Axes that could not be computed at all are named, not silently dropped. */
    notComputed: RegimeAxis[];
    limitations: string[];
}

export interface MarketRegimeTransition {
    id: string;
    axis: RegimeAxis;
    previousState: MarketRegimeState;
    newState: MarketRegimeState;
    timestamp: number;
    dataTimestamp: number;
    evidence: Evidence[];
    confidence: number;
    affectedNodeIds: string[];
}

/* ── Signals / events (Phase 16 §18) ──────────────────────────────────────── */

export type CrossAssetSignalType =
    | "CORRELATION_BREAK"
    | "RELATIONSHIP_FLIP"
    | "RELATIONSHIP_STRENGTHENING"
    | "RELATIONSHIP_WEAKENING"
    | "REGIME_SHIFT"
    | "VOLATILITY_EXPANSION"
    | "VOLATILITY_COMPRESSION"
    | "CLUSTER_CHANGE"
    | "LEAD_LAG_OBSERVATION";

export type CrossAssetSignalStatus = "DETECTED" | "CONFIRMED" | "EXPIRED" | "INVALIDATED";

export interface CrossAssetSignal {
    id: string;
    type: CrossAssetSignalType;
    sourceNodes: string[];
    targetNodes: string[];
    evidence: Evidence[];
    timestamp: number;
    dataTimestamp: number;
    /** 0..1 rule confidence. Never a probability, never a trade signal. */
    confidence: number;
    status: CrossAssetSignalStatus;
    /** Window this signal was measured on. */
    window: RelationshipWindow;
    /** Set when the signal was confirmed by a later observation. */
    confirmedAt?: number;
    expiresAt?: number;
    /** Human-readable summary that always states the measured numbers. */
    summary: string;
}

/** Alias used by the event store (Phase 16 §18 keeps one shape). */
export type CrossAssetEvent = CrossAssetSignal;

/* ── Per-symbol context (Phase 16 §19, §20) ───────────────────────────────── */

export interface SymbolRelationshipSummary {
    nodeId: string;
    symbol: string;
    label: string;
    coefficient: number | null;
    stability: RelationshipStability;
    term: RelationshipTerm;
    window: RelationshipWindow;
    sampleSize: number;
    dataQuality: DataQualityStatus;
    changed: boolean;
}

export interface PortfolioCrossAssetImpact {
    /** How much of the book shares this symbol's relationships. */
    relatedExposureWeight: number;
    /** Symbols actually held that sit inside this symbol's clusters. */
    correlatedHoldings: string[];
    /** Declared concentration warnings (evidence-backed, may be empty). */
    warnings: Evidence[];
    /** HOLDINGS | NONE — no positions means no impact to report. */
    status: "AVAILABLE" | "NO_HOLDINGS" | "UNAVAILABLE";
    limitations: string[];
}

export interface SymbolCrossAssetContext {
    symbol: string;
    calculatedAt: number;
    dataTimestamp: number;
    window: RelationshipWindow;
    /** Only relationships that passed the meaningfulness threshold (§20). */
    relationships: SymbolRelationshipSummary[];
    clusters: MarketCluster[];
    regime: MarketRegimeSnapshot | null;
    factors: MarketFactor[];
    signals: CrossAssetSignal[];
    portfolioImpact: PortfolioCrossAssetImpact | null;
    /** Evidence lines in the §30 contract shape (Observed / Calculated / …). */
    narrative: Evidence[];
    dataQuality: DataQuality;
    limitations: string[];
    engineVersions: EngineVersions;
}

/* ── Graph snapshot (Phase 16 §43) ────────────────────────────────────────── */

export interface EngineVersions {
    marketData: string;
    relationship: string;
    regime: string;
    factor: string;
    graph: string;
    /** Versions of the engines that contributed, when known. */
    correlation?: string;
    portfolio?: string;
}

export interface MarketGraphSnapshot {
    snapshotId: string;
    /** `global` for the shared universe; `user:{uid}` for private state. */
    scope: string;
    nodes: MarketNode[];
    edges: MarketEdge[];
    clusters: MarketCluster[];
    factors: MarketFactor[];
    regime: MarketRegimeSnapshot | null;
    signals: CrossAssetSignal[];
    /** Symbols that could not be loaded, with the reason. */
    unavailableSymbols: Array<{ symbol: string; reason: string }>;
    window: RelationshipWindow;
    createdAt: number;
    dataTimestamp: number;
    engineVersions: EngineVersions;
    dataQuality: DataQuality;
    /** Performance + failure counters (Phase 16 §54). */
    observability: GraphObservability;
    limitations: string[];
}

export interface GraphObservability {
    /** Wall-clock ms spent loading market data. */
    loadDataMs: number;
    /** Wall-clock ms spent computing relationships/clusters/factors/regime. */
    computeMs: number;
    relationshipFailures: number;
    staleRelationships: number;
    cacheHits: number;
    cacheMisses: number;
    nodeCount: number;
    edgeCount: number;
}

/* ── User-defined relationships (Phase 16 §4) ─────────────────────────────── */

export interface UserDefinedRelationship {
    id: string;
    userId: string;
    sourceSymbol: string;
    targetSymbol: string;
    /** Declared direction of the relationship, for the user's own notes. */
    declaredType: "POSITIVE" | "NEGATIVE" | "LEADS" | "EXPOSED";
    note: string;
    createdAt: number;
    updatedAt: number;
    /** Always true downstream — user links never become measured edges. */
    userDefined: true;
}

/* ── Relationship memory (Phase 16 §42) ───────────────────────────────────── */

export interface RelationshipMemoryRecord {
    id: string;
    pairKey: string;
    pair: [string, string];
    observedBehavior: string;
    recentBehavior: string;
    historicalContext: string;
    /** How many times a similar condition was observed in stored history. */
    similarObservations: number;
    samples: Array<{ at: number; coefficient: number | null; stability: RelationshipStability }>;
    updatedAt: number;
    limitations: string[];
}

/* ── Free vs Pro (Phase 16 §51) ───────────────────────────────────────────── */

export type CrossAssetTier = "FREE" | "PRO";

export interface CrossAssetLimits {
    maxSymbols: number;
    maxWindows: number;
    leadLag: boolean;
    clusters: boolean;
    regime: boolean;
    factors: boolean;
    explorer: boolean;
    research: boolean;
}
