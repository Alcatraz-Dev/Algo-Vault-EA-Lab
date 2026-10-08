/**
 * IndicatorRenderer architectural guard (Phase 3C).
 *
 * Runs with:
 *
 *     npx jiti tests/indicator-renderer-guard.test.ts
 *
 * Source-level architectural guards for the indicator-series extraction — no
 * DOM and no chart mount are required (the repo's browser assertions live in
 * e2e/pro-terminal-viewport.smoke.spec.ts). These checks protect the Phase 3C
 * boundary:
 *
 *   • IndicatorRenderer exists and the parent delegates indicator creation to it
 *   • the renderer is a renderer: no viewport policy, no market data, no
 *     API fetching, no chart creation, no viewport fitting, no memoization /
 *     throttling
 *   • the parent keeps the calculation authority (same kernels, same
 *     per-family "series exists" guards) and hands over aligned arrays
 *   • the layer semantics (create-once / remove-when-off, pane topology,
 *     pane stretch factors) are preserved verbatim
 *   • the lifecycle order: chart → viewport attach → series → indicator attach
 *     → viewport wiring → data commit → indicator reconciliation → indicator
 *     data, with pane order preserved (reconciliation stays after the Pine
 *     study pane effect)
 *   • cleanup: the parent detaches the renderer before ChartSurface removes the chart
 *   • the handle contract stays ref-based (the parent and the smoke probe read
 *     the mounted indicator series through the refs the renderer writes)
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

const ROOT = path.resolve(__dirname, "..");
const readSource = (rel: string): string => fs.readFileSync(path.resolve(ROOT, rel), "utf8");

/**
 * Strip block + line comments so a forbidden identifier only trips the guard
 * when it is real code (`://` is preserved so URLs in strings stay intact).
 */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PRO_CHART = readSource("components/pro-scalping-terminal/ProTerminalChart.tsx");
const INDICATOR_RENDERER = readSource("components/pro-scalping-terminal/IndicatorRenderer.tsx");
const CHART_SURFACE = readSource("components/pro-scalping-terminal/ChartSurface.tsx");
const SERIES_RENDERER = readSource("components/pro-scalping-terminal/SeriesRenderer.tsx");

const PRO_CODE = stripComments(PRO_CHART);
const RENDER_CODE = stripComments(INDICATOR_RENDERER);
const SURFACE_CODE = stripComments(CHART_SURFACE);
const SERIES_CODE = stripComments(SERIES_RENDERER);

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

/** The body of a class method, from its signature to the next method signature. */
function methodBody(code: string, signature: string): string {
    const start = code.indexOf(signature);
    assert(start >= 0, `${signature} not found`);
    const rest = code.slice(start + signature.length);
    const next = rest.search(/\n    (?:private |public )?[a-zA-Z]+\(/);
    return next >= 0 ? rest.slice(0, next) : rest;
}

// ══════════════════════════════════════════════════════════════════
// 1. Existence + export
// ══════════════════════════════════════════════════════════════════

console.log("IndicatorRenderer guard: existence");

check("IndicatorRenderer exists, is exported and is imported by the parent", () => {
    assert(INDICATOR_RENDERER.length > 0, "the module has content");
    assert(/export class IndicatorRenderer\b/.test(INDICATOR_RENDERER), "IndicatorRenderer is exported");
    assert(
        /import\s*\{[^}]*\bIndicatorRenderer\b[^}]*\}\s*from\s*["']\.\/IndicatorRenderer["']/.test(PRO_CHART),
        "the parent imports the renderer"
    );
    assert(PRO_CODE.includes("new IndicatorRenderer({"), "the parent constructs the renderer with its refs");
});

// ══════════════════════════════════════════════════════════════════
// 2. Parent delegates indicator creation
// ══════════════════════════════════════════════════════════════════

console.log("IndicatorRenderer guard: parent delegates indicator series");

check("IndicatorRenderer owns the indicator series lifecycle", () => {
    assert(count(RENDER_CODE, "addSeries(") >= 4, "the renderer creates the indicator series");
    assert(RENDER_CODE.includes("addSeries(CandlestickSeries"), "Heikin-Ashi lives in the renderer");
    assert(RENDER_CODE.includes("HistogramSeries"), "the delta histogram lives in the renderer");
    for (const call of ["chart.addPane(", "chart.removePane(", "chart.removeSeries(", "createPriceLine("]) {
        assert(RENDER_CODE.includes(call), `the renderer owns ${call}`);
    }
    // Pane bookkeeping: every pane the layers create is remembered and freed.
    for (const paneRef of ["supertrendPane", "rsiPane", "macdPane", "stochasticPane", "atrPane", "deltaPane"]) {
        assert(RENDER_CODE.includes(`refs.${paneRef}.current`), `${paneRef} is tracked by the renderer`);
    }
});

check("ProTerminalChart no longer creates the extracted indicator series", () => {
    assert(!PRO_CODE.includes("addHiddenLine"), "the parent's hidden-line factory is gone");
    assert(!PRO_CODE.includes("addSeries(CandlestickSeries"), "the parent creates no candlestick series");
    assert(!PRO_CODE.includes("HistogramSeries"), "the parent creates no histogram series");
    assert(!PRO_CODE.includes("RSI ${v}") && !PRO_CODE.includes("STOCH ${v}"), "the RSI/Stochastic guide lines moved with their panes");
    assert(RENDER_CODE.includes("rsi.createPriceLine({") && RENDER_CODE.includes("k.createPriceLine({"), "the renderer creates the guide lines");
    assert(importedNames(PRO_CHART, "lightweight-charts").every((n) => n !== "CandlestickSeries" && n !== "HistogramSeries"),
        "the parent no longer imports the series constructors it handed over");
});

check("IndicatorRenderer owns appearance/visibility/data/cleanup for those series", () => {
    // Appearance: each layer keeps its existing colors, widths and guides.
    for (const expected of [
        '"#94a3b8"', '"#60a5fa"', '"#f97316"', 'rgba(249, 115, 22, 0.55)',
        '"#22d3ee"', 'rgba(34, 211, 238, 0.5)', '"#f472b6"', '"#c084fc"',
        '"#38bdf8"', '"#f59e0b"', '"#34d399"', '"#a78bfa"', '"#eab308"',
        "RSI ${v}", "STOCH ${v}", "LineStyle.Dashed", "#26a69a", "#ef5350",
    ]) {
        assert(RENDER_CODE.includes(expected), `the renderer keeps ${expected}`);
    }
    // Visibility: created only while the layer is on, removed when it is off.
    for (const flag of [
        "layers.bollingerBands", "layers.keltnerChannels", "layers.donchianChannels",
        "layers.supertrend", "layers.heikinAshi", "layers.rsiPane", "layers.macdPane",
        "layers.ichimokuCloud", "layers.stochasticPane", "layers.atrPane",
        "layers.delta && !layers.cumulativeDelta",
    ]) {
        assert(RENDER_CODE.includes(flag), `the renderer reuses ${flag}`);
    }
    assert(RENDER_CODE.includes("isLayerOn(layers, layerId as ChartLayerId)"), "MA overlays use the shared isLayerOn verdict");
    // Data mutation: only the renderer writes indicator series data.
    assert(!PRO_CODE.includes("feedSeries("), "the parent's series feeder is gone");
    for (const family of ["bollinger", "keltner", "donchian", "supertrend", "heikinAshi", "rsi", "macd", "ichimoku", "stochastic", "atr", "delta"]) {
        assert(RENDER_CODE.includes(`data.${family}`), `the renderer commits the ${family} family`);
    }
    assert(RENDER_CODE.includes("series.setData("), "the renderer performs the series writes");
});

// ══════════════════════════════════════════════════════════════════
// 3. No viewport authority
// ══════════════════════════════════════════════════════════════════

console.log("IndicatorRenderer guard: no viewport authority");

check("IndicatorRenderer never touches viewport policy", () => {
    for (const forbidden of [
        "ViewportController",
        "chart-engine/viewport",
        "fitContent",
        "scrollToRealTime",
        "handleDataAppend",
        "handleDataMutation",
        "prependStarted",
        "prependCompleted",
        "captureSnapshot",
        "restoreSnapshot",
        "USER_PANNED",
        "FOLLOWING_LIVE",
        "getVisibleLogicalRange",
        "subscribeVisibleLogicalRangeChange",
        "isProgrammatic",
        "LogicalRange",
        "handleResize",
        "initialFit",
    ]) {
        assert(!RENDER_CODE.includes(forbidden), `IndicatorRenderer must not reference ${forbidden}`);
    }
});

check("ProTerminalChart remains the single viewport authority", () => {
    assert(PRO_CODE.includes("new ViewportController()"), "the controller is still constructed in the parent");
    assert(PRO_CODE.includes("prependStarted") && PRO_CODE.includes("prependCompleted"), "the parent still sequences prepends");
    assert(PRO_CODE.includes("viewport.handleDataAppend") && PRO_CODE.includes("viewport.handleDataMutation"), "the parent still sequences data commits");
});

// ══════════════════════════════════════════════════════════════════
// 4/5/6/7. No market data, no fetching, no chart recreation, no fitting
// ══════════════════════════════════════════════════════════════════

console.log("IndicatorRenderer guard: renderer, not a data provider");

check("no market-data authority", () => {
    for (const forbidden of ["useLiveCandles", "ChartDataEngine", "chart-data-engine", "loadOlder", "fetchCandles", "reconcile(", "useOrderFlow", "Symbol", "Timeframe"]) {
        assert(!RENDER_CODE.includes(forbidden), `IndicatorRenderer must not reference ${forbidden}`);
    }
});

check("no API fetching and no chart recreation", () => {
    assert(!/\bfetch\s*\(/.test(RENDER_CODE), "IndicatorRenderer never calls fetch(");
    assert(!RENDER_CODE.includes("createChart("), "IndicatorRenderer never creates a chart");
    assert(!RENDER_CODE.includes("chart.remove()"), "IndicatorRenderer never removes the chart");
});

check("no viewport fitting and no hidden optimization", () => {
    assert(!RENDER_CODE.includes("fitContent("), "no fitContent(");
    assert(!RENDER_CODE.includes("scrollToRealTime("), "no scrollToRealTime(");
    for (const forbidden of ["useMemo", "useCallback", "useEffect", "throttle", "debounce", "requestAnimationFrame", "setInterval", "setTimeout"]) {
        assert(!RENDER_CODE.includes(forbidden), `IndicatorRenderer must not contain ${forbidden}`);
    }
});

// ══════════════════════════════════════════════════════════════════
// 8. Lifecycle ordering (incl. pane order)
// ══════════════════════════════════════════════════════════════════

console.log("IndicatorRenderer guard: lifecycle ordering");

check("chart → viewport attach → series → indicator attach → viewport wiring", () => {
    const viewportAttach = PRO_CODE.indexOf("viewport.attach(chart.timeScale())");
    const seriesAttach = PRO_CODE.indexOf("seriesRenderer.attach(chart");
    const indicatorAttach = PRO_CODE.indexOf("indicatorRenderer.attach(chart");
    const rangeWiring = PRO_CODE.indexOf("subscribeVisibleLogicalRangeChange");
    assert(viewportAttach >= 0 && seriesAttach >= 0 && indicatorAttach >= 0 && rangeWiring >= 0, "all lifecycle anchors exist");
    assert(viewportAttach < seriesAttach, "the viewport attaches before the series are created");
    assert(seriesAttach < indicatorAttach, "the indicator renderer attaches after the price/volume series");
    assert(indicatorAttach < rangeWiring, "the indicator renderer attaches before the viewport subscriptions");
});

check("indicator series are reconciled in the layer effect, after the study pane effect", () => {
    const studyPane = PRO_CODE.indexOf("studyPaneRef.current = paneIndex");
    const sync = PRO_CODE.indexOf("indicatorRenderer.syncLayers(");
    const data = PRO_CODE.indexOf("indicatorRenderer.setData(");
    assert(studyPane >= 0 && sync >= 0 && data >= 0, "all ordering anchors exist");
    assert(studyPane < sync, "pane order preserved: the Pine study pane is created before the indicator panes");
    assert(sync < data, "the series are created before they are fed");
});

check("the parent still commits price/volume data before the indicator data", () => {
    assert(PRO_CODE.indexOf("seriesRenderer.setCandleData(") < PRO_CODE.indexOf("indicatorRenderer.setData("),
        "candle commit precedes the indicator commit");
});

check("the reconciliation effect still depends on every indicator layer flag", () => {
    const syncIdx = PRO_CODE.indexOf("indicatorRenderer.syncLayers(");
    assert(syncIdx >= 0, "the reconciliation call exists");
    const tail = PRO_CODE.slice(syncIdx);
    const deps = tail.slice(tail.indexOf("}, ["), tail.indexOf("]);") + 3);
    for (const flag of [
        "layers.bollingerBands", "layers.keltnerChannels", "layers.donchianChannels", "layers.supertrend",
        "layers.heikinAshi", "layers.rsiPane", "layers.macdPane", "layers.delta", "layers.cumulativeDelta",
        "layers.ema50", "layers.ema200", "layers.sma20", "layers.sma50", "layers.sma200",
        "layers.ichimokuCloud", "layers.stochasticPane", "layers.atrPane", "symbol",
    ]) {
        assert(deps.includes(flag), `the reconciliation depends on ${flag}`);
    }
});

// ══════════════════════════════════════════════════════════════════
// 9. Cleanup
// ══════════════════════════════════════════════════════════════════

console.log("IndicatorRenderer guard: cleanup");

check("the parent detaches the renderer in the chart effect cleanup", () => {
    assert(PRO_CODE.includes("indicatorRenderer.detach()"), "the parent detaches the renderer");
    const attach = PRO_CODE.indexOf("indicatorRenderer.attach(chart");
    const detach = PRO_CODE.indexOf("indicatorRenderer.detach()");
    assert(attach < detach, "detach happens after attach");
    // The parent no longer nulls the handed-over handles itself.
    for (const ref of ["bbSeriesRef", "kcSeriesRef", "dcSeriesRef", "stSeriesRef", "haSeriesRef", "rsiSeriesRef", "macdSeriesRef", "ichiSeriesRef", "stochSeriesRef", "atrSeriesRef", "deltaSeriesRef", "maLayerSeriesRef"]) {
        assertEqual(count(PRO_CODE, `${ref}.current = null`), 0, `${ref} is cleared only by the renderer`);
    }
});

check("detach drops every indicator handle and the chart binding", () => {
    const body = methodBody(RENDER_CODE, "detach(): void {");
    assertEqual(count(body, ".current = null"), 18, "all eighteen indicator handles are cleared");
    assert(body.includes("this.chart = null"), "the chart binding is dropped");
});

check("the chart instance is still removed by ChartSurface exactly once", () => {
    assertEqual(count(SURFACE_CODE, "chart.remove()"), 1, "one removal, in the surface's own cleanup");
    assertEqual(count(PRO_CODE, "createChart("), 0, "the parent never creates a chart");
});

// ══════════════════════════════════════════════════════════════════
// 10. Calculation boundary
// ══════════════════════════════════════════════════════════════════

console.log("IndicatorRenderer guard: calculation boundary");

check("IndicatorRenderer imports no calculation engine", () => {
    for (const forbidden of ["pine-runtime", "market-core", "/market-data", "indicators/engine", "lib/pine", "alignedIndicatorSeries", "indicatorPrimitives", "TA."]) {
        assert(!RENDER_CODE.includes(forbidden), `IndicatorRenderer must not include ${forbidden}`);
    }
    // It is a renderer over lightweight-charts only.
    for (const dep of ["./chart-layers", "./chart-settings"]) {
        assert(RENDER_CODE.includes(dep), `the renderer may read the layer/appearance vocabulary (${dep})`);
    }
    assert(!RENDER_CODE.includes("/api/"), "no API path in the renderer");
});

check("the parent keeps the indicator mathematics and its per-family guards", () => {
    for (const call of [
        "TA.bb(closes, 20, 2)", "TA.keltner(highs, lows, closes, 20, 2)", "TA.donchian(highs, lows, 20)",
        "TA.supertrend(highs, lows, closes, 10, 3)", "TA.heikinashi(", "TA.rsi(closes, 14)", "TA.macd(closes, 12, 26, 9)",
        "TA.highest(highs, 9)", "TA.lowest(lows, 52)", "alignedIndicatorSeries(",
    ]) {
        assert(PRO_CODE.includes(call), `the parent still computes ${call}`);
    }
    for (const guard of ["if (bbSeriesRef.current)", "if (kcSeriesRef.current)", "if (dcSeriesRef.current)", "if (stSeriesRef.current)", "if (haSeriesRef.current)", "if (rsiSeriesRef.current)", "if (macdSeriesRef.current)", "if (ichiSeriesRef.current)", "if (stochSeriesRef.current)", "if (atrSeriesRef.current)", "if (deltaSeriesRef.current)"]) {
        assert(PRO_CODE.includes(guard), `the parent keeps the ${guard} guard`);
    }
    assert(PRO_CODE.includes("indicatorRenderer.setData(payload)"), "the parent hands the aligned arrays over in one commit");
    assert(PRO_CODE.includes("if (candles.length === 0) return;"), "the empty-dataset path is unchanged (no indicator clear was added)");
});

check("the estimated-delta pane keeps its exact commit + blank semantics", () => {
    assert(PRO_CODE.includes("const ed = orderFlow.estimatedDelta;"), "the parent still reads the estimated delta");
    assert(PRO_CODE.includes("layers.delta && Number.isFinite(b.delta) && b.delta !== 0"), "the histogram keeps its gate");
    assert(PRO_CODE.includes("payload.delta = { hist: histData, line: lineData };"), "empty arrays reproduce the previous blank path");
});

// ══════════════════════════════════════════════════════════════════
// Handle contract
// ══════════════════════════════════════════════════════════════════

console.log("IndicatorRenderer guard: handle contract");

check("indicator series handles stay ref-based in the parent", () => {
    for (const slot of [
        "bbSeriesRef", "kcSeriesRef", "dcSeriesRef", "stSeriesRef", "stPaneOwnedRef", "haSeriesRef",
        "rsiSeriesRef", "rsiPaneOwnedRef", "macdSeriesRef", "macdPaneOwnedRef", "maLayerSeriesRef",
        "ichiSeriesRef", "stochSeriesRef", "stochPaneOwnedRef", "atrSeriesRef", "atrPaneOwnedRef",
        "deltaSeriesRef", "deltaPaneOwnedRef",
    ]) {
        assert(PRO_CODE.includes(`const ${slot} = useRef`), `${slot} stays an imperative ref`);
        assert(!new RegExp(`useState[^\\n]*\\b${slot}\\b`).test(PRO_CODE), `${slot} is never converted to React state`);
    }
    // The renderer is handed those very refs (spot-check the mapping).
    for (const [key, ref] of [
        ["bb", "bbSeriesRef"], ["heikinAshi", "haSeriesRef"], ["ma", "maLayerSeriesRef"],
        ["ichimoku", "ichiSeriesRef"], ["delta", "deltaSeriesRef"], ["deltaPane", "deltaPaneOwnedRef"],
    ] as const) {
        assert(PRO_CODE.includes(`${key}: ${ref},`), `the renderer receives ${ref} as ${key}`);
    }
});

check("the AI overlay's own indicatorSeriesRef is untouched", () => {
    assert(PRO_CODE.includes("const indicatorSeriesRef = useRef") && PRO_CODE.includes("indicatorSeriesRef.current.push("),
        "the AI overlay still owns its series list");
    assert(!RENDER_CODE.includes("indicatorSeriesRef"), "the renderer never touches the AI overlay list");
});

check("VWAP / EMA9 / EMA20 stay in the parent (viewport-coupled)", () => {
    for (const anchor of ["vwapSeriesRef", "ema9Ref", "ema20Ref", "computeVwap(", "pushLineTail(", "pushEma("]) {
        assert(PRO_CODE.includes(anchor), `${anchor} is still parent-owned`);
    }
    assert(!RENDER_CODE.includes("vwap") && !RENDER_CODE.includes("ema9") && !RENDER_CODE.includes("ema20"),
        "the renderer never takes over VWAP/EMA9/EMA20");
});

check("Phase 3A/3B boundaries are untouched by this extraction", () => {
    assert(SERIES_CODE.includes("syncChartType("), "SeriesRenderer keeps the chart-type switch");
    assert(!SERIES_CODE.includes("IndicatorRenderer"), "SeriesRenderer does not depend on the indicator renderer");
    assertEqual(count(SURFACE_CODE, "createChart("), 1, "ChartSurface still owns the single chart");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
