import { MarketCandle, MarketSession } from "@/lib/market-data/types";
import { rsi as rsiSeries } from "@/lib/analytics/indicators";
import { buildIndicatorSeries, indicatorRowAt } from "./indicator-library";

// ─────────────────────────────────────────────────────────────────────────────
// Per-candle feature computation used by BOTH the pattern discovery engine and
// the backtest engine. Features at bar `i` only use data known by the close of
// bar `i`. Swing points / sweeps are confirmed with a confirmation lag so the
// engines never peek at future candles (no look-ahead bias).
// ─────────────────────────────────────────────────────────────────────────────

export type TrendLabel = "bullish" | "bearish" | "neutral";
export type VolState = "low" | "normal" | "high" | "extreme";

export interface SweepFeature {
    side: "buy_side" | "sell_side";
    index: number;
    level: number;
    confirmed: boolean;
}

export interface BreakerFeature {
    direction: TrendLabel;
    index: number;
}

export interface CandleFeatures {
    index: number;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    ema20: number;
    ema50: number;
    /** Canonical RSI(14) (lib/market-core indicator engine). null during warmup. */
    rsi: number | null;
    trend: TrendLabel;
    trendScore: number;
    atr: number;
    atrPct: number;
    volState: VolState;
    swingLow: number | null;
    swingHigh: number | null;
    swingLowIndex: number | null;
    swingHighIndex: number | null;
    lastSweep: SweepFeature | null;
    lastSweepBarsAgo: number | null;
    choch: BreakerFeature | null;
    bos: BreakerFeature | null;
    /** Close broke the latest already-confirmed swing high/low on this bar. */
    structureBreakUp: boolean;
    structureBreakDown: boolean;
    /** A close-confirmed swing break against the latest break direction. */
    structureShiftUp: boolean;
    structureShiftDown: boolean;
    bullishFvgRetest: boolean;
    bearishFvgRetest: boolean;
    bullishOrderBlockRetest: boolean;
    bearishOrderBlockRetest: boolean;
    fvgDirection: TrendLabel | null;
    fvgIndex: number | null;
    fvgBarsAgo: number | null;
    fvgZoneHigh: number | null;
    fvgZoneLow: number | null;
    obDirection: TrendLabel | null;
    obIndex: number | null;
    obZoneHigh: number | null;
    obZoneLow: number | null;
    session: MarketSession;
    hour: number;
    weekday: number;
    momentumPct: number;
    breakoutHigh: boolean;
    breakoutLow: boolean;
    rangeExpansion: number;
    higherHigh: boolean;
    higherLow: boolean;
    lowerHigh: boolean;
    lowerLow: boolean;
    /** Indicator library values at this bar (see indicator-library.ts). null during warm-up. */
    ind: Record<string, number | null>;
    /** Indicator library values at the previous bar, for crossover rules. null on the first bar. */
    indPrev: Record<string, number | null> | null;
}

const SWING_LOOKBACK = 3;
const BREAKOUT_LOOKBACK = 10;
const MOMENTUM_LOOKBACK = 10;

function ema(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let result = values[0];
    for (let i = 1; i < values.length; i++) {
        result = values[i] * k + result * (1 - k);
    }
    return result;
}

function sessionOf(timestamp: number): MarketSession {
    const hour = new Date(timestamp).getUTCHours();
    if (hour >= 12 && hour < 16) return "overlap";
    if (hour >= 7 && hour < 16) return "london";
    if (hour >= 12 && hour < 21) return "new_york";
    if (hour >= 0 && hour < 8) return "asian";
    return "closed";
}

export function computeFeatures(candles: MarketCandle[]): CandleFeatures[] {
    const n = candles.length;
    const features: CandleFeatures[] = [];
    if (n < 5) return features;

    // Canonical RSI(14) over the closes — computed once from the canonical
    // indicator engine (lib/market-core), causal: rsiValues[i] only uses closes 0..i.
    const rsiValues = rsiSeries(candles.map((c) => c.close), 14).map((v) =>
        Number.isFinite(v) ? v : null
    );

    // Warm up EMA/ATR window.
    const closes: number[] = [];

    // Confirmed swing points are emitted with a lag of SWING_LOOKBACK bars so we
    // never trade on a peak that hasn't finished forming yet.
    const confirmedSwings: Array<{ index: number; price: number; type: "high" | "low" }> = [];

    // rolling sweep / breaker / fvg / ob detection results, indexed by candle idx
    const sweepAt: Record<number, SweepFeature> = {};
    const chochAt: Record<number, BreakerFeature> = {};
    const bosAt: Record<number, BreakerFeature> = {};
    const fvgAt: Record<number, BreakerFeature> = {};
    const obAt: Record<number, BreakerFeature> = {};
    const fvgZonesAt: Record<number, { high: number; low: number }> = {};
    const obZonesAt: Record<number, { high: number; low: number }> = {};
    let lastStructureBreak: TrendLabel | null = null;
    let activeOrderBlock: { direction: TrendLabel; index: number; formedAt: number; high: number; low: number; invalidation: number } | null = null;
    let activeBullishFvg: { high: number; low: number; formedAt: number } | null = null;
    let activeBearishFvg: { high: number; low: number; formedAt: number } | null = null;

    let atrSum = 0;
    const atrWindow: number[] = [];
    const trValues: number[] = [];

    for (let i = 0; i < n; i++) {
        const c = candles[i];
        closes.push(c.close);

        // True range + rolling ATR(14)
        let tr = c.high - c.low;
        if (trValues.length > 0) {
            const prevClose = candles[i - 1].close;
            tr = Math.max(tr, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
        }
        trValues.push(tr);
        atrWindow.push(tr);
        if (atrWindow.length > 14) atrWindow.shift();
        atrSum = atrWindow.reduce((s, v) => s + v, 0);
        const atr = atrWindow.length > 0 ? atrSum / atrWindow.length : tr;

        const ema20 = ema(closes.slice(Math.max(0, closes.length - 20)), 20);
        const ema50 = ema(closes.slice(Math.max(0, closes.length - 50)), 50);

        let trend: TrendLabel = "neutral";
        if (closes.length >= 20) {
            if (ema20 > ema50 * 1.001) trend = "bullish";
            else if (ema20 < ema50 * 0.999) trend = "bearish";
        }

        const atrPct = c.close !== 0 ? (atr / c.close) * 100 : 0;
        let volState: VolState = "normal";
        if (atrPct < 0.1) volState = "low";
        else if (atrPct < 0.3) volState = "normal";
        else if (atrPct < 0.6) volState = "high";
        else volState = "extreme";

        // Swing confirmation (backdated): mark a swing candidate once SMART-bars pass.
        if (i >= 2 * SWING_LOOKBACK) {
            const peakIdx = i - SWING_LOOKBACK;
            const window = candles.slice(peakIdx - SWING_LOOKBACK, peakIdx + SWING_LOOKBACK + 1);
            const w = candles[peakIdx];
            if (window.every((x) => x.high <= w.high)) {
                confirmedSwings.push({ index: peakIdx, price: w.high, type: "high" });
            }
            if (window.every((x) => x.low >= w.low)) {
                confirmedSwings.push({ index: peakIdx, price: w.low, type: "low" });
            }
        }

        const lastHigh = [...confirmedSwings].reverse().find((s) => s.type === "high");
        const lastLow = [...confirmedSwings].reverse().find((s) => s.type === "low");
        const priorHigh = [...confirmedSwings].reverse().find((s) => s.type === "high" && s.index < i - SWING_LOOKBACK);
        const priorLow = [...confirmedSwings].reverse().find((s) => s.type === "low" && s.index < i - SWING_LOOKBACK);
        const previousClose = i > 0 ? candles[i - 1].close : null;
        const structureBreakUp = !!priorHigh && previousClose !== null && previousClose <= priorHigh.price && c.close > priorHigh.price;
        const structureBreakDown = !!priorLow && previousClose !== null && previousClose >= priorLow.price && c.close < priorLow.price;
        const structureShiftUp = structureBreakUp && lastStructureBreak === "bearish";
        const structureShiftDown = structureBreakDown && lastStructureBreak === "bullish";
        if (structureBreakUp) lastStructureBreak = "bullish";
        if (structureBreakDown) lastStructureBreak = "bearish";

        // Sweep detection against confirmed levels (break + close back).
        for (const s of confirmedSwings) {
            if (s.index >= i - SWING_LOOKBACK) continue; // only levels confirmed before this bar
            if (s.type === "high" && c.high > s.price && c.close < s.price) {
                sweepAt[i] = { side: "buy_side", index: i, level: s.price, confirmed: c.close < c.open };
                break;
            }
            if (s.type === "low" && c.low < s.price && c.close > s.price) {
                sweepAt[i] = { side: "sell_side", index: i, level: s.price, confirmed: c.close > c.open };
                break;
            }
        }

        // BOS / CHOCH via progression of confirmed swing high/low prices.
        const highs = confirmedSwings.filter((s) => s.type === "high").map((s) => s.price);
        const lows = confirmedSwings.filter((s) => s.type === "low").map((s) => s.price);
        if (lows.length >= 2) {
            const prev = lows[lows.length - 2];
            const cur = lows[lows.length - 1];
            if (cur < prev) {
                bosAt[i] = { direction: "bearish", index: i };
            } else if (cur > prev) {
                // handled below for bullish BOS via highs
            }
        }
        if (highs.length >= 2) {
            const prev = highs[highs.length - 2];
            const cur = highs[highs.length - 1];
            if (cur > prev) {
                bosAt[i] = { direction: "bullish", index: i };
            }
        }

        // One-shot retest of the latest unfilled FVG, strictly after its
        // three-candle formation bar has closed.
        const bullishFvgRetest = !!activeBullishFvg && i > activeBullishFvg.formedAt &&
            c.low <= activeBullishFvg.high && c.high >= activeBullishFvg.low;
        const bearishFvgRetest = !!activeBearishFvg && i > activeBearishFvg.formedAt &&
            c.high >= activeBearishFvg.low && c.low <= activeBearishFvg.high;
        if (bullishFvgRetest) activeBullishFvg = null;
        if (bearishFvgRetest) activeBearishFvg = null;

        // FVG: the first and third candle wicks do not overlap; detected only
        // once the third candle closes, so the event is available causally at i.
        if (i >= 2) {
            const first = candles[i - 2];
            if (c.low > first.high) {
                fvgAt[i] = { direction: "bullish", index: i };
                fvgZonesAt[i] = { high: c.low, low: first.high };
                activeBullishFvg = { high: c.low, low: first.high, formedAt: i };
            } else if (c.high < first.low) {
                fvgAt[i] = { direction: "bearish", index: i };
                fvgZonesAt[i] = { high: first.low, low: c.high };
                activeBearishFvg = { high: first.low, low: c.high, formedAt: i };
            }
        }

        // Order block convention used here: nearest opposing candle in the
        // three bars before a same-direction displacement candle (body >= 1 ATR
        // and >= 70% of range). This is an explicit mechanical proxy, not a
        // claim that all SMC schools define order blocks identically.
        const currentBody = Math.abs(c.close - c.open);
        const currentRange = c.high - c.low;
        const displacement = currentBody >= atr && currentRange > 0 && currentBody / currentRange >= 0.7;
        let bullishOrderBlockRetest = false;
        let bearishOrderBlockRetest = false;
        if (activeOrderBlock && i > activeOrderBlock.formedAt) {
            const invalidated = activeOrderBlock.direction === "bullish"
                ? c.close < activeOrderBlock.invalidation
                : c.close > activeOrderBlock.invalidation;
            if (invalidated) activeOrderBlock = null;
            else if (c.low <= activeOrderBlock.high && c.high >= activeOrderBlock.low) {
                bullishOrderBlockRetest = activeOrderBlock.direction === "bullish";
                bearishOrderBlockRetest = activeOrderBlock.direction === "bearish";
                activeOrderBlock = null;
            }
        }
        if (displacement) {
            for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
                const candidate = candles[j];
                const opposite = c.close > c.open ? candidate.close < candidate.open : candidate.close > candidate.open;
                if (!opposite) continue;
                const direction = c.close > c.open ? "bullish" : "bearish";
                obAt[i] = { direction, index: i };
                obZonesAt[i] = { high: candidate.high, low: candidate.low };
                activeOrderBlock = {
                    direction,
                    index: j,
                    formedAt: i,
                    high: candidate.high,
                    low: candidate.low,
                    invalidation: direction === "bullish" ? candidate.low : candidate.high,
                };
                break;
            }
        }

        // Breakout of prior N-bar extreme.
        let breakoutHigh = false;
        let breakoutLow = false;
        if (i >= BREAKOUT_LOOKBACK) {
            const window = candles.slice(i - BREAKOUT_LOOKBACK, i);
            const maxHigh = Math.max(...window.map((x) => x.high));
            const minLow = Math.min(...window.map((x) => x.low));
            breakoutHigh = c.close > maxHigh;
            breakoutLow = c.close < minLow;
        }

        // Momentum + range expansion.
        let momentumPct = 0;
        let rangeExpansion = 0;
        if (i >= MOMENTUM_LOOKBACK) {
            const ref = candles[i - MOMENTUM_LOOKBACK].close;
            momentumPct = ref !== 0 ? ((c.close - ref) / ref) * 100 : 0;
            const prevRanges = candles.slice(i - BREAKOUT_LOOKBACK, i).map((x) => x.high - x.low);
            const avgRange = prevRanges.length > 0 ? prevRanges.reduce((a, b) => a + b, 0) / prevRanges.length : 0;
            rangeExpansion = avgRange > 0 ? ((c.high - c.low) / avgRange - 1) * 100 : 0;
        }

        // Swing point trend labels (with lag).
        const HL = confirmedSwings;
        const higherHigh = HL.filter((s) => s.type === "high").length >= 2
            ? HL.filter((s) => s.type === "high").slice(-2)[0].price < HL.filter((s) => s.type === "high").slice(-1)[0].price
            : false;
        const higherLow = HL.filter((s) => s.type === "low").length >= 2
            ? HL.filter((s) => s.type === "low").slice(-2)[0].price < HL.filter((s) => s.type === "low").slice(-1)[0].price
            : false;
        const lowerHigh = HL.filter((s) => s.type === "high").length >= 2
            ? HL.filter((s) => s.type === "high").slice(-2)[0].price > HL.filter((s) => s.type === "high").slice(-1)[0].price
            : false;
        const lowerLow = HL.filter((s) => s.type === "low").length >= 2
            ? HL.filter((s) => s.type === "low").slice(-2)[0].price > HL.filter((s) => s.type === "low").slice(-1)[0].price
            : false;

        // roll last-occurrence lookups
        const recentWindow = Math.max(i - 60, 0);
        const lastSweep = Object.keys(sweepAt)
            .filter((k) => Number(k) <= i && Number(k) >= recentWindow)
            .map((k) => sweepAt[Number(k)])
            .sort((a, b) => b.index - a.index)[0] ?? null;
        const lastChoch = null; // computed below
        const lastBos = Object.keys(bosAt)
            .filter((k) => Number(k) <= i && Number(k) >= recentWindow)
            .map((k) => bosAt[Number(k)])
            .sort((a, b) => b.index - a.index)[0] ?? null;
        const lastFvg = Object.keys(fvgAt)
            .filter((k) => Number(k) <= i && Number(k) >= i - 8 && Number(k) >= 0)
            .map((k) => fvgAt[Number(k)])
            .sort((a, b) => b.index - a.index)[0] ?? null;
        const lastOb = Object.keys(obAt)
            .filter((k) => Number(k) <= i && Number(k) >= i - 20 && Number(k) >= 0)
            .map((k) => obAt[Number(k)])
            .sort((a, b) => b.index - a.index)[0] ?? null;

        features.push({
            index: i,
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            ema20,
            ema50,
            rsi: rsiValues[i] ?? null,
            trend,
            trendScore: trend === "bullish" ? 1 : trend === "bearish" ? -1 : 0,
            atr,
            atrPct,
            volState,
            swingLow: lastLow ? lastLow.price : null,
            swingHigh: lastHigh ? lastHigh.price : null,
            swingLowIndex: lastLow ? lastLow.index : null,
            swingHighIndex: lastHigh ? lastHigh.index : null,
            lastSweep,
            lastSweepBarsAgo: lastSweep ? i - lastSweep.index : null,
            choch: lastChoch,
            bos: lastBos,
            structureBreakUp,
            structureBreakDown,
            structureShiftUp,
            structureShiftDown,
            bullishFvgRetest,
            bearishFvgRetest,
            bullishOrderBlockRetest,
            bearishOrderBlockRetest,
            fvgDirection: lastFvg ? lastFvg.direction : null,
            fvgIndex: lastFvg ? lastFvg.index : null,
            fvgBarsAgo: lastFvg ? i - lastFvg.index : null,
            fvgZoneHigh: lastFvg ? fvgZonesAt[lastFvg.index]?.high ?? null : null,
            fvgZoneLow: lastFvg ? fvgZonesAt[lastFvg.index]?.low ?? null : null,
            obDirection: lastOb ? lastOb.direction : null,
            obIndex: lastOb ? lastOb.index : null,
            obZoneHigh: lastOb ? obZonesAt[lastOb.index]?.high ?? null : null,
            obZoneLow: lastOb ? obZonesAt[lastOb.index]?.low ?? null : null,
            session: sessionOf(c.timestamp),
            hour: new Date(c.timestamp).getUTCHours(),
            weekday: new Date(c.timestamp).getUTCDay(),
            momentumPct,
            breakoutHigh,
            breakoutLow,
            rangeExpansion,
            higherHigh,
            higherLow,
            lowerHigh,
            lowerLow,
            ind: {},
            indPrev: null,
        });
    }

    // Indicator library: computed once over the whole series (causal per bar).
    const indicatorSeries = buildIndicatorSeries(candles);
    let prevRow: Record<string, number | null> | null = null;
    for (let i = 0; i < n; i++) {
        const row = indicatorRowAt(indicatorSeries, i);
        features[i].ind = row;
        features[i].indPrev = prevRow;
        prevRow = row;
    }

    // CHOCH = a BOS against the prevailing direction (detected post-hoc, backdated).
    const bosList = Object.entries(bosAt)
        .map(([, b]) => b)
        .sort((a, b) => a.index - b.index);
    let prevBosDir: TrendLabel | null = null;
    for (const b of bosList) {
        if (prevBosDir && b.direction !== prevBosDir) {
            chochAt[b.index] = { direction: b.direction, index: b.index };
        }
        prevBosDir = b.direction;
    }
    for (let i = 0; i < n; i++) {
        const fe = features[i];
        const recentBos = bosList.filter((b) => b.index <= i && b.index >= i - 60);
        const recentChoch = Object.values(chochAt)
            .filter((c) => c.index <= i && c.index >= i - 60)
            .sort((a, b) => b.index - a.index)[0] ?? null;
        fe.bos = recentBos.length > 0 ? { direction: recentBos[recentBos.length - 1].direction, index: recentBos[recentBos.length - 1].index } : null;
        fe.choch = recentChoch ? { direction: recentChoch.direction, index: recentChoch.index } : null;
        if (fe.choch && fe.bos && fe.bos.index > fe.choch.index && fe.bos.direction === fe.choch.direction) {
            fe.choch = fe.bos; // most recent co-directional structure change is the one that matters
        }
    }

    return features;
}

export function getFeature(features: CandleFeatures[], index: number): CandleFeatures {
    return features[index];
}

// Find the macro/cadence timeframe feature at or before a given timestamp.
export function featureAtOrBefore(features: CandleFeatures[], timestamp: number): CandleFeatures | null {
    for (let i = features.length - 1; i >= 0; i--) {
        if (features[i].timestamp <= timestamp) return features[i];
    }
    return features.length > 0 ? features[0] : null;
}