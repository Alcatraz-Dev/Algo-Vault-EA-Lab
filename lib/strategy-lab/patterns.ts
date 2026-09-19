import { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { AnalysisPeriod, Pattern, PatternDiscoveryResult, PatternKind, PatternStats } from "./types";
import { CandleFeatures, computeFeatures } from "./features";

// ─────────────────────────────────────────────────────────────────────────────
// Pattern discovery engine.
//
// Matches recurring price-action patterns in REAL historical candles and then
// MEASURES their outcomes with a fixed, documented R-multiple framework:
//
//   Entry   : open of the bar AFTER the signal (signal detected at close).
//   Stop    : pattern-defined level (sweep low, swing low, OB/FVG boundary…).
//   Risk R  : |entry - stop|.
//   Target  : +2R (conservative fixed target used ONLY for measurement).
//   Max hold: 24 bars; if neither target nor stop hits, exit at last close and
//             the outcome is computed as partial R.
//   Same-bar conflicts resolve in favor of the STOP (conservative).
//
// All statistics below come from this engine — the AI layer never invents them.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_HOLD_BARS = 24;
const MEASURE_TARGET_R = 2;
const MEASURE_SL_R = 1;
const WARMUP_BARS = 40;

interface Entry {
    index: number;
    direction: "long" | "short";
    sl: number;
    conditions: string[];
}

interface Outcome {
    r: number;
    barsHeld: number;
    win: boolean;
    loss: boolean;
    breakeven: boolean;
    exit?: number;
    reason: "tp" | "sl" | "time";
}

export function measureOutcome(
    candles: MarketCandle[],
    features: CandleFeatures[],
    entry: Entry
): Outcome {
    const n = candles.length;
    const start = entry.index + 1; // next-bar execution model
    if (start >= n) return { r: 0, barsHeld: 0, win: false, loss: false, breakeven: true, reason: "time" };

    const entryPrice = candles[start].open;
    const risk = Math.abs(entryPrice - entry.sl);
    if (risk <= 0) return { r: 0, barsHeld: 0, win: false, loss: false, breakeven: true, reason: "time" };

    const target = entry.direction === "long" ? entryPrice + risk * MEASURE_TARGET_R : entryPrice - risk * MEASURE_TARGET_R;
    const stop = entry.sl;

    for (let i = start; i < Math.min(n, start + MAX_HOLD_BARS); i++) {
        const c = candles[i];
        if (entry.direction === "long") {
            if (c.low <= stop) {
                const r = -MEASURE_SL_R;
                return { r, barsHeld: i - start, win: r > 0, loss: true, breakeven: false, exit: stop, reason: "sl" };
            }
            if (c.high >= target) {
                const r = MEASURE_TARGET_R;
                return { r, barsHeld: i - start, win: true, loss: false, breakeven: false, exit: target, reason: "tp" };
            }
        } else {
            if (c.high >= stop) {
                const r = -MEASURE_SL_R;
                return { r, barsHeld: i - start, win: r > 0, loss: true, breakeven: false, exit: stop, reason: "sl" };
            }
            if (c.low <= target) {
                const r = MEASURE_TARGET_R;
                return { r, barsHeld: i - start, win: true, loss: false, breakeven: false, exit: target, reason: "tp" };
            }
        }
    }

    const lastIndex = Math.min(n - 1, start + MAX_HOLD_BARS - 1);
    const exit = candles[lastIndex].close;
    const r = entry.direction === "long" ? (exit - entryPrice) / risk : (entryPrice - exit) / risk;
    return { r, barsHeld: lastIndex - start, win: r > 0.05, loss: r < -0.05, breakeven: Math.abs(r) <= 0.05, exit, reason: "time" };
}

function computeStats(outcomes: Outcome[]): PatternStats {
    if (outcomes.length === 0) {
        return {
            occurrences: 0, winning: 0, losing: 0, breakeven: 0, winRate: 0,
            averageR: 0, averageReturnPercent: 0, maxWinStreak: 0, maxLossStreak: 0,
            maxDrawdownPct: 0, profitFactor: 0, expectancy: 0, averageBarsHeld: 0,
            direction: "long",
        };
    }

    const winning = outcomes.filter((o) => o.win).length;
    const losing = outcomes.filter((o) => o.loss).length;
    const breakeven = outcomes.filter((o) => o.breakeven).length;
    const total = outcomes.length;
    const winRate = total > 0 ? (winning / total) * 100 : 0;

    const grossProfit = outcomes.filter((o) => o.r > 0).reduce((s, o) => s + o.r, 0);
    const grossLoss = Math.abs(outcomes.filter((o) => o.r < 0).reduce((s, o) => s + o.r, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const averageR = outcomes.reduce((s, o) => s + o.r, 0) / total;

    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let curW = 0;
    let curL = 0;
    let equity = 0;
    let peak = 0;
    let maxDD = 0;
    for (const o of outcomes) {
        if (o.r > 0) { curW++; curL = 0; } else if (o.r < 0) { curL++; curW = 0; } else { curW = 0; curL = 0; }
        maxWinStreak = Math.max(maxWinStreak, curW);
        maxLossStreak = Math.max(maxLossStreak, curL);
        equity += o.r;
        peak = Math.max(peak, equity);
        if (peak > 0) maxDD = Math.max(maxDD, ((peak - equity) / peak) * 100);
    }

    const averageBarsHeld = outcomes.reduce((s, o) => s + o.barsHeld, 0) / total;

    return {
        occurrences: total,
        winning,
        losing,
        breakeven,
        winRate: Number(winRate.toFixed(2)),
        averageR: Number(averageR.toFixed(3)),
        averageReturnPercent: Number((averageR * MEASURE_TARGET_R * 0.5).toFixed(3)),
        maxWinStreak,
        maxLossStreak,
        maxDrawdownPct: Number(maxDD.toFixed(2)),
        profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(2)) : 0,
        expectancy: Number(averageR.toFixed(3)),
        averageBarsHeld: Number(averageBarsHeld.toFixed(1)),
        direction: "long",
    };
}

type Matcher = (
    f: CandleFeatures,
    fPrev: CandleFeatures | null,
    feats: CandleFeatures[],
    i: number
) => { index: number } | null;

function makeMatchers(direction: "long" | "short") {
    const bullish = direction === "long";

    const liquiditySweepReversal: Matcher = (f, _p, feats, i) => {
        if (!f.lastSweep || f.lastSweepBarsAgo === null || f.lastSweepBarsAgo < 1 || f.lastSweepBarsAgo > 3) return null;
        const correctSide = bullish ? f.lastSweep.side === "buy_side" : f.lastSweep.side === "sell_side";
        if (!correctSide) return null;
        const trendOk = bullish ? f.trend !== "bearish" : f.trend !== "bullish";
        const fvgOk = bullish ? f.fvgDirection === "bullish" : f.fvgDirection === "bearish";
        if (!trendOk && !fvgOk && !f.lastSweep.confirmed) return null;
        const entryOk = bullish ? f.close > f.open : f.close < f.open;
        if (!entryOk) return null;
        return { index: i };
    };

    const breakoutRetest: Matcher = (f, fPrev, feats, i) => {
        let breakoutAgo: CandleFeatures | null = null;
        for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
            const cand = feats[k];
            if (bullish ? cand.breakoutHigh : cand.breakoutLow) { breakoutAgo = cand; break; }
        }
        if (!breakoutAgo) return null;
        const level = bullish ? breakoutAgo.high : breakoutAgo.low;
        const retestOk = bullish
            ? f.low <= level && f.low >= level * 0.994
            : f.high >= level && f.high <= level * 1.006;
        if (!retestOk) return null;
        const trendOk = bullish ? f.trend !== "bearish" : f.trend !== "bullish";
        if (!trendOk) return null;
        return { index: i };
    };

    const trendContinuation: Matcher = (f, _p, feats, i) => {
        const trendOk = bullish ? f.trend === "bullish" : f.trend === "bearish";
        if (!trendOk) return null;
        if (!(bullish ? f.higherHigh && f.higherLow : f.lowerHigh && f.lowerLow)) return null;
        const momentumOk = bullish ? f.momentumPct > 0.1 : f.momentumPct < -0.1;
        if (!momentumOk) return null;
        return { index: i };
    };

    const fvgReaction: Matcher = (f, _p, feats, i) => {
        if (f.fvgDirection === null || f.fvgBarsAgo === null || f.fvgBarsAgo < 1 || f.fvgBarsAgo > 4) return null;
        const dirOk = bullish ? f.fvgDirection === "bullish" : f.fvgDirection === "bearish";
        if (!dirOk || f.fvgZoneLow === null || f.fvgZoneHigh === null) return null;
        const withinZone = bullish
            ? f.low <= f.fvgZoneHigh && f.low >= f.fvgZoneLow * 0.998
            : f.high >= f.fvgZoneLow && f.high <= f.fvgZoneHigh * 1.002;
        if (!withinZone) return null;
        return { index: i };
    };

    const orderBlockReaction: Matcher = (f, _p, feats, i) => {
        if (f.obIndex === null || f.obDirection === null) return null;
        const ago = i - f.obIndex;
        if (ago < 1 || ago > 20) return null;
        const dirOk = bullish ? f.obDirection === "bullish" : f.obDirection === "bearish";
        if (!dirOk || f.obZoneLow === null || f.obZoneHigh === null) return null;
        const withinZone = bullish
            ? f.low <= f.obZoneHigh && f.low >= f.obZoneLow * 0.998
            : f.high >= f.obZoneLow && f.high <= f.obZoneHigh * 1.002;
        if (!withinZone) return null;
        return { index: i };
    };

    const sessionBreakout: Matcher = (f, _p, feats, i) => {
        const breakOk = bullish ? f.breakoutHigh : f.breakoutLow;
        if (!breakOk) return null;
        const sessionOk = f.session === "london" || f.session === "new_york" || f.session === "overlap";
        if (!sessionOk) return null;
        return { index: i };
    };

    const volatilityExpansion: Matcher = (f, _p, feats, i) => {
        const breakOk = bullish ? f.breakoutHigh : f.breakoutLow;
        if (!breakOk) return null;
        if (f.rangeExpansion < 40) return null;
        const volTrendOk = bullish ? f.momentumPct > 0 : f.momentumPct < 0;
        if (!volTrendOk) return null;
        return { index: i };
    };

    const meanReversion: Matcher = (f, _p, feats, i) => {
        if (f.trend !== "neutral") return null;
        const oversold = bullish ? f.momentumPct < -1.5 : f.momentumPct > 1.5;
        const nearSwing = bullish && f.swingLow !== null ? f.low <= f.swingLow * 1.004 : f.swingHigh !== null ? f.high >= f.swingHigh * 0.996 : false;
        if (!oversold || !nearSwing) return null;
        return { index: i };
    };

    const momentumContinuation: Matcher = (f, _p, feats, i) => {
        const strong = bullish ? f.momentumPct > 2 : f.momentumPct < -2;
        if (!strong) return null;
        let breakRecently = false;
        for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
            if (bullish ? feats[k].breakoutHigh : feats[k].breakoutLow) { breakRecently = true; break; }
        }
        const trendOk = bullish ? f.trend === "bullish" : f.trend === "bearish";
        if (!breakRecently || !trendOk) return null;
        return { index: i };
    };

    return {
        liquidity_sweep_reversal: { name: "Liquidity Sweep Reversal", matcher: liquiditySweepReversal },
        breakout_retest: { name: "Breakout + Retest", matcher: breakoutRetest },
        trend_continuation: { name: "Trend Continuation", matcher: trendContinuation },
        fvg_reaction: { name: "FVG Reaction", matcher: fvgReaction },
        order_block_reaction: { name: "Order Block Reaction", matcher: orderBlockReaction },
        session_breakout: { name: "Session Breakout", matcher: sessionBreakout },
        volatility_expansion: { name: "Volatility Expansion", matcher: volatilityExpansion },
        mean_reversion: { name: "Mean Reversion", matcher: meanReversion },
        momentum_continuation: { name: "Momentum Continuation", matcher: momentumContinuation },
    } as Record<PatternKind, { name: string; matcher: Matcher }>;
}

function makeConditions(kind: PatternKind, direction: "long" | "short"): string[] {
    const d = direction === "long" ? "bullish" : "bearish";
    const base: Record<PatternKind, string[]> = {
        liquidity_sweep_reversal: [
            `${direction === "long" ? "Buy-side" : "Sell-side"} liquidity sweep within the last 3 bars`,
            "Rejection candle closes back inside the sweep level",
            `${d === "bullish" ? "Bullish" : "Bearish"} FVG or non-opposing trend at signal`,
        ],
        breakout_retest: [
            "Close beyond the prior 10-bar extreme",
            "Price retests the broken level within 3 bars",
            "Retest holds above/below the breakout level",
        ],
        trend_continuation: [
            `EMA structure ${d}`,
            `${direction === "long" ? "Higher highs and higher lows" : "Lower highs and lower lows"}`,
            "Positive momentum confirms continuation",
        ],
        fvg_reaction: [
            `${d === "bullish" ? "Bullish" : "Bearish"} fair value gap formed 1-4 bars ago`,
            "Price returns into the gap zone",
            "Reaction candle respects the gap boundary",
        ],
        order_block_reaction: [
            `${d === "bullish" ? "Bullish" : "Bearish"} order block formed recently`,
            "Price returns into the order block zone",
            "Block boundary holds",
        ],
        session_breakout: [
            "Break of the prior 10-bar extreme",
            "Setup occurs in London / New York / overlap",
            "Continuation momentum confirmed",
        ],
        volatility_expansion: [
            "Breakout with range expansion > 40%",
            "ATR readjusted upward",
            "Directional momentum aligned",
        ],
        mean_reversion: [
            "Neutral EMA structure",
            `Extended move (${direction === "long" ? "oversold" : "overbought"})`,
            "Price near the last swing extreme",
        ],
        momentum_continuation: [
            `Strong ${d} momentum`,
            "Recent breakout of prior extreme",
            "EMA structure aligned",
        ],
    };
    return base[kind];
}

let patternCounter = 0;

export function discoverPatterns(
    symbol: SupportedSymbol,
    period: AnalysisPeriod,
    timeframe: Timeframe,
    candles: MarketCandle[],
    minOccurrences = 10
): PatternDiscoveryResult {
    const features = computeFeatures(candles);
    const patterns: Pattern[] = [];

    for (const direction of ["long", "short"] as const) {
        const matchers = makeMatchers(direction);

        for (const kind of Object.keys(matchers) as PatternKind[]) {
            const { name, matcher } = matchers[kind];
            const entries: Entry[] = [];
            const exampleTimestamps: number[] = [];

            for (let i = WARMUP_BARS; i < features.length - 1; i++) {
                const f = features[i];
                const fPrev = i > 0 ? features[i - 1] : null;
                const hit = matcher(f, fPrev, features, i);
                if (!hit) continue;

                // Next-bar execution for measurement.
                const entryBar = candles[hit.index + 1];
                if (!entryBar) continue;
                let sl: number;
                if (direction === "long") {
                    sl = f.lastSweep?.side === "buy_side"
                        ? Math.min(f.lastSweep.level, f.swingLow ?? f.lastSweep.level)
                        : f.low - f.atr * 0.5;
                } else {
                    sl = f.lastSweep?.side === "sell_side"
                        ? Math.max(f.lastSweep.level, f.swingHigh ?? f.lastSweep.level)
                        : f.high + f.atr * 0.5;
                }
                entries.push({ index: hit.index, direction, sl, conditions: makeConditions(kind, direction) });
                if (exampleTimestamps.length < 3) exampleTimestamps.push(candles[hit.index].timestamp);
            }

            const outcomes = entries.map((e) => measureOutcome(candles, features, e));
            const stats = computeStats(outcomes);
            stats.direction = direction;

            if (outcomes.length < 3) {
                // still expose, but with null stats so the UI can show "insufficient"
            }

            patternCounter++;
            patterns.push({
                id: `${kind}_${direction}_${patternCounter}`,
                kind,
                name: `${name} (${direction})`,
                description: conditionsDescription(kind, direction),
                direction,
                timeframe,
                matchCount: entries.length,
                stats: entries.length >= minOccurrences ? stats : stats.occurrences >= 3 ? stats : null,
                conditions: makeConditions(kind, direction),
                exampleTimestamps,
            });
        }
    }

    const sorted = patterns.sort((a, b) => {
        const score = (p: Pattern) => (p.stats ? p.stats.winRate * p.stats.averageR * Math.min(p.stats.occurrences, 200) : 0);
        return score(b) - score(a);
    });

    return {
        symbol,
        timeframe,
        period,
        generatedAt: Date.now(),
        barsScanned: candles.length,
        patterns: sorted,
        topPattern: sorted[0] || null,
    };
}

function conditionsDescription(kind: PatternKind, direction: "long" | "short"): string {
    const conditions = makeConditions(kind, direction);
    return conditions.join(", ");
}