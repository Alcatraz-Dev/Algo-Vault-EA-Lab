import { MarketSnapshot, FreshnessResult } from "../market-data/market-truth";

export interface FreshnessGuardResult {
    allowed: boolean;
    reason: string;
    freshness: FreshnessResult;
    action: "PROCEED" | "BLOCK_STALE" | "BLOCK_UNAVAILABLE";
}

export function createFreshnessGuard(
    thresholds?: Partial<Record<string, number>>
): (snapshot: MarketSnapshot, timeframe: string) => FreshnessGuardResult {
    return (snapshot: MarketSnapshot, timeframe: string): FreshnessGuardResult => {
        if (!snapshot || snapshot.currentPrice === 0) {
            return {
                allowed: false,
                reason: "MARKET_DATA_UNAVAILABLE — No live market data available for this signal generation",
                freshness: { fresh: false, status: "unavailable", dataAgeMs: 0, thresholdMs: 0, category: "tick" },
                action: "BLOCK_UNAVAILABLE",
            };
        }

        const freshness = {
            fresh: snapshot.freshnessStatus === "fresh",
            status: snapshot.freshnessStatus,
            dataAgeMs: snapshot.dataAgeMs,
            thresholdMs: (thresholds && thresholds[timeframe]) ?? 300000,
            category: snapshot.dataAgeCategory,
        };

        if (!freshness.fresh) {
            return {
                allowed: false,
                reason: `MARKET_DATA_STALE — Data age: ${snapshot.dataAgeMs}ms, threshold: ${freshness.thresholdMs}ms, status: ${snapshot.freshnessStatus}`,
                freshness,
                action: "BLOCK_STALE",
            };
        }

        return {
            allowed: true,
            reason: "Market data is fresh and valid",
            freshness,
            action: "PROCEED",
        };
    };
}

export const defaultFreshnessGuard = createFreshnessGuard();