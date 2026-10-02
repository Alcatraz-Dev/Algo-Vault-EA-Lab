/**
 * Capability resolution — the single place that turns a provider capability
 * set into per-feature data-quality states consumed by UI, engines and AI.
 *
 * The rule enforced everywhere: if only OHLC + volume exists, Volume Profile
 * is ESTIMATED and Delta/Footprint/Heatmap are UNAVAILABLE — never faked.
 */

export { canonicalOrderFlowProvider } from "./normalizer";
export type { OrderFlowDataProvider } from "./normalizer";

import {
    deriveFeatureAvailability,
    type FeatureAvailability,
    type OrderFlowCapabilities,
    type OrderFlowDataQuality,
    type OrderFlowFeatureId,
    type OrderFlowMode,
} from "./types";
import { resolveCapabilities, canonicalOrderFlowProvider, type OrderFlowDataProvider } from "./normalizer";

export type { OrderFlowCapabilities } from "./types";

/**
 * Resolve the full availability map for a provider. `mode` is informational
 * (live data with no L2 history degrades heatmap quality in the availability
 * layer through the provider's own capability declaration).
 */
export function resolveFeatureAvailability(
    provider: OrderFlowDataProvider = canonicalOrderFlowProvider,
    mode: OrderFlowMode = "live",
): Record<OrderFlowFeatureId, FeatureAvailability> {
    void mode;
    const caps = resolveCapabilities(provider);
    return deriveFeatureAvailability(caps);
}

/** Capabilities of the default canonical provider (candles only). */
export function canonicalCapabilities(): OrderFlowCapabilities {
    return resolveCapabilities(canonicalOrderFlowProvider);
}

/** Summarize a capability set into one overall data-quality grade. */
export function overallDataQuality(caps: OrderFlowCapabilities): OrderFlowDataQuality {
    if (caps.bidAskClassification) return "HIGH";
    if (caps.trades) return "PARTIAL";
    if (caps.candles) return "ESTIMATED";
    return "UNAVAILABLE";
}

/**
 * Is a feature honestly computable right now (quality better than
 * UNAVAILABLE/STALE/INSUFFICIENT_HISTORY)?
 */
export function isFeatureUsable(a: FeatureAvailability): boolean {
    return a.quality === "HIGH" || a.quality === "PARTIAL" || a.quality === "ESTIMATED";
}

/** Convenience: the availability row for one feature. */
export function availabilityFor(
    feature: OrderFlowFeatureId,
    provider: OrderFlowDataProvider = canonicalOrderFlowProvider,
): FeatureAvailability {
    return resolveFeatureAvailability(provider)[feature];
}
