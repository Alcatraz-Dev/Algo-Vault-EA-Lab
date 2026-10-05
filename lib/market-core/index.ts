/**
 * AlgoVault Market Intelligence Core (Phase 3).
 *
 * ONE canonical market model → ONE indicator engine → ONE Smart Money engine
 * → ONE intelligence context, consumed by chart, backtest, replay, alerts,
 * strategies, AI, paper and live trading.
 *
 *   lib/market-core/types.ts        canonical candle + result/overlay/object types
 *   lib/market-core/registry.ts     indicatorRegistry / overlayRegistry
 *   lib/market-core/indicators/*    pure math + incremental IndicatorEngine
 *   lib/market-core/overlays.ts     market-coordinate overlays, layers, density
 *   lib/market-core/smart-money/*   deterministic confirmation-aware detectors
 *   lib/market-core/context.ts      structured intelligence context (facts only)
 *   lib/market-core/debug.ts        developer inspector
 */

export * from "./types";
export { Registry, indicatorRegistry, overlayRegistry } from "./registry";

export {
    IndicatorEngine,
    alignedIndicatorSeries,
    mapToTimeline,
    type IndicatorRef,
    type IndicatorInstanceConfig,
    type SeriesChangeKind,
    type SeriesUpdateReport,
} from "./indicators/engine";
export {
    REGISTERED_INDICATORS,
    registerBuiltinIndicators,
    defaultParams,
} from "./indicators/definitions";
export * as indicatorPrimitives from "./indicators/primitives";

export {
    INTELLIGENCE_LAYERS,
    LAYER_BY_ID,
    PRIORITY_RANK,
    overlayPriority,
    selectOverlaysForViewport,
    sortOverlays,
    smartMoneyToOverlay,
    registerBuiltinOverlays,
    type LayerDefinition,
    type DensityOptions,
} from "./overlays";

export {
    SMART_MONEY_VERSION,
    detectSmartMoney,
    visibleAsOf,
    detectedBy,
    statusAsOf,
    SmartMoneyDetector,
    type SmartMoneyConfig,
    type SmartMoneyDetection,
} from "./smart-money/engine";
export { detectPivots, detectStructure, type Pivot, type StructureResult } from "./smart-money/structure";
export { detectLiquidity, type LiquidityResult } from "./smart-money/liquidity";
export { detectFvgs, detectOrderBlocks, detectZones, type ZonesResult } from "./smart-money/zones";
export { detectDealingRange, classifyZone, type DealingRange } from "./smart-money/premium-discount";
export {
    SESSION_WINDOWS,
    sessionsAt,
    primarySession,
    sessionLevels,
    detectSessionLiquidity,
    type SessionWindow,
    type SessionLevel,
} from "./smart-money/sessions";
export { timeframeToMs, closeTimeOf, isForming, inferTimeframe } from "./smart-money/shared";

export { buildIntelligenceContext, type IntelligenceContextInput } from "./context";
export {
    isMarketCoreDebug,
    setMarketCoreDebug,
    describeCandle,
    describeOverlay,
    describeSmartMoney,
    describeIndicators,
    debugSnapshot,
} from "./debug";
