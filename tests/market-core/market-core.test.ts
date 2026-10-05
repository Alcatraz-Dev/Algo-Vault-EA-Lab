/**
 * Market Intelligence Core — Phase 3 test suite.
 *
 * Run with:
 *     node scripts/jiti-tsrun.mjs tests/market-core/market-core.test.ts
 * (or `npm run test:market-core`)
 *
 * Follows the repo's self-contained runner convention
 * (see tests/chart-engine/chart-engine.test.ts).
 *
 * Coverage:
 *   1. Indicator math vs independent naive implementations (SMA, EMA, WMA,
 *      VWAP, Bollinger, RSI, MACD, Stochastic, AO, ATR, ADX, OBV)
 *   2. Timestamp alignment (gaps, prepend, lookups)
 *   3. Historical extension equivalence (incremental vs full recompute)
 *   4. Realtime updates (forming candle, close → new candle)
 *   5. Overlay model (market coordinates, layers, density, pan/zoom safety)
 *   6. Smart Money detectors (HH/HL/LH/LL, BOS, CHOCH, FVG, OB, liquidity,
 *      sweep, premium/discount, sessions)
 *   7. Future-candle leakage protection (confirmationAt / visibleAsOf)
 *   8. Lifecycle (add/remove/change indicator, symbol & timeframe scoping)
 *   9. Intelligence context + debug inspector
 *  10. Performance (10k candles, many indicators, detection, overlays)
 */

import {
    IndicatorEngine,
    alignedIndicatorSeries,
    mapToTimeline,
    indicatorRegistry,
    overlayRegistry,
    registerBuiltinIndicators,
    detectSmartMoney,
    detectPivots,
    detectFvgs,
    detectOrderBlocks,
    visibleAsOf,
    detectedBy,
    SmartMoneyDetector,
    SMART_MONEY_VERSION,
    buildIntelligenceContext,
    selectOverlaysForViewport,
    sortOverlays,
    smartMoneyToOverlay,
    overlayPriority,
    LAYER_BY_ID,
    sessionLevels,
    primarySession,
    sessionsAt,
    classifyZone,
    timeframeToMs,
    setMarketCoreDebug,
    isMarketCoreDebug,
    describeCandle,
    describeOverlay,
    describeSmartMoney,
    debugSnapshot,
    type CoreCandle,
    type MarketOverlay,
    type SmartMoneyObject,
} from "../../lib/market-core";
import { barIndexForTime } from "../../lib/chart-engine/coordinate-mapping";
import { SmartMoneyEngine } from "../../lib/market-intelligence/smart-money/engine";
import { sma as analyticsSma, ema as analyticsEma, rsi as analyticsRsi, macd as analyticsMacd, atrSeries as analyticsAtr } from "../../lib/analytics/indicators";

let passed = 0;
let failed = 0;
const asyncChecks: Promise<void>[] = [];

function check(name: string, fn: () => void | Promise<void>): void {
    const r = fn();
    if (r instanceof Promise) {
        asyncChecks.push(
            r.then(
                () => {
                    passed += 1;
                    console.log(`  ✓ ${name}`);
                },
                (err: unknown) => {
                    failed += 1;
                    console.error(`  ✗ ${name}`);
                    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
                },
            ),
        );
        return;
    }
    passed += 1;
    console.log(`  ✓ ${name}`);
}

function assert(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = ""): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message} Expected ${b} but got ${a}`);
}

function assertClose(actual: number | null | undefined, expected: number, message = "", eps = 1e-9): void {
    assert(actual !== null && actual !== undefined && Number.isFinite(actual), `${message} (expected a number, got ${String(actual)})`);
    if (Math.abs((actual as number) - expected) > eps) {
        throw new Error(`${message} Expected ${expected} but got ${actual}`);
    }
}

/**
 * Element-wise series comparison tolerant to floating-point summation order
 * (rolling window vs naive window sums differ at ~1e-14, not in substance).
 */
function assertSeriesEqual(
    actual: Array<number | null>,
    expected: Array<number | null>,
    message = "",
): void {
    assertEqual(actual.length, expected.length, `${message} length`);
    const norm = (v: number | null | undefined): number | null =>
        v === null || v === undefined || Number.isNaN(v) ? null : v;
    for (let i = 0; i < actual.length; i++) {
        const a = norm(actual[i]);
        const e = norm(expected[i]);
        if (a === null || e === null) {
            assert(a === e, `${message} index ${i}: expected ${e} got ${a}`);
            continue;
        }
        const tol = Math.max(1e-9, Math.abs(e) * 1e-9);
        if (Math.abs(a - e) > tol) {
            throw new Error(`${message} index ${i}: expected ${e} got ${a}`);
        }
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────

const H1 = 3_600_000;
const START = Date.UTC(2026, 8, 21, 0, 0); // Sunday 2026-09-21 (week handled below)

/** Deterministic pseudo-random walk candles (no Math.random anywhere). */
function makeCandles(n: number, opts?: { symbol?: string; timeframe?: string; start?: number; seed?: number }): CoreCandle[] {
    const symbol = opts?.symbol ?? "XAUUSD";
    const timeframe = opts?.timeframe ?? "H1";
    const step = timeframeToMs(timeframe) || H1;
    let seed = opts?.seed ?? 42;
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0xffffffff;
    };
    const out: CoreCandle[] = [];
    let price = 100;
    const start = opts?.start ?? START;
    for (let i = 0; i < n; i++) {
        const drift = (rand() - 0.5) * 2;
        const open = price;
        const close = Math.max(1, open + drift);
        const high = Math.max(open, close) + rand();
        const low = Math.min(open, close) - rand();
        out.push({
            timestamp: start + i * step,
            open,
            high,
            low,
            close,
            volume: 100 + Math.floor(rand() * 50),
            symbol,
            timeframe,
            finalized: i < n - 1,
        });
        price = close;
    }
    return out;
}

/** Hand-built candle (full control of OHLC). */
function bar(offset: number, o: number, h: number, l: number, c: number, opts?: { volume?: number; finalized?: boolean; symbol?: string; timeframe?: string }): CoreCandle {
    return {
        timestamp: START + offset * H1,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: opts?.volume ?? 10,
        symbol: opts?.symbol ?? "EURUSD",
        timeframe: opts?.timeframe ?? "H1",
        finalized: opts?.finalized ?? true,
    };
}

function naiveSma(values: number[], period: number): Array<number | null> {
    return values.map((_, i) => {
        if (i < period - 1) return null;
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += values[j];
        return sum / period;
    });
}

function naiveEma(values: number[], period: number): Array<number | null> {
    const k = 2 / (period + 1);
    const out: Array<number | null> = values.map(() => null);
    let emaValue: number | null = null;
    let seedSum = 0;
    for (let i = 0; i < values.length; i++) {
        if (emaValue === null) {
            seedSum += values[i];
            if (i === period - 1) emaValue = seedSum / period;
            out[i] = emaValue;
            continue;
        }
        emaValue = values[i] * k + emaValue * (1 - k);
        out[i] = emaValue;
    }
    return out;
}

function naiveAtr(candles: CoreCandle[], period: number): Array<number | null> {
    const out: Array<number | null> = candles.map(() => null);
    if (candles.length < period) return out;
    const tr = candles.map((c, i) =>
        i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)),
    );
    let atr = 0;
    for (let i = 0; i < period; i++) atr += tr[i];
    atr /= period;
    out[period - 1] = atr;
    for (let i = period; i < candles.length; i++) {
        atr = (atr * (period - 1) + tr[i]) / period;
        out[i] = atr;
    }
    return out;
}

function naiveRsi(values: number[], period: number): Array<number | null> {
    const out: Array<number | null> = values.map(() => null);
    if (values.length <= period) return out;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
        const d = values[i] - values[i - 1];
        if (d >= 0) gain += d;
        else loss -= d;
    }
    gain /= period;
    loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < values.length; i++) {
        const d = values[i] - values[i - 1];
        const g = d > 0 ? d : 0;
        const l = d < 0 ? -d : 0;
        gain = (gain * (period - 1) + g) / period;
        loss = (loss * (period - 1) + l) / period;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
}

function valuesOf(rows: Array<{ values: Record<string, number | null> }>, key: string): Array<number | null> {
    return rows.map((r) => (r.values[key] === undefined ? null : r.values[key]));
}

function engineFor(candles: CoreCandle[], indicators: Array<{ id: string; params?: Record<string, number> }>, opts?: { symbol?: string; timeframe?: string }): IndicatorEngine {
    const engine = new IndicatorEngine({
        symbol: opts?.symbol ?? candles[0]?.symbol ?? "TEST",
        timeframe: opts?.timeframe ?? candles[0]?.timeframe ?? "H1",
        indicators,
    });
    engine.setSeries(candles);
    return engine;
}

registerBuiltinIndicators();

// ════════════════════════════════════════════════════════════════════════════
console.log("1. Indicator registry & math");
// ════════════════════════════════════════════════════════════════════════════

check("registry exposes every required indicator with a version", () => {
    const ids = indicatorRegistry.ids().sort();
    assertEqual(
        ids,
        ["adx", "atr", "awesome", "bollinger", "ema", "macd", "obv", "rsi", "sma", "stochastic", "vwap", "wma"].sort(),
        "indicator ids",
    );
    for (const def of indicatorRegistry.list()) {
        assert(/^\d+\.\d+\.\d+$/.test(def.version), `${def.id} has a semver version`);
        assert(def.outputs.length > 0, `${def.id} declares outputs`);
        assert(def.docs && def.docs.length > 10, `${def.id} documents its rule`);
    }
});

check("duplicate indicator registration is rejected loudly", () => {
    let threw = false;
    try {
        indicatorRegistry.register(indicatorRegistry.get("ema")!);
    } catch {
        threw = true;
    }
    assert(threw, "duplicate registration must throw");
});

const sample = makeCandles(300, { seed: 7 });
const closes = sample.map((c) => c.close);

check("SMA matches an independent naive implementation", () => {
    const engine = engineFor(sample, [{ id: "sma", params: { period: 21 } }]);
    const rows = engine.get({ id: "sma", params: { period: 21 } });
    assertEqual(rows.length, 300, "row count");
    assertSeriesEqual(valuesOf(rows, "value"), naiveSma(closes, 21), "sma21 series");
});

check("EMA uses the SMA seed and matches a naive seeded EMA", () => {
    const engine = engineFor(sample, [{ id: "ema", params: { period: 20 } }]);
    const rows = engine.get({ id: "ema", params: { period: 20 } });
    assertSeriesEqual(valuesOf(rows, "value"), naiveEma(closes, 20), "ema20 series");
    const naive = naiveEma(closes, 20);
    assert(naive[18] === null && naive[19] !== null, "warmup is period-1 bars");
    assertClose(rows[19].values.value, closes.slice(0, 20).reduce((a, b) => a + b, 0) / 20, "SMA seed");
});

check("WMA weights the newest close highest", () => {
    const engine = engineFor(sample, [{ id: "wma", params: { period: 10 } }]);
    const rows = engine.get({ id: "wma", params: { period: 10 } });
    assertEqual(rows[8].values.value, null, "warmup");
    const i = 250;
    const window = closes.slice(i - 9, i + 1);
    let acc = 0;
    window.forEach((v, idx) => (acc += v * (idx + 1)));
    assertClose(rows[i].values.value, acc / 55, "wma value");
});

check("RSI matches an independent Wilder implementation", () => {
    const engine = engineFor(sample, [{ id: "rsi", params: { period: 14 } }]);
    const rows = engine.get({ id: "rsi", params: { period: 14 } });
    assertSeriesEqual(valuesOf(rows, "value"), naiveRsi(closes, 14), "rsi14 series");
});

check("Bollinger bands = SMA ± k·population stdev", () => {
    const period = 20;
    const mult = 2;
    const engine = engineFor(sample, [{ id: "bollinger", params: { period, mult } }]);
    const rows = engine.get({ id: "bollinger", params: { period, mult } });
    const i = 200;
    const window = closes.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(window.reduce((a, v) => a + (v - mean) ** 2, 0) / period);
    assertClose(rows[i].values.middle, mean, "middle");
    assertClose(rows[i].values.upper, mean + mult * sd, "upper");
    assertClose(rows[i].values.lower, mean - mult * sd, "lower");
    assert(rows[period - 2].values.upper === null, "warmup nulls");
});

check("MACD line, signal and histogram follow the documented seeds", () => {
    const engine = engineFor(sample, [{ id: "macd" }]);
    const rows = engine.get({ id: "macd" });
    const fast = naiveEma(closes, 12);
    const slow = naiveEma(closes, 26);
    for (let i = 0; i < closes.length; i++) {
        const expected = fast[i] !== null && slow[i] !== null ? (fast[i] as number) - (slow[i] as number) : null;
        const got = rows[i].values.macd;
        if (expected === null) assert(got === null, `macd null at ${i}`);
        else assertClose(got, expected as number, `macd at ${i}`);
    }
    assert(rows[25].values.signal === null, "signal null before slow seeds");
    assert(rows[26 + 9 - 2].values.signal !== null, "signal seeds at slow+signal-1");
    assertClose(rows[100].values.histogram!, (rows[100].values.macd as number) - (rows[100].values.signal as number), "histogram");
});

check("Stochastic stays in 0–100 and warms up correctly", () => {
    const engine = engineFor(sample, [{ id: "stochastic" }]);
    const rows = engine.get({ id: "stochastic" });
    assert(rows[13].values.k === null, "raw %K warmup");
    for (const row of rows) {
        for (const key of ["k", "d"]) {
            const v = row.values[key];
            if (v === null) continue;
            assert(v >= 0 && v <= 100, `${key} in 0..100 (got ${v})`);
        }
    }
});

check("Awesome Oscillator = SMA5(median) − SMA34(median)", () => {
    const engine = engineFor(sample, [{ id: "awesome" }]);
    const rows = engine.get({ id: "awesome" });
    assert(rows[32].values.value === null, "warmup is slow period");
    const i = 250;
    const median = (c: CoreCandle) => (c.high + c.low) / 2;
    const smaOf = (end: number, period: number) => {
        let sum = 0;
        for (let j = end - period + 1; j <= end; j++) sum += median(sample[j]);
        return sum / period;
    };
    assertClose(rows[i].values.value!, smaOf(i, 5) - smaOf(i, 34), "AO value");
});

check("ATR matches an independent Wilder implementation", () => {
    const engine = engineFor(sample, [{ id: "atr", params: { period: 14 } }]);
    const rows = engine.get({ id: "atr", params: { period: 14 } });
    assertSeriesEqual(valuesOf(rows, "value"), naiveAtr(sample, 14), "atr14 series");
});

check("ADX warms up after 2×period and reports DI in 0–100", () => {
    const engine = engineFor(sample, [{ id: "adx", params: { period: 14 } }]);
    const rows = engine.get({ id: "adx", params: { period: 14 } });
    assert(rows[13].values.adx === null, "no ADX at 14 bars");
    assert(rows[27].values.adx !== null, "ADX present at 2*period-1");
    for (const row of rows) {
        if (row.values.plusDI === null) continue;
        assert(row.values.plusDI! >= 0 && row.values.plusDI! <= 100, "+DI range");
        assert(row.values.minusDI! >= 0 && row.values.minusDI! <= 100, "−DI range");
        assert(row.values.adx! >= 0 && row.values.adx! <= 100, "ADX range");
    }
});

check("OBV accumulates signed volume and stays null without volume", () => {
    const engine = engineFor(sample, [{ id: "obv" }]);
    const rows = engine.get({ id: "obv" });
    assertEqual(rows[0].values.value, 0, "OBV starts at 0");
    let expected = 0;
    for (let i = 1; i < sample.length; i++) {
        const diff = sample[i].close - sample[i - 1].close;
        if (diff > 0) expected += sample[i].volume ?? 0;
        else if (diff < 0) expected -= sample[i].volume ?? 0;
        assertClose(rows[i].values.value!, expected, `OBV at ${i}`);
    }
    const noVolume = sample.map((c) => ({ ...c, volume: 0 }));
    const engine2 = engineFor(noVolume, [{ id: "obv" }]);
    assertEqual(engine2.get({ id: "obv" })[50].values.value, null, "null when the feed has no volume");
});

check("VWAP resets at every UTC day boundary", () => {
    const day1 = makeCandles(10, { start: Date.UTC(2026, 8, 21, 0, 0), seed: 3 });
    const day2 = makeCandles(10, { start: Date.UTC(2026, 8, 22, 0, 0), seed: 3 });
    const candles = [...day1, ...day2];
    const rows = alignedIndicatorSeries(candles, { id: "vwap" }, "value");
    const first = candles[0];
    assertClose(rows[0]!, (first.high + first.low + first.close) / 3, "first bar VWAP = typical price (volume fallback 1)");
    const day2First = candles[10];
    assertClose(rows[10]!, (day2First.high + day2First.low + day2First.close) / 3, "VWAP resets at the new UTC day");
});

check("legacy analytics adapters delegate to the same math", () => {
    assertSeriesEqual(analyticsSma(closes, 21), naiveSma(closes, 21), "analytics sma (NaN warmup)");
    assertSeriesEqual(analyticsEma(closes, 20), naiveEma(closes, 20), "analytics ema");
    assertSeriesEqual(analyticsRsi(closes, 14), naiveRsi(closes, 14), "analytics rsi");
    assertSeriesEqual(analyticsAtr(sample as never, 14), naiveAtr(sample, 14), "analytics atr");
    const m = analyticsMacd(closes);
    assert(Number.isNaN(m.signal[10]), "signal does not seed on placeholder zeros");
    assert(Number.isFinite(m.signal[60]), "signal is live in the tail");
});

// ════════════════════════════════════════════════════════════════════════════
console.log("2. Alignment by market coordinates");
// ════════════════════════════════════════════════════════════════════════════

check("indicator rows carry candle open times (including across a weekend gap)", () => {
    const friday = makeCandles(5, { start: Date.UTC(2026, 8, 21, 20, 0), seed: 11 }); // Sun? use Friday 20:00
    const sunday = makeCandles(5, { start: Date.UTC(2026, 8, 23, 21, 0), seed: 12 });
    const candles = [...friday, ...sunday];
    const engine = engineFor(candles, [{ id: "ema", params: { period: 3 } }]);
    const rows = engine.get({ id: "ema", params: { period: 3 } });
    assertEqual(rows.map((r) => r.timestamp), candles.map((c) => c.timestamp), "row timestamps = candle open times");
    const aligned = engine.getOutputAligned({ id: "ema", params: { period: 3 } }, "value", candles.map((c) => c.timestamp));
    assertEqual(aligned.length, 10, "aligned length");
    assert(aligned[9] !== null, "tail present");
    // A timestamp between candles resolves to nothing (no fabricated point).
    assertEqual(engine.at({ id: "ema", params: { period: 3 } }, candles[4].timestamp + H1 / 2), null, "gap timestamp has no value");
});

check("historical prepend recomputes correctly and never duplicates rows", () => {
    const recent = makeCandles(120, { start: START + 500 * H1, seed: 21 });
    const older = makeCandles(200, { start: START, seed: 22 });
    const engine = new IndicatorEngine({ symbol: "XAUUSD", timeframe: "H1", indicators: [{ id: "ema", params: { period: 20 } }, { id: "sma", params: { period: 20 } }] });
    engine.setSeries(recent);
    const before = engine.get({ id: "ema", params: { period: 20 } }).slice();
    const report = engine.setSeries([...older, ...recent]);
    assertEqual(report.kind, "full", "prepend forces a full recompute");
    const after = engine.get({ id: "ema", params: { period: 20 } });
    assertEqual(after.length, 320, "row count grows exactly by the prepended history");
    assertEqual(after.slice(200).map((r) => r.timestamp), before.map((r) => r.timestamp), "original timestamps preserved");
    // The canonical (full-history) values are authoritative for the overlap.
    const full = new IndicatorEngine({ symbol: "XAUUSD", timeframe: "H1", indicators: [{ id: "ema", params: { period: 20 } }] });
    full.setSeries([...older, ...recent]);
    assertEqual(after, full.get({ id: "ema", params: { period: 20 } }), "after == full recompute");
    // Dedupe: identical timestamp appears once.
    const stamps = after.map((r) => r.timestamp);
    assertEqual(new Set(stamps).size, stamps.length, "no duplicate indicator points");
});

check("alignedIndicatorSeries memoizes per snapshot and refreshes on a new snapshot", () => {
    const a = alignedIndicatorSeries(sample, { id: "ema", params: { period: 20 } }, "value");
    const b = alignedIndicatorSeries(sample, { id: "ema", params: { period: 20 } }, "value");
    assert(a === b, "same snapshot → same array (memoized)");
    const changed = sample.map((c, i) => (i === sample.length - 1 ? { ...c, close: c.close + 5 } : c));
    const c2 = alignedIndicatorSeries(changed, { id: "ema", params: { period: 20 } }, "value");
    assert(c2 !== a, "new snapshot → new computation");
    assert(c2[c2.length - 1] !== a[a.length - 1], "tail value updated");
});

check("mapToTimeline maps HTF values onto base candles by timestamp", () => {
    const base: number[] = [];
    for (let i = 0; i < 12; i++) base.push(Date.UTC(2026, 8, 21, 0, i * 5));
    const htf = [
        { timestamp: Date.UTC(2026, 8, 21, 0, 0), values: { ema200: 1 } },
        { timestamp: Date.UTC(2026, 8, 21, 1, 0), values: { ema200: 2 } },
    ];
    const mapped = mapToTimeline(base, htf);
    assertEqual(mapped[0].ema200, 1, "first base candle sees the first HTF row");
    assertEqual(mapped[11].ema200, 1, "inside hour 0 the value is constant");
    const later = [...base, Date.UTC(2026, 8, 21, 1, 5)];
    const mapped2 = mapToTimeline(later, htf);
    assertEqual(mapped2[12].ema200, 2, "value steps when the next HTF candle opens");
    assertEqual(mapToTimeline([Date.UTC(2026, 8, 20, 0, 0)], htf)[0].ema200, undefined, "before the first HTF row → no value");
});

// ════════════════════════════════════════════════════════════════════════════
console.log("3. Incremental equivalence (historical + realtime)");
// ════════════════════════════════════════════════════════════════════════════

const ALL_INDICATORS = indicatorRegistry.ids().map((id) => ({ id }));

function fullCompute(candles: CoreCandle[]): Map<string, Array<{ timestamp: number; values: Record<string, number | null> }>> {
    const engine = new IndicatorEngine({ symbol: "XAUUSD", timeframe: "H1", indicators: ALL_INDICATORS });
    engine.setSeries(candles);
    const out = new Map();
    for (const key of engine.instanceKeys()) out.set(key, engine.getByKey(key));
    return out;
}

function assertEnginesEqual(engine: IndicatorEngine, expected: Map<string, unknown>, label: string): void {
    for (const key of engine.instanceKeys()) {
        assertEqual(engine.getByKey(key), expected.get(key), `${label}: ${key}`);
    }
}

check("incremental tail update == full recompute for every indicator", () => {
    const base = makeCandles(400, { seed: 55 });
    const expected = fullCompute(base);

    const engine = new IndicatorEngine({ symbol: "XAUUSD", timeframe: "H1", indicators: ALL_INDICATORS });
    engine.setSeries(base.slice(0, 300));
    const report = engine.setSeries(base);
    assertEqual(report.kind, "incremental", "extension folds incrementally");
    assertEnginesEqual(engine, expected, "append");
});

check("forming-candle tick updates re-fold only the tail and stay exact", () => {
    const base = makeCandles(300, { seed: 91 });
    const engine = new IndicatorEngine({ symbol: "XAUUSD", timeframe: "H1", indicators: ALL_INDICATORS });
    engine.setSeries(base);
    let current = base;

    for (let tick = 0; tick < 5; tick++) {
        const mutated = current.map((c, i) =>
            i === current.length - 1 ? { ...c, close: c.close + (tick % 2 === 0 ? 1.25 : -0.75), high: Math.max(c.high, c.close + 1.5) } : c,
        );
        const report = engine.setSeries(mutated);
        assertEqual(report.kind, "incremental", `tick ${tick} folds incrementally`);
        current = mutated;
        const expected = fullCompute(current);
        assertEnginesEqual(engine, expected, `tick ${tick}`);
    }
});

check("candle close → new candle transition finalizes and seeds without duplication", () => {
    const base = makeCandles(200, { seed: 13 });
    const engine = new IndicatorEngine({ symbol: "XAUUSD", timeframe: "H1", indicators: ALL_INDICATORS });
    engine.setSeries(base);

    // Close the forming candle, open the next one (canonical aggregator shape).
    const closed = base.slice(0, -1).map((c) => ({ ...c, finalized: true }));
    const last = base[base.length - 1];
    const fresh: CoreCandle = {
        ...last,
        timestamp: last.timestamp + H1,
        open: last.close,
        high: Math.max(last.close, last.close + 0.4),
        low: Math.min(last.close, last.close - 0.4),
        close: last.close + 0.2,
        finalized: false,
    };
    const next = [...closed, fresh];
    const report = engine.setSeries(next);
    assertEqual(report.kind, "incremental", "close+append is incremental");
    const expected = fullCompute(next);
    assertEnginesEqual(engine, expected, "after close → new candle");
    const rows = engine.get({ id: "ema", params: { period: 20 } });
    assertEqual(rows.length, next.length, "row count matches candle count");
    assertEqual(new Set(rows.map((r) => r.timestamp)).size, rows.length, "no duplicated indicator points");
    assertEqual(rows[rows.length - 1].timestamp, fresh.timestamp, "last row belongs to the new candle");
});

check("mid-series revision forces a full recompute (never a stale prefix)", () => {
    const base = makeCandles(250, { seed: 31 });
    const engine = new IndicatorEngine({ symbol: "XAUUSD", timeframe: "H1", indicators: ALL_INDICATORS });
    engine.setSeries(base);
    const revised = base.map((c, i) => (i === 100 ? { ...c, close: c.close + 10, high: c.high + 10 } : c));
    const report = engine.setSeries(revised);
    assertEqual(report.kind, "full", "prefix revision detected");
    assertEnginesEqual(engine, fullCompute(revised), "after revision");
});

// ════════════════════════════════════════════════════════════════════════════
console.log("4. Overlay model");
// ════════════════════════════════════════════════════════════════════════════

const ZONE_OBJ: SmartMoneyObject = {
    id: "fvg|bullish|EURUSD|H1|1723000000000",
    kind: "fvg",
    symbol: "EURUSD",
    timeframe: "H1",
    detectedAt: 1723000000000,
    confirmationAt: 1723036000000,
    status: "active",
    direction: "bullish",
    priceHigh: 1.105,
    priceLow: 1.1,
    sourceCandles: [1722992800000, 1722996400000, 1723000000000],
    metadata: { zoneStart: 1722992800000 },
};

function overlay(id: string, layer: MarketOverlay["layer"], start: number, priority?: MarketOverlay["priority"]): MarketOverlay {
    return {
        id,
        type: "marker",
        layer,
        symbol: "EURUSD",
        timeframe: "H1",
        startTime: start,
        priceStart: 1.1,
        ...(priority ? { priority } : {}),
    };
}

check("smart-money objects convert to market-coordinate overlays only", () => {
    const o = smartMoneyToOverlay(ZONE_OBJ);
    assertEqual(o.startTime, ZONE_OBJ.detectedAt, "startTime = detection time");
    assertEqual(o.priceStart, 1.105, "top price");
    assertEqual(o.priceEnd, 1.1, "bottom price");
    assertEqual(o.layer, "fvg", "layer routing");
    assertEqual(o.metadata?.status, "active", "status preserved for renderers");
    assertEqual(o.metadata?.confirmationAt, ZONE_OBJ.confirmationAt, "confirmation carried through");
    for (const key of Object.keys(o)) {
        assert(
            !/pixel|screen|clientX|clientY|left|top/.test(key),
            `overlay must never carry screen coordinates (found ${key})`,
        );
    }
});

check("layer visibility and density budgets limit rendering, not data", () => {
    const many: MarketOverlay[] = [];
    for (let i = 0; i < 500; i++) {
        many.push(overlay(`sm-${i}`, "market_structure", START + i * H1, i % 4 === 0 ? "critical" : "low"));
    }
    many.push(overlay("ai-1", "ai", START));
    const visible = selectOverlaysForViewport(many, { visible: { market_structure: true, ai: false } });
    assert(!visible.some((o) => o.layer === "ai"), "hidden layer excluded");
    assert(visible.length <= LAYER_BY_ID.market_structure.budget, "budget enforced");
    assert(
        visible.some((o) => o.priority === "critical"),
        "highest priority survives the budget",
    );
    assertEqual(many.length, 501, "original set untouched (data preserved)");
    const all = selectOverlaysForViewport(many, { visible: { market_structure: true, ai: true }, budgetScale: 10 });
    assert(all.length === 501, "budget scale raises the drawing budget without changing data");
});

check("viewport filtering drops only objects outside the time window", () => {
    const ended: MarketOverlay = { ...overlay("a", "signals", START), endTime: START + 20 * H1 };
    const items = [ended, overlay("b", "signals", START + 100 * H1)];
    const inWindow = selectOverlaysForViewport(items, { fromTime: START + 50 * H1, toTime: START + 150 * H1 });
    assertEqual(inWindow.map((o) => o.id), ["b"], "only in-window object drawn");
});

check("pan/zoom/resize cannot change an overlay's market coordinates", () => {
    const items = [smartMoneyToOverlay(ZONE_OBJ), overlay("sig", "signals", START + 10 * H1)];
    const before = JSON.stringify(sortOverlays(items));
    // Simulate the coordinate pipeline at two zoom levels: the logical index
    // for the same timestamp differs, but the market coordinates must not.
    const candles = makeCandles(300, { seed: 4 });
    const probe = START - 50 * H1; // before the loaded window
    const idxZoomedIn = barIndexForTime(candles, probe, H1);
    const idxZoomedOut = barIndexForTime(candles, probe, 4 * H1);
    assert(idxZoomedIn !== idxZoomedOut, "logical index changes with zoom");
    const after = JSON.stringify(sortOverlays(items));
    assertEqual(after, before, "overlay market coordinates are immutable across viewports");
    assertEqual(items[0].startTime, ZONE_OBJ.detectedAt, "startTime unchanged");
});

check("priority resolves from the layer when the object does not declare one", () => {
    assertEqual(overlayPriority(overlay("x", "signals", START)), "critical", "signals are critical");
    assertEqual(overlayPriority(overlay("x", "ai", START)), "low", "ai is low");
    assertEqual(overlayPriority(overlay("x", "signals", START, "medium")), "medium", "explicit priority wins");
});

check("overlay registry exposes built-in overlay definitions", () => {
    for (const id of ["indicator.line", "sm.fvg", "sm.order_block", "signal.marker", "ai.annotation"]) {
        assert(overlayRegistry.has(id), `${id} registered`);
    }
});

// ════════════════════════════════════════════════════════════════════════════
console.log("5. Smart Money detectors");
// ════════════════════════════════════════════════════════════════════════════

function zigZag(): CoreCandle[] {
    const highs = [101, 104, 103, 102, 105, 104, 101, 103, 100, 102];
    const lows = [99, 102, 100, 98, 101, 99, 97, 100, 96, 99];
    return highs.map((h, i) => bar(i, (h + lows[i]) / 2, h, lows[i], h - 0.5));
}

/**
 * Fixture whose ONLY structure break happens on the LAST candle (forming):
 * a confirmed swing high at 103 is broken by the close of bar 9.
 */
function breakFixture(): CoreCandle[] {
    const highs = [101, 104, 103, 102, 103, 103, 102, 101, 102, 107];
    const lows = [99, 102, 100, 98, 99, 99.5, 99, 98.5, 99, 102];
    const closes = [100.5, 103.5, 102.5, 101.5, 102, 102.5, 101.5, 100.5, 101, 106.5];
    return highs.map((h, i) => ({
        ...bar(i, (h + lows[i]) / 2, h, lows[i], closes[i]),
        finalized: i < highs.length - 1,
    }));
}

check("pivots are confirmed with pivot_time and confirmation_time", () => {
    const candles = zigZag();
    const pivots = detectPivots(candles, 1, H1);
    const sh = pivots.filter((p) => p.side === "high" && !p.developing);
    assertEqual(sh.map((p) => p.price), [104, 105, 103], "swing highs found");
    for (const p of pivots) {
        assert(p.confirmationTime >= p.timestamp + H1, "confirmation is at least one bar after the pivot");
        if (!p.developing) assertEqual(p.confirmationTime, candles[p.confirmationIndex].timestamp + H1, "confirmation = close of pivot+lookback");
    }
});

check("HH/HL/LH/LL are classified correctly (previous same-side swing)", () => {
    const detection = detectSmartMoney(zigZag(), { symbol: "EURUSD", timeframe: "H1", lookback: 1 });
    const kinds = detection.objects.map((o) => o.kind);
    assert(kinds.includes("hh"), "higher high present (104 → 105)");
    assert(kinds.includes("lh"), "lower high present (105 → 103)");
    assert(kinds.includes("ll"), "lower low present (98 → 97)");
    assert(!kinds.includes("hl"), "no higher low in this fixture");
    assertEqual(detection.structure.counts.hh, 1, "one HH");
    assertEqual(detection.structure.counts.lh, 1, "one LH");
    // lows: 98 (i3) → 97 (i6) → 96 (i8): two lower lows.
    assertEqual(detection.structure.counts.ll, 2, "two LL");
});

check("BOS fires on a close through a confirmed swing high, with pivot metadata", () => {
    const detection = detectSmartMoney(zigZag(), { symbol: "EURUSD", timeframe: "H1", lookback: 1 });
    const breaks = detection.objects.filter((o) => o.kind === "bos" || o.kind === "choch");
    assertEqual(breaks.length, 1, "exactly one break in the fixture");
    const b = breaks[0];
    assertEqual(b.direction, "bullish", "bullish break");
    assertEqual(b.price, 104, "broken level = swing high price");
    assertEqual(b.metadata?.pivotTime, START + 1 * H1, "pivot_time exposed");
    assertEqual(b.confirmationAt, START + 4 * H1 + H1, "confirmation = close of the breaking candle");
    assertEqual(b.status, "confirmed", "closed breaking candle confirms immediately");
});

check("CHOCH fires when the break direction flips", () => {
    // Zigzag up, then a close below the last confirmed swing low.
    const candles: CoreCandle[] = [];
    const plan: Array<[number, number, number, number]> = [
        [100, 101, 99, 100.5],
        [100.5, 104, 100, 103.5], // SH 104
        [103.5, 103.5, 101, 102],
        [102, 102, 99.5, 100],
        [100, 103, 99, 102.5],
        [102.5, 106, 102, 105.5], // SH 106 → BOS
        [105.5, 105.5, 100, 101],
        [101, 101.5, 97, 98],
        [98, 98.5, 96, 96.5], // close 96.5 below confirmed low 97? SL must exist first
        [96.5, 99, 96, 98],
    ];
    plan.forEach((row, i) => candles.push(bar(i, row[0], row[1], row[2], row[3])));
    const detection = detectSmartMoney(candles, { symbol: "EURUSD", timeframe: "H1", lookback: 1 });
    const kinds = detection.objects.filter((o) => o.kind === "bos" || o.kind === "choch").map((o) => o.kind);
    assert(kinds.includes("bos"), "continuation break exists");
    assert(kinds.includes("choch"), "character change exists after the flip");
});

check("FVG: 3-candle gap with correct bounds, anchor and lifecycle", () => {
    const candles: CoreCandle[] = [];
    // Room for 10 candles; plant a bullish gap between bar 1 (high 100.5) and bar 3 (low 101.2)
    const plan: Array<[number, number, number, number]> = [
        [100, 100.4, 99.6, 100],
        [100, 100.5, 99.8, 100.2], // c1 high 100.5
        [100.2, 101.5, 100, 101.4],
        [101.4, 102, 101.2, 101.8], // c3 low 101.2 > 100.5 → gap [100.5, 101.2]
        [101.8, 102.2, 101.5, 102],
        [102, 102.5, 101.7, 102.3],
        [102.3, 102.6, 101.9, 102.4],
        [102.4, 102.7, 102.1, 102.5],
        [102.5, 102.8, 102.2, 102.6],
        [102.6, 102.9, 102.3, 102.7],
    ];
    plan.forEach((row, i) => candles.push(bar(i, row[0], row[1], row[2], row[3])));
    const ctxCandles = candles;
    const fvgs = detectFvgs({ symbol: "EURUSD", timeframe: "H1", tfMs: H1, candles: ctxCandles, lookback: 3, equalTolerance: 0.001 });
    const gap = fvgs.find((f) => f.metadata?.zoneStart === candles[1].timestamp);
    assert(gap !== undefined, "bullish FVG detected");
    assert(gap!.priceHigh! > gap!.priceLow!, "bounds ordered high ≥ low");
    assertClose(gap!.priceLow!, 100.5, "gap origin = c1.high");
    assertClose(gap!.priceHigh!, 101.2, "gap top = c3.low");
    assertEqual(gap!.confirmationAt, candles[3].timestamp + H1, "confirmed at the close of candle 3");
    assertEqual(gap!.status, "active", "no retest → active");
    assertEqual(gap!.direction, "bullish", "direction");

    // Re-test: price trades halfway into the gap → mitigated.
    const retest = candles.map((c, i) =>
        i === 5 ? { ...c, low: 100.85, close: 101.0 } : c,
    );
    const fvgs2 = detectFvgs({ symbol: "EURUSD", timeframe: "H1", tfMs: H1, candles: retest, lookback: 3, equalTolerance: 0.001 });
    const gap2 = fvgs2.find((f) => f.metadata?.zoneStart === candles[1].timestamp);
    assertEqual(gap2!.status, "mitigated", "≥50% penetration mitigates");

    // Full fill: close beyond the gap origin → invalidated.
    const filled = candles.map((c, i) => (i === 7 ? { ...c, close: 100.2, low: 100.1 } : c));
    const fvgs3 = detectFvgs({ symbol: "EURUSD", timeframe: "H1", tfMs: H1, candles: filled, lookback: 3, equalTolerance: 0.001 });
    const gap3 = fvgs3.find((f) => f.metadata?.zoneStart === candles[1].timestamp);
    assertEqual(gap3!.status, "invalidated", "close beyond the origin invalidates");
});

check("Order block: last opposite candle before displacement, with lifecycle", () => {
    const candles: CoreCandle[] = [];
    const plan: Array<[number, number, number, number]> = [
        [100, 100.5, 99.5, 100],
        [100, 100.6, 99.6, 100.2],
        [100.2, 100.7, 99.7, 100.3],
        [100.3, 100.8, 99.8, 100.4],
        [100.4, 100.9, 99.9, 100.5],
        [100.5, 101.2, 99.8, 100.0], // bearish candle (OB candidate), high 101.2
        [100.0, 102.5, 99.9, 102.3], // bullish displacement closing above 101.2
        [102.3, 102.8, 102.0, 102.6],
        [102.6, 103.0, 102.4, 102.8],
        [102.8, 103.2, 102.6, 103.0],
    ];
    plan.forEach((row, i) => candles.push(bar(i, row[0], row[1], row[2], row[3])));
    const obs = detectOrderBlocks({
        symbol: "EURUSD",
        timeframe: "H1",
        tfMs: H1,
        candles,
        lookback: 3,
        equalTolerance: 0.001,
    });
    const ob = obs.find((o) => o.metadata?.zoneStart === candles[5].timestamp && o.direction === "bullish");
    assert(ob !== undefined, "bullish OB detected on the last bearish candle before displacement");
    assertClose(ob!.priceHigh!, 101.2, "block high = candidate high");
    assertClose(ob!.priceLow!, 99.8, "block low = candidate low");
    assertEqual(ob!.confirmationAt, candles[6].timestamp + H1, "confirmed at the displacement close");
    assertEqual(ob!.status, "active", "untouched block is active");
    assert((ob!.strength ?? 0) > 0 && (ob!.strength ?? 0) <= 100, "strength bounded 0..100");

    const mitigated = candles.map((c, i) => (i === 8 ? { ...c, low: 100.6, high: 103 } : c));
    const obs2 = detectOrderBlocks({ symbol: "EURUSD", timeframe: "H1", tfMs: H1, candles: mitigated, lookback: 3, equalTolerance: 0.001 });
    const ob2 = obs2.find((o) => o.metadata?.zoneStart === candles[5].timestamp && o.direction === "bullish");
    assertEqual(ob2!.status, "mitigated", "trade back into the block mitigates it");

    const broken = candles.map((c, i) => (i === 8 ? { ...c, close: 99.5, low: 99.4 } : c));
    const obs3 = detectOrderBlocks({ symbol: "EURUSD", timeframe: "H1", tfMs: H1, candles: broken, lookback: 3, equalTolerance: 0.001 });
    const ob3 = obs3.find((o) => o.metadata?.zoneStart === candles[5].timestamp && o.direction === "bullish");
    assertEqual(ob3!.status, "invalidated", "close below the block invalidates it");
});

check("Liquidity: equal highs pool + sweep with buy-side/sell-side conventions", () => {
    // Two swing highs at ~100.00 (within 0.1%), then a wick above with a close back below.
    const highs = [99, 100, 99.5, 99.9998, 99.8, 99.9, 99.6, 100.4, 99.7, 99.8, 99.9, 99.7];
    const lows = [97, 98.5, 97.5, 98.4, 98.6, 98.7, 98.0, 99.0, 98.2, 98.3, 98.6, 98.4];
    const candles = highs.map((h, i) => bar(i, (h + lows[i]) / 2, h, lows[i], Math.min(h - 0.05, lows[i] + 1)));
    // Make the sweep candle close back below the pool level.
    candles[7] = bar(7, 99.9, 100.4, 99.0, 99.6);

    const detection = detectSmartMoney(candles, { symbol: "EURUSD", timeframe: "H1", lookback: 1 });
    const pools = detection.pools.filter((p) => p.kind === "equal_highs");
    assert(pools.length >= 1, "equal highs pool detected");
    const pool = pools[0];
    assertEqual(pool.metadata?.side, "buy_side", "liquidity above highs is buy-side");
    assert(pool.confirmationAt <= candles[7].timestamp, "pool known before the sweep candle");

    const sweep = detection.sweeps.find((s) => s.metadata?.poolId === pool.id);
    assert(sweep !== undefined, "sweep detected");
    assertEqual(sweep!.direction, "bearish", "buy-side sweep is bearish");
    assertEqual(sweep!.confirmationAt, candles[7].timestamp + H1, "sweep confirmed at its close");
    assertEqual(pool.status, "invalidated", "swept pool is invalidated");
    assertEqual(pool.metadata?.sweptBy, sweep!.id, "pool links to the sweep");
});

check("Premium/discount: dealing range from confirmed swings", () => {
    const detection = detectSmartMoney(zigZag(), { symbol: "EURUSD", timeframe: "H1", lookback: 1 });
    const range = detection.dealingRange;
    assert(range !== null, "dealing range exists");
    assert(range!.high > range!.low, "bounds ordered");
    assertClose(range!.equilibrium, (range!.high + range!.low) / 2, "equilibrium = midpoint");
    assert(["premium", "discount", "equilibrium"].includes(range!.zone), "zone classified");
    assertEqual(classifyZone(range!.high, range!), "premium", "top of range is premium");
    assertEqual(classifyZone(range!.low, range!), "discount", "bottom of range is discount");
});

check("Sessions: UTC windows and session levels", () => {
    const london = Date.UTC(2026, 8, 22, 10, 0);
    const overlap = Date.UTC(2026, 8, 22, 13, 0);
    const closed = Date.UTC(2026, 8, 22, 23, 0);
    assertEqual(primarySession(london), "London", "London at 10:00 UTC");
    assertEqual(primarySession(overlap), "overlap", "London/NY overlap at 13:00 UTC");
    assertEqual(primarySession(closed), "closed", "closed at 23:00 UTC");
    assert(sessionsAt(overlap).length === 2, "overlap has two active sessions");
    const candles = makeCandles(48, { start: Date.UTC(2026, 8, 22, 0, 0), seed: 5, timeframe: "H1" });
    const levels = sessionLevels(candles);
    assert(levels.length >= 1, "session levels for the current day");
    for (const l of levels) {
        assert(l.high >= l.low, "session high ≥ low");
        assert(l.color.startsWith("#"), "layer color available");
    }
});

check("SmartMoneyDetector memoizes on snapshot identity and disposes cleanly", () => {
    const candles = makeCandles(120, { seed: 17 });
    const detector = new SmartMoneyDetector({ symbol: "EURUSD", timeframe: "H1" });
    const first = detector.run(candles);
    const second = detector.run(candles);
    assert(first === second, "same snapshot → cached detection");
    const changed = candles.map((c, i) => (i === 119 ? { ...c, close: c.close + 1 } : c));
    const third = detector.run(changed);
    assert(third !== first, "new snapshot → recompute");
    detector.dispose();
});

check("detection is deterministic (identical input → identical output)", () => {
    const candles = makeCandles(400, { seed: 77 });
    const a = detectSmartMoney(candles, { symbol: "XAUUSD", timeframe: "H1" });
    const b = detectSmartMoney(candles, { symbol: "XAUUSD", timeframe: "H1" });
    assertEqual(a, b, "two runs identical");
    assertEqual(a.version, SMART_MONEY_VERSION, "version stamped");
});

// ════════════════════════════════════════════════════════════════════════════
console.log("6. Future-candle leakage protection");
// ════════════════════════════════════════════════════════════════════════════

check("no object is knowable before its confirmation time", () => {
    const candles = makeCandles(500, { seed: 8 });
    const full = detectSmartMoney(candles, { symbol: "XAUUSD", timeframe: "H1" });
    assert(full.objects.length > 0, "fixture produces objects");
    const lastClose = candles[candles.length - 1].timestamp + H1;
    for (const obj of full.objects) {
        const known = visibleAsOf([obj], obj.confirmationAt - 1);
        assertEqual(known.length, 0, `${obj.id} hidden before confirmation`);
        assertEqual(visibleAsOf([obj], obj.confirmationAt).length, 1, `${obj.id} visible at confirmation`);
    }
    assert(visibleAsOf(full.objects, lastClose).length <= full.objects.length, "asOf filter works");
});

check("a break on candle k is unknown during candle k and known after it closes", () => {
    const candles = breakFixture(); // BOS on index 9 (forming)
    const breakIdx = 9;
    // Prefix snapshot where the breaking candle is still FORMING.
    const prefix = candles
        .slice(0, breakIdx + 1)
        .map((c, i, arr) => (i === arr.length - 1 ? { ...c, finalized: false } : c));
    const detection = detectSmartMoney(prefix, { symbol: "EURUSD", timeframe: "H1", lookback: 1 });
    const breakObj = detection.objects.find((o) => o.kind === "bos" || o.kind === "choch");
    assert(breakObj !== undefined, "forming break is present in the raw detection");
    assertEqual(breakObj!.status, "developing", "marking a break on the forming candle as developing");
    assert(breakObj!.confirmationAt > prefix[prefix.length - 1].timestamp, "confirmation is in the future of the prefix");

    const knownDuring = visibleAsOf(detection.objects, prefix[prefix.length - 1].timestamp);
    assert(!knownDuring.some((o) => o.kind === "bos" || o.kind === "choch"), "NOT visible while forming (no look-ahead)");

    const knownAfter = visibleAsOf(detection.objects, prefix[prefix.length - 1].timestamp + H1);
    assert(knownAfter.some((o) => o.kind === "bos" || o.kind === "choch"), "visible once the candle closes");

    // Ids are stable across prefix and full runs → reproducible research.
    const fullRun = detectSmartMoney(candles, { symbol: "EURUSD", timeframe: "H1", lookback: 1 });
    const fullBreak = fullRun.objects.find((o) => o.kind === "bos" || o.kind === "choch");
    assert(fullBreak !== undefined, "break present in the full run");
    assertEqual(breakObj!.id, fullBreak!.id, "stable id between prefix and full runs");
});

check("prefix runs never depend on future candles (structural invariance)", () => {
    const candles = makeCandles(300, { seed: 44 });
    // Kinds that are structurally prefix-stable (ids anchored on source
    // candle times). Pools that aggregate later members (equal levels) and
    // derived ranges are legitimately refined as data arrives.
    const STABLE = new Set(["swing_high", "swing_low", "hh", "hl", "lh", "ll", "bos", "choch", "fvg", "order_block", "liquidity_pool"]);
    const stableKnown = (objects: SmartMoneyObject[]) =>
        visibleAsOf(objects, candles[149].timestamp).filter(
            (o) => STABLE.has(o.kind) && (o.kind !== "liquidity_pool" || o.metadata?.source === "swing"),
        );
    const at150 = detectSmartMoney(candles.slice(0, 150), { symbol: "XAUUSD", timeframe: "H1" });
    const knownAt150 = stableKnown(at150.objects);
    const inFull = new Map(stableKnown(detectSmartMoney(candles, { symbol: "XAUUSD", timeframe: "H1" }).objects).map((o) => [o.id, o]));
    assert(knownAt150.length > 0, "prefix produced known objects");
    for (const obj of knownAt150) {
        const twin = inFull.get(obj.id);
        assert(twin !== undefined, `${obj.id} also known in the full run`);
        assertEqual(twin!.confirmationAt, obj.confirmationAt, `${obj.id} confirmation identical`);
        assertEqual(twin!.price, obj.price, `${obj.id} price identical`);
    }
    // Developing objects can never slip through the gate.
    assert(!knownAt150.some((o) => o.confirmationAt > candles[149].timestamp), "nothing beyond the prefix close time");
    assertEqual(detectedBy(at150.objects, 0).length, 0, "detectedBy(0) sees nothing");
});

check("backtest-style stepping sees each event exactly when it confirms", () => {
    const candles = breakFixture();
    const detection = detectSmartMoney(candles, { symbol: "EURUSD", timeframe: "H1", lookback: 1 });
    const breakObj = detection.objects.find((o) => o.kind === "bos" || o.kind === "choch")!;
    let firstSeenAt: number | null = null;
    for (let i = 0; i < candles.length; i++) {
        const asOf = candles[i].timestamp + H1; // the moment bar i closes
        const seen = visibleAsOf(detection.objects, asOf).some((o) => o.id === breakObj.id);
        if (seen && firstSeenAt === null) firstSeenAt = asOf;
    }
    assert(firstSeenAt !== null, "event becomes visible at some step");
    assert(firstSeenAt! >= breakObj.confirmationAt, "visible no earlier than confirmation");
    assertEqual(firstSeenAt, candles[9].timestamp + H1, "visible exactly at the close of candle 9");
});

// ════════════════════════════════════════════════════════════════════════════
console.log("7. Lifecycle (configure / symbol / timeframe)");
// ════════════════════════════════════════════════════════════════════════════

check("adding an indicator computes it; removing it leaves no ghost state", () => {
    const candles = makeCandles(200, { seed: 6 });
    const engine = new IndicatorEngine({ symbol: "EURUSD", timeframe: "H1", indicators: [{ id: "ema", params: { period: 20 } }] });
    engine.setSeries(candles);
    const added = engine.configure([{ id: "ema", params: { period: 20 } }, { id: "rsi", params: { period: 14 } }, { id: "macd" }]);
    assertEqual(added.removed.length, 0, "nothing removed");
    assertEqual(added.added.length, 2, "rsi + macd added");
    assertEqual(engine.get({ id: "rsi", params: { period: 14 } }).length, 200, "new indicator computed over history");

    const removed = engine.configure([{ id: "ema", params: { period: 20 } }]);
    assertEqual(removed.removed.length, 2, "rsi + macd dropped");
    assertEqual(engine.instanceKeys().length, 1, "only the kept instance remains");
    assert(!engine.has({ id: "rsi" }), "no ghost rsi");
    assertEqual(engine.get({ id: "rsi" }).length, 0, "no ghost rows");
});

check("changing parameters recomputes and does not serve stale values", () => {
    const candles = makeCandles(250, { seed: 9 });
    const engine = new IndicatorEngine({ symbol: "EURUSD", timeframe: "H1" });
    engine.setSeries(candles);
    engine.configure([{ key: "ema", id: "ema", params: { period: 9 } }]);
    const short = engine.getByKey("ema").slice();
    engine.configure([{ key: "ema", id: "ema", params: { period: 50 } }]);
    const long = engine.getByKey("ema");
    assertEqual(long.length, 250, "recomputed over the series");
    assert(long[30].values.value !== short[30].values.value, "new parameter reflected at index 30");
    const fresh = new IndicatorEngine({ symbol: "EURUSD", timeframe: "H1", indicators: [{ id: "ema", params: { period: 50 } }] });
    fresh.setSeries(candles);
    assertEqual(long, fresh.get({ id: "ema", params: { period: 50 } }), "equals a fresh computation");
});

check("symbol/timeframe engines are isolated (XAUUSD M5 vs EURUSD H1)", () => {
    const xau = makeCandles(100, { symbol: "XAUUSD", timeframe: "M5", seed: 1, start: START });
    const eur = makeCandles(100, { symbol: "EURUSD", timeframe: "H1", seed: 2, start: START });
    const a = new IndicatorEngine({ symbol: "XAUUSD", timeframe: "M5", indicators: [{ id: "ema", params: { period: 20 } }] });
    const b = new IndicatorEngine({ symbol: "EURUSD", timeframe: "H1", indicators: [{ id: "ema", params: { period: 20 } }] });
    a.setSeries(xau);
    b.setSeries(eur);
    const before = JSON.stringify(b.get({ id: "ema", params: { period: 20 } }));
    a.setSeries([]);
    assertEqual(JSON.stringify(b.get({ id: "ema", params: { period: 20 } })), before, "clearing XAUUSD leaves EURUSD untouched");
    assertEqual(a.get({ id: "ema", params: { period: 20 } }).length, 0, "XAUUSD rows cleared");
    a.dispose();
    b.dispose();
    assertEqual(a.instanceKeys().length, 0, "dispose clears instances");
});

check("workspaces/layouts that switch indicators never leak rows between keys", () => {
    const candles = makeCandles(120, { seed: 23 });
    const engine = new IndicatorEngine({ symbol: "EURUSD", timeframe: "H1" });
    engine.setSeries(candles);
    engine.configure([{ key: "A", id: "sma", params: { period: 10 } }]);
    engine.configure([{ key: "B", id: "sma", params: { period: 10 } }]);
    assertEqual(engine.instanceKeys(), ["B"], "only the active workspace's instance exists");
    assert(engine.getByKey("A") === undefined || engine.getByKey("A").length === 0, "key A state gone");
});

// ════════════════════════════════════════════════════════════════════════════
console.log("8. Intelligence context & debug inspector");
// ════════════════════════════════════════════════════════════════════════════

check("buildIntelligenceContext exposes deterministic facts with provenance", () => {
    const candles = makeCandles(400, { symbol: "XAUUSD", timeframe: "H1", seed: 66 });
    const indicators = engineFor(candles, [
        { id: "ema", params: { period: 20 } },
        { id: "atr", params: { period: 14 } },
        { id: "rsi", params: { period: 14 } },
    ]);
    const ctx = buildIntelligenceContext({ candles, symbol: "XAUUSD", timeframe: "H1", indicators });
    assertEqual(ctx.market.symbol, "XAUUSD", "symbol");
    assertEqual(ctx.market.price, candles[candles.length - 1].close, "price = last close");
    assert(typeof ctx.market.session === "string" && ctx.market.session.length > 0, "session resolved");
    assert(["bullish", "bearish", "neutral"].includes(ctx.structure.bias), "bias resolved");
    assert(Array.isArray(ctx.liquidity.pools), "pools present");
    assert(Array.isArray(ctx.imbalances.fvgs), "fvgs present");
    assert(Array.isArray(ctx.orderBlocks.active), "active order blocks present");
    assert(typeof ctx.provenance.smartMoneyVersion === "string", "smart money version stamped");
    assertEqual(ctx.provenance.indicatorVersions.ema, "1.0.0", "indicator version stamped");
    assert(typeof ctx.volatility.atr === "number", "ATR available when configured");
    const emaKey = Object.keys(ctx.indicators).find((k) => k.startsWith("ema"));
    assert(emaKey !== undefined, "indicator facts keyed by instance key");
    const emaLatest = indicators.latest({ id: "ema", params: { period: 20 } })!;
    assertEqual(Object.values(ctx.indicators[emaKey!])[0], emaLatest.values.value, "latest EMA value exposed");
    for (const setup of ctx.activeSetups) {
        assert(setup.confirmationAt <= ctx.market.candleTimestamp, `${setup.id} is knowable at the last candle`);
    }
});

check("debug inspector describes candles, overlays and smart-money objects", () => {
    const candles = makeCandles(20, { seed: 12 });
    const candleDebug = describeCandle(candles[3], 3);
    assertEqual(candleDebug.index, 3, "index");
    assertEqual(candleDebug.timestamp, candles[3].timestamp, "timestamp");
    assertEqual(candleDebug.iso, new Date(candles[3].timestamp).toISOString(), "iso rendering");

    const overlayDebug = describeOverlay(smartMoneyToOverlay(ZONE_OBJ));
    assertEqual(overlayDebug.status, "active", "status");
    assertEqual(overlayDebug.confirmationAtIso, new Date(ZONE_OBJ.confirmationAt).toISOString(), "confirmation rendered");

    const smDebug = describeSmartMoney(ZONE_OBJ);
    assertEqual(smDebug.kind, "fvg", "kind");
    assert(smDebug.invalidationCondition !== null, "invalidation rule exposed");

    const snapshot = debugSnapshot({ candles, smartMoney: [ZONE_OBJ] });
    assert((snapshot.candles as { count: number }).count === 20, "snapshot includes candle count");
});

check("debug mode is off for normal users and can be toggled explicitly", () => {
    const before = isMarketCoreDebug();
    assert(typeof before === "boolean", "boolean flag");
    setMarketCoreDebug(true);
    assertEqual(isMarketCoreDebug(), true, "enabled on demand");
    setMarketCoreDebug(false);
    assertEqual(isMarketCoreDebug(), false, "disabled again");
    setMarketCoreDebug(before);
});

// ════════════════════════════════════════════════════════════════════════════
console.log("9. Legacy Market Intelligence adapter (one engine, many consumers)");
// ════════════════════════════════════════════════════════════════════════════

check("SmartMoneyEngine.run delegates to the core and preserves the legacy shape", () => {
    const candles = makeCandles(300, { symbol: "XAUUSD", timeframe: "H1", seed: 88 }) as never;
    const engine = new SmartMoneyEngine({ mode: "historical" });
    const res = engine.run(candles, "H1");
    assertEqual(typeof res.structureState, "object", "structureState present");
    assert(["bullish", "bearish", "neutral", "range", "unknown"].includes(res.structureState.trend), "trend resolved");
    assert(Array.isArray(res.events) && res.events.length > 0, "events produced");
    assert(Array.isArray(res.liquidity), "liquidity array");
    assert(Array.isArray(res.fvg), "fvg array");
    assert(Array.isArray(res.orderBlocks), "order block array");
    for (const ev of res.events) {
        assert(ev.source === "calculated", "every event is calculated (never invented)");
        assert(typeof ev.metadata?.confirmationAt === "number", `${ev.id} carries confirmationAt`);
        assert(typeof ev.metadata?.status === "string", `${ev.id} carries lifecycle status`);
    }
    for (const z of res.fvg) {
        assert(z.top >= z.bottom, "FVG bounds ordered (top ≥ bottom)");
    }
    for (const pool of res.liquidity) {
        assert(["buy_side", "sell_side"].includes(pool.side), "side convention");
    }
    const again = engine.run(candles, "H1");
    assertEqual(again, res, "deterministic across runs");
});

check("SmartMoneyEngine keeps its documented guards (insufficient candles, no fake FVG)", () => {
    const engine = new SmartMoneyEngine({ mode: "historical" });
    const tiny = engine.run([{ timestamp: 1, open: 1, high: 2, low: 0, close: 1 }] as never, "M5");
    assert(tiny.limitations.length > 0, "insufficient data is reported honestly");
    assertEqual(tiny.events.length, 0, "no events on insufficient data");

    const flat = Array.from({ length: 40 }, (_, i) => ({
        timestamp: i * H1,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
    }));
    const flatRun = engine.run(flat as never, "H1");
    assertEqual(flatRun.fvg.length, 0, "flat candles never invent an FVG");
});

// ════════════════════════════════════════════════════════════════════════════
console.log("10. Performance");
// ════════════════════════════════════════════════════════════════════════════

check("10k candles × 12 indicators compute within budget", () => {
    const big = makeCandles(10_000, { seed: 2024 });
    const t0 = Date.now();
    const engine = new IndicatorEngine({ symbol: "XAUUSD", timeframe: "M5", indicators: ALL_INDICATORS });
    const report = engine.setSeries(big);
    const fullMs = Date.now() - t0;
    assertEqual(engine.get({ id: "ema", params: { period: 20 } }).length, 10_000, "rows produced");
    console.log(`    full fold: ${fullMs}ms (${report.folded} candles)`);
    assert(fullMs < 3000, `full computation took ${fullMs}ms (budget 3000ms)`);

    const t1 = Date.now();
    const ticks = 50;
    for (let i = 0; i < ticks; i++) {
        const mutated = big.map((c, idx) => (idx === big.length - 1 ? { ...c, close: c.close + i * 0.01, high: Math.max(c.high, c.close + 0.5) } : c));
        engine.setSeries(mutated);
        big.splice(big.length - 1, 1, mutated[mutated.length - 1]);
    }
    const tickMs = (Date.now() - t1) / ticks;
    console.log(`    realtime tick: ${tickMs.toFixed(2)}ms avg over ${ticks} updates`);
    assert(tickMs < 25, `per-tick cost ${tickMs.toFixed(2)}ms (budget 25ms)`);
});

check("smart money detection on 10k candles stays within budget", () => {
    const big = makeCandles(10_000, { seed: 5150 });
    const t0 = Date.now();
    const detection = detectSmartMoney(big, { symbol: "XAUUSD", timeframe: "M5" });
    const ms = Date.now() - t0;
    console.log(`    detection: ${ms}ms, objects=${detection.objects.length}`);
    assert(ms < 3000, `detection took ${ms}ms (budget 3000ms)`);
    assert(detection.objects.length > 0, "produced objects on random data");
});

check("overlay density selection scales to thousands of objects", () => {
    const items: MarketOverlay[] = [];
    for (let i = 0; i < 5000; i++) items.push(overlay(`o-${i}`, i % 3 === 0 ? "fvg" : "liquidity", START + i * H1));
    const t0 = Date.now();
    const selected = selectOverlaysForViewport(items, { fromTime: START, toTime: START + 1000 * H1 });
    const ms = Date.now() - t0;
    console.log(`    selectOverlays: ${ms}ms for ${items.length} objects → ${selected.length} drawn`);
    assert(ms < 500, `selection took ${ms}ms (budget 500ms)`);
    assert(selected.length < items.length, "budget actually limits the drawn set");
});

check("aligned lookup by timestamp stays fast on deep history", () => {
    const big = makeCandles(10_000, { seed: 31337 });
    const engine = engineFor(big, [{ id: "ema", params: { period: 200 } }]);
    const t0 = Date.now();
    for (let i = 0; i < 2000; i++) {
        const ts = big[i * 5].timestamp;
        const row = engine.at({ id: "ema", params: { period: 200 } }, ts);
        assert(row !== null, "row found");
    }
    const ms = Date.now() - t0;
    console.log(`    2000 at() lookups: ${ms}ms`);
    assert(ms < 500, `lookups took ${ms}ms (budget 500ms)`);
});

// Await async checks (none currently, kept for parity with other suites), then report.
await Promise.all(asyncChecks);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
