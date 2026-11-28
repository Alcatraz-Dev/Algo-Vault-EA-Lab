/**
 * BTCUSD Smart Money scalper — deterministic rules, no fabrication.
 *
 * Smart-money entries are a SEQUENCE, not a single-bar pattern, so the
 * evaluator walks recent bars and accepts the first qualifying setup:
 *
 *   1. Liquidity sweep — a bar wicks through the prior N-bar extreme and
 *      closes back inside it (sell-side sweep for longs, buy-side for
 *      shorts). The swept extreme is the stop anchor.
 *   2. Displacement gap — after the sweep, a three-candle fair value gap
 *      prints in the trade direction.
 *   3. Retest — the latest closed bar trades back into that gap, i.e. the
 *      entry is on the retest rather than chasing the displacement.
 *
 * Stops sit beyond the swept extreme plus an ATR buffer. Targets go to the
 * post-sweep leg extreme when it clears the configured R:R, otherwise to the
 * R:R distance; if the final R:R does not clear the minimum there is no
 * setup and the function returns null rather than forcing a trade.
 *
 * Callers must pass CLOSED candles only (`candles.slice(0, -1)`) so a forming
 * bar can never trigger an entry. This is a rule-based approximation of SMC,
 * not a guarantee of edge.
 */

import type { MarketCandle } from "@/lib/market-data/types";

export type SmartMoneyDirection = "long" | "short" | "both";

export interface SmartMoneyScalpingConfig {
    /** The platform feed instrument this bot evaluates (always BTCUSD). */
    symbol: "BTCUSD";
    /**
     * The symbol name sent to the broker. Brokers name Bitcoin differently
     * (`BTCUSD`, `BTCUSD.m`, `BTCUSD.raw`, ...); the market feed stays BTCUSD
     * but the order must use the name the MT5 account actually lists.
     */
    brokerSymbol: string;
    /** Entry timeframe. */
    timeframe: "M1";
    /** Which side the bot may take. */
    direction: SmartMoneyDirection;
    /** Bars used for the sweep extreme. */
    sweepLookback: number;
    /** How many recent bars may contain the sweep. */
    sweepWindow: number;
    /** Minimum reward-to-risk for a setup to qualify. */
    minRiskReward: number;
    /** ATR period used for the stop buffer and the gap tolerance. */
    atrPeriod: number;
    /** Extra stop distance beyond the sweep, as a fraction of ATR. */
    slAtrBuffer: number;
    /** Estimated spread ceiling in USD — skip the entry above it. */
    maxSpreadUsd: number;
    /** Max concurrent positions for this bot. */
    maxPositions: number;
    /** Warm-up bars required before the first evaluation. */
    warmUpCandles: number;
    /** Magic number stamped on every order this bot opens. */
    magicNumber: number;
    /** Master switch (start/stop also gates the runtime). */
    enabled: boolean;
}

export const BTCUSD_SMART_MONEY_DEFAULTS: SmartMoneyScalpingConfig = {
    symbol: "BTCUSD",
    brokerSymbol: "BTCUSD",
    timeframe: "M1",
    direction: "both",
    sweepLookback: 20,
    sweepWindow: 5,
    minRiskReward: 2,
    atrPeriod: 14,
    slAtrBuffer: 0.25,
    maxSpreadUsd: 6,
    maxPositions: 1,
    warmUpCandles: 30,
    magicNumber: 70002,
    enabled: true,
};

export interface SmartMoneySetup {
    direction: "long" | "short";
    entry: number;
    sl: number;
    tp: number;
    /** Distance entry→SL in price units (always positive). */
    risk: number;
    riskReward: number;
    /** Human-readable confluences that produced the setup. */
    reasons: string[];
    /** Timestamp of the sweep bar that anchors this setup. */
    sweepTimestamp: number;
    /** How many closed bars ago the sweep printed. */
    sweepAgeBars: number;
    /** ATR at evaluation time, for display. */
    atr: number;
}

function trueRange(prev: MarketCandle | undefined, candle: MarketCandle): number {
    if (!prev) return candle.high - candle.low;
    return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - prev.close),
        Math.abs(candle.low - prev.close)
    );
}

/** Simple ATR over the last `period` bars; null when there is not enough data. */
export function averageTrueRange(
    candles: readonly MarketCandle[],
    period: number
): number | null {
    const bars = Math.max(2, Math.floor(period));
    if (candles.length < bars + 1) return null;
    let sum = 0;
    for (let i = candles.length - bars; i < candles.length; i += 1) {
        sum += trueRange(candles[i - 1], candles[i]);
    }
    const atr = sum / bars;
    return Number.isFinite(atr) && atr > 0 ? atr : null;
}

/**
 * Most recent bullish imbalance formed at/after `fromIndex` whose zone the
 * current price is retesting.
 */
function findBullishFvg(
    candles: readonly MarketCandle[],
    fromIndex: number,
    price: number,
    atr: number
): { low: number; high: number } | null {
    const firstPossible = Math.max(2, fromIndex + 2);
    for (let i = candles.length - 1; i >= firstPossible; i -= 1) {
        const gapLow = candles[i - 2].high;
        const gapHigh = candles[i].low;
        if (gapHigh <= gapLow) continue;
        if (price <= gapHigh && price >= gapLow - atr * 0.25) {
            return { low: gapLow, high: gapHigh };
        }
    }
    return null;
}

/**
 * Most recent bearish imbalance formed at/after `fromIndex` whose zone the
 * current price is retesting.
 */
function findBearishFvg(
    candles: readonly MarketCandle[],
    fromIndex: number,
    price: number,
    atr: number
): { low: number; high: number } | null {
    const firstPossible = Math.max(2, fromIndex + 2);
    for (let i = candles.length - 1; i >= firstPossible; i -= 1) {
        const gapLow = candles[i].high;
        const gapHigh = candles[i - 2].low;
        if (gapHigh <= gapLow) continue;
        if (price >= gapLow - atr * 0.25 && price <= gapHigh) {
            return { low: gapLow, high: gapHigh };
        }
    }
    return null;
}

/**
 * Evaluate the SMC sequence on CLOSED M1 candles (oldest → newest).
 *
 * Returns the first qualifying setup, or null. The caller owns the spread cap,
 * the position cap and the "one evaluation per closed bar" guard.
 */
export function evaluateSmartMoneySetup(
    candles: readonly MarketCandle[],
    config: SmartMoneyScalpingConfig
): SmartMoneySetup | null {
    if (!config.enabled) return null;

    const lookback = Math.max(3, Math.floor(config.sweepLookback));
    const sweepWindow = Math.max(1, Math.floor(config.sweepWindow));
    const atrPeriod = Math.max(2, Math.floor(config.atrPeriod));
    // Enough history for the sweep window AND its lookback.
    const minLength = Math.max(
        lookback + sweepWindow + 2,
        atrPeriod + 2,
        Math.floor(config.warmUpCandles) + 1
    );
    if (candles.length < minLength) return null;

    const atr = averageTrueRange(candles, atrPeriod);
    if (atr === null) return null;

    const lastIndex = candles.length - 1;
    const lastBar = candles[lastIndex];
    const entry = lastBar.close;
    if (!Number.isFinite(entry) || entry <= 0) return null;

    const allowLong = config.direction !== "short";
    const allowShort = config.direction !== "long";
    const minReward = Math.max(1, config.minRiskReward);
    const buffer = atr * Math.max(0, config.slAtrBuffer);

    // Newest sweep first, so the freshest structure wins.
    for (let s = lastIndex; s > lastIndex - sweepWindow && s >= 1; s -= 1) {
        const sweepBar = candles[s];
        const priorStart = Math.max(0, s - lookback);
        if (s - priorStart < 3) continue;
        const prior = candles.slice(priorStart, s);
        const priorLow = Math.min(...prior.map((c) => c.low));
        const priorHigh = Math.max(...prior.map((c) => c.high));
        const sweepAgeBars = lastIndex - s;

        // ── Long: sell-side sweep, reclaimed, gap retested ────────────────
        if (
            allowLong &&
            sweepBar.low < priorLow &&
            sweepBar.close > priorLow
        ) {
            const gap = findBullishFvg(candles, s, entry, atr);
            if (gap) {
                const sl = sweepBar.low - buffer;
                const risk = entry - sl;
                if (risk > 0) {
                    const legHigh = Math.max(
                        ...candles.slice(s, lastIndex + 1).map((c) => c.high)
                    );
                    const rrTarget = entry + risk * minReward;
                    const tp = legHigh >= rrTarget ? legHigh : rrTarget;
                    const riskReward = (tp - entry) / risk;
                    if (riskReward >= minReward) {
                        return {
                            direction: "long",
                            entry,
                            sl,
                            tp,
                            risk,
                            riskReward,
                            reasons: [
                                `sell-side sweep of the ${lookback}-bar low (${sweepAgeBars} bar${sweepAgeBars === 1 ? "" : "s"} ago)`,
                                `bullish FVG retest ${gap.low.toFixed(2)}–${gap.high.toFixed(2)}`,
                                "stop beyond the swept low; target at the leg high or R:R",
                            ],
                            sweepTimestamp: sweepBar.timestamp,
                            sweepAgeBars,
                            atr,
                        };
                    }
                }
            }
        }

        // ── Short: buy-side sweep, rejected, gap retested ─────────────────
        if (
            allowShort &&
            sweepBar.high > priorHigh &&
            sweepBar.close < priorHigh
        ) {
            const gap = findBearishFvg(candles, s, entry, atr);
            if (gap) {
                const sl = sweepBar.high + buffer;
                const risk = sl - entry;
                if (risk > 0) {
                    const legLow = Math.min(
                        ...candles.slice(s, lastIndex + 1).map((c) => c.low)
                    );
                    const rrTarget = entry - risk * minReward;
                    const tp = legLow <= rrTarget ? legLow : rrTarget;
                    const riskReward = (entry - tp) / risk;
                    if (riskReward >= minReward) {
                        return {
                            direction: "short",
                            entry,
                            sl,
                            tp,
                            risk,
                            riskReward,
                            reasons: [
                                `buy-side sweep of the ${lookback}-bar high (${sweepAgeBars} bar${sweepAgeBars === 1 ? "" : "s"} ago)`,
                                `bearish FVG retest ${gap.low.toFixed(2)}–${gap.high.toFixed(2)}`,
                                "stop beyond the swept high; target at the leg low or R:R",
                            ],
                            sweepTimestamp: sweepBar.timestamp,
                            sweepAgeBars,
                            atr,
                        };
                    }
                }
            }
        }
    }

    return null;
}
