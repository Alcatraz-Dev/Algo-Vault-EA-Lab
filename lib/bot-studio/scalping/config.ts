export type XauUsdScalpingTpLevel = 1 | 2;

export interface XauUsdScalpingConfig {
    /** Entry timeframe — the M1 chart the bot trades on. */
    timeframe: "M1";
    /** Direction bias for the scalping logic. */
    direction: "long" | "short";
    /** Take-profit 1 in pips (e.g. 15 = 15 × $0.10 per standard lot on XAUUSD). */
    tp1Pips: number;
    /** Take-profit 2 in pips — locked partial after TP1 is hit. */
    tp2Pips: number;
    /** Stop-loss in pips. */
    slPips: number;
    /** Risk per trade as % of free margin. */
    riskPercent: number;
    /** Max concurrent positions. */
    maxPositions: number;
    /** Warm-up candles required before the first signal. */
    warmUpCandles: number;
    /** Spread ceiling in points — skip signal if spread exceeds this. */
    maxSpreadPoints: number;
    /** Magic number assigned to every order the bot opens. */
    magicNumber: number;
    /** Enabled toggle. */
    enabled: boolean;
}

export const XAUUSD_SCALPING_DEFAULTS: XauUsdScalpingConfig = {
    timeframe: "M1",
    direction: "long",
    tp1Pips: 15,
    tp2Pips: 30,
    slPips: 10,
    riskPercent: 1.0,
    maxPositions: 1,
    warmUpCandles: 50,
    maxSpreadPoints: 15,
    magicNumber: 70001,
    enabled: true,
};

/** Convert a pip value to price distance for XAUUSD (2-digit broker convention: 1 pip = 0.10). */
export function pipsToPrice(pips: number): number {
    // XAUUSD pip = 0.10 (2-digit). 10 pips = 1.00.
    return pips * 0.10;
}

/** Format a pip-based distance as a price delta string for the UI. */
export function formatPipDistance(pips: number): string {
    return `${pips} pips (${pipsToPrice(pips).toFixed(2)})`;
}

/** Derive TP/SL price levels from entry and pip distances. */
export function deriveLevels(
    entry: number,
    tp1Pips: number,
    tp2Pips: number,
    slPips: number,
    direction: "long" | "short",
): { tp1: number; tp2: number; sl: number } {
    const tp1 = direction === "long" ? entry + pipsToPrice(tp1Pips) : entry - pipsToPrice(tp1Pips);
    const tp2 = direction === "long" ? entry + pipsToPrice(tp2Pips) : entry - pipsToPrice(tp2Pips);
    const sl = direction === "long" ? entry - pipsToPrice(slPips) : entry + pipsToPrice(slPips);
    return { tp1, tp2, sl };
}
