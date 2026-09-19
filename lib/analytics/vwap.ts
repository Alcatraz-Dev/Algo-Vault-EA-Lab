import { VWAPData, MarketCandle } from "../market-data/types";

function getTypicalPrice(candle: MarketCandle): number {
    return (candle.high + candle.low + candle.close) / 3;
}

export function calculateVWAP(
    candles: MarketCandle[],
    period: VWAPData["period"] = "session"
): VWAPData {
    if (candles.length === 0) {
        return {
            vwap: 0,
            upperBand1: 0,
            lowerBand1: 0,
            upperBand2: 0,
            lowerBand2: 0,
            distance: 0,
            distancePercent: 0,
            period,
        };
    }

    let filteredCandles = candles;

    if (period === "session") {
        const now = Date.now();
        const sessionStart = new Date(now);
        sessionStart.setUTCHours(0, 0, 0, 0);
        const sessionStartMs = sessionStart.getTime();
        filteredCandles = candles.filter((c) => c.timestamp >= sessionStartMs);
    } else if (period === "daily") {
        const now = Date.now();
        const dayStart = new Date(now);
        dayStart.setUTCHours(0, 0, 0, 0);
        filteredCandles = candles.filter((c) => c.timestamp >= dayStart.getTime());
    } else if (period === "weekly") {
        const now = Date.now();
        const weekStart = new Date(now);
        const dayOfWeek = weekStart.getUTCDay();
        weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek);
        weekStart.setUTCHours(0, 0, 0, 0);
        filteredCandles = candles.filter((c) => c.timestamp >= weekStart.getTime());
    }

    if (filteredCandles.length === 0) {
        filteredCandles = candles.slice(-20);
    }

    let cumTypicalPriceVolume = 0;
    let cumVolume = 0;

    const vwapPoints: number[] = [];

    for (const candle of filteredCandles) {
        const tp = getTypicalPrice(candle);
        const vol = candle.volume || 1;
        cumTypicalPriceVolume += tp * vol;
        cumVolume += vol;
        vwapPoints.push(cumVolume > 0 ? cumTypicalPriceVolume / cumVolume : tp);
    }

    const vwap = vwapPoints[vwapPoints.length - 1] || 0;
    const currentPrice = candles[candles.length - 1].close;

    let sumSquaredDev = 0;
    for (let i = 0; i < vwapPoints.length; i++) {
        sumSquaredDev += Math.pow(vwapPoints[i] - vwap, 2);
    }
    const stdDev = Math.sqrt(sumSquaredDev / vwapPoints.length) || 0;

    const distance = currentPrice - vwap;
    const distancePercent = vwap !== 0 ? (distance / vwap) * 100 : 0;

    return {
        vwap: Number(vwap.toFixed(5)),
        upperBand1: Number((vwap + stdDev).toFixed(5)),
        lowerBand1: Number((vwap - stdDev).toFixed(5)),
        upperBand2: Number((vwap + stdDev * 2).toFixed(5)),
        lowerBand2: Number((vwap - stdDev * 2).toFixed(5)),
        distance: Number(distance.toFixed(5)),
        distancePercent: Number(distancePercent.toFixed(3)),
        period,
    };
}

export function getVWAPPosition(price: number, vwap: VWAPData): "above" | "below" | "at" {
    const diff = Math.abs(price - vwap.vwap);
    const threshold = vwap.vwap * 0.0001;

    if (diff < threshold) return "at";
    return price > vwap.vwap ? "above" : "below";
}
