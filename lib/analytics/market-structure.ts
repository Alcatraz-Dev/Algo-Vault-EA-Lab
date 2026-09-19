import { MarketCandle, MarketStructureEvent, MarketStructurePoint, Timeframe } from "../market-data/types";

function getSwingPoints(candles: MarketCandle[], lookback: number = 3): MarketStructurePoint[] {
    const points: MarketStructurePoint[] = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
        const window = candles.slice(i - lookback, i + lookback + 1);
        const current = candles[i];

        const isSwingHigh = window.every((c) => c.high <= current.high);
        const isSwingLow = window.every((c) => c.low >= current.low);

        if (isSwingHigh) {
            points.push({
                index: i,
                price: current.high,
                timestamp: current.timestamp,
                type: "swing_high",
            });
        }

        if (isSwingLow) {
            points.push({
                index: i,
                price: current.low,
                timestamp: current.timestamp,
                type: "swing_low",
            });
        }
    }

    return points;
}

export function detectStructure(candles: MarketCandle[], timeframe: Timeframe): MarketStructureEvent[] {
    if (candles.length < 10) return [];

    const swingPoints = getSwingPoints(candles, 3);
    const events: MarketStructureEvent[] = [];

    const swingHighs = swingPoints.filter((p) => p.type === "swing_high").sort((a, b) => a.index - b.index);
    const swingLows = swingPoints.filter((p) => p.type === "swing_low").sort((a, b) => a.index - b.index);

    for (let i = 0; i < swingHighs.length; i++) {
        const point = swingHighs[i];
        events.push({
            id: `sh_${timeframe}_${point.index}`,
            type: "swing_high",
            direction: i > 0 && point.price > swingHighs[i - 1].price ? "bullish" : i > 0 && point.price < swingHighs[i - 1].price ? "bearish" : "bullish",
            price: point.price,
            timestamp: point.timestamp,
            timeframe,
        });
    }

    for (let i = 0; i < swingLows.length; i++) {
        const point = swingLows[i];
        events.push({
            id: `sl_${timeframe}_${point.index}`,
            type: "swing_low",
            direction: i > 0 && point.price > swingLows[i - 1].price ? "bullish" : i > 0 && point.price < swingLows[i - 1].price ? "bearish" : "bearish",
            price: point.price,
            timestamp: point.timestamp,
            timeframe,
        });
    }

    let lastHh: number | null = null;
    let lastLl: number | null = null;

    for (const high of swingHighs) {
        if (lastHh !== null && high.price > lastHh) {
            events.push({
                id: `bos_bull_h_${timeframe}_${high.index}`,
                type: "BOS",
                direction: "bullish",
                price: high.price,
                timestamp: high.timestamp,
                timeframe,
                brokenLevel: lastHh,
            });
        }
        lastHh = high.price;
    }

    for (const low of swingLows) {
        if (lastLl !== null && low.price < lastLl) {
            events.push({
                id: `bos_bear_l_${timeframe}_${low.index}`,
                type: "BOS",
                direction: "bearish",
                price: low.price,
                timestamp: low.timestamp,
                timeframe,
                brokenLevel: lastLl,
            });
        }
        lastLl = low.price;
    }

    let prevStructure: "bullish" | "bearish" | null = null;
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (event.type === "BOS") {
            if (prevStructure && event.direction !== prevStructure) {
                events[i] = { ...event, type: "CHOCH" };
            }
            prevStructure = event.direction;
        }
    }

    return events.sort((a, b) => a.timestamp - b.timestamp);
}

export function getOverallStructureBias(events: MarketStructureEvent[]): "bullish" | "bearish" | "neutral" {
    const recentBos = events.filter((e) => e.type === "BOS" || e.type === "CHOCH").slice(-5);
    if (recentBos.length === 0) return "neutral";

    const bullish = recentBos.filter((e) => e.direction === "bullish").length;
    const bearish = recentBos.filter((e) => e.direction === "bearish").length;

    if (bullish > bearish) return "bullish";
    if (bearish > bullish) return "bearish";
    return "neutral";
}
