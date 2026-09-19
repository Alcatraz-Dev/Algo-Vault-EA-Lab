import { MarketSnapshot, getMarketTruth } from "../market-data/market-truth";
import { AISignal } from "./types";

export interface StaleDetectionResult {
    isStale: boolean;
    reasons: string[];
    staleTypes: Array<
        | "TIME_FRESHNESS"
        | "MARKET_RELEVANCE"
        | "SIGNAL_AGE"
        | "SOURCE_EXPIRED"
        | "MARKET_REGIME_CHANGE"
        | "MARKET_MOVED_SIGNIFICANTLY"
        | "MARKET_DATA_UNAVAILABLE"
    >;
    recommendation: "CONTINUE" | "INVALIDATE" | "REVIEW";
}

const STALE_TIME_THRESHOLDS: Record<string, number> = {
    SCALPING: 5 * 60 * 1000,
    INTRADAY: 240 * 60 * 1000,
    SWING: 1440 * 60 * 1000,
    DEFAULT: 60 * 60 * 1000,
};

export async function detectSignalStaleness(
    signal: AISignal,
    snapshot?: MarketSnapshot
): Promise<StaleDetectionResult> {
    const reasons: string[] = [];
    const staleTypes: StaleDetectionResult["staleTypes"] = [];
    const now = Date.now();

    // 1. Time freshness check
    const signalAge = now - (signal.createdAt || now);
    const expirationTime = signal.expiresAt ? signal.expiresAt - now : -Infinity;

    if (expirationTime < 0) {
        reasons.push("Signal has expired — validity window closed");
        staleTypes.push("SIGNAL_AGE");
    } else if (signal.expiresAt && now > signal.expiresAt) {
        reasons.push("Signal expiration time exceeded");
        staleTypes.push("SIGNAL_AGE");
    }

    // 2. Market data freshness
    if (snapshot) {
        const dataAge = now - snapshot.timestamp;
        const threshold = getFreshnessThreshold(signal.timeframe);

        if (dataAge > threshold) {
            reasons.push(`Market data aged ${dataAge}ms (threshold: ${threshold}ms)`);
            staleTypes.push("TIME_FRESHNESS");
        }

        if (snapshot.dataAgeMs > threshold * 0.8) {
            reasons.push("Market data approaching staleness threshold");
        }
    } else if (signal.marketDataTimestamp) {
        const marketAge = now - signal.marketDataTimestamp;
        if (marketAge > 300000) {
            reasons.push(`Last market update was ${marketAge}ms ago`);
            staleTypes.push("TIME_FRESHNESS");
        }
    }

    // 3. Entry distance from market (market relevance)
    if (snapshot && signal.entry) {
        const entryDist = Math.abs(signal.entry - snapshot.currentPrice);
        const entryPct = snapshot.currentPrice !== 0
            ? (entryDist / snapshot.currentPrice) * 100
            : Infinity;

        if (entryPct > 5) {
            reasons.push(`Entry (${signal.entry}) is ${entryPct.toFixed(1)}% from current price (${snapshot.currentPrice})`);
            staleTypes.push("MARKET_RELEVANCE");
        }
    } else if (signal.entry && signal.currentPrice) {
        const entryDist = Math.abs(signal.entry - signal.currentPrice);
        const entryPct = signal.currentPrice !== 0
            ? (entryDist / signal.currentPrice) * 100
            : Infinity;

        if (entryPct > 5) {
            reasons.push(`Entry is ${entryPct.toFixed(1)}% from last known price`);
            staleTypes.push("MARKET_RELEVANCE");
        }
    }

    // 4. Signal status check
    if (["STOPPED", "CLOSED", "EXPIRED", "CANCELLED", "INVALIDATED"].includes(signal.status)) {
        reasons.push(`Signal is in terminal status: ${signal.status}`);
        staleTypes.push("SIGNAL_AGE");
    }

    // 5. Generate a fresh snapshot if not provided for market regime change detection
    if (!snapshot && signal.symbol) {
        try {
            const freshResult = await getMarketTruth(signal.symbol, signal.timeframe as any);
            if (freshResult && !freshResult.freshness.fresh) {
                reasons.push("Fresh market data unavailable or stale");
                staleTypes.push("MARKET_DATA_UNAVAILABLE");
            }
        } catch {
            // No market data for regime check
        }
    }

    const isStale = staleTypes.length > 0;

    let recommendation: StaleDetectionResult["recommendation"] = "CONTINUE";
    if (isStale) {
        if (staleTypes.includes("SIGNAL_AGE") || staleTypes.includes("MARKET_DATA_UNAVAILABLE")) {
            recommendation = "INVALIDATE";
        } else if (staleTypes.includes("MARKET_RELEVANCE")) {
            recommendation = "REVIEW";
        } else {
            recommendation = "REVIEW";
        }
    }

    return {
        isStale,
        reasons,
        staleTypes,
        recommendation,
    };
}

function getFreshnessThreshold(timeframe: string): number {
    switch (timeframe) {
        case "M1": return 60000;
        case "M5": return 300000;
        case "M15": return 900000;
        case "H1": return 3600000;
        case "H4": return 14400000;
        default: return 300000;
    }
}