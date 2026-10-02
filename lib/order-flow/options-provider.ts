/**
 * Options provider — real options chains for the GEX engine.
 *
 * Per-symbol sources (public, key-less endpoints):
 *  • Crypto (BTCUSD, ETHUSD) → Deribit `public/get_book_summary_by_currency`
 *    (mark_iv in percent, open_interest in base currency — 1 contract = 1 coin,
 *    so the GEX calculator's default 100× multiplier is overridden to 1).
 *  • US indices/ETFs/equities → CBOE delayed quotes (~15 min delay),
 *    OCC-format symbols, decimal IV, provider gamma used directly.
 *  • Forex/metals → no listed options source wired: the provider reports
 *    `available: false` and GEX stays explicitly UNAVAILABLE for those
 *    symbols. Never faked.
 *
 * All normalization lives in options-internal.ts (pure, tested); this module
 * only resolves the per-symbol source, fetches with a timeout, and records
 * failures honestly (`available: false` + error, never a fabricated chain).
 */

import type { GexProviderResult } from "./options-types";
import { normalizeCboePayload, normalizeDeribitPayload } from "./options-internal";

export { GEX_SUPPORTED_SYMBOLS, CRYPTO_GEX_SYMBOLS, OptionsCapableProvider, featureAvailabilityForSymbol } from "./options-types";
export type { GexProviderResult } from "./options-types";
export {
    parseOccSymbol,
    parseDeribitInstrument,
    occExpiryMs,
    deribitExpiryMs,
    normalizeDeribitPayload,
    normalizeCboePayload,
} from "./options-internal";

/** GET with timeout so a hung upstream can never block a route for minutes. */
async function fetchJson(url: string, timeoutMs = 8_000): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { accept: "application/json", "user-agent": "AlgoVault-OrderFlow/1.0" },
            cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as unknown;
    } finally {
        clearTimeout(timer);
    }
}

/** ETFs/equities quote on CBOE under their own ticker. */
const CBOE_TICKERS: ReadonlySet<string> = new Set([
    "SPY", "QQQ", "AAPL", "TSLA", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AMD", "NFLX", "COIN",
]);

/** Platform symbol → CBOE chain ticker (index proxies map to the index). */
const INDEX_TICKERS: Record<string, string> = {
    SPX500: "SPX",
    NAS100: "NDX",
    US30: "DJX",
};

async function fetchCboeChain(ticker: string): Promise<GexProviderResult> {
    const [chainRaw, quoteRaw] = await Promise.all([
        fetchJson(`https://cdn.cboe.com/api/global/delayed_quotes/options/${ticker}.json`),
        fetchJson(`https://cdn.cboe.com/api/global/delayed_quotes/quotes/${ticker}.json`).catch(() => null),
    ]);
    const { quotes, rejected, spot } = normalizeCboePayload(chainRaw, quoteRaw);
    return { available: true, quotes, rejected, spot, source: `cboe:${ticker}`, contractMultiplier: 100 };
}

async function fetchDeribitChain(coin: "BTC" | "ETH"): Promise<GexProviderResult> {
    const raw = await fetchJson(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${coin}&kind=option`);
    const { quotes, rejected, spot } = normalizeDeribitPayload(raw);
    return { available: true, quotes, rejected, spot, source: `deribit:${coin}`, contractMultiplier: 1 };
}

/**
 * Fetch the options chain for a platform symbol. Resolves the per-symbol
 * source, normalizes through the fail-closed validator, and never throws —
 * failures come back as `available: false` + error.
 */
export async function fetchGexChain(symbol: string): Promise<GexProviderResult> {
    const upper = symbol.toUpperCase();
    try {
        if (upper === "BTCUSD" || upper === "ETHUSD") {
            return await fetchDeribitChain(upper === "BTCUSD" ? "BTC" : "ETH");
        }
        const indexTicker = INDEX_TICKERS[upper];
        if (indexTicker) return await fetchCboeChain(indexTicker);
        if (CBOE_TICKERS.has(upper)) return await fetchCboeChain(upper);
        // Forex / metals: no listed options source wired — honest unavailability.
        return { available: false, quotes: [], rejected: 0, spot: null, source: null, error: "no-options-source" };
    } catch (err) {
        return {
            available: false,
            quotes: [],
            rejected: 0,
            spot: null,
            source: null,
            error: err instanceof Error ? err.message : "options-fetch-failed",
        };
    }
}
