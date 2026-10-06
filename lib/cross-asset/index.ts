/**
 * AlgoVault — Cross-Asset Intelligence (Phase 16) public surface.
 *
 * ONE cross-asset system: import from here, never reach into a sub-module for
 * a competing implementation.
 */

export * from "./types";
export * from "./versions";
export * from "./ids";
export {
    computeRelationship,
    rollingObservations,
    classifyStability,
    classifyRelationshipType,
    correlationMatrixCells,
    dataQualityOf,
    formatCoefficient,
    pairKey,
    truncateAt,
    CORRELATION_LABEL_THRESHOLD,
    STABILITY_BREAK_DELTA,
    STABILITY_FLIP_MIN,
    STABILITY_TREND_DELTA,
    QUALITY_GOOD_COVERAGE,
    QUALITY_DEGRADED_COVERAGE,
    type RelationshipResult,
    type RollingObservationSeries,
} from "./relationships";
export {
    computeLeadLag,
    pearsonPValue,
    DEFAULT_LAGS,
    MIN_LEAD_LAG_OBSERVATIONS,
    LEAD_LAG_MIN_COEFFICIENT,
} from "./lead-lag";
export {
    buildClusters,
    detectClusterChanges,
    clusterLabel,
    DEFAULT_CLUSTER_DISTANCE_THRESHOLD,
    type ClusterResult,
    type ClusterChange,
} from "./clustering";
export {
    computeFactors,
    factorValue,
    FACTOR_UNIVERSE,
    MIN_FACTOR_INPUTS,
} from "./factors";
export {
    computeMarketRegime,
    DEFAULT_EQUITY_SYMBOLS,
    CORRELATION_EXPANSION_DELTA,
    RISK_OFF_RETURN,
    RISK_ON_RETURN,
    VOL_HIGH_PERCENTILE,
    VOL_LOW_PERCENTILE,
    type MarketRegimeResult,
} from "./regime";
export {
    generateSignals,
    reconcileSignals,
    activeSignals,
    toRelationshipSummary,
    signalId,
    windowDurationMs,
} from "./events";
export {
    buildMarketGraphSnapshot,
    buildInstrumentNode,
    buildStructureNodes,
    relationshipEdges,
    metadataEdges,
    factorEdges,
    userDefinedEdges,
    diffSnapshots,
    type SnapshotDiff,
} from "./graph";
export {
    buildSymbolCrossAssetContext,
    buildPortfolioImpact,
    buildNarrative,
    crossAssetLimits,
    relationshipChanged,
    MAX_SYMBOL_RELATIONSHIPS,
    RELATIONSHIP_CHANGED_DELTA,
    type PortfolioHolding,
} from "./context";
