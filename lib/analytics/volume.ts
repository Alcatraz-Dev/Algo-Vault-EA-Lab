import { VolumeData, MarketCandle } from "../market-data/types";

export function analyzeVolume(candles: MarketCandle[]): VolumeData {
    const volumes = candles.map((c) => c.volume || 0);
    const hasVolume = volumes.some((v) => v > 0);

    if (!hasVolume) {
        return {
            volume: 0,
            averageVolume: 0,
            relativeVolume: 0,
            state: "normal",
            isTickVolume: true,
        };
    }

    const currentVolume = volumes[volumes.length - 1] || 0;
    const lookback = Math.min(20, volumes.length - 1);
    const recentVolumes = volumes.slice(-lookback - 1, -1);
    const averageVolume = recentVolumes.length > 0
        ? recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length
        : currentVolume;

    const relativeVolume = averageVolume > 0 ? currentVolume / averageVolume : 0;

    let state: VolumeData["state"] = "normal";
    if (relativeVolume > 2.0) state = "expanded";
    else if (relativeVolume > 1.5) state = "expanded";
    else if (relativeVolume < 0.5) state = "contracted";
    else if (relativeVolume < 0.7) state = "contracted";

    return {
        volume: currentVolume,
        averageVolume: Math.round(averageVolume),
        relativeVolume: Number(relativeVolume.toFixed(2)),
        state,
        isTickVolume: true,
    };
}

export function detectVolumeSpike(candles: MarketCandle[], threshold: number = 2.0): boolean {
    const volumes = candles.map((c) => c.volume || 0);
    if (volumes.length < 5) return false;

    const current = volumes[volumes.length - 1] || 0;
    const recent = volumes.slice(-21, -1).filter((v) => v > 0);
    if (recent.length === 0) return false;

    const avg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
    return avg > 0 && current / avg >= threshold;
}

export function getVolumeProfile(candles: MarketCandle[], levels: number = 20): { price: number; volume: number }[] {
    if (candles.length === 0) return [];

    const allHighs = candles.map((c) => c.high);
    const allLows = candles.map((c) => c.low);
    const maxPrice = Math.max(...allHighs);
    const minPrice = Math.min(...allLows);
    const range = maxPrice - minPrice;

    if (range === 0) return [];

    const step = range / levels;
    const profile: { price: number; volume: number }[] = [];

    for (let i = 0; i < levels; i++) {
        const levelLow = minPrice + i * step;
        const levelHigh = levelLow + step;
        const midPrice = (levelLow + levelHigh) / 2;

        let totalVolume = 0;
        for (const candle of candles) {
            if (candle.high >= levelLow && candle.low <= levelHigh) {
                totalVolume += candle.volume || 1;
            }
        }

        profile.push({ price: midPrice, volume: totalVolume });
    }

    return profile;
}
