// ─────────────────────────────────────────────────────────────────────────────
// Strategy Engine test harness (repo jiti-runner convention).
// Pure domain: no network, no RTDB, no AI, no Math.random.
// ─────────────────────────────────────────────────────────────────────────────

import type { MarketCandle } from "@/lib/market-data/types";
import type { Strategy } from "@/lib/strategy-lab/types";

let passed = 0;
const failures: string[] = [];
let currentSection = "";

export function section(title: string): void {
    currentSection = title;
    console.log(`\n── ${title} ──────────────────────────────────────`);
}

export function check(cond: boolean, message: string): void {
    if (cond) {
        passed++;
        console.log(`  ✓ ${message}`);
    } else {
        failures.push(`${currentSection} :: ${message}`);
        console.log(`  ✗ ${message}`);
    }
}

export function summary(): { ok: boolean; passed: number; failures: string[] } {
    return { ok: failures.length === 0, passed, failures };
}

export function resetHarness(): void {
    passed = 0;
    failures.length = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic data
// ─────────────────────────────────────────────────────────────────────────────

const MIN = 5 * 60 * 1000;

function candle(t: number, open: number, close: number, pad = 0.3): MarketCandle {
    return {
        timestamp: t,
        open,
        high: Math.max(open, close) + pad,
        low: Math.min(open, close) - pad,
        close,
        volume: 100,
    };
}

/** Gentle deterministic uptrend with a wiggle — no randomness. */
export function uptrendCandles(n: number, start = 100, baseTime = Date.UTC(2026, 0, 5, 0, 0, 0)): MarketCandle[] {
    const out: MarketCandle[] = [];
    let price = start;
    for (let i = 0; i < n; i++) {
        const drift = 0.35 + 0.25 * Math.sin(i / 7);
        const next = price + drift;
        out.push(candle(baseTime + i * MIN, price, next));
        price = next;
    }
    return out;
}

/**
 * Acceptance-test series (spec §52): an uptrend whose structure produces a
 * confirmed bullish BOS at a known index, with EMA20 > EMA50 and RSI > 50.
 *
 * Returns the candles plus the exact bar index where the bullish BOS first
 * becomes available (i.e. the first bar where the full condition may fire).
 */
export function acceptanceSeries(): { candles: MarketCandle[]; bosAvailableAt: number } {
    const closes: number[] = [];
    // Phase A — strictly rising, idx 0..59 (no swing points can confirm in a
    // monotonic series; lets RSI(14) and EMA(50) finish warming up).
    let p = 100;
    for (let i = 0; i < 60; i++) {
        p += 0.6;
        closes.push(Number(p.toFixed(2)));
    }
    // Swing high #1 at idx 60 (confirmed at 63): peak, then a shallow decline.
    closes.push(Number((p + 0.6).toFixed(2))); // 60 — local peak
    closes.push(Number((p + 0.6 - 1.0).toFixed(2))); // 61
    closes.push(Number((p + 0.6 - 2.0).toFixed(2))); // 62
    closes.push(Number((p + 0.6 - 3.0).toFixed(2))); // 63 — swing high #1 confirmed here
    // Recovery to a HIGHER swing high at idx 70 (confirmed at 73 → bullish BOS).
    const from63 = p + 0.6 - 3.0;
    for (let i = 1; i <= 7; i++) closes.push(Number((from63 + i * 1.1).toFixed(2))); // 64..70
    closes.push(Number((from63 + 7 * 1.1 - 0.5).toFixed(2))); // 71
    closes.push(Number((from63 + 7 * 1.1 - 1.0).toFixed(2))); // 72
    closes.push(Number((from63 + 7 * 1.1 - 1.5).toFixed(2))); // 73 — swing high #2 confirmed → BOS
    // Continue the uptrend with shallow pullbacks so structure stays bullish.
    let up = closes[closes.length - 1];
    for (let i = 74; i < 220; i++) {
        up = up + (i % 6 === 0 ? -0.9 : 0.75);
        closes.push(Number(up.toFixed(2)));
    }

    const baseTime = Date.UTC(2026, 0, 5, 0, 0, 0);
    const candles = closes.map((c, i) => candle(baseTime + i * MIN, c - 0.1, c));

    return { candles, bosAvailableAt: 73 };
}

/** Bearish/no-structure series: EMA rises but swing highs DESCEND. */
export function noBosSeries(n: number): MarketCandle[] {
    const baseTime = Date.UTC(2026, 0, 5, 0, 0, 0);
    const closes: number[] = [];
    let p = 100;
    for (let i = 0; i < n; i++) {
        // sawtooth with DECLINING peaks
        const phase = i % 10;
        if (phase <= 5) p += 1.0;
        else p -= 0.9;
        const decay = Math.floor(i / 10) * 0.8;
        closes.push(Number((p - decay).toFixed(2)));
    }
    return closes.map((c, i) => candle(baseTime + i * MIN, c - 0.05, c));
}

/** The canonical acceptance strategy (spec §52). */
export function acceptanceStrategy(overrides: Partial<Strategy> = {}): Strategy {
    const base: Strategy = {
        id: "acc-ema-rsi-bos",
        name: "EMA/RSI/BOS Acceptance",
        description: "LONG when EMA20 > EMA50 AND RSI > 50 AND bullish BOS confirmed. Risk 1%, SL = 1 ATR, TP = 2 ATR.",
        asset: "XAUUSD",
        direction: "long",
        timeframes: { macro: "M5", structure: "M5", setup: "M5", entry: "M5" },
        regimeFilter: [],
        entryRules: [
            { id: "r-ema", enabled: true, group: "indicator", label: "EMA20 > EMA50", operator: "eq", value: "ema20_above_ema50", indicator: "ema_cross", groupLogic: "AND" },
            { id: "r-rsi", enabled: true, group: "indicator", label: "RSI > 50", operator: "gt", value: 50, indicator: "rsi", groupLogic: "AND" },
            { id: "r-bos", enabled: true, group: "structure", label: "Bullish BOS", operator: "eq", value: "bos_bullish", groupLogic: "AND" },
        ],
        confirmationRules: [],
        stopLoss: { mode: "atr", atrMultiple: 1, levelOffset: 0, useSwing: false },
        takeProfit: { mode: "r", r1: 2, r2: 0, r3: 0, fixedDistance: 0, partialCloses: [{ atR: 2, closePercent: 100 }], moveBeAfterTp1: false, lockAfterTp2: false, trailingEnabled: false, trailingStopAtr: 1.5 },
        risk: { mode: "percent", riskPercent: 1, fixedLot: 0.01, maxPositions: 1, dailyLossLimitPct: 0, maxDrawdownPct: 0 },
        filters: { sessions: [], daysOfWeek: [0, 1, 2, 3, 4, 5, 6], volatilityMinAtrPct: 0, volatilityMaxAtrPct: 0, maxTradesPerDay: 99, cooldownCandles: 0 },
        executionModel: "next_bar_open",
        costs: { spreadPips: 10, commissionPerLot: 7, slippagePips: 1 },
        sourcePatternId: null,
        whyp: { discovered: "", conditionsSelected: "", occurrenceFrequency: "", historicalPerformance: "", weaknesses: "", poorRegimes: "", generatedByProvider: "test" },
        version: "1.0.0",
        created: 1,
        updated: 1,
    };
    return { ...base, ...overrides };
}

export const XAUUSD_SPEC = { pipSize: 0.01, contractSize: 100, digits: 2, minLot: 0.01, maxLot: 100, lotStep: 0.01, typicalSpread: 0.2, symbol: "XAUUSD" };

export function approx(a: number, b: number, tol = 1e-6): boolean {
    return Math.abs(a - b) <= tol;
}

export function approxEq(a: number, b: number, tol = 1e-6): boolean {
    return Math.abs(a - b) <= tol;
}
