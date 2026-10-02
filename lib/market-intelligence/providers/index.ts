/**
 * Providers barrel — external intelligence layer.
 */
export * from "./interfaces/external-intelligence-provider";
export { getExternalProvider, listExternalProviders, getExternalConnectionStatuses, tradingViewMCPProvider } from "./tradingview";
export type { ExternalMarketEvent } from "./tradingview/provenance";
export { toExternalMarketEvent, describeFreshness } from "./tradingview/provenance";
export { getTradingViewFlags, publicTradingViewFlags } from "./tradingview/feature-flags";
export { getMcpMetrics } from "./tradingview/observability";
