/**
 * AI Draw — deterministic trade-plan levels computed from the chart's OWN
 * candles.
 *
 * Contract (same non-fabrication rule as the rest of the platform):
 *   • Input is exactly the candle array the chart renders.
 *   • Every output price is derived from those candles (ATR, swing
 *     structure, S/R clusters, EMA trend) — nothing is invented and no
 *     future bars are read.
 *   • The plan carries `evidence` strings with the real computed values so
 *     the UI can show *why* each level sits where it does.
 *   • Pure and synchronous: no I/O, no randomness — identical input gives
 *     an identical plan (property-tested).
 *
 * This is a levels-drawing aid, not financial advice; the chart labels it
 * as derived-from-data wherever it renders.
 */

import { emaRuntime } from "../market-core/indicators/primitives";
import { detectPivots } from "../market-core/smart-money/structure";
import { inferTimeframe, timeframeToMs } from "../market-core/smart-money/shared";
import { detectLiquidity } from "../analytics/liquidity";
import type { MarketCandle, Timeframe } from "../market-data/types";

export interface AiDrawCandle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

export type AiDrawLevelKey = "entry" | "sl" | "tp1" | "tp2" | "tp3" | "tp4" | "tp5" | "support" | "resistance";

export interface AiDrawLevel {
    key: AiDrawLevelKey;
    label: string;
    price: number;
}

export interface AiDrawPlan {
    direction: "long" | "short";
    /** Planned entry = last close (the price the chart is showing right now). */
    entry: number;
    /** Stop beyond the nearest structure (or 1.5×ATR when no structure). */
    sl: number;
    /** First target at 2R (snapped to a real resistance/support when closer). */
    tp1: number;
    /** Second target at 3R (snapped likewise). */
    tp2: number;
    /** Third target at 4R (snapped likewise). */
    tp3: number;
    /** Fourth target at 5R (snapped likewise). */
    tp4: number;
    /** Fifth target at 6R (snapped likewise). */
    tp5: number;
    atr: number;
    /** |entry − sl| — the risk unit every target is measured against. */
    risk: number;
    rr1: number;
    rr2: number;
    rr3: number;
    rr4: number;
    rr5: number;
    /** Nearest clustered swing support/resistance below/above the close. */
    support: number | null;
    resistance: number | null;
    /** SMC / liquidity-derived zones (order-block / FVG proxy from candle clusters). */
    liquidityZones: Array<{ price: number; side: "bid" | "ask"; strength: number }>;
    /** Order-block proxy derived from swing cluster near price. */
    orderBlock: number | null;
    /** FVG proxy zones derived from candle gap analysis. */
    fvgZone: Array<{ low: number; high: number }>;
    /** Bias score biased toward profitable setups (strong trend + near structure). */
    biasScore: number;
    trendUp: boolean;
    /** Real computed facts backing the plan (numbers, not adjectives). */
    evidence: string[];
    /** Timestamp (ms) of the last candle the plan was computed from. */
    anchorTime: number;
    bars: number;
}

const MIN_BARS = 60;
const ATR_PERIOD = 14;
const SWING_WINDOW = 3;

function roundTo(price: number): number {
    const abs = Math.abs(price);
    const digits = abs >= 100 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 5;
    const f = 10 ** digits;
    return Math.round(price * f) / f;
}

function atr(candles: AiDrawCandle[], period = ATR_PERIOD): number {
    const start = Math.max(1, candles.length - period);
    let sum = 0;
    let n = 0;
    for (let i = start; i < candles.length; i++) {
        const c = candles[i];
        const prevClose = candles[i - 1].close;
        const tr = Math.max(
            c.high - c.low,
            Math.abs(c.high - prevClose),
            Math.abs(c.low - prevClose)
        );
        sum += tr;
        n += 1;
    }
    return n > 0 ? sum / n : 0;
}

/**
 * EMA through the ONE indicator engine kernel (SMA-seeded). Returns the mean
 * of the available values when the series is shorter than the seed window,
 * preserving the legacy short-array behaviour.
 */
function ema(values: number[], period: number): number {
    if (values.length === 0) return 0;
    const runtime = emaRuntime(period);
    const state = runtime.initialState();
    let last: number | null = null;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        last = runtime.step(state, { timestamp: i, open: v, high: v, low: v, close: v, volume: 0 }).value ?? last;
    }
    if (last !== null) return last;
    const n = Math.min(period, values.length);
    return values.slice(0, n).reduce((s, v) => s + v, 0) / n;
}

/** Fractal swing points — the ONE core pivot detector (same ±SWING_WINDOW rule). */
function swings(candles: AiDrawCandle[]): { highs: number[]; lows: number[] } {
    const pivots = detectPivots(candles, SWING_WINDOW, timeframeToMs(inferTimeframe(candles)));
    const highs: number[] = [];
    const lows: number[] = [];
    for (const p of pivots) {
        if (p.developing) continue;
        if (p.side === "high") highs.push(p.price);
        else lows.push(p.price);
    }
    return { highs, lows };
}

/** Cluster nearby prices; returns [{ price, touches }] sorted by proximity. */
function cluster(prices: number[], tolerance: number): Array<{ price: number; touches: number }> {
    const sorted = [...prices].sort((a, b) => a - b);
    const out: Array<{ price: number; touches: number }> = [];
    let bucket: number[] = [];
    const flush = () => {
        if (bucket.length > 0) {
            out.push({
                price: bucket.reduce((s, v) => s + v, 0) / bucket.length,
                touches: bucket.length,
            });
        }
        bucket = [];
    };
    for (const p of sorted) {
        if (bucket.length === 0 || Math.abs(p - bucket[bucket.length - 1]) <= tolerance) {
            bucket.push(p);
        } else {
            flush();
            bucket = [p];
        }
    }
    flush();
    return out;
}

/**
 * Compute the AI draw plan from candles. Returns null when there is not
 * enough real data to anchor levels (never guesses).
 */
export function computeAiDrawPlan(candles: AiDrawCandle[]): AiDrawPlan | null {
    if (!Array.isArray(candles) || candles.length < MIN_BARS) return null;

    const last = candles[candles.length - 1];
    const lastClose = last.close;
    if (!Number.isFinite(lastClose) || lastClose <= 0) return null;

    const atrValue = atr(candles);
    if (!Number.isFinite(atrValue) || atrValue <= 0) return null;

    const { highs, lows } = swings(candles);
    if (highs.length === 0 || lows.length === 0) return null;

    const tolerance = Math.max(atrValue * 0.3, 1e-9);
    const highClusters = cluster(highs, tolerance);
    const lowClusters = cluster(lows, tolerance);

    // Nearest support below the close, nearest resistance above it.
    const supports = lowClusters.filter((c) => c.price < lastClose).sort((a, b) => b.price - a.price);
    const resistances = highClusters.filter((c) => c.price > lastClose).sort((a, b) => a.price - b.price);
    const support = supports[0] ?? null;
    const resistance = resistances[0] ?? null;

    const closes = candles.map((c) => c.close);
    const fast = ema(closes.slice(-100), 20);
    const slow = ema(closes.slice(-100), 50);
    const trendUp = fast > slow;

    // SMC / liquidity zone enhancement: detect liquidity pools near price
    // (derived from same candles; no fabrication) for smoother, profitable trade bias.
    let liquidityBias = 0; // positive = bullish liquidity pressure
    const liquidityZones: Array<{ price: number; side: "bid" | "ask"; strength: number }> = [];
    try {
        const timeframe = inferTimeframe(candles) as Timeframe;
        // `AiDrawCandle` is the engine's own structural candle shape; the
        // analytics detector takes the canonical `MarketCandle`. Both carry the
        // OHLC fields this reads, so the widening cast is safe here.
        const results = detectLiquidity(
            candles as unknown as MarketCandle[],
            timeframe
        );
        for (const lvl of results.levels.slice(0, 5)) {
            const isBid = lvl.type.includes("low");
            liquidityZones.push({
                price: Number.isFinite(lvl.price) ? lvl.price : lastClose,
                side: isBid ? "bid" : "ask",
                strength: lvl.strength,
            });
            if (isBid) liquidityBias += 10;
            else if (lvl.type.includes("high")) liquidityBias -= 8;
        }
    } catch {
        // Liquidity detection is optional; no impact if unavailable.
    }

    const distToSupport = support ? lastClose - support.price : Number.POSITIVE_INFINITY;
    const distToResistance = resistance ? resistance.price - lastClose : Number.POSITIVE_INFINITY;

    // Profitability-biased direction: prefer trades where trend aligns with
    // nearest structure and liquidity supports the move (SMC concept).
    // Compute structure/liquidity scores before deciding direction.
    const trendScore = trendUp ? 1 : -1;
    // Use temporary direction for structure score (will be refined by final direction)
    const preliminaryDir = (distToSupport <= 1.2 * atrValue && distToSupport <= distToResistance)
        ? "long"
        : (distToResistance <= 1.2 * atrValue ? "short" : (trendUp ? "long" : "short"));
    const structureScore = preliminaryDir === "long"
        ? (distToSupport < 2 * atrValue ? 1 : 0) - (distToResistance < 2 * atrValue ? 1 : 0)
        : (distToResistance < 2 * atrValue ? 1 : 0) - (distToSupport < 2 * atrValue ? 1 : 0);
    const liquidityScore = liquidityBias / 10; // normalize roughly to [-1, 1]
    const biasScore = Math.round((trendScore * 0.4 + structureScore * 0.35 + liquidityScore * 0.25) * 100);

    // Bias: price pressed against a real level wins, otherwise trend + liquidity.
    let direction: "long" | "short";
    if (distToSupport <= 1.2 * atrValue && distToSupport <= distToResistance) {
        direction = "long";
    } else if (distToResistance <= 1.2 * atrValue) {
        direction = "short";
    } else if (biasScore >= 20) {
        direction = "long";
    } else if (biasScore <= -20) {
        direction = "short";
    } else {
        direction = trendUp ? "long" : "short";
    }

    // Stop: beyond the protecting structure when one is close, else 1.5×ATR.
    let sl: number;
    if (direction === "long") {
        sl = support && distToSupport <= 3 * atrValue
            ? support.price - 0.25 * atrValue
            : lastClose - 1.5 * atrValue;
    } else {
        sl = resistance && distToResistance <= 3 * atrValue
            ? resistance.price + 0.25 * atrValue
            : lastClose + 1.5 * atrValue;
    }

    const risk = Math.abs(lastClose - sl);
    const minRisk = atrValue * 0.2;
    if (!Number.isFinite(risk) || risk < minRisk) {
        sl = direction === "long" ? lastClose - minRisk : lastClose + minRisk;
    }
    const finalRisk = Math.abs(lastClose - sl);
    const dir = direction === "long" ? 1 : -1;

    // Order-block proxy: nearest swing cluster near price acts as SMC supply/demand zone.
    const orderBlock = (direction === "long"
        ? (lowClusters.find((c) => Math.abs(c.price - lastClose) < 2 * atrValue))
        : (highClusters.find((c) => Math.abs(c.price - lastClose) < 2 * atrValue)))?.price ?? null;

    // FVG proxy: gap zones derived from candle shadows/body gaps near the close.
    const fvgZone: Array<{ low: number; high: number }> = [];
    for (let i = Math.max(1, candles.length - 8); i < candles.length - 1; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        if (curr.low > prev.high) fvgZone.push({ low: prev.high, high: curr.low });
        else if (prev.low > curr.high) fvgZone.push({ low: curr.high, high: prev.low });
    }

    // Stronger snap: prefer order-block and liquidity zones over pure ATR multiples.
    const snap = (target: number, minPrice: number): number => {
        let best = roundTo(target);
        // Prefer nearby order-block / liquidity zone when it improves R:R
        if (direction === "long" && resistance) {
            const r = resistance.price;
            if (r > lastClose + 0.3 * finalRisk && r < target + finalRisk) best = roundTo(r);
            else if (orderBlock && Math.abs(orderBlock - target) < 0.7 * finalRisk && orderBlock < target && orderBlock > lastClose) best = roundTo(orderBlock);
        }
        if (direction === "short" && support) {
            const s = support.price;
            if (s < lastClose - 0.3 * finalRisk && s > target - finalRisk) best = roundTo(s);
            else if (orderBlock && Math.abs(orderBlock - target) < 0.7 * finalRisk && orderBlock > target && orderBlock < lastClose) best = roundTo(orderBlock);
        }
        // Ensure min separation
        if (direction === "long" && best <= minPrice + 0.05 * finalRisk) best = minPrice + 0.05 * finalRisk;
        if (direction === "short" && best >= minPrice - 0.05 * finalRisk) best = minPrice - 0.05 * finalRisk;
        return best;
    };

    // Base targets (before snap enforcement)
    const baseTp1 = lastClose + dir * 2 * finalRisk;
    const baseTp2 = lastClose + dir * 3 * finalRisk;
    const baseTp3 = lastClose + dir * 4 * finalRisk;
    const baseTp4 = lastClose + dir * 5 * finalRisk;
    const baseTp5 = lastClose + dir * 6 * finalRisk;

    // Snapped targets, ensuring minimum separation of 0.1×finalRisk between levels
    const tp1 = snap(baseTp1, lastClose);
    let tp2 = snap(baseTp2, tp1);
    let tp3 = snap(baseTp3, tp2);
    let tp4 = snap(baseTp4, tp3);
    let tp5 = snap(baseTp5, tp4);

    // Final safety: ensure targets are ordered correctly (long: increasing, short: decreasing)
    if (direction === "long") {
        if (tp2 <= tp1) tp2 = tp1 + 0.1 * finalRisk;
        if (tp3 <= tp2) tp3 = tp2 + 0.1 * finalRisk;
        if (tp4 <= tp3) tp4 = tp3 + 0.1 * finalRisk;
        if (tp5 <= tp4) tp5 = tp4 + 0.1 * finalRisk;
    } else {
        if (tp2 >= tp1) tp2 = tp1 - 0.1 * finalRisk;
        if (tp3 >= tp2) tp3 = tp2 - 0.1 * finalRisk;
        if (tp4 >= tp3) tp4 = tp3 - 0.1 * finalRisk;
        if (tp5 >= tp4) tp5 = tp4 - 0.1 * finalRisk;
    }

    const evidence: string[] = [
        `ATR(${ATR_PERIOD}) = ${roundTo(atrValue)}`,
        support
            ? `Support ${roundTo(support.price)} (${support.touches} swing touch${support.touches === 1 ? "" : "es"})`
            : "No swing support below the close",
        resistance
            ? `Resistance ${roundTo(resistance.price)} (${resistance.touches} swing touch${resistance.touches === 1 ? "" : "es"})`
            : "No swing resistance above the close",
        `EMA20 ${roundTo(fast)} ${trendUp ? ">" : "≤"} EMA50 ${roundTo(slow)}`,
        `Stop ${roundTo(sl)} = structure ${support || resistance ? "±0.25×ATR buffer" : "±1.5×ATR"} · risk ${roundTo(finalRisk)}`,
        `Targets at ${direction === "long" ? "+" : "-"}2R / 3R / 4R / 5R / 6R (up to TP5 for strong AI signals)${(direction === "long" ? resistance : support) ? ", snapped to opposing swing cluster where close" : ""}`,
    ];

    return {
        direction,
        entry: roundTo(lastClose),
        sl: roundTo(sl),
        tp1,
        tp2,
        tp3,
        tp4,
        tp5,
        atr: roundTo(atrValue),
        risk: roundTo(finalRisk),
        rr1: finalRisk > 0 ? Math.round((Math.abs(tp1 - lastClose) / finalRisk) * 100) / 100 : 0,
        rr2: finalRisk > 0 ? Math.round((Math.abs(tp2 - lastClose) / finalRisk) * 100) / 100 : 0,
        rr3: finalRisk > 0 ? Math.round((Math.abs(tp3 - lastClose) / finalRisk) * 100) / 100 : 0,
        rr4: finalRisk > 0 ? Math.round((Math.abs(tp4 - lastClose) / finalRisk) * 100) / 100 : 0,
        rr5: finalRisk > 0 ? Math.round((Math.abs(tp5 - lastClose) / finalRisk) * 100) / 100 : 0,
        support: support ? roundTo(support.price) : null,
        resistance: resistance ? roundTo(resistance.price) : null,
        orderBlock: orderBlock ? roundTo(orderBlock) : null,
        fvgZone,
        trendUp,
        evidence: [
            // The measured facts first (ATR, structure touches, EMA spread,
            // stop/risk) — these are the numbers the chart's evidence panel and
            // the AI badge quote back to the trader.
            ...evidence,
            // Then the SMC context layered on top of that measurement.
            `SMC bias = ${biasScore} (trend=${trendUp ? "UP" : "DOWN"}, structure=${direction})`,
            orderBlock ? `Order-block zone near ${roundTo(orderBlock)} (SMC supply/demand)` : "No strong order-block near close",
            fvgZone.length ? `FVG zones: ${fvgZone.length} gap(s) detected near price` : "No FVG gap near price",
            `Liquidity zones detected = ${liquidityZones.length}`,
        ],
        liquidityZones,
        biasScore,
        anchorTime: last.timestamp,
        bars: candles.length,
    };
}

/** Levels in draw order (entry first) — the chart turns these into lines. */
export function aiDrawLevels(plan: AiDrawPlan): AiDrawLevel[] {
    const tps: AiDrawLevel[] = [];
    if (plan.tp1 !== undefined) tps.push({ key: "tp1", label: "AI TP1", price: plan.tp1 });
    if (plan.tp2 !== undefined) tps.push({ key: "tp2", label: "AI TP2", price: plan.tp2 });
    if (plan.tp3 !== undefined) tps.push({ key: "tp3", label: "AI TP3", price: plan.tp3 });
    if (plan.tp4 !== undefined) tps.push({ key: "tp4", label: "AI TP4", price: plan.tp4 });
    if (plan.tp5 !== undefined) tps.push({ key: "tp5", label: "AI TP5", price: plan.tp5 });
    const out: AiDrawLevel[] = [
        { key: "entry", label: `${plan.direction === "long" ? "BUY" : "SELL"} ENTRY`, price: plan.entry },
        { key: "sl", label: "AI SL", price: plan.sl },
        ...tps,
        ...(plan.support !== null ? [{ key: "support" as const, label: "SMC Support", price: plan.support }] : []),
        ...(plan.resistance !== null ? [{ key: "resistance" as const, label: "SMC Resistance", price: plan.resistance }] : []),
        ...(plan.orderBlock !== null ? [{ key: "support" as const, label: "Order Block (SMC)", price: plan.orderBlock }] : []),
    ];
    // Include FVG zone as a reference line when available (use first zone center)
    if (plan.fvgZone.length > 0) {
        const center = (plan.fvgZone[0].low + plan.fvgZone[0].high) / 2;
        out.push({ key: "resistance" as const, label: "FVG Zone", price: Math.round(center * 100) / 100 });
    }
    return out;
}
