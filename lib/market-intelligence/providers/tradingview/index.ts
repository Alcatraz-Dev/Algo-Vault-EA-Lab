/**
 * External intelligence provider registry (PHASE 2).
 *
 * Providers register here; consumers (AI Terminal, Scalping Terminal,
 * research, extension API) resolve by id. The registry is deliberately
 * additive: adding a future external provider requires no changes to the
 * Intelligence Engine.
 */
import type { ExternalIntelligenceProvider, ProviderConnectionStatus } from "../interfaces/external-intelligence-provider";
import { TradingViewMCPProvider, tradingViewMCPProvider } from "./tradingview-mcp-provider";

const registry = new Map<string, ExternalIntelligenceProvider>();

export function registerExternalProvider(provider: ExternalIntelligenceProvider): void {
    registry.set(provider.id, provider);
}

export function getExternalProvider(id: string): ExternalIntelligenceProvider | null {
    return registry.get(id) ?? null;
}

export function listExternalProviders(): ExternalIntelligenceProvider[] {
    return [...registry.values()];
}

// Built-in providers (fail-closed when their feature flags are off).
registerExternalProvider(tradingViewMCPProvider);

export { TradingViewMCPProvider, tradingViewMCPProvider };

/** Aggregated connection status across all registered providers. */
export async function getExternalConnectionStatuses(userId: string): Promise<ProviderConnectionStatus[]> {
    return Promise.all(listExternalProviders().map((p) => p.getConnectionStatus(userId)));
}
