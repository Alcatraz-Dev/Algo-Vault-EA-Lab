/**
 * GEX options-provider types — isolated from options-provider.ts (fetching)
 * so client code can import the contracts without pulling `fetch`/network
 * code into the browser bundle.
 *
 * Also defines the options-capable `OrderFlowDataProvider` adapter used by
 * capability resolution: context building needs a provider whose
 * `describeCapabilities` reports options support for GEX-capable symbols and
 * plain candles otherwise.
 */

import type { OptionQuote, OrderFlowCapabilities } from "./types";
import type { OrderFlowDataProvider } from "./normalizer";
import { UNAVAILABLE_CAPABILITIES, deriveFeatureAvailability } from "./types";
import type { SupportedSymbol } from "@/lib/market-data/types";

/** Platform-symbol alias accepted by the provider (any supported symbol). */
export type SupportedSymbolAlias = string;

/** Symbols with a wired options source (GEX-capable). */
export const GEX_SUPPORTED_SYMBOLS: ReadonlySet<string> = new Set([
    "BTCUSD",
    "ETHUSD",
    "SPX500",
    "NAS100",
    "US30",
    "SPY",
    "QQQ",
    "AAPL",
    "TSLA",
    "MSFT",
    "NVDA",
    "AMZN",
    "META",
    "GOOGL",
    "AMD",
    "NFLX",
    "COIN",
]);

/** Result of a provider fetch — every field is honest about what happened. */
export interface GexProviderResult {
    /** True when a source is wired for this symbol (even if the fetch errored). */
    available: boolean;
    quotes: OptionQuote[];
    rejected: number;
    /** Underlying spot used for the chain (null when unresolved). */
    spot: number | null;
    /** "deribit:BTC" | "cboe:SPX" | null when no source is wired. */
    source: string | null;
    /** Contract multiplier override for the GEX calculator (crypto = 1). */
    contractMultiplier?: number;
    error?: string;
}

/** Symbols behind a Deribit-style contract multiplier of 1 (crypto). */
export const CRYPTO_GEX_SYMBOLS: ReadonlySet<string> = new Set(["BTCUSD", "ETHUSD"]);

const OPTIONS_CAPS: OrderFlowCapabilities = {
    ...UNAVAILABLE_CAPABILITIES,
    candles: true,
    options: true,
    openInterest: true,
    impliedVolatility: true,
};

const CANDLE_CAPS: OrderFlowCapabilities = {
    ...UNAVAILABLE_CAPABILITIES,
    candles: true,
};

/**
 * An options-capable order-flow provider. Capabilities are per-symbol: GEX
 * symbols declare the full options class, everything else stays candle-only.
 * `getOptionChain` throws for symbols without a wired source (never fabricates).
 */
export class OptionsCapableProvider implements OrderFlowDataProvider {
    readonly id = "algovault-candles+options";

    private readonly fetchChain: (symbol: string) => Promise<GexProviderResult>;

    constructor(fetchChain: (symbol: string) => Promise<GexProviderResult>) {
        this.fetchChain = fetchChain;
    }

    describeCapabilities(): OrderFlowCapabilities {
        return { ...OPTIONS_CAPS };
    }

    async getOptionChain(underlying: string): Promise<OptionQuote[]> {
        const result = await this.fetchChain(underlying);
        if (!result.available || result.quotes.length === 0) {
            throw new Error(result.error ?? "options-chain-unavailable");
        }
        return result.quotes;
    }
}

/**
 * Per-symbol feature availability: GEX symbols get the options capability
 * class, everything else stays candle-only. Actual context-level availability
 * still depends on the fetch succeeding (empty chain → UNAVAILABLE GEX).
 */
export function featureAvailabilityForSymbol(symbol: SupportedSymbol | string) {
    const gexCapable = GEX_SUPPORTED_SYMBOLS.has(symbol.toUpperCase());
    return {
        gexCapable,
        features: deriveFeatureAvailability(gexCapable ? OPTIONS_CAPS : CANDLE_CAPS),
    };
}
