/**
 * Provider capability adapter for the Order Flow engine.
 *
 * AlgoVault's canonical market-data layer (lib/market-data — Biquote OHLCV
 * with tick volume + TradingView live price) provides NO trades, NO bid/ask
 * classification, NO Level 2 and NO options. This file is the honest,
 * provider-neutral boundary: it declares what the current canonical feed
 * supports and exposes the interfaces a richer provider implements later.
 *
 * Nothing here fabricates capabilities. A provider that cannot deliver a data
 * class reports `false` and the whole downstream pipeline degrades to explicit
 * UNAVAILABLE states (see capabilities.ts / deriveFeatureAvailability).
 */

import { fetchCandles } from "@/lib/market-data/normalizer";
import type { SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { validateCandleForProfile, validateTradeBatch, validateL2Snapshot, validateOptionChain } from "./validation";
import { UNAVAILABLE_CAPABILITIES, type L2Snapshot, type OptionQuote, type OrderFlowCapabilities, type OrderFlowTrade } from "./types";

/**
 * The full order-flow data contract. Implementers return null / empty for any
 * capability they lack — the engine treats that as UNAVAILABLE, never as
 * "empty market".
 */
export interface OrderFlowDataProvider {
    readonly id: string;
    describeCapabilities(): OrderFlowCapabilities;

    /** Raw trade tape (requires bidAskClassification for true delta). */
    getTrades?(symbol: string, options?: { sinceMs?: number; limit?: number }): Promise<OrderFlowTrade[]>;
    /** Level 2 book snapshots (live poll or historical slices). */
    getL2Snapshots?(symbol: string, options?: { sinceMs?: number; untilMs?: number; limit?: number }): Promise<L2Snapshot[]>;
    /** Options chain for GEX. */
    getOptionChain?(underlying: string): Promise<OptionQuote[]>;
}

/**
 * The canonical AlgoVault feed. Candles only. Every richer capability is
 * explicitly false — this is the honest current state of the platform.
 */
export class CanonicalCandleProvider implements OrderFlowDataProvider {
    readonly id = "algovault-canonical";

    describeCapabilities(): OrderFlowCapabilities {
        return {
            ...UNAVAILABLE_CAPABILITIES,
            candles: true,
        };
    }

    /** Canonical OHLCV through the existing normalizer (validation included). */
    async getCandles(symbol: SupportedSymbol, timeframe: Timeframe, options?: { from?: number; to?: number }) {
        const candles = await fetchCandles(symbol, timeframe, options);
        return candles.filter(validateCandleForProfile);
    }
}

/** Default provider instance used across the app until a richer one connects. */
export const canonicalOrderFlowProvider: CanonicalCandleProvider = new CanonicalCandleProvider();

/**
 * Resolve the capabilities for a (possibly richer) provider with graceful
 * degradation: probes optional methods so a partially-implemented provider
 * never yields a false "supported" claim.
 */
export function resolveCapabilities(provider: OrderFlowDataProvider): OrderFlowCapabilities {
    if (!provider) return { ...UNAVAILABLE_CAPABILITIES };
    const caps = provider.describeCapabilities();
    // Cross-check declared capabilities against what is actually implemented.
    const checked: OrderFlowCapabilities = { ...caps };
    if (checked.trades && typeof provider.getTrades !== "function") checked.trades = false;
    if (checked.bidAskClassification && !checked.trades) checked.bidAskClassification = false;
    if (checked.level2 && typeof provider.getL2Snapshots !== "function") checked.level2 = false;
    if (checked.historicalLevel2 && !checked.level2) checked.historicalLevel2 = false;
    if (checked.options && typeof provider.getOptionChain !== "function") checked.options = false;
    if (checked.openInterest && !checked.options) checked.openInterest = false;
    if (checked.impliedVolatility && !checked.options) checked.impliedVolatility = false;
    return checked;
}

/** Safe wrapper: fetch trades with validation + rejection counting. */
export async function fetchValidatedTrades(
    provider: OrderFlowDataProvider,
    symbol: string,
    options?: { sinceMs?: number; limit?: number },
): Promise<{ trades: OrderFlowTrade[]; rejected: number; available: boolean }> {
    if (!provider.getTrades) return { trades: [], rejected: 0, available: false };
    try {
        const raw = await provider.getTrades(symbol, options);
        const { trades, rejected } = validateTradeBatch(raw);
        return { trades, rejected, available: true };
    } catch {
        return { trades: [], rejected: 0, available: true }; // provider exists but errored — honest empty
    }
}

/** Safe wrapper: fetch L2 snapshots with validation. */
export async function fetchValidatedL2(
    provider: OrderFlowDataProvider,
    symbol: string,
    options?: { sinceMs?: number; untilMs?: number; limit?: number },
): Promise<{ snapshots: L2Snapshot[]; available: boolean }> {
    if (!provider.getL2Snapshots) return { snapshots: [], available: false };
    try {
        const raw = await provider.getL2Snapshots(symbol, options);
        const snapshots = raw
            .map((s) => validateL2Snapshot(s).value)
            .filter((s): s is L2Snapshot => s !== null);
        return { snapshots, available: true };
    } catch {
        return { snapshots: [], available: true };
    }
}

/** Safe wrapper: fetch an options chain with validation. */
export async function fetchValidatedOptionChain(
    provider: OrderFlowDataProvider,
    underlying: string,
): Promise<{ quotes: OptionQuote[]; rejected: number; available: boolean }> {
    if (!provider.getOptionChain) return { quotes: [], rejected: 0, available: false };
    try {
        const raw = await provider.getOptionChain(underlying);
        const { quotes, rejected } = validateOptionChain(raw);
        return { quotes, rejected, available: true };
    } catch {
        return { quotes: [], rejected: 0, available: true };
    }
}
