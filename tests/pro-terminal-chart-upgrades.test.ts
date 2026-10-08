/**
 * Pro Terminal chart upgrades — self-verifying checks for the pure modules.
 *
 * Runs with:
 *
 *     npx jiti tests/pro-terminal-chart-upgrades.test.ts
 *
 * Covers the non-fabrication + determinism contract of the AI draw engine
 * (entry/SL/TP plan levels derived only from the chart's own candles), the
 * chart-settings merge/preset logic, the Fibonacci "values" parser, the
 * partial-close lot math (close 25% of a trade), and the execution-log →
 * chart fill mapping.
 */

import {
    computeAiDrawPlan,
    aiDrawLevels,
    type AiDrawCandle,
} from "../lib/chart-engine/ai-draw";
import {
    DEFAULT_FIBO_LEVELS,
    defaultChartSettings,
    mergeChartSettings,
    normalisePendingOrderType,
    parseFiboLevels,
    partialCloseVolume,
    tradeFillFromExecution,
    withPreset,
} from "../components/pro-scalping-terminal/chart-settings";
import {
    barCloseCountdown,
    formatCountdown,
    intervalMsForTimeframe,
    marketCountdown,
    marketStatusAt,
    resolveSession,
} from "../lib/chart-engine/bar-countdown";
import { isMarketTradableAt } from "../lib/chart-engine/timeframe";
import {
    MAGNET_TOOLS,
    extendRayToBounds,
    hitTestDrawing,
    removeDrawingById,
    resolveMarketPointToPixel,
    resolvedFiboLevels,
    snapToOHLC,
    toolCommitsDrawing,
    translateDrawingByMarketDelta,
    triangleVertices,
    undoLastDrawing,
    updateDrawingColor,
    updateDrawingLabel,
    type DrawingGeom,
} from "../components/pro-scalping-terminal/drawing-utils";
import {
    CHART_LAYERS,
    LAYER_REQUIREMENTS,
    defaultLayerState,
    isLayerOn,
    layerCapability,
    type ChartLayerId,
} from "../components/pro-scalping-terminal/chart-layers";
import {
    OHLC_MAX_LIMIT,
    OHLC_MIN_LIMIT,
    clampOhlcLimit,
    fetchCandlesWithProvider,
    finaliseCandles,
    resolveOhlcLimit,
    timeframeToLimit,
} from "../lib/market-data/normalizer";
import { createApiDataSources } from "../lib/chart-engine/data-sources";
import { ChartDataEngine, type ChartDataSources } from "../lib/chart-engine/chart-data-engine";
import type { ChartCandle } from "../lib/chart-engine/candle";
import type { Time } from "lightweight-charts";
import type { DrawingItem } from "../components/pro-scalping-terminal/ProTerminalChart";
import fs from "node:fs";
import path from "node:path";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
    try {
        fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  ✗ ${name}`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    }
}

/** Async variant — queued and awaited before the final summary. */
const asyncChecks: Array<{ name: string; fn: () => Promise<void> }> = [];
function checkAsync(name: string, fn: () => Promise<void>): void {
    asyncChecks.push({ name, fn });
}

function assert(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = ""): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message} Expected ${b} but got ${a}`);
}

/**
 * Linear interpolation between vertices with a tiny deterministic wobble.
 * Vertices are `per` candles apart, so each interior vertex is a strict
 * fractal swing (window ±3) — giving exact control over where the swing
 * support/resistance clusters land.
 */
function makeCandles(vertices: number[], per = 7): AiDrawCandle[] {
    const out: AiDrawCandle[] = [];
    let ts = 1_700_000_000_000;
    let prevClose = vertices[0];
    for (let seg = 0; seg < vertices.length - 1; seg++) {
        const a = vertices[seg];
        const b = vertices[seg + 1];
        for (let k = 0; k < per; k++) {
            const t = k / per;
            const wobble = Math.sin((seg * per + k) * 1.7) * 0.05;
            const close = a + (b - a) * t + wobble;
            // Open at the previous close offset a hair in the travel
            // direction, so a pivot candle's low/high stays strictly the
            // extreme of its ±3 window (fractal swing rule).
            const direction = Math.sign(close - prevClose) || 1;
            const open = out.length === 0 ? close : prevClose + direction * 0.02;
            const high = Math.max(open, close) + 0.05;
            const low = Math.min(open, close) - 0.05;
            out.push({ timestamp: ts, open, high, low, close });
            prevClose = close;
            ts += 60_000;
        }
    }
    // Final candle sitting exactly on the last vertex.
    const last = vertices[vertices.length - 1];
    const direction = Math.sign(last - prevClose) || 1;
    const open = prevClose + direction * 0.02;
    out.push({
        timestamp: ts,
        open,
        high: Math.max(open, last) + 0.05,
        low: Math.min(open, last) - 0.05,
        close: last,
    });
    return out;
}

// Swing lows at 100 (4 touches), swing highs at 110/109/108/103,
// ending at 100.2 — pressed into the 100 support (within 1.2×ATR).
const LONG_FIXTURE = makeCandles([105, 100, 110, 100, 109, 100, 108, 100, 103, 100.2]);
// Mirror: swing highs at 110, lows at 100, ending at 109.4 — pressed into
// the 110 resistance.
const SHORT_FIXTURE = makeCandles([105, 110, 100, 109, 100, 108, 100, 107, 100, 109.4]);

console.log("AI draw plan (deterministic, candles only)");
check("returns null with fewer than 60 candles (never guesses)", () => {
    assertEqual(computeAiDrawPlan(LONG_FIXTURE.slice(0, 59)), null);
    assertEqual(computeAiDrawPlan([]), null);
});

check("long fixture: direction long with support-bounded stop", () => {
    const plan = computeAiDrawPlan(LONG_FIXTURE);
    assert(plan, "plan should compute");
    assertEqual(plan!.direction, "long");
    assert(Math.abs((plan!.support ?? -1) - 100) < 0.5, `support ~100, got ${plan!.support}`);
    assert(plan!.resistance !== null && plan!.resistance > plan!.entry, "resistance above entry");
    assert(plan!.sl < plan!.entry, "long stop below entry");
    assert(plan!.entry < plan!.tp1, "target 1 above entry");
    assert(plan!.tp1 <= plan!.tp2, "tp2 not below tp1");
    assert(plan!.risk > 0, "risk is positive");
    assert(plan!.rr1 >= 1.5 && plan!.rr1 <= 2.5, `rr1 near 2, got ${plan!.rr1}`);
});

check("short fixture: direction short with resistance-bounded stop", () => {
    const plan = computeAiDrawPlan(SHORT_FIXTURE);
    assert(plan, "plan should compute");
    assertEqual(plan!.direction, "short");
    assert(plan!.sl > plan!.entry, "short stop above entry");
    assert(plan!.tp1 < plan!.entry, "target below entry");
    assert(plan!.tp2 <= plan!.tp1, "tp2 not above tp1");
    assert(Math.abs((plan!.resistance ?? -1) - 110) < 0.5, `resistance ~110, got ${plan!.resistance}`);
    assert(Math.abs((plan!.support ?? -1) - 100) < 0.5, `support ~100, got ${plan!.support}`);
});

check("is deterministic: identical input gives an identical plan", () => {
    const a = computeAiDrawPlan(LONG_FIXTURE);
    const b = computeAiDrawPlan(LONG_FIXTURE);
    assertEqual(JSON.stringify(a), JSON.stringify(b));
});

check("reads no future bars: anchor is the last candle timestamp", () => {
    const full = computeAiDrawPlan(LONG_FIXTURE)!;
    const truncated = computeAiDrawPlan(LONG_FIXTURE.slice(0, -1))!;
    assertEqual(full.anchorTime, LONG_FIXTURE[LONG_FIXTURE.length - 1].timestamp);
    assertEqual(truncated.anchorTime, LONG_FIXTURE[LONG_FIXTURE.length - 2].timestamp);
    assertEqual(full.bars, LONG_FIXTURE.length);
    assertEqual(truncated.bars, LONG_FIXTURE.length - 1);
});

check("evidence carries the real computed numbers (ATR + structure)", () => {
    const plan = computeAiDrawPlan(LONG_FIXTURE)!;
    assert(plan.evidence.length >= 4, "at least four evidence lines");
    assert(plan.evidence.some((e) => e.startsWith("ATR(14) = ")), "ATR evidence present");
    assert(
        plan.evidence.some((e) => e.startsWith("Support ") && e.includes("4 swing touches")),
        `support evidence present, got: ${plan.evidence.join(" | ")}`
    );
    assert(plan.atr > 0, "ATR positive");
});

check("levels render entry first with side-aware label", () => {
    const plan = computeAiDrawPlan(LONG_FIXTURE)!;
    const levels = aiDrawLevels(plan);
    assertEqual(levels[0].key, "entry");
    assert(levels[0].label.includes("BUY"), "long entry labelled BUY");
    assertEqual(levels[0].price, plan.entry);
    const keys = levels.map((l) => l.key);
    for (const required of ["sl", "tp1", "tp2"] as const) {
        assert(keys.includes(required), `${required} level present`);
    }
    const shortLevels = aiDrawLevels(computeAiDrawPlan(SHORT_FIXTURE)!);
    assert(shortLevels[0].label.includes("SELL"), "short entry labelled SELL");
});

console.log("Chart settings");
check("merge tolerates corrupt/absent storage", () => {
    assertEqual(mergeChartSettings(null), defaultChartSettings());
    assertEqual(mergeChartSettings("garbage"), defaultChartSettings());
    assertEqual(mergeChartSettings({ colors: { bull: "not-a-color" } }), defaultChartSettings());
});

check("partial input keeps preset defaults for untouched keys", () => {
    const merged = mergeChartSettings({ colors: { bull: "#123456" }, display: { grid: false } });
    assertEqual(merged.colors.bull, "#123456");
    assertEqual(merged.colors.bear, defaultChartSettings().colors.bear, "bear untouched");
    assertEqual(merged.display.grid, false);
    assertEqual(merged.display.volume, true, "untouched display flag keeps default");
});

check("tool style values are clamped and validated", () => {
    const merged = mergeChartSettings({ tools: { lineWidth: 99, fontSize: 2, color: "red" } });
    assertEqual(merged.tools.lineWidth, 4, "width clamped to 4");
    assertEqual(merged.tools.fontSize, 8, "font clamped to 8");
    assertEqual(merged.tools.color, defaultChartSettings().tools.color, "invalid color falls back");
    const badFibo = mergeChartSettings({ tools: { fiboLevels: [0.5] } });
    assertEqual(badFibo.tools.fiboLevels, DEFAULT_FIBO_LEVELS, "single level rejected → default");
});

check("presets swap colors but keep user display/tool choices", () => {
    let s = defaultChartSettings("midnight");
    s = { ...s, display: { ...s.display, volume: false }, tools: { ...s.tools, color: "#ff0000" } };
    const graphite = withPreset(s, "graphite");
    assertEqual(graphite.preset, "graphite");
    assertEqual(graphite.colors.background, "#1b1f27");
    assertEqual(graphite.display.volume, false, "display choice survives preset change");
    assertEqual(graphite.tools.color, "#ff0000", "tool color survives preset change");
    const light = withPreset(s, "light");
    assertEqual(light.colors.background, "#ffffff");
});

check("dark presets keep an actual dark background", () => {
    assertEqual(defaultChartSettings("midnight").colors.background, "#0b0f17");
    assertEqual(defaultChartSettings("graphite").colors.background, "#1b1f27");
});

console.log("Fibonacci values parser");
check("parses a comma-separated level list", () => {
    assertEqual(parseFiboLevels("0, 0.382, 0.5, 1"), [0, 0.382, 0.5, 1]);
});
check("rejects degenerate or non-numeric input", () => {
    assertEqual(parseFiboLevels("0.5"), null, "single level rejected");
    assertEqual(parseFiboLevels("a, b"), null, "non-numeric rejected");
    assertEqual(parseFiboLevels(""), null, "empty rejected");
});

console.log("Partial close (close 25% of a trade)");
check("100% closes the whole position", () => {
    assertEqual(partialCloseVolume(1.0, 100), { mode: "full", volume: 1.0 });
    assertEqual(partialCloseVolume(0.01, 99), { mode: "full", volume: 0.01 }, "single-lot position can only close fully");
});
check("25% of 1.00 lot → 0.25 partial", () => {
    assertEqual(partialCloseVolume(1.0, 25), { mode: "partial", volume: 0.25 });
    assertEqual(partialCloseVolume(1.0, 50), { mode: "partial", volume: 0.5 });
    assertEqual(partialCloseVolume(0.5, 75), { mode: "partial", volume: 0.37 });
});
check("slices below the lot step snap to the smallest valid slice", () => {
    assertEqual(partialCloseVolume(0.02, 25), { mode: "partial", volume: 0.01 });
});
check("dust remainder closes the position instead of leaving < 0.01", () => {
    // 0.025 × 90% = 0.0225 → 0.02 to close, leaving 0.005 (below the step).
    assertEqual(partialCloseVolume(0.025, 90), { mode: "full", volume: 0.025 });
});
check("invalid inputs are safe", () => {
    assertEqual(partialCloseVolume(0, 25), { mode: "full", volume: 0 });
    assertEqual(partialCloseVolume(1, 0), { mode: "partial", volume: 0 });
    assertEqual(partialCloseVolume(Number.NaN, 25), { mode: "full", volume: 0 });
});

console.log("Execution log → chart fill mapping");
check("BUY/SELL map to directional entries", () => {
    const buy = tradeFillFromExecution({ id: "1", action: "BUY", executedAt: 1_700_000_000_000, price: 2400, volume: 0.1 });
    assertEqual(buy?.kind, "entry");
    assertEqual(buy?.side, "buy");
    const sell = tradeFillFromExecution({ id: "2", action: "SELL", executedAt: 1_700_000_000_000, price: 2401, volume: 0.1 });
    assertEqual(sell?.side, "sell");
});
check("CLOSE/PARTIAL_CLOSE map to exits without inventing a direction", () => {
    const close = tradeFillFromExecution({ id: "3", action: "CLOSE", executedAt: 1_700_000_000_000, price: 2410, volume: 0.1 });
    assertEqual(close?.kind, "exit");
    assertEqual(close?.side, "unknown");
    const part = tradeFillFromExecution({ id: "4", action: "PARTIAL_CLOSE", executedAt: 1_700_000_000_000, price: 2412, volume: 0.05 });
    assertEqual(part?.kind, "partial");
});
check("non-fill actions and invalid prices never become markers", () => {
    assertEqual(tradeFillFromExecution({ id: "5", action: "CANCEL", executedAt: 1_700_000_000_000, price: 2400 }), null);
    assertEqual(tradeFillFromExecution({ id: "6", action: "MODIFY", executedAt: 1_700_000_000_000, price: 2400 }), null);
    assertEqual(tradeFillFromExecution({ id: "7", action: "BUY", executedAt: 1_700_000_000_000, price: 0 }), null);
    assertEqual(tradeFillFromExecution({ id: "8", action: "BUY", executedAt: 0, price: 2400 }), null);
});
check("fills carry their symbol so the chart can scope markers", () => {
    const fill = tradeFillFromExecution({ id: "9", action: "BUY", executedAt: 1_700_000_000_000, price: 2400, symbol: "XAUUSD" });
    assertEqual(fill?.symbol, "XAUUSD");
});

console.log("Pending order type normalisation");
check("accepts the MT5 limit/stop vocabulary", () => {
    assertEqual(normalisePendingOrderType("BUY_LIMIT"), "BUY_LIMIT");
    assertEqual(normalisePendingOrderType("sell limit"), "SELL_LIMIT");
    assertEqual(normalisePendingOrderType("BUY_STOP"), "BUY_STOP");
    assertEqual(normalisePendingOrderType("market"), null);
    assertEqual(normalisePendingOrderType(""), null);
});

console.log("Drawing selection, magnet and object operations");
const geom = (over: Partial<DrawingGeom> = {}): DrawingGeom => ({
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    width: 800,
    height: 400,
    fontSize: 12,
    ...over,
});
const drawing = (over: Partial<DrawingItem> = {}): DrawingItem => ({
    id: "d1",
    type: "trendline",
    points: [
        { time: 1_700_000_000_000, price: 100 },
        { time: 1_700_000_600_000, price: 110 },
    ],
    ...over,
});

check("magnet snaps to the nearest candle component (never invents)", () => {
    const candle = { open: 100, high: 110, low: 95, close: 105 };
    assertEqual(snapToOHLC(candle, 108), 110, "near high → high");
    assertEqual(snapToOHLC(candle, 96), 95, "near low → low");
    assertEqual(snapToOHLC(candle, 104.4), 105, "near close → close");
    assertEqual(snapToOHLC(candle, 100.9), 100, "near open → open");
    assertEqual(snapToOHLC(undefined, 100), null, "no candle → null (caller keeps raw price)");
    assertEqual(snapToOHLC(candle, Number.NaN), null, "invalid price → null");
});

check("magnet applies to price-anchored tools only", () => {
    for (const t of ["trendline", "ray", "horizontal", "fibo", "rectangle"] as const) {
        assert(MAGNET_TOOLS.has(t), `${t} should snap`);
    }
    for (const t of ["ruler", "text", "vertical", "select"] as const) {
        assert(!MAGNET_TOOLS.has(t), `${t} must keep exact cursor values`);
    }
});

check("hit test: horizontal/vertical lines select across the container", () => {
    assert(hitTestDrawing("horizontal", geom({ y1: 100 }), 500, 106), "click 6px below the line hits");
    assert(!hitTestDrawing("horizontal", geom({ y1: 100 }), 500, 150), "click 50px away misses");
    assert(hitTestDrawing("vertical", geom({ x1: 300 }), 305, 200), "click near the vertical hits");
    assert(!hitTestDrawing("vertical", geom({ x1: 300 }), 350, 200), "click away misses");
});

check("hit test: trendline selects anywhere along the segment", () => {
    const g = geom({ x1: 0, y1: 0, x2: 100, y2: 100 });
    assert(hitTestDrawing("trendline", g, 50, 54), "mid-segment within threshold hits");
    assert(!hitTestDrawing("trendline", g, 50, 90), "perpendicular distance too large misses");
    assert(!hitTestDrawing("trendline", g, 160, 160), "beyond the endpoint misses");
});

check("hit test: rectangles answer on edges only (interior stays pannable)", () => {
    const g = geom({ x1: 10, y1: 10, x2: 110, y2: 80 });
    assert(hitTestDrawing("rectangle", g, 60, 12), "top edge hits");
    assert(hitTestDrawing("rectangle", g, 11, 45), "left edge hits");
    assert(!hitTestDrawing("rectangle", g, 60, 45), "interior does NOT capture clicks");
    assert(!hitTestDrawing("rectangle", g, 200, 45), "outside misses");
});

check("hit test: fib levels and text bounding box", () => {
    const fib = geom({ x1: 0, y1: 0, x2: 100, y2: 100 });
    assert(hitTestDrawing("fibo", fib, 50, 50), "on the 50% level hits");
    assert(!hitTestDrawing("fibo", fib, 300, 50), "outside the fib span misses");
    const text = geom({ x1: 100, y1: 50, label: "HELLO" });
    assert(hitTestDrawing("text", text, 120, 45), "inside the label box hits");
    assert(!hitTestDrawing("text", text, 300, 45), "far from the label misses");
    assert(!hitTestDrawing("text", text, 120, 90), "below the label misses");
});

check("market-coordinate move translates every anchor by the same time/price delta", () => {
    const original = drawing({
        color: "#38bdf8",
        points: [
            { time: 1_700_000_000_000, price: 100 },
            { time: 1_700_000_600_000, price: 110 },
        ],
    });
    const moved = translateDrawingByMarketDelta(original, 120_000, -2.5);
    assertEqual(moved.points, [
        { time: 1_700_000_120_000, price: 97.5 },
        { time: 1_700_000_720_000, price: 107.5 },
    ]);
    assertEqual(moved.id, original.id, "identity is preserved");
    assertEqual(moved.color, original.color, "style is preserved");
    assertEqual(original.points[0].price, 100, "source drawing remains immutable");
    assertEqual(
        moved.points[1].price - moved.points[0].price,
        original.points[1].price - original.points[0].price,
        "trendline price delta is preserved",
    );
    assertEqual(
        moved.points[1].time! - moved.points[0].time!,
        original.points[1].time! - original.points[0].time!,
        "trendline time span is preserved",
    );
});

check("market-coordinate move keeps time-less anchors and ignores invalid deltas", () => {
    const original = drawing({ points: [{ price: 100 }, { price: 105 }] });
    const moved = translateDrawingByMarketDelta(original, 60_000, 2);
    assertEqual(moved.points, [{ price: 102 }, { price: 107 }]);
    assertEqual(translateDrawingByMarketDelta(original, Number.NaN, 2), original);
    assertEqual(translateDrawingByMarketDelta(original, 1, Number.POSITIVE_INFINITY), original);
});

check("single-object delete removes only that drawing", () => {
    const a = drawing({ id: "a" });
    const b = drawing({ id: "b", type: "horizontal" });
    const next = removeDrawingById([a, b], "a");
    assertEqual(next.length, 1);
    assertEqual(next[0].id, "b");
    assertEqual(removeDrawingById([a, b], "missing").length, 2, "unknown id is a no-op");
});

check("undo drops exactly the last placed object", () => {
    const a = drawing({ id: "a" });
    const b = drawing({ id: "b" });
    const undone = undoLastDrawing([a, b]);
    assertEqual(undone.map((d) => d.id), ["a"]);
    assertEqual(undoLastDrawing([]), [], "undo on empty list stays empty");
});

check("label and color updates touch only the target drawing", () => {
    const a = drawing({ id: "a", type: "text", label: "old" });
    const b = drawing({ id: "b" });
    const relabelled = updateDrawingLabel([a, b], "a", "new note");
    assertEqual(relabelled[0].label, "new note");
    assertEqual(relabelled[1], b, "untouched drawing keeps identity");
    const recolored = updateDrawingColor([a, b], "b", "#ff0000");
    assertEqual(recolored[0], a);
    assertEqual(recolored[1].color, "#ff0000");
});

console.log("Magnet setting");
check("magnet defaults on and survives partial merges", () => {
    assertEqual(defaultChartSettings().display.magnet, true, "magnet on by default");
    assertEqual(mergeChartSettings({ display: { magnet: false } }).display.magnet, false);
    // Settings persisted before the magnet existed must gain the default.
    assertEqual(mergeChartSettings({ display: { grid: false } }).display.magnet, true);
});

console.log("Bar-close countdown (moves with the live candle)");
check("counts down inside the forming bar", () => {
    const interval = 300_000; // M5
    const barStart = 1_700_000_100_000; // arbitrary but grid-aligned below
    const at = barStart + 61_000; // 1:01 into the bar
    const c = barCloseCountdown(at, interval)!;
    assertEqual(c.barStart, Math.floor(at / interval) * interval);
    assertEqual(c.closeAt, c.barStart + interval);
    assertEqual(c.remainingMs, interval - 61_000);
    assertEqual(formatCountdown(c.remainingMs), "00:03:59", "zero-padded HH:MM:SS");
});

check("rolls into the next bar instead of sticking at zero", () => {
    const interval = 60_000;
    const barStart = Math.floor(1_700_000_000_000 / interval) * interval;
    const atBoundary = barStart + interval; // exactly the next bar's open
    const c = barCloseCountdown(atBoundary, interval)!;
    assertEqual(c.barStart, barStart + interval, "bar advanced");
    assertEqual(c.remainingMs, interval, "a fresh bar gets the full interval");
    assertEqual(formatCountdown(c.remainingMs), "00:01:00");
});

check("never returns a negative or over-long remaining time", () => {
    const interval = 60_000;
    for (const offset of [-1, 0, 1, 59_999, 60_000, 120_000]) {
        const at = 1_700_000_000_000 + offset;
        const c = barCloseCountdown(at, interval)!;
        assert(c.remainingMs >= 0, `remaining >= 0 at offset ${offset}`);
        assert(c.remainingMs <= interval, `remaining <= interval at offset ${offset}`);
    }
});

check("a broken clock or interval degrades safely", () => {
    assertEqual(barCloseCountdown(Number.NaN, 60_000), null);
    const bad = barCloseCountdown(1_700_000_000_000, 0)!; // interval 0 → 60s fallback
    assertEqual(bad.remainingMs <= 60_000, true);
    assertEqual(intervalMsForTimeframe("M5", { M5: 300_000 }), 300_000);
    assertEqual(intervalMsForTimeframe("NOPE", { M5: 300_000 }), 60_000, "unknown tf falls back");
});

check("countdown label stays HH:MM:SS past an hour", () => {
    assertEqual(formatCountdown(0), "00:00:00");
    assertEqual(formatCountdown(1_000), "00:00:01");
    assertEqual(formatCountdown(61_000), "00:01:01");
    assertEqual(formatCountdown(3_661_000), "01:01:01");
    assertEqual(formatCountdown(-500), "00:00:00", "negative input clamps");
});

console.log("Market hours (open/closed state + what the countdown waits for)");
// Forex week: Sunday 21:00 UTC → Friday 21:00 UTC.
const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min);

check("a trading weekday is open and counts to the Friday close", () => {
    const wed = utc(2026, 1, 7, 12); // Wednesday 12:00 UTC
    const s = marketStatusAt(wed);
    assertEqual(s.open, true);
    assertEqual(s.phase, "open");
    assertEqual(new Date(s.changeAt as number).toISOString(), "2026-01-09T21:00:00.000Z", "closes Friday 21:00 UTC");
    const c = marketCountdown(wed, 300_000);
    assertEqual(c.target, "bar-close", "counts to the forming bar while trading");
    assertEqual(c.label, "close 00:05:00");
    assertEqual(c.closingSoon, false);
});

check("inside the last 15 minutes the chip counts to the session close", () => {
    const late = utc(2026, 1, 9, 20, 50); // Friday 20:50 UTC → closes in 10 min
    const c = marketCountdown(late, 300_000);
    assertEqual(c.open, true);
    assertEqual(c.closingSoon, true);
    assertEqual(c.label, "closes in 00:10:00", "the session close wins over the bar clock");
});

check("a closed market counts to the next open, never to a bar close", () => {
    const sat = utc(2026, 1, 10, 12); // Saturday 12:00 UTC
    const s = marketStatusAt(sat);
    assertEqual(s.open, false);
    assertEqual(s.phase, "closed");
    assertEqual(new Date(s.changeAt as number).toISOString(), "2026-01-11T21:00:00.000Z", "re-opens Sunday 21:00 UTC");
    const c = marketCountdown(sat, 300_000);
    assertEqual(c.target, "market-open");
    assertEqual(c.closingSoon, false);
    assertEqual(c.label, "opens in 33:00:00");
    assertEqual(c.remainingMs, 33 * 3_600_000);
});

check("Friday 21:00 UTC is the close; Sunday 21:00 UTC is the open", () => {
    const fridayClose = marketStatusAt(utc(2026, 1, 9, 21, 0));
    assertEqual(fridayClose.open, false, "the boundary minute itself is closed");
    assertEqual(new Date(fridayClose.changeAt as number).toISOString(), "2026-01-11T21:00:00.000Z");
    const sundayOpen = marketStatusAt(utc(2026, 1, 11, 21, 0));
    assertEqual(sundayOpen.open, true, "the open boundary minute is trading");
    assertEqual(new Date(sundayOpen.changeAt as number).toISOString(), "2026-01-16T21:00:00.000Z", "closes the coming Friday");
    assertEqual(
        marketStatusAt(utc(2026, 1, 11, 20, 59)).untilChangeMs,
        60_000,
        "one minute to the Sunday open"
    );
});

check("crypto never closes and keeps the bar countdown", () => {
    const sat = utc(2026, 1, 10, 12);
    const s = marketStatusAt(sat, { alwaysOpen: true });
    assertEqual(s.open, true);
    assertEqual(s.changeAt, null, "an always-on market has no boundary to count to");
    const c = marketCountdown(sat, 300_000, { alwaysOpen: true });
    assertEqual(c.target, "bar-close");
    assertEqual(c.closingSoon, false, "nothing ever closes, so nothing is closing soon");
});

check("a broken clock degrades to 'open' instead of claiming a weekend", () => {
    const s = marketStatusAt(Number.NaN);
    assertEqual(s.open, true);
    assertEqual(s.changeAt, null);
    assertEqual(marketCountdown(Number.NaN, 300_000).remainingMs, 0);
});

check("market phase always agrees with the candle-gap engine", () => {
    // Every hour of two full weeks: the clock's open/closed verdict and its
    // next-boundary claim must match isMarketTradableAt minute by minute.
    const start = utc(2026, 1, 5); // Monday
    for (let h = 0; h < 14 * 24; h++) {
        const at = start + h * 3_600_000;
        const s = marketStatusAt(at);
        assertEqual(s.open, isMarketTradableAt(at), `phase agrees at ${new Date(at).toISOString()}`);
        assert(s.untilChangeMs >= 0, "never a negative wait");
        if (s.changeAt !== null) {
            const expectedPhase = isMarketTradableAt(s.changeAt);
            assertEqual(expectedPhase, !s.open, `boundary flips the phase at ${new Date(s.changeAt).toISOString()}`);
            assert(
                isMarketTradableAt(s.changeAt - 60_000) === s.open,
                "one minute earlier the phase is still the old one"
            );
        }
    }
});

console.log("Session pause (chart + countdown hold still when nothing trades)");
check("a quiet feed pauses the chart even mid-week", () => {
    // Mid-week: the calendar says open, but the provider has gone silent
    // (metals/index session break) — the chart must pause.
    assertEqual(resolveSession({ calendarOpen: true, feedStale: false }).open, true, "ticks flowing → running");
    const quiet = resolveSession({ calendarOpen: true, feedStale: true });
    assertEqual(quiet.open, false);
    assertEqual(quiet.reason, "feed-quiet");
});

check("unfillable gaps pause too — that is how a mid-week break reads", () => {
    // A metals/indices session break inside the weekly window leaves candle
    // opens the engine cannot fill, so the feed reports a gap, not silence.
    const gap = resolveSession({ calendarOpen: true, feedGap: true });
    assertEqual(gap.open, false);
    assertEqual(gap.reason, "feed-gap");
    assertEqual(
        resolveSession({ calendarOpen: true, feedStale: true, feedGap: true }).reason,
        "feed-gap",
        "a gap is the more specific reason and wins"
    );
});

check("a closed calendar pauses regardless of the feed", () => {
    const closed = resolveSession({ calendarOpen: false, feedStale: false });
    assertEqual(closed.open, false);
    assertEqual(closed.reason, "calendar-close", "the weekly window is the stated reason");
    assertEqual(resolveSession({ calendarOpen: false, feedStale: true, feedGap: true }).reason, "calendar-close");
});

check("crypto keeps running through feed silence", () => {
    // A silent 24/7 feed is a broken feed, not a closed market — the chart must
    // not freeze and claim "market closed".
    assertEqual(resolveSession({ calendarOpen: true, feedStale: true, alwaysOpen: true }).open, true);
    assertEqual(resolveSession({ calendarOpen: true, feedGap: true, alwaysOpen: true }).open, true);
    assertEqual(resolveSession({ calendarOpen: true, feedStale: true, alwaysOpen: true }).reason, null);
});

check("nothing is paused while ticks are flowing and the week is open", () => {
    const running = resolveSession({ calendarOpen: true, feedStale: false, feedGap: false, alwaysOpen: false });
    assertEqual(running.open, true);
    assertEqual(running.reason, null);
});

// ══════════════════════════════════════════════════════════════════
// Phase 0 — contract-fix regression tests
// ══════════════════════════════════════════════════════════════════

const readSource = (rel: string): string => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
const CHART_SOURCE = readSource("components/pro-scalping-terminal/ProTerminalChart.tsx");
// Phase 3E: the drawing SVG surface (the market→pixel projection and the paint
// of every drawing type) moved out of ProTerminalChart into DrawingRenderer.
// The drawing checks below therefore read the module that now owns that code;
// each assertion keeps its original intent and message.
const DRAWING_RENDERER_SOURCE = readSource("components/pro-scalping-terminal/DrawingRenderer.tsx");
const DRAWING_UTILS_SOURCE = readSource("components/pro-scalping-terminal/drawing-utils.ts");
const WORKSPACE_SOURCE = readSource("components/pro-scalping-terminal/ProTerminalChartWorkspace.tsx");
const SHELL_SOURCE = readSource("components/terminal/TerminalShell.tsx");
const TERMINAL_DATA_SOURCE = readSource("components/terminal/TerminalData.tsx");
const ROUTE_SOURCE = readSource("app/api/analytics/ohlc/route.ts");
const TOOLBAR_SOURCE = readSource("components/trading/ChartToolbar.tsx");
const ENGINE_SOURCE = readSource("lib/chart-engine/chart-data-engine.ts");

console.log("Phase 0: history limit contract");
check("explicit valid client limit wins over the timeframe default", () => {
    // M15's default is 400 — an explicit request must survive it.
    assertEqual(resolveOhlcLimit("M15", 1500), 1500, "explicit limit honored");
    assertEqual(resolveOhlcLimit("H1", 1800), 1800, "explicit limit beats H1 default (200)");
    assertEqual(resolveOhlcLimit("D1", 300), 300, "explicit limit beats D1 default (120)");
});
check("limit is clamped to the safe server window", () => {
    assertEqual(clampOhlcLimit(9999), OHLC_MAX_LIMIT, "clamped to max");
    assertEqual(clampOhlcLimit(1), OHLC_MIN_LIMIT, "clamped to min");
    assertEqual(clampOhlcLimit("2500"), OHLC_MAX_LIMIT, "string over-max clamps");
    assertEqual(clampOhlcLimit(750.9), 750, "floored");
    assertEqual(clampOhlcLimit("abc"), null, "unparsable → null");
    assertEqual(clampOhlcLimit(""), null, "empty → null");
    assertEqual(clampOhlcLimit(null), null, "absent → null");
});
check("default behavior still works when no limit is provided", () => {
    assertEqual(resolveOhlcLimit("M1"), 500);
    assertEqual(resolveOhlcLimit("M15"), 400);
    assertEqual(resolveOhlcLimit("H1"), 200);
    assertEqual(resolveOhlcLimit("D1"), 120);
    assertEqual(timeframeToLimit("H4"), 150, "timeframe table unchanged");
});
check("ohlc route honors the explicit limit and clamps server-side", () => {
    assert(ROUTE_SOURCE.includes("clampOhlcLimit(rawLimit)"), "route clamps raw limit");
    assert(ROUTE_SOURCE.includes("?? timeframeToLimit(timeframe)"), "timeframe table is only the fallback");
    assert(ROUTE_SOURCE.includes("const MAX_LIMIT = OHLC_MAX_LIMIT"), "server max is authoritative");
    assert(!/Number\(rawLimit\) \|\| 400/.test(ROUTE_SOURCE), "legacy '|| 400' override removed");
    assert(ROUTE_SOURCE.includes("fetchCandles(symbol, timeframe, { limit })"), "effective limit passed to provider pipeline");
});
check("deep paging (before/from/to) still passes the limit through", () => {
    assert(ROUTE_SOURCE.includes("fetchDeepHistoryPage(symbol, timeframe, { beforeMs: before, limit })"), "range fill carries limit");
    // Phase 1: page-back uses the outcome-aware variant so a transient
    // provider failure is never reported as "no more history" — the limit
    // and exclusive beforeMs cursor must still be carried through.
    assert(ROUTE_SOURCE.includes("fetchDeepHistoryPageDetailed(symbol, timeframe, { beforeMs: Number(beforeParam), limit })"), "page-back carries limit via the outcome-aware fetch");
    assert(ROUTE_SOURCE.includes("fromParam") && ROUTE_SOURCE.includes("toParam"), "from/to preserved");
    assert(ROUTE_SOURCE.includes("hasDeepHistory"), "deep-history contract preserved");
    assert(ROUTE_SOURCE.includes("historyBoundary"), "page-back reports exhausted vs unavailable");
});
check("finaliseCandles: ascending order, no duplicate opens (first wins)", () => {
    const out = finaliseCandles([
        { timestamp: 3000, open: 3, high: 3, low: 3, close: 3 },
        { timestamp: 1000, open: 1, high: 1, low: 1, close: 1 },
        { timestamp: 2000, open: 2, high: 2, low: 2, close: 2 },
        { timestamp: 2000, open: 99, high: 99, low: 99, close: 99 },
    ]);
    assertEqual(out.map((c) => c.timestamp), [1000, 2000, 3000], "ascending + deduped");
    assertEqual(out[1].open, 2, "first occurrence wins on duplicate");
});

console.log("Phase 0: coordinate contract");
check("resolveMarketPointToPixel returns null when either axis is unresolvable", () => {
    const chart = { timeScale: () => ({ timeToCoordinate: (t: Time) => (Number(t) === 1_700_000_000 ? 42 : null) }) };
    const series = { priceToCoordinate: (p: number) => (p > 0 ? 7 : null) };
    const ok = resolveMarketPointToPixel({ time: 1_700_000_000_000, price: 100 }, chart, series);
    assertEqual(ok, { x: 42, y: 7 }, "both axes resolve → pixel");
    assertEqual(resolveMarketPointToPixel({ time: 1_700_000_060_000, price: 100 }, chart, series), null, "unresolvable time → null, never x=0");
    assertEqual(resolveMarketPointToPixel({ time: 1_700_000_000_000, price: -1 }, chart, series), null, "unresolvable price → null, never y=0");
    assertEqual(resolveMarketPointToPixel({ time: 1_700_000_000_000, price: 100 }, null, series), null, "missing chart → null");
    assertEqual(resolveMarketPointToPixel({ time: 1_700_000_000_000, price: 100 }, chart, null), null, "missing series → null");
    const throwing = { timeScale: () => ({ timeToCoordinate: () => { throw new Error("not ready"); } }) };
    assertEqual(resolveMarketPointToPixel({ time: 1, price: 1 }, throwing, series), null, "throwing transform → null, no crash");
});
check("timeframe switch: unresolvable drawing stays persisted and returns when resolvable", () => {
    const d: DrawingItem = {
        id: "d1",
        type: "trendline",
        points: [{ time: 1_700_000_000_000, price: 100 }, { time: 1_700_000_300_000, price: 110 }],
    };
    const before = JSON.stringify(d);
    // New timeframe: candle opens don't match the stored timestamps → hidden.
    const m5Chart = { timeScale: () => ({ timeToCoordinate: () => null }) };
    const series = { priceToCoordinate: () => 5 };
    assertEqual(resolveMarketPointToPixel(d.points[0], m5Chart, series), null, "hidden while unresolvable");
    // Stored market data untouched by the failed resolution.
    assertEqual(JSON.stringify(d), before, "market coordinates never mutated");
    // Original timeframe returns → visible again automatically.
    const resolved = resolveMarketPointToPixel(d.points[0], { timeScale: () => ({ timeToCoordinate: () => 12 }) }, series);
    assertEqual(resolved, { x: 12, y: 5 }, "renders again once resolvable");
});
check("chart source has no timeToCoordinate/priceToCoordinate ?? 0 fallbacks", () => {
    const re = /(?:timeToCoordinate|priceToCoordinate)\([\s\S]{0,150}?\?\?\s*0/g;
    assert(re.exec(CHART_SOURCE) === null, "ProTerminalChart: no ?? 0 coordinate fallback");
    assert(re.exec(DRAWING_UTILS_SOURCE) === null, "drawing-utils: no ?? 0 coordinate fallback");
    assert(re.exec(DRAWING_RENDERER_SOURCE) === null, "DrawingRenderer: no ?? 0 coordinate fallback");
});
check("unresolved drawing is skipped by hit-testing (continue on null)", () => {
    assert(CHART_SOURCE.includes("if (!a || !b) continue;"), "hit-test path skips unresolvable objects");
    assert(DRAWING_RENDERER_SOURCE.includes("if (!a || !b) return null;"), "render path skips unresolvable objects");
});

console.log("Phase 0: drawing tools");
check("hand never commits a drawing; select neither; placement needs a drag", () => {
    assertEqual(toolCommitsDrawing("hand", 100), false, "hand never commits");
    assertEqual(toolCommitsDrawing("hand", 0), false, "hand never commits, zero drag");
    assertEqual(toolCommitsDrawing("select", 100), false, "select never commits");
    assertEqual(toolCommitsDrawing("horizontal", 0), true, "click-placed line commits without drag");
    assertEqual(toolCommitsDrawing("text", 0), true, "text commits without drag");
    assertEqual(toolCommitsDrawing("trendline", 20), true, "drag commits");
    assertEqual(toolCommitsDrawing("trendline", 2), false, "sub-threshold jitter doesn't commit");
    assert(CHART_SOURCE.includes('if (tool === "hand")'), "pointer-down early-returns for hand");
    assert(CHART_SOURCE.includes("toolCommitsDrawing(dp.tool, dist)"), "pointer-up gates commit on toolCommitsDrawing");
});
check("triangle: deterministic third vertex, real polygon renderer", () => {
    assertEqual(triangleVertices(10, 20, 110, 80), [[10, 20], [110, 80], [10, 80]], "third vertex derived from the two stored points");
    // Phase 3E: the branch moved to DrawingRenderer and paints its polygon
    // through `createElement` (the module stays JSX-free so the plain jiti
    // runner can import it), so the polygon check reads the element vocabulary.
    assert(
        DRAWING_RENDERER_SOURCE.includes('d.type === "triangle"') &&
            /case "triangle":[\s\S]{0,400}polygon/.test(DRAWING_RENDERER_SOURCE),
        "triangle render branch exists"
    );
    const g: DrawingGeom = { x1: 10, y1: 20, x2: 110, y2: 80, width: 400, height: 300, fontSize: 12 };
    assert(hitTestDrawing("triangle", g, 10, 50, 8), "hits the left edge (x1…y2)");
    assert(hitTestDrawing("triangle", g, 60, 50, 8), "hits the diagonal");
    assert(!hitTestDrawing("triangle", g, 40, 60, 8), "interior stays free for panning");
    assert(TOOLBAR_SOURCE.includes('id: "triangle"'), "toolbar exposes the triangle tool");
    assert(TOOLBAR_SOURCE.includes('id: "ray"'), "toolbar exposes the ray tool");
});
check("ray extends from anchor toward p2 to the container boundary", () => {
    // Anchor (50,100) toward (150,140) in 800×600: dx=100,dy=40 → hits x=800 first (t=7.5 → y=400).
    const end = extendRayToBounds(50, 100, 150, 140, 800, 600);
    assert(end !== null, "ray resolves");
    assert(end !== null && end.x === 800, "extends to right boundary");
    assert(end !== null && end.y === 400, "direction from the two market points");
    // Backward ray: p2 left of anchor → extends to x=0.
    const back = extendRayToBounds(150, 140, 50, 100, 800, 600);
    assert(back !== null && back.x === 0, "backward ray reaches left boundary");
    // Degenerate direction → null (never a fake segment).
    assertEqual(extendRayToBounds(50, 100, 50, 100, 800, 600), null, "degenerate ray → null");
    // Hit-test measures against the SAME extended geometry.
    const g: DrawingGeom = { x1: 50, y1: 100, x2: 150, y2: 140, width: 800, height: 600, fontSize: 12 };
    assert(hitTestDrawing("ray", g, 700, 360, 8), "hit far past p2 on the extended ray");
    assert(!hitTestDrawing("ray", g, 700, 100, 8), "off-axis point misses");
    assert(DRAWING_RENDERER_SOURCE.includes("extendRayToBounds("), "renderer uses the shared extension helper");
});

console.log("Phase 0: fibonacci shared source of truth");
check("resolvedFiboLevels: drawing override > configured > defaults", () => {
    assertEqual(resolvedFiboLevels(null, null), [...DEFAULT_FIBO_LEVELS], "falls back to defaults");
    assertEqual(resolvedFiboLevels(null, [0, 0.5, 1]), [0, 0.5, 1], "configured wins over defaults");
    assertEqual(resolvedFiboLevels({ fiboLevels: [0, 0.25, 1] }, [0, 0.5, 1]), [0, 0.25, 1], "drawing override wins over configured");
    // Invalid arrays (< 2 finite) fall through instead of rendering garbage.
    assertEqual(resolvedFiboLevels({ fiboLevels: [0.5] }, [0, 1]), [0, 1], "single-level override rejected");
    assertEqual(resolvedFiboLevels({ fiboLevels: [Number.NaN, Infinity] }, null), [...DEFAULT_FIBO_LEVELS], "all-invalid → defaults");
});
check("custom fibo levels affect BOTH rendering geometry and hit-testing", () => {
    const levels = resolvedFiboLevels({ fiboLevels: [0, 0.5, 1] }, [0, 0.382, 0.618, 1]);
    assertEqual(levels, [0, 0.5, 1], "shared resolver picks the custom set");
    const g: DrawingGeom = { x1: 0, y1: 100, x2: 200, y2: 300, width: 400, height: 400, fontSize: 12, fiboLevels: levels };
    // y = y1 + diff*level → 0.5 → y=200 (a custom level that isn't in the default set).
    assert(hitTestDrawing("fibo", g, 100, 200, 6), "hits the custom 50% level");
    // y = 100 + 200*0.382 = 176.4 — present only in the OLD default list.
    assert(!hitTestDrawing("fibo", g, 100, 176.4, 6), "misses a level absent from the custom set");
    // Same geometry, default levels → the opposite verdict: shared source of truth.
    const gd: DrawingGeom = { ...g, fiboLevels: [...DEFAULT_FIBO_LEVELS] };
    assert(hitTestDrawing("fibo", gd, 100, 176.4, 6), "default set hits its own 38.2% level");
    // Chart renderer + hit-test both call the same helper.
    assert(DRAWING_RENDERER_SOURCE.includes("resolvedFiboLevels(d, cfg.tools.fiboLevels)"), "renderer resolves levels via helper");
    assert(CHART_SOURCE.includes("resolvedFiboLevels(d, cfgRef.current.tools.fiboLevels)"), "hit-test resolves levels via helper");
    assert(!/const FIB\w* = \[0, 0\.236/.test(DRAWING_UTILS_SOURCE), "no hardcoded level array in hit-testing");
});

console.log("Phase 0: layer truth");
check("only explicit true renders — missing/off keys are OFF", () => {
    assertEqual(isLayerOn(null, "vwap"), false, "null state → off");
    assertEqual(isLayerOn({}, "ema9"), false, "missing key → off");
    assertEqual(isLayerOn({ vwap: false }, "vwap"), false, "explicit false → off");
    assertEqual(isLayerOn({ vwap: true }, "vwap"), true, "explicit true → on");
});
check("default layer state is clean (no indicator on by default)", () => {
    const d = defaultLayerState();
    assertEqual(d.vwap, false, "VWAP off by default");
    assertEqual(d.ema9, false, "EMA9 off by default");
    assertEqual(d.ema20, false, "EMA20 off by default");
    assertEqual(CHART_LAYERS.every((l) => l.defaultOn === false), true, "every layer defaults off");
});
check("EMA9/EMA20/VWAP visibility is bound to its layer config", () => {
    assert(CHART_SOURCE.includes('visible: isLayerOn(layers, "vwap")'), "VWAP visibility follows layers.vwap");
    assert(CHART_SOURCE.includes('visible: isLayerOn(layers, "ema9")'), "EMA9 visibility follows layers.ema9");
    assert(CHART_SOURCE.includes('visible: isLayerOn(layers, "ema20")'), "EMA20 visibility follows layers.ema20");
});
check("capability truthfulness: available ⇒ implemented ⇒ bound in the chart", () => {
    const boundLayer = (id: string): boolean =>
        new RegExp(`layers\\.${id}\\b|isLayerOn\\(layers, "${id}"\\)`).test(CHART_SOURCE);
    for (const l of CHART_LAYERS) {
        const cap = layerCapability(l.id);
        if (l.available) {
            assertEqual(cap, "implemented", `${l.id} is available so it must be implemented`);
            const bound = new RegExp(`layers\\.${l.id}\\b|isLayerOn\\(layers, "${l.id}"\\)`).test(CHART_SOURCE);
            assert(bound, `${l.id} is available but has no binding in ProTerminalChart`);
        } else {
            // Unavailable layers are either explicitly planned/unsupported or
            // per-symbol gated (gex has a renderer, enabled only for some symbols).
            if (cap === "implemented") {
                assert(l.id === "gex", `${l.id} is unavailable but neither planned nor per-symbol gated`);
            }
        }
        if (cap !== "implemented") {
            assertEqual(l.available, false, `${l.id} capability=${cap} must not be advertised as available`);
            assert(LAYER_REQUIREMENTS[l.id] !== undefined, `${l.id} planned layer needs a requirements entry`);
            assertEqual(boundLayer(l.id), false, `${l.id} planned ⇒ no render binding in the chart`);
        }
    }
});
check("ema9 layer exists and is selectable", () => {
    const ema9 = CHART_LAYERS.find((l) => l.id === "ema9");
    assert(ema9 !== undefined, "ema9 layer declared");
    assertEqual(layerCapability("ema9"), "implemented", "ema9 has a real renderer");
});

console.log("Phase 0: position callbacks + trade history wiring");
check("onPositionSelect chain: Shell → Workspace → Chart, semantic only", () => {
    assert(SHELL_SOURCE.includes("onPositionSelect={handlePositionSelect}"), "Shell forwards its handler");
    assert(WORKSPACE_SOURCE.includes("onPositionSelect={onPositionSelect}"), "Workspace forwards the prop");
    assert(CHART_SOURCE.includes("onPositionSelectRef.current?.("), "Chart emits the callback");
    assert(!CHART_SOURCE.includes("/api/trading/execute"), "Chart never calls the execute endpoint");
    assert(!WORKSPACE_SOURCE.includes("/api/trading/execute"), "Workspace never calls the execute endpoint");
});
check("onModifyPositionStops chain: ticket + changed stop, no execution in the chart", () => {
    assert(SHELL_SOURCE.includes("onModifyPositionStops={handleModifyPositionStops}"), "Shell forwards its handler");
    assert(WORKSPACE_SOURCE.includes("onModifyPositionStops={onModifyPositionStops}"), "Workspace forwards the prop");
    assert(CHART_SOURCE.includes("onModifyPositionStopsRef.current?.(dragged.ticket"), "Chart emits ticket + stops");
    // Host-side commit goes through the frozen Unified Trading path.
    assert(SHELL_SOURCE.includes('executionType: "MODIFY_POSITION"'), "Shell routes through Unified Trading MODIFY_POSITION");
    assert(SHELL_SOURCE.includes("positionId: ticket"), "host passes the position identity");
});
check("chartHistory derives from real execution logs — not hardcoded empty", () => {
    assert(!/chartHistory\s*=\s*\[\s*\]/.test(SHELL_SOURCE), "no hard-coded chartHistory = []");
    assert(SHELL_SOURCE.includes("data.executionLogs"), "Shell reads executionLogs from context");
    assert(SHELL_SOURCE.includes("tradeFillFromExecution"), "reuses the existing execution → fill mapping");
    assert(SHELL_SOURCE.includes("!l.errorCode"), "failed executions excluded");
    assert(SHELL_SOURCE.includes("l.executionPrice > 0"), "invalid prices excluded");
    assert(SHELL_SOURCE.includes("tradeHistory={chartHistory}"), "history is actually passed to the chart");
});
check("execution logs are per-account from RTDB trading_logs/{uid}/{accountId}", () => {
    assert(TERMINAL_DATA_SOURCE.includes("trading_logs/"), "listens on trading_logs path");
    assert(TERMINAL_DATA_SOURCE.includes("${uid}/${accountId}"), "account-scoped — isolation preserved");
    assert(TERMINAL_DATA_SOURCE.includes("executionLogs"), "exposed on the context");
});

console.log("Phase 0: reconciliation wiring");
check("resync() reconciles instead of a full reload when data exists", () => {
    assert(ENGINE_SOURCE.includes("this.reconcile(page.candles)"), "resync invokes reconcile");
    assert(ENGINE_SOURCE.includes("if (this.candles.length === 0)"), "empty dataset keeps the initial-load path");
    assert(ENGINE_SOURCE.includes("this.commitCandles(enforceChronology(result.series), \"reconcile\")"), "reconcile commits through chronology enforcement");
    // No viewport reset: reconcile doesn't touch visible-range APIs.
    const reconcileBody = ENGINE_SOURCE.slice(ENGINE_SOURCE.indexOf("reconcile(providerCandles"), ENGINE_SOURCE.indexOf("detectGaps"));
    assert(!/setVisibleRange|scrollToPosition|scrollToRealTime/.test(reconcileBody), "reconcile never resets the viewport");
});

// ── Phase 0 async checks (queued; summary printed by runQueuedAsyncChecks) ──

const P0_HOUR = 3_600_000;
function p0Series(n: number, startMs: number, price = 100): ChartCandle[] {
    const out: ChartCandle[] = [];
    for (let i = 0; i < n; i++) {
        out.push({
            timestamp: startMs + i * P0_HOUR,
            open: price + i,
            high: price + i + 1,
            low: price + i - 1,
            close: price + i + 0.5,
            volume: 10 + i,
            symbol: "XAUUSD",
            timeframe: "H1",
            finalized: true,
        });
    }
    return out;
}
async function p0WaitUntil(pred: () => boolean, ms = 1000): Promise<void> {
    const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
    if (!pred()) throw new Error("condition not met within " + ms + "ms");
}

checkAsync("resync reconciles: no dupes, no chronology break, no viewport reset", async () => {
    const base = Date.UTC(2026, 0, 5, 0); // fixed past Monday 00:00
    let latestCalls = 0;
    const sources: ChartDataSources = {
        loadLatest: async () => {
            latestCalls += 1;
            // First load: 10 bars. On resync: overlapping page with a corrected
            // close on bar #7 plus two genuinely new bars.
            const candles = p0Series(latestCalls === 1 ? 10 : 12, base);
            if (latestCalls > 1) candles[7] = { ...candles[7], close: 555, high: 556 };
            return { candles, hasMore: false };
        },
        loadOlder: async () => ({ candles: [], hasMore: false }),
    };
    const engine = new ChartDataEngine(sources, {
        symbol: "XAUUSD",
        timeframe: "H1",
        pageSize: 12,
        healthIntervalMs: 60_000,
    });
    try {
        engine.start();
        await p0WaitUntil(() => engine.getCandles().length === 10);
        const before = engine.getCandles();
        const beforeFirst = before[0].timestamp;

        await engine.resync();
        const after = [...engine.getCandles()];

        // No duplicate timestamps.
        assertEqual(new Set(after.map((c) => c.timestamp)).size, after.length, "no duplicate candles");
        // Chronology strictly ascending (no regression in candle chronology).
        for (let i = 1; i < after.length; i++) {
            assert(after[i].timestamp > after[i - 1].timestamp, `chronology holds at index ${i}`);
        }
        // Deep history preserved — no viewport/dataset reset.
        assertEqual(after[0].timestamp, beforeFirst, "oldest candle unchanged (no reload)");
        assert(after.length >= before.length, "dataset preserved or grown");
        // Provider correction applied and new bars merged in.
        assert(after.some((c) => c.close === 555), "provider correction wins on its bucket");
        assertEqual(after.length, 12, "two new bars merged");
        // No future leakage: every bar at or before the last known open.
        const lastOpen = after[after.length - 1].timestamp;
        assert(after.every((c) => c.timestamp <= lastOpen), "no bar beyond the newest known open");
        assertEqual(engine.getStatus().connection, "live", "back to live after reconcile");
        assertEqual(engine.getStatus().reconnects, 1, "reconnect counted");
        assert(latestCalls === 2, "exactly one fresh page fetched (no polling loop added)");
    } finally {
        engine.destroy();
    }
});

checkAsync("loadOlder prepend: viewport history grows without dropping bars", async () => {
    const base = Date.UTC(2026, 0, 5, 0);
    const sources: ChartDataSources = {
        loadLatest: async () => ({ candles: p0Series(5, base), hasMore: true }),
        loadOlder: async ({ beforeMs }) => ({
            candles: p0Series(5, beforeMs - 5 * P0_HOUR).filter((c) => c.timestamp < beforeMs),
            hasMore: false,
        }),
    };
    const engine = new ChartDataEngine(sources, {
        symbol: "XAUUSD",
        timeframe: "H1",
        pageSize: 5,
        healthIntervalMs: 60_000,
    });
    try {
        engine.start();
        await p0WaitUntil(() => engine.getCandles().length === 5);
        const firsts = engine.getCandles()[0].timestamp;
        const ok = await engine.loadOlder();
        assert(ok, "older page loaded");
        const after = [...engine.getCandles()];
        assertEqual(after.length, 10, "five prepended");
        assert(after[0].timestamp < firsts, "older bars land at the front");
        for (let i = 1; i < after.length; i++) {
            assert(after[i].timestamp > after[i - 1].timestamp, `prepend keeps chronology at ${i}`);
        }
    } finally {
        engine.destroy();
    }
});

checkAsync("explicit limit reaches the provider URL (clamped at the server max)", async () => {
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ bars: [] }), { status: 200 });
    }) as typeof fetch;
    try {
        await fetchCandlesWithProvider("XAUUSD", "M15", { limit: 1500 });
        assert(seen.some((u) => u.includes("limit=1500")), `explicit 1500 reaches provider: ${seen[0] ?? "(none)"}`);
        await fetchCandlesWithProvider("XAUUSD", "H1", {});
        assert(seen.some((u) => u.includes("limit=200")), "H1 default used when absent");
        await fetchCandlesWithProvider("XAUUSD", "D1", { limit: 99_999 });
        assert(seen.some((u) => u.includes("limit=2000")), "over-max clamped to 2000 at the provider boundary");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

async function runQueuedAsyncChecks(): Promise<void> {
    for (const t of asyncChecks) {
        try {
            await t.fn();
            passed += 1;
            console.log(`  ✓ ${t.name}`);
        } catch (err) {
            failed += 1;
            console.error(`  ✗ ${t.name}`);
            console.error(`    ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}
void runQueuedAsyncChecks();
