/**
 * ChartSurface / SeriesRenderer architectural guard.
 *
 * Runs with:
 *
 *     npx jiti tests/chart-surface-guard.test.ts
 *
 * Source-level architectural guards for the chart lifecycle extractions — no
 * DOM and no chart mount are required (the repo's browser assertions live in
 * e2e/pro-terminal-viewport.smoke.spec.ts). These checks protect the Phase 3A
 * (chart surface) and Phase 3B (price + volume series) boundaries:
 *
 *   • who owns the single lightweight-charts instance
 *   • that the parent stops creating/removing a chart
 *   • that ChartSurface and SeriesRenderer never take over viewport policy
 *   • that they are renderers, not market-data providers
 *   • that the series handle contract stays ref-based (the smoke probe reads
 *     the mounted series through the parent's refs)
 *   • the lifecycle order: chart → viewport attach → series → viewport wiring
 *     → data
 *   • that a chart-type switch never creates a chart or a series
 *
 * The checks are structural (imports, specific calls and identifier ordering)
 * and comment-stripped, so they are architectural rather than tied to line
 * numbers or formatting.
 */

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

function assert(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message = ""): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message} Expected ${b} but got ${a}`);
}

const readSource = (rel: string): string => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");

/**
 * Strip block + line comments so a forbidden identifier only trips the guard
 * when it is real code. `://` is preserved (URLs in strings stay intact).
 */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PRO_CHART = readSource("components/pro-scalping-terminal/ProTerminalChart.tsx");
const CHART_SURFACE = readSource("components/pro-scalping-terminal/ChartSurface.tsx");
const SERIES_RENDERER = readSource("components/pro-scalping-terminal/SeriesRenderer.tsx");
// Phase 3C: the indicator-series ownership boundary (see
// tests/indicator-renderer-guard.test.ts for its own full guard).
const INDICATOR_RENDERER = readSource("components/pro-scalping-terminal/IndicatorRenderer.tsx");

const PRO_CODE = stripComments(PRO_CHART);
const SURFACE_CODE = stripComments(CHART_SURFACE);
const RENDERER_CODE = stripComments(SERIES_RENDERER);
const INDICATOR_CODE = stripComments(INDICATOR_RENDERER);

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** Named + type imports pulled from `import { … } from "<module>"` blocks. */
function importedNames(src: string, moduleName: string): string[] {
    const names: string[] = [];
    const escaped = moduleName.replace(/[/\\]/g, "\\$&");
    const re = new RegExp(`import\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*["']${escaped}["']`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        for (const raw of m[1].split(",")) {
            const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
            if (name) names.push(name);
        }
    }
    return names;
}

// ══════════════════════════════════════════════════════════════════
// Chart instance ownership
// ══════════════════════════════════════════════════════════════════

console.log("ChartSurface guard: chart instance ownership");
check("ChartSurface creates exactly one chart and removes exactly one chart", () => {
    assertEqual(count(SURFACE_CODE, "createChart("), 1, "createChart is called once");
    assertEqual(count(SURFACE_CODE, "chart.remove()"), 1, "chart.remove() is called once");
    assert(SURFACE_CODE.includes("chartRef.current = chart"), "the surface publishes the instance via the caller's ref");
    assert(SURFACE_CODE.includes("chartRef.current = null"), "the surface clears the ref before removal");
});
check("ProTerminalChart never creates or removes a chart", () => {
    assertEqual(count(PRO_CODE, "createChart("), 0, "no createChart in the parent");
    assert(!/\.remove\(\)/.test(PRO_CODE), "no chart.remove() in the parent");
    assert(!importedNames(PRO_CHART, "lightweight-charts").includes("createChart"), "createChart is not imported by the parent");
});
check("single chart invariant: exactly one instance per ProTerminalChart", () => {
    assertEqual(count(PRO_CODE, "<ChartSurface"), 1, "exactly one surface is mounted");
    assertEqual(count(SURFACE_CODE, "createChart(") + count(PRO_CODE, "createChart("), 1, "one creator across the pair");
    assertEqual(count(PRO_CHART, "useRef<IChartApi | null>"), 1, "one chart ref in the parent");
    assert(!/useRef<IChartApi/.test(SURFACE_CODE), "the surface owns no chart ref of its own");
    assert(SURFACE_CODE.includes("chartRef"), "the surface writes the caller's ref");
});

// ══════════════════════════════════════════════════════════════════
// Viewport invariant
// ══════════════════════════════════════════════════════════════════

console.log("ChartSurface guard: viewport invariant");
check("ChartSurface never owns viewport policy", () => {
    for (const forbidden of [
        "ViewportController",
        "chart-engine/viewport",
        "fitContent",
        "scrollToRealTime",
        "handleRangeChange",
        "isFollowingLive",
        "getPhase",
        "USER_PANNED",
        "FOLLOWING_LIVE",
        "prepend",
    ]) {
        assert(!SURFACE_CODE.includes(forbidden), `ChartSurface must not reference ${forbidden}`);
    }
});
check("SeriesRenderer never owns viewport policy", () => {
    for (const forbidden of [
        "ViewportController",
        "chart-engine/viewport",
        "fitContent",
        "scrollToRealTime",
        "isProgrammatic",
        "initialFit",
        "handleDataAppend",
        "handleDataMutation",
        "getVisibleLogicalRange",
        "USER_PANNED",
        "FOLLOWING_LIVE",
        "prepend",
    ]) {
        assert(!RENDERER_CODE.includes(forbidden), `SeriesRenderer must not reference ${forbidden}`);
    }
});
check("ProTerminalChart remains the single viewport authority", () => {
    assert(PRO_CODE.includes("new ViewportController()"), "the controller is still constructed in the parent");
    assert(PRO_CODE.includes("viewport.attach(chart.timeScale())"), "the parent attaches it to the chart's time scale");
    assert(PRO_CODE.includes("viewport.reset("), "the parent resets it on mount/context change");
    assert(PRO_CODE.includes("subscribeVisibleLogicalRangeChange"), "the parent wires the visible-range subscription");
});

// ══════════════════════════════════════════════════════════════════
// Data invariant
// ══════════════════════════════════════════════════════════════════

console.log("ChartSurface guard: data invariant");
check("surface + renderer are renderers, not market-data providers", () => {
    const modules: Array<[string, string]> = [
        ["ChartSurface", SURFACE_CODE],
        ["SeriesRenderer", RENDERER_CODE],
    ];
    for (const [name, code] of modules) {
        for (const forbidden of [
            "useLiveCandles",
            "ChartDataEngine",
            "chart-data-engine",
            "loadOlder",
            "fetchCandles",
            "reconcile(",
        ]) {
            assert(!code.includes(forbidden), `${name} must not reference ${forbidden}`);
        }
    }
});
check("ProTerminalChart keeps the single live feed", () => {
    assertEqual(count(PRO_CODE, "useLiveCandles("), 1, "exactly one live candle feed");
    assert(PRO_CODE.includes("viewport.handleDataMutation") || PRO_CODE.includes("viewport.handleDataAppend"), "the parent still sequences data commits with the viewport");
});

// ══════════════════════════════════════════════════════════════════
// Series ownership
// ══════════════════════════════════════════════════════════════════

console.log("ChartSurface guard: series ownership");
check("SeriesRenderer owns the six price/volume series", () => {
    for (const ctor of ["CandlestickSeries", "LineSeries", "AreaSeries", "BaselineSeries", "BarSeries", "HistogramSeries"]) {
        assert(RENDERER_CODE.includes(`addSeries(${ctor}`), `SeriesRenderer creates the ${ctor}`);
    }
});
check("ProTerminalChart delegates series creation and drops the alt-series imports", () => {
    assert(PRO_CODE.includes("seriesRenderer.attach(chart"), "the parent attaches the renderer to the chart");
    const names = importedNames(PRO_CHART, "lightweight-charts");
    for (const ctor of ["AreaSeries", "BaselineSeries", "BarSeries"]) {
        assert(!names.includes(ctor), `${ctor} is no longer imported by the parent`);
        assertEqual(count(PRO_CODE, `addSeries(${ctor}`), 0, `${ctor} is never created in the parent`);
    }
    // Phase 3C moved the Heikin-Ashi candlestick series — the last one the
    // parent created — into IndicatorRenderer, so the parent now creates none.
    assertEqual(count(PRO_CODE, "addSeries(CandlestickSeries"), 0, "the parent creates no candlestick series");
    assert(INDICATOR_CODE.includes("addSeries(CandlestickSeries"), "the Heikin-Ashi series is owned by IndicatorRenderer");
});
check("SeriesRenderer owns no indicator/overlay/drawing layer", () => {
    for (const forbidden of [
        "addPane",
        "removeSeries",
        "createPriceLine",
        "removePriceLine",
        "createSeriesMarkers",
        "Bollinger",
        "MACD",
        "RSI",
        "Supertrend",
        "Ichimoku",
        "PSAR",
    ]) {
        assert(!RENDERER_CODE.includes(forbidden), `SeriesRenderer must not reference ${forbidden}`);
    }
});
check("ChartSurface owns no series", () => {
    assert(!SURFACE_CODE.includes("addSeries"), "the surface never creates a series");
    assert(!SURFACE_CODE.includes("SeriesRenderer"), "the surface does not depend on the series renderer");
});

// ══════════════════════════════════════════════════════════════════
// Handle contract
// ══════════════════════════════════════════════════════════════════

console.log("ChartSurface guard: series handle contract");
check("series handles stay ref-based and directly accessible in the parent", () => {
    for (const slot of [
        "candleSeriesRef",
        "volumeSeriesRef",
        "lineSeriesRef",
        "areaSeriesRef",
        "baselineSeriesRef",
        "barSeriesRef",
        "activePriceSeriesRef",
        "activeSeriesTypeRef",
    ]) {
        assert(PRO_CODE.includes(`const ${slot} = useRef`), `${slot} stays an imperative ref`);
        assert(!new RegExp(`useState[^\\n]*\\b${slot}\\b`).test(PRO_CODE), `${slot} is never converted to React state`);
    }
    assert(PRO_CODE.includes("new SeriesRenderer({"), "the renderer is constructed with the ref handle");
});

// ══════════════════════════════════════════════════════════════════
// Lifecycle ordering + chart-type safety
// ══════════════════════════════════════════════════════════════════

console.log("ChartSurface guard: lifecycle ordering");
check("chart → viewport attach → series → viewport wiring → data", () => {
    const viewportAttach = PRO_CODE.indexOf("viewport.attach(chart.timeScale())");
    const seriesAttach = PRO_CODE.indexOf("seriesRenderer.attach(chart");
    const rangeWiring = PRO_CODE.indexOf("subscribeVisibleLogicalRangeChange");
    const dataCommit = PRO_CODE.indexOf("seriesRenderer.setCandleData(");
    assert(viewportAttach >= 0 && seriesAttach >= 0 && rangeWiring >= 0 && dataCommit >= 0, "all lifecycle anchors exist");
    assert(viewportAttach < seriesAttach, "the viewport attaches before the series are created");
    assert(seriesAttach < rangeWiring, "the series are created before the viewport subscriptions");
    assert(rangeWiring < dataCommit, "data updates run after the viewport wiring");
});
check("a chart-type switch never creates a chart or a series", () => {
    const idx = RENDERER_CODE.indexOf("syncChartType(");
    assert(idx >= 0, "SeriesRenderer exposes syncChartType");
    const body = RENDERER_CODE.slice(idx);
    assert(!body.includes("addSeries("), "switching never creates a series");
    assert(!body.includes("createChart"), "switching never creates a chart");
    assert(!body.includes("fitContent"), "switching never fits content");
    assert(body.includes("setData("), "switching feeds the alternate series from the same candles");
});
check("teardown drops series handles before the chart is removed", () => {
    assert(PRO_CODE.includes("seriesRenderer.detach()"), "the parent detaches the series on teardown");
    // The chart's own removal stays in ChartSurface's cleanup.
    assertEqual(count(SURFACE_CODE, "chart.remove()"), 1, "the surface still removes the chart exactly once");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
