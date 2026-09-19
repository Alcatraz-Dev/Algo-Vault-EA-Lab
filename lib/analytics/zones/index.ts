import { Zone, ZoneStatus, ZoneType, MarketCandle, Timeframe } from "../../market-data/types";

let zoneCounter = 0;
function generateZoneId(type: ZoneType, timestamp: number): string {
    zoneCounter++;
    return `${type}_${timestamp}_${zoneCounter}`;
}

export function detectOrderBlocks(candles: MarketCandle[], timeframe: Timeframe): Zone[] {
    const zones: Zone[] = [];

    for (let i = 2; i < candles.length; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        const bodySize = Math.abs(curr.close - curr.open);
        const prevBodySize = Math.abs(prev.close - prev.open);

        if (curr.close > curr.open && prev.close < prev.open && bodySize > prevBodySize * 1.5) {
            zones.push({
                id: generateZoneId("order_block", prev.timestamp),
                type: "order_block",
                direction: "bullish",
                high: prev.high,
                low: prev.open,
                timeframe,
                strength: 60,
                status: "active",
                createdAt: prev.timestamp,
            });
        }

        if (curr.close < curr.open && prev.close > prev.open && bodySize > prevBodySize * 1.5) {
            zones.push({
                id: generateZoneId("order_block", prev.timestamp),
                type: "order_block",
                direction: "bearish",
                high: prev.open,
                low: prev.low,
                timeframe,
                strength: 60,
                status: "active",
                createdAt: prev.timestamp,
            });
        }
    }

    return zones.slice(-10);
}

export function detectFairValueGaps(candles: MarketCandle[], timeframe: Timeframe): Zone[] {
    const zones: Zone[] = [];

    for (let i = 2; i < candles.length; i++) {
        const candle1 = candles[i - 2];
        const candle3 = candles[i];

        if (candle3.low > candle1.high) {
            zones.push({
                id: generateZoneId("fvg", candle1.timestamp),
                type: "fvg",
                direction: "bullish",
                high: candle3.low,
                low: candle1.high,
                timeframe,
                strength: 50,
                status: "active",
                createdAt: candle1.timestamp,
            });
        }

        if (candle3.high < candle1.low) {
            zones.push({
                id: generateZoneId("fvg", candle1.timestamp),
                type: "fvg",
                direction: "bearish",
                high: candle1.low,
                low: candle3.high,
                timeframe,
                strength: 50,
                status: "active",
                createdAt: candle1.timestamp,
            });
        }
    }

    return zones.slice(-10);
}

export function updateZoneStatus(zones: Zone[], currentCandle: MarketCandle): Zone[] {
    return zones.map((zone) => {
        if (zone.status !== "active") return zone;

        if (zone.direction === "bullish" && currentCandle.close < zone.low) {
            return { ...zone, status: "invalidated" as ZoneStatus };
        }
        if (zone.direction === "bearish" && currentCandle.close > zone.high) {
            return { ...zone, status: "invalidated" as ZoneStatus };
        }

        if (zone.direction === "bullish" && currentCandle.low <= zone.high && currentCandle.close > zone.low) {
            return { ...zone, status: "mitigated" as ZoneStatus, mitigatedAt: currentCandle.timestamp };
        }
        if (zone.direction === "bearish" && currentCandle.high >= zone.low && currentCandle.close < zone.high) {
            return { ...zone, status: "mitigated" as ZoneStatus, mitigatedAt: currentCandle.timestamp };
        }

        return zone;
    });
}

export function getAllZones(candles: MarketCandle[], timeframe: Timeframe): Zone[] {
    if (candles.length < 10) return [];

    const orderBlocks = detectOrderBlocks(candles, timeframe);
    const fvgs = detectFairValueGaps(candles, timeframe);

    const allZones = [...orderBlocks, ...fvgs];

    const currentCandle = candles[candles.length - 1];
    return updateZoneStatus(allZones, currentCandle).sort((a, b) => b.strength - a.strength);
}
