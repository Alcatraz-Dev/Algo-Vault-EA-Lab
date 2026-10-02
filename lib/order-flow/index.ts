/**
 * Order Flow & Market Microstructure Intelligence — public surface.
 *
 * Everything a consumer needs: types, capability resolution, calculation
 * engines, the replay-safe context builder and feature flags/settings.
 * Chart and terminal components consume from here; nothing imports deeper
 * internals directly, keeping the module boundary enforceable.
 */

export * from "./types";
export {
    DEFAULT_ORDER_FLOW_SETTINGS,
    ORDER_FLOW_FLAGS,
    isOrderFlowEnabled,
    orderFlowGate,
    mergeOrderFlowSettings,
    sanitizeOrderFlowSettings,
    type OrderFlowSettings,
    type OrderFlowFeatureFlags,
} from "./settings";
export {
    canonicalCapabilities,
    canonicalOrderFlowProvider,
    availabilityFor,
    overallDataQuality,
    isFeatureUsable,
    resolveFeatureAvailability,
    type OrderFlowDataProvider,
} from "./capabilities";
export { computeVolumeProfile, computeSessionProfile, computeDailyProfiles, computeVisibleRangeProfile, computeFixedRangeProfile, DevelopingVolumeProfile, type VolumeProfileOptions } from "./volume-profile";
export { computeDelta, CumulativeDeltaTracker, detectDeltaDivergences, type DeltaOptions } from "./delta";
export { computeEstimatedDelta, detectEstimatedDeltaDivergences, ESTIMATED_DELTA_METHOD, type EstimatedDeltaOptions } from "./delta-proxy";
export { computeFootprint, detectCellImbalances, detectDiagonalImbalances, type FootprintOptions } from "./footprint";
export { cellImbalanceRatio, dominantSide } from "./imbalance";
export { detectAbsorption, type AbsorptionOptions } from "./absorption";
export { detectExhaustion, type ExhaustionOptions } from "./exhaustion";
export { detectLargeTrades, percentile, type LargeTradeOptions } from "./large-trades";
export { detectLiquidityEvents, detectSweepsAndReplenishment, bookImbalance, buildHeatmapState, type LiquidityOptions } from "./liquidity";
export { classifyByTickRule, classifyByQuoteTest, classificationQuality, type ClassifiedTrade, type TradeClassificationMethod } from "./tick-classifier";
export { buildOrderFlowContext, buildOrderFlowConfluence, type OrderFlowContextInput, type ConfluenceInput } from "./context-builder";
export { orderFlowAtBoundary, ReplayOrderFlow, type ReplayOrderFlowOptions } from "./replay";
export {
    orderFlowToIntelligence,
    scoreOrderFlowForSignal,
    buildSignalExplanation,
    ORDER_FLOW_SOURCE,
    type OrderFlowSignalScore,
} from "./intelligence-adapter";
export { computeGex, blackScholesGamma, gexLevels, assessOptionChain, type GexOptions, type GexLevel } from "./gex";
export {
    validateTrade,
    validateTradeBatch,
    validateL2Level,
    validateL2Snapshot,
    validateOptionQuote,
    validateOptionChain,
    validateCandleForProfile,
} from "./validation";
