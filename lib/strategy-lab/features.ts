import { MarketCandle, MarketSession } from "@/lib/market-data/types";

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

    let atrSum = 0;
    const atrWindow: number[] = [];
    const trValues: number[] = [];

    let lastFvgZoneHigh: number | null = null;
    let lastFvgZoneLow: number | null = null;
    let lastObZoneHigh: number | null = null;
    let lastObZoneLow: number | null = null;

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

        // Sweep detection against confirmed levels (break + close back).
        for (const s of confirmedSwings) {
            if (s.index >= i - SWING_LOOKBACK) continue; // only levels confirmed before this bar
            if (s.type === "low" && c.low < s.price && c.close > s.price) {
                sweepAt[i] = { side: "buy_side", index: i, level: s.price, confirmed: c.close > c.open };
                break;
            }
            if (s.type === "high" && c.high > s.price && c.close < s.price) {
                sweepAt[i] = { side: "sell_side", index: i, level: s.price, confirmed: c.close < c.open };
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

        // FVG: candle[i-1] gap between candle[i-2] and candle[i].
        if (i >= 2) {
            const c2 = candles[i - 2];
            const c1 = candles[i - 1];
            if (c1.low > c2.high) {
                fvgAt[i] = { direction: "bullish", index: i };
                lastFvgZoneHigh = c1.low;
                lastFvgZoneLow = c2.high;
            } else if (c1.high < c2.low) {
                fvgAt[i] = { direction: "bearish", index: i };
                lastFvgZoneHigh = c2.low;
                lastFvgZoneLow = c1.high;
            }
        }

        // Order block: strong candle against prior candle.
        if (i >= 1) {
            const prev = candles[i - 1];
            const bodySize = Math.abs(c.close - c.open);
            const prevBody = Math.abs(prev.close - prev.open);
            if (c.close > c.open && prev.close < prev.open && bodySize > prevBody * 1.5) {
                obAt[i] = { direction: "bullish", index: i };
                lastObZoneHigh = prev.high;
                lastObZoneLow = prev.open;
            } else if (c.close < c.open && prev.close > prev.open && bodySize > prevBody * 1.5) {
                obAt[i] = { direction: "bearish", index: i };
                lastObZoneHigh = prev.open;
                lastObZoneLow = prev.low;
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
            fvgDirection: lastFvg ? lastFvg.direction : null,
            fvgIndex: lastFvg ? lastFvg.index : null,
            fvgBarsAgo: lastFvg ? i - lastFvg.index : null,
            fvgZoneHigh: lastFvg ? lastFvgZoneHigh : null,
            fvgZoneLow: lastFvg ? lastFvgZoneLow : null,
            obDirection: lastOb ? lastOb.direction : null,
            obIndex: lastOb ? lastOb.index : null,
            obZoneHigh: lastOb ? lastObZoneHigh : null,
            obZoneLow: lastOb ? lastObZoneLow : null,
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
        });
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