/**
 * Client bridge — re-exports the pure order-flow engines for client
 * components. Everything here is pure computation (no network, no server
 * modules), safe for the browser bundle. The capability resolution for the
 * client reads the canonical provider's declared capabilities synchronously.
 */

import { canonicalOrderFlowProvider } from "./normalizer";
import { deriveFeatureAvailability } from "./types";
import type { FeatureAvailability, OrderFlowFeatureId } from "./types";

export {
    computeVolumeProfile,
    computeSessionProfile,
    computeDailyProfiles,
    computeVisibleRangeProfile,
    computeFixedRangeProfile,
    DevelopingVolumeProfile,
} from "./volume-profile";
export { computeDelta, CumulativeDeltaTracker, detectDeltaDivergences } from "./delta";
export { computeEstimatedDelta, detectEstimatedDeltaDivergences, ESTIMATED_DELTA_METHOD } from "./delta-proxy";
export { computeFootprint } from "./footprint";
export { detectAbsorption } from "./absorption";
export { detectExhaustion } from "./exhaustion";
export { detectLargeTrades } from "./large-trades";
export { detectLiquidityEvents, buildHeatmapState } from "./liquidity";
export { computeGex, gexLevels } from "./gex";
export type { GexResult, OptionQuote, OrderFlowCapabilities } from "./types";
export type { GexLevel } from "./gex/levels";
export { GEX_SUPPORTED_SYMBOLS } from "./options-types";
export type { GexProviderResult } from "./options-types";
export { buildOrderFlowContext, buildOrderFlowConfluence } from "./context-builder";
export { mergeOrderFlowSettings, DEFAULT_ORDER_FLOW_SETTINGS, orderFlowGate, ORDER_FLOW_FLAGS } from "./settings";
export type { OrderFlowSettings } from "./settings";
export type {
    AbsorptionEvent,
    ExhaustionEvent,
    ImbalanceEvent,
    LiquidityEvent,
    LargeTradeEvent,
    OrderFlowContext,
    VolumeProfileResult,
} from "./types";

/** Client-side availability (canonical provider is synchronous). */
export function deriveFeatureAvailabilityClient(): Record<OrderFlowFeatureId, FeatureAvailability> {
    return deriveFeatureAvailability(canonicalOrderFlowProvider.describeCapabilities());
}
