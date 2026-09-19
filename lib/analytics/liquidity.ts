import { LiquidityLevel, LiquiditySweep, MarketCandle, Timeframe } from "../market-data/types";

function findEqualLevels(candles: MarketCandle[], type: "highs" | "lows", tolerance: number = 0.001): { price: number; count: number; timestamps: number[] }[] {
    const levels: { price: number; count: number; timestamps: number[] }[] = [];

    const prices = type === "highs"
        ? candles.map((c) => c.high)
        : candles.map((c) => c.low);

    const used = new Set<number>();

    for (let i = 0; i < prices.length; i++) {
        if (used.has(i)) continue;

        const matching: number[] = [i];
        for (let j = i + 1; j < prices.length; j++) {
            if (used.has(j)) continue;
            if (Math.abs(prices[j] - prices[i]) / prices[i] < tolerance) {
                matching.push(j);
                used.add(j);
            }
        }

        if (matching.length >= 2) {
            const avgPrice = matching.reduce((sum, idx) => sum + prices[idx], 0) / matching.length;
            levels.push({
                price: avgPrice,
                count: matching.length,
                timestamps: matching.map((idx) => candles[idx].timestamp),
            });
        }
    }

    return levels;
}

function getPreviousDayLevels(candles: MarketCandle[]): { high: number; low: number } | null {
    if (candles.length < 2) return null;

    const lastTimestamp = candles[candles.length - 1].timestamp;
    const dayMs = 24 * 60 * 60 * 1000;
    const previousDayStart = lastTimestamp - dayMs;
    const previousDayCandles = candles.filter(
        (c) => c.timestamp >= previousDayStart && c.timestamp < lastTimestamp
    );

    if (previousDayCandles.length === 0) return null;

    return {
        high: Math.max(...previousDayCandles.map((c) => c.high)),
        low: Math.min(...previousDayCandles.map((c) => c.low)),
    };
}

function getPreviousWeekLevels(candles: MarketCandle[]): { high: number; low: number } | null {
    if (candles.length < 2) return null;

    const lastTimestamp = candles[candles.length - 1].timestamp;
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const previousWeekStart = lastTimestamp - weekMs;
    const previousWeekCandles = candles.filter(
        (c) => c.timestamp >= previousWeekStart && c.timestamp < lastTimestamp
    );

    if (previousWeekCandles.length === 0) return null;

    return {
        high: Math.max(...previousWeekCandles.map((c) => c.high)),
        low: Math.min(...previousWeekCandles.map((c) => c.low)),
    };
}

function getSwingHighLows(candles: MarketCandle[], lookback: number = 3): LiquidityLevel[] {
    const levels: LiquidityLevel[] = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
        const window = candles.slice(i - lookback, i + lookback + 1);
        const current = candles[i];

        if (window.every((c) => c.high <= current.high)) {
            levels.push({
                id: `sl_sh_${i}`,
                type: "swing_high",
                price: current.high,
                strength: Math.min(100, 50 + (candles.length - i)),
                timeframe: "H1",
                timestamp: current.timestamp,
            });
        }

        if (window.every((c) => c.low >= current.low)) {
            levels.push({
                id: `sl_sl_${i}`,
                type: "swing_low",
                price: current.low,
                strength: Math.min(100, 50 + (candles.length - i)),
                timeframe: "H1",
                timestamp: current.timestamp,
            });
        }
    }

    return levels;
}

function detectSweeps(candles: MarketCandle[], levels: LiquidityLevel[]): LiquiditySweep[] {
    const sweeps: LiquiditySweep[] = [];

    for (const level of levels) {
        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i];

            if (level.type === "swing_high" || level.type === "equal_highs") {
                if (candle.high > level.price && candle.close < level.price) {
                    sweeps.push({
                        id: `sweep_${level.id}_${i}`,
                        type: "sweep",
                        side: "sell_side",
                        level: level.price,
                        sweepPrice: candle.high,
                        confirmed: candle.close < candle.open,
                        timestamp: candle.timestamp,
                    });
                }
            }

            if (level.type === "swing_low" || level.type === "equal_lows") {
                if (candle.low < level.price && candle.close > level.price) {
                    sweeps.push({
                        id: `sweep_${level.id}_${i}`,
                        type: "sweep",
                        side: "buy_side",
                        level: level.price,
                        sweepPrice: candle.low,
                        confirmed: candle.close > candle.open,
                        timestamp: candle.timestamp,
                    });
                }
            }
        }
    }

    return sweeps.slice(-10);
}

export function detectLiquidity(candles: MarketCandle[], timeframe: Timeframe): {
    levels: LiquidityLevel[];
    sweeps: LiquiditySweep[];
} {
    if (candles.length < 20) return { levels: [], sweeps: [] };

    const levels: LiquidityLevel[] = [];

    const equalHighs = findEqualLevels(candles, "highs");
    for (const eh of equalHighs) {
        levels.push({
            id: `eqh_${eh.price.toFixed(5)}`,
            type: "equal_highs",
            price: eh.price,
            strength: Math.min(100, 40 + eh.count * 15),
            timeframe,
            timestamp: eh.timestamps[eh.timestamps.length - 1],
        });
    }

    const equalLows = findEqualLevels(candles, "lows");
    for (const el of equalLows) {
        levels.push({
            id: `eql_${el.price.toFixed(5)}`,
            type: "equal_lows",
            price: el.price,
            strength: Math.min(100, 40 + el.count * 15),
            timeframe,
            timestamp: el.timestamps[el.timestamps.length - 1],
        });
    }

    const pdl = getPreviousDayLevels(candles);
    if (pdl) {
        levels.push({
            id: "pdl_high",
            type: "prev_day_high",
            price: pdl.high,
            strength: 70,
            timeframe,
            timestamp: candles[candles.length - 2]?.timestamp || 0,
        });
        levels.push({
            id: "pdl_low",
            type: "prev_day_low",
            price: pdl.low,
            strength: 70,
            timeframe,
            timestamp: candles[candles.length - 2]?.timestamp || 0,
        });
    }

    const pwl = getPreviousWeekLevels(candles);
    if (pwl) {
        levels.push({
            id: "pwl_high",
            type: "prev_week_high",
            price: pwl.high,
            strength: 80,
            timeframe,
            timestamp: candles[candles.length - 2]?.timestamp || 0,
        });
        levels.push({
            id: "pwl_low",
            type: "prev_week_low",
            price: pwl.low,
            strength: 80,
            timeframe,
            timestamp: candles[candles.length - 2]?.timestamp || 0,
        });
    }

    const swingLevels = getSwingHighLows(candles);
    levels.push(...swingLevels);

    const sweeps = detectSweeps(candles, levels);

    return { levels: levels.sort((a, b) => b.strength - a.strength), sweeps };
}
