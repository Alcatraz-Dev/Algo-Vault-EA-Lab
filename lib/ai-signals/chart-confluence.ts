/**
 * Chart Confluence — the AI signal engine reads the SAME overlays the
 * Pro Terminal chart draws.
 *
 * Every number produced here comes from the exact deterministic routines the
 * chart renders with (components/pro-scalping-terminal/ProTerminalChart.tsx):
 *   • session highs/lows      (Asia / London / New York, UTC windows)
 *   • daily floor-trader pivots (P / R1 / R2 / S1 / S2 from the previous UTC day)
 *   • previous-day high/low
 *   • session-anchored VWAP   (cumulative typical price × volume, UTC day anchor)
 *   • EMA 9 / EMA 20 stack    (the chart's EMA overlay lines)
 *   • equal highs / lows      (EQH / EQL tolerance clustering)
 *   • price position vs every one of those levels
 *
 * No LLM and no heuristics that the chart cannot show: when a user opens the
 * chart on a generated signal they see the very levels the signal was built
 * from. Market-closed / weekend silence is never papered over — the previous
 * UTC day's candles drive the levels, and the session quality is reported as
 * the chart's badge reports it.
 */

import { MarketCandle } from "@/lib/market-data/types";
import { detectSmartMoney, inferTimeframe, indicatorPrimitives } from "@/lib/market-core";
import type { SignalDirection } from "./types";

// ── level model (mirrors the chart's price-line overlays) ────────────────────

export type ChartLevelKind =
    | "session_high"
    | "session_low"
    | "pivot"
    | "pivot_r1"
    | "pivot_r2"
    | "pivot_s1"
    | "pivot_s2"
    | "prev_day_high"
    | "prev_day_low"
    | "eqh"
    | "eql";

export interface ChartLevel {
    kind: ChartLevelKind;
    label: string;
    price: number;
    /** Bullish/bearish relevance when approached from either side. */
    color: string;
}

export interface ChartConfluenceInput {
    candles: MarketCandle[];
    /** Current tradeable price (last candle close unless overridden). */
    currentPrice: number;
    /**
     * UTC hour windows mirroring SESSION_WINDOWS in ProTerminalChart.tsx and
     * the session engine in lib/analytics/sessions.ts.
     */
    sessionWindows?: ReadonlyArray<{ key: string; label: string; startH: number; endH: number }>;
}

export interface ChartConfluence {
    levels: ChartLevel[];
    /** Session-anchored VWAP value (null when candles lack volume AND no fallback). */
    vwap: number | null;
    ema9: number | null;
    ema20: number | null;
    /** Previous UTC day H/L (null when the window holds a single day). */
    prevDayHigh: number | null;
    prevDayLow: number | null;
    /** Daily pivot set (null when there is no complete previous day). */
    pivots: { p: number; r1: number; r2: number; s1: number; s2: number } | null;
    /** Equal highs / lows clustered with the chart's tolerance rule. */
    eqh: number[];
    eql: number[];
    /** Asia / London / New York session extremes for the last UTC day with data. */
    sessionLevels: Array<{ key: string; label: string; high: number; low: number }>;
}

// ── helpers (1:1 with the chart's local computations) ────────────────────────

const DEFAULT_SESSION_WINDOWS = [
    { key: "asian", label: "Asia", startH: 0, endH: 8 },
    { key: "london", label: "London", startH: 7, endH: 16 },
    { key: "ny", label: "New York", startH: 12, endH: 21 },
] as const;

function dayOf(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
}

/** Session-anchored VWAP — same cumulative typical price × volume as the chart. */
function computeVwapValue(candles: MarketCandle[]): number | null {
    if (candles.length === 0) return null;
    let cumPV = 0;
    let cumV = 0;
    let currentDay = "";
    let last = 0;
    for (const c of candles) {
        const day = dayOf(c.timestamp);
        if (day !== currentDay) {
            currentDay = day;
            cumPV = 0;
            cumV = 0;
        }
        const tp = (c.high + c.low + c.close) / 3;
        const v = c.volume && c.volume > 0 ? c.volume : 1;
        cumPV += tp * v;
        cumV += v;
        last = cumPV / cumV;
    }
    return Number.isFinite(last) ? last : null;
}

/**
 * EMA through the ONE indicator engine kernel (SMA-seeded, `null` until the
 * seed window fills) — identical to the value the chart plots.
 */
function emaValue(values: number[], period: number): number | null {
    if (values.length === 0) return null;
    const runtime = indicatorPrimitives.emaRuntime(period);
    const state = runtime.initialState();
    const rows = values.map((v, i) =>
        runtime.step(state, { timestamp: i, open: v, high: v, low: v, close: v, volume: 0 }).value,
    );
    const last = rows[rows.length - 1];
    return last === undefined ? null : last;
}

/**
 * Equal highs/lows via the ONE Smart Money engine (confirmed swing clusters
 * within the documented relative tolerance) — the same EQH/EQL pools the
 * chart's liquidity layer draws.
 */
function computeEqualLevels(candles: MarketCandle[]): { eqh: number[]; eql: number[] } {
    const detection = detectSmartMoney(candles, {
        symbol: "N/A",
        timeframe: inferTimeframe(candles),
        structure: false,
        liquidity: true,
        zones: false,
        orderBlocks: false,
        sessions: false,
    });
    const eqh: number[] = [];
    const eql: number[] = [];
    for (const pool of detection.pools) {
        if (pool.price === undefined) continue;
        if (pool.kind === "equal_highs") eqh.push(pool.price);
        else if (pool.kind === "equal_lows") eql.push(pool.price);
    }
    return { eqh, eql };
}

/** Daily floor-trader pivots from the previous UTC day (chart's exact rule). */
function computeDailyPivots(candles: MarketCandle[]): ChartConfluence["pivots"] {
    if (candles.length < 3) return null;
    const lastDay = dayOf(candles[candles.length - 1].timestamp);
    const prev = candles.filter((c) => dayOf(c.timestamp) !== lastDay);
    if (prev.length < 3) return null;
    const H = Math.max(...prev.map((c) => c.high));
    const L = Math.min(...prev.map((c) => c.low));
    const C = prev[prev.length - 1].close;
    const p = (H + L + C) / 3;
    const range = H - L;
    return { p, r1: 2 * p - L, r2: p + range, s1: 2 * p - H, s2: p - range };
}

function computePrevDayExtremes(candles: MarketCandle[]): { high: number | null; low: number | null } {
    if (candles.length === 0) return { high: null, low: null };
    const lastDay = dayOf(candles[candles.length - 1].timestamp);
    const days = [...new Set(candles.map((c) => dayOf(c.timestamp)))].sort();
    const idx = days.indexOf(lastDay);
    if (idx <= 0) return { high: null, low: null };
    const prevDay = candles.filter((c) => dayOf(c.timestamp) === days[idx - 1]);
    if (prevDay.length < 3) return { high: null, low: null };
    return {
        high: Math.max(...prevDay.map((c) => c.high)),
        low: Math.min(...prevDay.map((c) => c.low)),
    };
}

/** Session extremes for the last UTC day with data (chart's session lines). */
function computeSessionExtremes(
    candles: MarketCandle[],
    windows: ReadonlyArray<{ key: string; label: string; startH: number; endH: number }>
): ChartConfluence["sessionLevels"] {
    if (candles.length === 0) return [];
    const lastDay = dayOf(candles[candles.length - 1].timestamp);
    const out: ChartConfluence["sessionLevels"] = [];
    for (const w of windows) {
        const inWindow = candles.filter((c) => {
            const d = new Date(c.timestamp);
            return d.toISOString().slice(0, 10) === lastDay && d.getUTCHours() >= w.startH && d.getUTCHours() < w.endH;
        });
        if (inWindow.length < 3) continue;
        out.push({
            key: w.key,
            label: w.label,
            high: Math.max(...inWindow.map((c) => c.high)),
            low: Math.min(...inWindow.map((c) => c.low)),
        });
    }
    return out;
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Build the full chart-confluence snapshot from the canonical candles.
 * Deterministic: same candles ⇒ same levels, no wall-clock inputs.
 */
export function buildChartConfluence(input: ChartConfluenceInput): ChartConfluence {
    const { candles, currentPrice } = input;
    const windows = input.sessionWindows ?? DEFAULT_SESSION_WINDOWS;

    const vwap = computeVwapValue(candles);
    const closes = candles.map((c) => c.close);
    const ema9 = emaValue(closes, 9);
    const ema20 = emaValue(closes, 20);
    const pivots = computeDailyPivots(candles);
    const prevDay = computePrevDayExtremes(candles);
    const { eqh, eql } = computeEqualLevels(candles);
    const sessionLevels = computeSessionExtremes(candles, windows);

    const levels: ChartLevel[] = [];
    for (const s of sessionLevels) {
        levels.push({ kind: "session_high", label: `${s.label} H`, price: s.high, color: "#22d3ee" });
        levels.push({ kind: "session_low", label: `${s.label} L`, price: s.low, color: "#22d3ee" });
    }
    if (pivots) {
        levels.push({ kind: "pivot", label: "P", price: pivots.p, color: "#eab308" });
        levels.push({ kind: "pivot_r1", label: "R1", price: pivots.r1, color: "#fb7185" });
        levels.push({ kind: "pivot_r2", label: "R2", price: pivots.r2, color: "#fb7185" });
        levels.push({ kind: "pivot_s1", label: "S1", price: pivots.s1, color: "#34d399" });
        levels.push({ kind: "pivot_s2", label: "S2", price: pivots.s2, color: "#34d399" });
    }
    if (prevDay.high !== null) levels.push({ kind: "prev_day_high", label: "Prev day H", price: prevDay.high, color: "#94a3b8" });
    if (prevDay.low !== null) levels.push({ kind: "prev_day_low", label: "Prev day L", price: prevDay.low, color: "#94a3b8" });
    for (const price of eqh) levels.push({ kind: "eqh", label: "EQH", price, color: "#f97316" });
    for (const price of eql) levels.push({ kind: "eql", label: "EQL", price, color: "#34d399" });

    return {
        levels,
        vwap,
        ema9,
        ema20,
        prevDayHigh: prevDay.high,
        prevDayLow: prevDay.low,
        pivots,
        eqh,
        eql,
        sessionLevels,
    };
}

// ── direction & scoring ──────────────────────────────────────────────────────

/**
 * Chart-level direction vote, in the same spirit as the chart's level
 * layout: price above VWAP + EMAs stacked up + room toward resistance
 * favours longs; the mirror image favours shorts. Returns a signed score;
 * positive = bullish, negative = bearish. |score| is the conviction.
 */
export function scoreChartDirection(cf: ChartConfluence, currentPrice: number): number {
    let score = 0;

    if (cf.vwap !== null) {
        if (currentPrice > cf.vwap) score += 1;
        else if (currentPrice < cf.vwap) score -= 1;
    }

    if (cf.ema9 !== null && cf.ema20 !== null) {
        if (currentPrice > cf.ema9 && cf.ema9 > cf.ema20) score += 1;
        else if (currentPrice < cf.ema9 && cf.ema9 < cf.ema20) score -= 1;
    }

    if (cf.pivots) {
        if (currentPrice > cf.pivots.p) score += 1;
        else if (currentPrice < cf.pivots.p) score -= 1;
    }

    // EQH above = buy-side liquidity that magnetises price up; EQL below =
    // sell-side liquidity that magnetises price down (chart's EQH/EQL logic).
    const eqhAbove = cf.eqh.filter((p) => p > currentPrice).length;
    const eqlBelow = cf.eql.filter((p) => p < currentPrice).length;
    if (eqhAbove > eqlBelow) score += 1;
    else if (eqlBelow > eqhAbove) score -= 1;

    return score;
}

export interface ChartConfluenceScore {
    score: number;
    detail: string;
    /** Level labels backing the score, for reasoning / transparency. */
    evidence: string[];
}

/** Max raw score of scoreChartConfluence (used by the confidence pipeline). */
export const CHART_CONFLUENCE_MAX_SCORE = 10;

/**
 * Direction-relative confluence score on the chart's own levels.
 * Touches, breaks and stacking of session/pivot/VWAP/EMA levels — the same
 * things a trader eyeballs on the Pro Terminal chart.
 */
export function scoreChartConfluence(
    cf: ChartConfluence,
    direction: SignalDirection,
    currentPrice: number
): ChartConfluenceScore {
    let score = 0;
    const evidence: string[] = [];
    const long = direction === "BUY";

    // 1. VWAP side (≤2): trading above VWAP supports longs, below supports shorts.
    if (cf.vwap !== null) {
        const withTrend = long ? currentPrice > cf.vwap : currentPrice < cf.vwap;
        if (withTrend) {
            score += 2;
            evidence.push(`Price ${long ? "above" : "below"} VWAP (${cf.vwap.toFixed(4)})`);
        } else {
            evidence.push(`Price on wrong side of VWAP (${cf.vwap.toFixed(4)})`);
        }
    }

    // 2. EMA stack (≤2): EMA9/EMA20 stacking with price on trend side.
    if (cf.ema9 !== null && cf.ema20 !== null) {
        const stacked = long ? currentPrice > cf.ema9 && cf.ema9 > cf.ema20 : currentPrice < cf.ema9 && cf.ema9 < cf.ema20;
        if (stacked) {
            score += 2;
            evidence.push(`EMA 9/20 stacked ${long ? "up" : "down"} (${cf.ema9.toFixed(4)} / ${cf.ema20.toFixed(4)})`);
        }
    }

    // 3. Pivot room (≤2): direction has clear runway to the next pivot band.
    if (cf.pivots) {
        if (long && currentPrice > cf.pivots.p) {
            score += 1;
            evidence.push(`Price above daily pivot P (${cf.pivots.p.toFixed(4)})`);
            if (cf.pivots.r1 > currentPrice) {
                score += 1;
                evidence.push(`Room to R1 (${cf.pivots.r1.toFixed(4)})`);
            }
        } else if (!long && currentPrice < cf.pivots.p) {
            score += 1;
            evidence.push(`Price below daily pivot P (${cf.pivots.p.toFixed(4)})`);
            if (cf.pivots.s1 < currentPrice) {
                score += 1;
                evidence.push(`Room to S1 (${cf.pivots.s1.toFixed(4)})`);
            }
        }
    }

    // 4. Session extremes (≤2): session high broken supports longs (breakout
    // continuation), session low swept-then-held supports longs too (sweep
    // reversal); mirrored for shorts.
    const lastSession = cf.sessionLevels[cf.sessionLevels.length - 1];
    if (lastSession) {
        if (long && currentPrice > lastSession.high) {
            score += 2;
            evidence.push(`Trading above ${lastSession.label} high (${lastSession.high.toFixed(4)})`);
        } else if (!long && currentPrice < lastSession.low) {
            score += 2;
            evidence.push(`Trading below ${lastSession.label} low (${lastSession.low.toFixed(4)})`);
        } else if (long && currentPrice >= lastSession.low && currentPrice <= lastSession.high) {
            score += 1;
            evidence.push(`Inside ${lastSession.label} range`);
        } else if (!long && currentPrice >= lastSession.low && currentPrice <= lastSession.high) {
            score += 1;
            evidence.push(`Inside ${lastSession.label} range`);
        }
    }

    // 5. EQH/EQL liquidity magnets (≤2): resting liquidity in the trade's
    // favour gives price a target (the chart draws these as EQH/EQL lines).
    const magnets = long ? cf.eqh.filter((p) => p > currentPrice) : cf.eql.filter((p) => p < currentPrice);
    if (magnets.length > 0) {
        score += Math.min(2, magnets.length);
        evidence.push(`${magnets.length} ${long ? "EQH" : "EQL"} magnet${magnets.length > 1 ? "s" : ""} ${long ? "above" : "below"}`);
    }

    return { score: Math.min(score, CHART_CONFLUENCE_MAX_SCORE), detail: evidence.join("; "), evidence };
}

/**
 * Human-readable chart-evidence lines appended to a signal's reasoning so
 * users see exactly which drawn levels back the call.
 */
export function chartConfluenceReasoning(cf: ChartConfluence, direction: SignalDirection, currentPrice: number): string[] {
    const lines: string[] = [];
    const { score, evidence } = scoreChartConfluence(cf, direction, currentPrice);
    if (evidence.length > 0) lines.push(`Chart confluence (${score}/${CHART_CONFLUENCE_MAX_SCORE}): ${evidence.join("; ")}.`);
    return lines;
}
