import { Zone, ZoneScore } from "../../market-data/types";

type ZoneScoringFactors = {
    htfAlignment?: boolean;
    structureAlignment?: boolean;
    liquidityInteraction?: boolean;
    fvgOverlap?: boolean;
    vwapRelationship?: boolean;
    volumeExpansion?: boolean;
    recency?: boolean;
};

export function scoreZone(zone: Zone, currentPrice: number, factors: ZoneScoringFactors = {}): ZoneScore {
    let strength = 0;
    const reasons: string[] = [];

    if (factors.htfAlignment) {
        strength += 20;
        reasons.push("Higher timeframe alignment");
    }

    if (factors.structureAlignment) {
        strength += 18;
        reasons.push("Market structure alignment");
    }

    if (factors.liquidityInteraction) {
        strength += 15;
        reasons.push("Liquidity interaction");
    }

    if (factors.fvgOverlap) {
        strength += 14;
        reasons.push("FVG overlap");
    }

    if (factors.vwapRelationship) {
        strength += 12;
        reasons.push("VWAP relationship");
    }

    if (factors.volumeExpansion) {
        strength += 10;
        reasons.push("Volume expansion");
    }

    if (factors.recency) {
        strength += 8;
        reasons.push("Recent formation");
    }

    const distanceToZone = zone.direction === "bullish"
        ? Math.abs(currentPrice - zone.high)
        : Math.abs(currentPrice - zone.low);

    if (distanceToZone < zone.high * 0.001) {
        strength += 15;
        reasons.push("Price near zone");
    } else if (distanceToZone < zone.high * 0.005) {
        strength += 8;
        reasons.push("Price approaching zone");
    }

    if (zone.status === "mitigated") {
        strength = Math.max(0, strength - 20);
        reasons.push("Zone already mitigated (reduced score)");
    }

    if (zone.status === "invalidated") {
        strength = 0;
        reasons.push("Zone invalidated");
    }

    strength = Math.min(100, Math.max(0, strength));

    return {
        zoneId: zone.id,
        strength,
        reasons,
    };
}

export function scoreAllZones(zones: Zone[], currentPrice: number): ZoneScore[] {
    return zones
        .filter((z) => z.status === "active")
        .map((zone) => scoreZone(zone, currentPrice, {
            recency: Date.now() - zone.createdAt < 24 * 60 * 60 * 1000,
        }))
        .sort((a, b) => b.strength - a.strength);
}
