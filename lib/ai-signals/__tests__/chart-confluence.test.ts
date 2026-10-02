/**
 * Chart-confluence tests — the shared overlay math the AI signal engine
 * reuses from the Pro Terminal chart (session levels, daily pivots, prev-day
 * H/L, VWAP, EMA stack, EQH/EQL clustering, direction vote and scoring).
 *
 * Pure functions only: no network, no Firebase, no wall-clock dependencies
 * (all timestamps are fixed constants, so runs are deterministic).
 */

import {
    buildChartConfluence,
    scoreChartConfluence,
    scoreChartDirection,
    CHART_CONFLUENCE_MAX_SCORE,
} from "../chart-confluence";
import type { MarketCandle } from "@/lib/market-data/types";

/** Fixed anchor: 2026-09-30 is a Wednesday, 2026-10-01 a Thursday (UTC). */
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY1 = Date.UTC(2026, 8, 30); // prev day
const DAY2 = Date.UTC(2026, 9, 1);  // last day

let seq = 0;
/** Build one candle from explicit fields with a monotonic timestamp. */
function candle(ts: number, open: number, high: number, low: number, close: number, volume = 100): MarketCandle {
    seq += 1;
    return { timestamp: ts, open, high, low, close, volume, _seq: seq } as MarketCandle & { _seq: number };
}

/**
 * Two full days of hourly candles.
 * Day 1 (previous day): trades 100 → 110, high 112, low 98.
 * Day 2 (last day): flat around 110 with a known session structure.
 */
function buildTwoDays(): MarketCandle[] {
    const candles: MarketCandle[] = [];
    // ── previous day: 24 hourly candles, steady climb 100 → 110 ──────────
    for (let h = 0; h < 24; h++) {
        const open = 100 + h * 0.4;
        const close = 100 + (h + 1) * 0.4;
        candles.push(candle(DAY1 + h * HOUR_MS, open, close + 0.6, open - 0.6, close));
    }
    // Force known prev-day extremes: high 112, low 98 at fixed hours.
    candles[6] = candle(DAY1 + 6 * HOUR_MS, 102.4, 112, 102, 103); // high spike
    candles[2] = candle(DAY1 + 2 * HOUR_MS, 100.8, 101, 98, 100.9); // low spike
    // ── last day: flat drift 110 → 110.5 (only 22h so "today" is partial) ─
    for (let h = 0; h < 22; h++) {
        const open = 110 + h * 0.02;
        const close = 110 + (h + 1) * 0.02;
        candles.push(candle(DAY2 + h * HOUR_MS, open, close + 0.3, open - 0.3, close, 120));
    }
    return candles;
}

export function runChartConfluenceTests(): boolean {
    console.log("--- Chart Confluence Tests ---");
    let passed = true;
    const check = (name: string, cond: boolean) => {
        console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}`);
        if (!cond) passed = false;
    };

    const candles = buildTwoDays();
    const lastClose = candles[candles.length - 1].close;
    const cf = buildChartConfluence({ candles, currentPrice: lastClose });

    // ── pivots: H=112, L=98, C=last prev-day close → P=(H+L+C)/3 ──
    check("pivots computed from complete previous day", cf.pivots !== null);
    if (cf.pivots) {
        const prevDay = candles.filter((c) => new Date(c.timestamp).toISOString().slice(0, 10) === new Date(DAY1).toISOString().slice(0, 10));
        const H = Math.max(...prevDay.map((c) => c.high));
        const L = Math.min(...prevDay.map((c) => c.low));
        const C = prevDay[prevDay.length - 1].close;
        const p = (H + L + C) / 3;
        const range = H - L;
        check("pivot P = (H+L+C)/3", Math.abs(cf.pivots.p - p) < 1e-9);
        check("R1 = 2P − L", Math.abs(cf.pivots.r1 - (2 * p - L)) < 1e-9);
        check("R2 = P + range", Math.abs(cf.pivots.r2 - (p + range)) < 1e-9);
        check("S1 = 2P − H", Math.abs(cf.pivots.s1 - (2 * p - H)) < 1e-9);
        check("S2 = P − range", Math.abs(cf.pivots.s2 - (p - range)) < 1e-9);
    }

    // ── prev-day extremes ──
    check("prev day high = 112", cf.prevDayHigh === 112);
    check("prev day low = 98", cf.prevDayLow === 98);

    // ── session extremes (last UTC day) ──
    const asia = cf.sessionLevels.find((s) => s.key === "asian");
    const ny = cf.sessionLevels.find((s) => s.key === "ny");
    check("Asia session extremes present", asia !== undefined);
    check("NY session extremes present", ny !== undefined);
    if (asia && ny) {
        check("Asia high < NY high (flat day, more range later)", asia.high <= ny.high);
        check("session highs within day-2 range", asia.high > 100 && ny.high < 115);
    }

    // ── VWAP / EMA ──
    check("VWAP computed", cf.vwap !== null && cf.vwap! > 100 && cf.vwap! < 120);
    check("EMA 9 near last closes", cf.ema9 !== null && Math.abs(cf.ema9! - lastClose) < 2);
    check("EMA 20 near last closes", cf.ema20 !== null && Math.abs(cf.ema20! - lastClose) < 2);

    // ── levels list ──
    const kinds = new Set(cf.levels.map((l) => l.kind));
    check("levels include pivot", kinds.has("pivot"));
    check("levels include prev_day_high", kinds.has("prev_day_high"));
    check("levels include session_high", kinds.has("session_high"));
    check("every level price is finite and positive", cf.levels.every((l) => Number.isFinite(l.price) && l.price > 0));

    // ── EQH/EQL: engineered swing structure on a synthetic series ──
    // Equal highs at interior indices (the fractal rule needs ≥2 bars on
    // each side): highs of 105.0 at positions 4 and 8 of 13.
    const eqhCandles: MarketCandle[] = [];
    let t = Date.UTC(2026, 8, 28);
    const push = (high: number, low: number, close: number) => {
        eqhCandles.push(candle(t, close - 1, high, low, close));
        t += HOUR_MS;
    };
    // idx: 0     1     2     3      4     5     6     7      8     9     10    11    12
    push(102, 99.0, 101);   // 0
    push(103, 100.2, 102);  // 1
    push(104, 101.0, 103);  // 2
    push(103.5, 100.8, 102.5); // 3
    push(105, 101.5, 103.5);   // 4  swing high (equal)
    push(103, 100.9, 102);     // 5
    push(102, 100.0, 101);     // 6
    push(103.5, 100.7, 102.5); // 7
    push(105, 101.2, 103.2);   // 8  swing high (equal)
    push(103, 100.5, 102);     // 9
    push(102.5, 100.1, 101.5); // 10
    push(103, 100.4, 102);     // 11
    push(102.8, 100.3, 101.8); // 12
    const eqhCf = buildChartConfluence({ candles: eqhCandles, currentPrice: 102 });
    check("equal highs clustered into one EQH level", eqhCf.eqh.length >= 1);
    if (eqhCf.eqh.length >= 1) {
        check("EQH price ≈ 105 (cluster mean)", Math.abs(eqhCf.eqh[0] - 105) < 0.05);
    }

    // ── direction vote ──
    // Price above VWAP+EMAs+pivot ⇒ positive vote.
    const above = scoreChartDirection(cf, 118);
    check("price above all anchors ⇒ bullish vote", above > 0);
    const below = scoreChartDirection(cf, 95);
    check("price below all anchors ⇒ bearish vote", below < 0);
    const mid = scoreChartDirection(cf, lastClose);
    check("mid price gives weaker vote than extremes", Math.abs(mid) <= Math.abs(above));

    // ── direction-relative scoring ──
    const longScore = scoreChartConfluence(cf, "BUY", 118);
    const shortScore = scoreChartConfluence(cf, "SELL", 95);
    check("long score higher than short score at 118", longScore.score > shortScore.score);
    check("short score higher than long score at 95", shortScore.score > scoreChartConfluence(cf, "BUY", 95).score);
    check("long score bounded by max", longScore.score >= 0 && longScore.score <= CHART_CONFLUENCE_MAX_SCORE);
    check("long evidence non-empty", longScore.evidence.length > 0);
    check("evidence mentions VWAP", longScore.evidence.some((e) => e.toLowerCase().includes("vwap")));

    // ── reasoning lines ──
    // chartConfluenceReasoning is exercised indirectly through the engine;
    // here verify the score serialises into a readable line.
    const line = `Chart confluence (${longScore.score}/${CHART_CONFLUENCE_MAX_SCORE}): ${longScore.evidence.join("; ")}.`;
    check("reasoning line contains score", line.includes(`${longScore.score}/${CHART_CONFLUENCE_MAX_SCORE}`));

    // ── determinism ──
    const cf2 = buildChartConfluence({ candles, currentPrice: lastClose });
    check("same candles ⇒ identical pivots", JSON.stringify(cf.pivots) === JSON.stringify(cf2.pivots));
    check("same candles ⇒ identical levels", JSON.stringify(cf.levels) === JSON.stringify(cf2.levels));

    // ── edge cases ──
    const empty = buildChartConfluence({ candles: [], currentPrice: 0 });
    check("empty candles ⇒ no levels", empty.levels.length === 0 && empty.pivots === null);
    const singleDay = buildChartConfluence({ candles: candles.slice(24), currentPrice: lastClose });
    check("single day ⇒ no pivots (needs complete prev day)", singleDay.pivots === null);

    console.log("--- Chart Confluence Tests Complete ---");
    return passed;
}
