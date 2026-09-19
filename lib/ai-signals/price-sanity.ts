import { MarketSnapshot } from "../market-data/market-truth";
import { SUPPORTED_SYMBOLS, SupportedSymbol } from "../market-data/types";

export interface PriceSanityResult {
    passed: boolean;
    reason: string;
    referencePrice: number;
    currentPrice: number;
    priceDifference: number;
    priceDifferencePercent: number;
    action: "PROCEED" | "REJECT_REFRESH" | "REJECT_INVALID";
}

const DEFAULT_INSTRUMENT_THRESHOLDS: Record<string, number> = {
    XAUUSD: 0.15,
    BTCUSD: 0.10,
    ETHUSD: 0.10,
    NAS100: 0.10,
    US30: 0.10,
    SPX500: 0.10,
    EURUSD: 0.01,
    GBPUSD: 0.01,
    USDJPY: 0.01,
    USDCHF: 0.01,
    AUDUSD: 0.01,
    NZDUSD: 0.01,
};

function getInstrumentThreshold(symbol: string): number {
    const upper = symbol.toUpperCase();
    if (DEFAULT_INSTRUMENT_THRESHOLDS[upper]) {
        return DEFAULT_INSTRUMENT_THRESHOLDS[upper];
    }
    const sym = upper as SupportedSymbol;
    if (SUPPORTED_SYMBOLS.includes(sym)) return 0.05;
    return 0.05;
}

export function currentPriceSanityCheck(
    referencePrice: number,
    snapshot: MarketSnapshot,
    instrument?: string
): PriceSanityResult {
    const symbol = instrument || snapshot.symbol;
    const threshold = getInstrumentThreshold(symbol);

    if (!referencePrice || referencePrice <= 0) {
        return {
            passed: false,
            reason: "INVALID_REFERENCE_PRICE — Reference price is missing or zero",
            referencePrice: 0,
            currentPrice: snapshot.currentPrice,
            priceDifference: snapshot.currentPrice,
            priceDifferencePercent: 0,
            action: "REJECT_INVALID",
        };
    }

    const currentPrice = snapshot.currentPrice;
    const priceDifference = Math.abs(referencePrice - currentPrice);
    const priceDifferencePercent = currentPrice !== 0
        ? (priceDifference / currentPrice) * 100
        : Infinity;

    if (priceDifferencePercent > threshold) {
        return {
            passed: false,
            reason: `PRICE_MISMATCH — Reference ${referencePrice} vs current ${currentPrice} (${priceDifferencePercent.toFixed(2)}% diff, threshold ${threshold}%)`,
            referencePrice,
            currentPrice,
            priceDifference,
            priceDifferencePercent,
            action: "REJECT_REFRESH",
        };
    }

    return {
        passed: true,
        reason: "Price sanity check passed",
        referencePrice,
        currentPrice,
        priceDifference,
        priceDifferencePercent,
        action: "PROCEED",
    };
}

export interface SignalPriceValidationResult {
    passed: boolean;
    sanityResult: PriceSanityResult;
    freshnessResult?: { fresh: boolean; status: string; dataAgeMs: number };
    overallAction: "PROCEED" | "REJECT_STALE" | "REJECT_INVALID" | "REJECT_REFRESH";
    message: string;
}

export function validateTelegramSignalPrice(
    signalEntryPrice: number,
    snapshot: MarketSnapshot,
    freshness: { fresh: boolean; status: string; dataAgeMs: number }
): SignalPriceValidationResult {
    if (!freshness.fresh) {
        return {
            passed: false,
            sanityResult: {
                passed: false,
                reason: `MARKET_DATA_STALE — ${freshness.status} (age: ${freshness.dataAgeMs}ms)`,
                referencePrice: signalEntryPrice,
                currentPrice: snapshot.currentPrice,
                priceDifference: Math.abs(signalEntryPrice - snapshot.currentPrice),
                priceDifferencePercent: snapshot.currentPrice !== 0
                    ? (Math.abs(signalEntryPrice - snapshot.currentPrice) / snapshot.currentPrice) * 100
                    : 100,
                action: "REJECT_REFRESH",
            },
            freshnessResult: freshness,
            overallAction: "REJECT_STALE",
            message: `Telegram signal rejected — market data is ${freshness.status} (age: ${freshness.dataAgeMs}ms). Signal marked as stale.`,
        };
    }

    const sanity = currentPriceSanityCheck(signalEntryPrice, snapshot);

    if (!sanity.passed) {
        return {
            passed: false,
            sanityResult: sanity,
            freshnessResult: freshness,
            overallAction: sanity.action === "REJECT_REFRESH" ? "REJECT_REFRESH" : "REJECT_INVALID",
            message: `Telegram signal rejected — ${sanity.reason}`,
        };
    }

    return {
        passed: true,
        sanityResult: sanity,
        freshnessResult: freshness,
        overallAction: "PROCEED",
        message: "Telegram signal price validated against fresh market data",
    };
}