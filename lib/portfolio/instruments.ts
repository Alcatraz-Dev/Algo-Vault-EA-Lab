/**
 * AlgoVault — Portfolio instrument metadata (Phase 15 §5).
 *
 * EXTENDS the canonical symbol registry in `@/lib/ai-signals/symbol-specs`; it
 * does not duplicate it. Contract size, pip size and category all come from the
 * existing registry so exposure maths can never disagree with the Risk Engine.
 *
 * The one thing the existing registry does not carry is currency decomposition.
 * That is added here, and only where it is determinable:
 *   • FX pairs  → base/quote currency split straight from the symbol.
 *   • Everything else → `UNAVAILABLE` rather than an invented currency split.
 *
 * Asset-class support is reported, never assumed: `supportedAssetClasses()`
 * reads the registry so a class with no instruments is honestly absent.
 */

import { SYMBOL_SPECS, getSymbolSpec } from "@/lib/ai-signals/symbol-specs";
import type { SignalCategory } from "@/lib/ai-signals/types";
import type { AssetClass, InstrumentMetadata } from "./types";

/** Existing `SignalCategory` → portfolio asset class. One-to-one, no invention. */
const CATEGORY_TO_ASSET_CLASS: Record<SignalCategory, AssetClass> = {
    gold: "METALS",
    forex: "FX",
    indices: "INDICES",
    crypto: "CRYPTO",
    stocks: "EQUITIES",
};

/**
 * Currency pairs AlgoVault treats as genuine two-currency exposures. Anything
 * outside this list is reported as a single-currency exposure, because an
 * assumed split would be fabricated data.
 */
const FX_CURRENCIES = new Set([
    "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD",
]);

/** Instruments whose account currency is USD by contract definition. */
const USD_SETTLED = new Set([
    "XAUUSD", "XAGUSD", "US30", "NAS100", "SPX500", "BTCUSD", "ETHUSD",
]);

/** Currencies whose ISO code is 3 letters — used only as a sanity gate. */
function looksLikeCurrency(code: string): boolean {
    return /^[A-Z]{3}$/.test(code);
}

/**
 * Derive currency metadata for a symbol.
 * Returns `null` currency fields — never guesses — when the split is not
 * determinable from the symbol itself.
 */
function deriveCurrencies(symbol: string): {
    currency: string | null;
    currencyPair: [string, string] | null;
    quoteCurrency: string | null;
} {
    const upper = symbol.toUpperCase();
    const spec = getSymbolSpec(upper);

    if (!spec) {
        return { currency: null, currencyPair: null, quoteCurrency: null };
    }

    // Genuine 6-letter FX pair with both legs recognised.
    if (spec.category === "forex" && upper.length === 6) {
        const base = upper.slice(0, 3);
        const quote = upper.slice(3, 6);
        if (FX_CURRENCIES.has(base) && FX_CURRENCIES.has(quote) && looksLikeCurrency(base) && looksLikeCurrency(quote)) {
            // FX P&L is realised in the quote currency of the pair.
            return { currency: quote, currencyPair: [base, quote], quoteCurrency: quote };
        }
    }

    if (spec.category === "crypto" && upper.endsWith("USD")) {
        return { currency: "USD", currencyPair: null, quoteCurrency: "USD" };
    }

    if (USD_SETTLED.has(upper)) {
        return { currency: "USD", currencyPair: null, quoteCurrency: "USD" };
    }

    return { currency: null, currencyPair: null, quoteCurrency: null };
}

/** Normalized metadata for one symbol. Never throws, never guesses. */
export function instrumentMetadata(symbol: string): InstrumentMetadata {
    const upper = String(symbol || "").trim().toUpperCase();
    const spec = getSymbolSpec(upper);
    const currencies = deriveCurrencies(upper);

    if (!spec) {
        return {
            symbol: upper,
            assetClass: "UNAVAILABLE",
            currency: null,
            currencyPair: null,
            contractSize: null,
            quoteCurrency: null,
        };
    }

    return {
        symbol: upper,
        assetClass: CATEGORY_TO_ASSET_CLASS[spec.category] ?? "OTHER",
        currency: currencies.currency,
        currencyPair: currencies.currencyPair,
        contractSize: typeof spec.contractSize === "number" && spec.contractSize > 0 ? spec.contractSize : null,
        quoteCurrency: currencies.quoteCurrency,
    };
}

/** Contract size with an honest `null` for unknown instruments. */
export function contractSizeOf(symbol: string): number | null {
    const spec = getSymbolSpec(symbol);
    return spec && spec.contractSize > 0 ? spec.contractSize : null;
}

/** Every symbol the canonical registry knows about. */
export function knownSymbols(): string[] {
    return Object.keys(SYMBOL_SPECS);
}

/** Asset classes that actually have at least one registered instrument. */
export function supportedAssetClasses(): AssetClass[] {
    const set = new Set<AssetClass>();
    for (const symbol of knownSymbols()) {
        const meta = instrumentMetadata(symbol);
        if (meta.assetClass !== "UNAVAILABLE") set.add(meta.assetClass);
    }
    return Array.from(set).sort();
}

/**
 * Asset classes AlgoVault's registry does NOT cover. Reported so the UI can
 * say "unsupported" instead of showing an empty or invented breakdown.
 */
export function unsupportedAssetClasses(): AssetClass[] {
    const supported = new Set(supportedAssetClasses());
    return (["FX", "METALS", "INDICES", "COMMODITIES", "CRYPTO", "EQUITIES", "ETFS"] as AssetClass[]).filter(
        (c) => !supported.has(c)
    );
}

/**
 * Currency sensitivity of a notional long exposure, expressed as signed
 * fractions of the exposure. Long EURUSD is +EUR / −USD in notional terms.
 *
 * Returns `null` when the symbol has no determinable currency split — callers
 * must then report UNAVAILABLE rather than assuming a single USD leg.
 */
export function currencyWeights(
    symbol: string,
    notional: number
): Array<{ currency: string; signed: number }> | null {
    const meta = instrumentMetadata(symbol);
    if (!meta.currencyPair) {
        if (!meta.currency) return null;
        return [{ currency: meta.currency, signed: notional }];
    }
    const [base, quote] = meta.currencyPair;
    return [
        { currency: base, signed: notional },
        { currency: quote, signed: -notional },
    ];
}
