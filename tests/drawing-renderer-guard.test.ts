/**
 * DrawingRenderer architectural guard (Phase 3E) + runtime drawing contract.
 *
 * Runs with:
 *
 *     npx jiti tests/drawing-renderer-guard.test.ts
 *
 * Source-level architectural guards for the drawing-surface extraction — no DOM
 * and no chart mount are required (the repo's browser assertions live in
 * e2e/pro-terminal-viewport.smoke.spec.ts). These checks protect the Phase 3E
 * boundary:
 *
 *   • DrawingRenderer exists and the parent delegates the drawing surface to it
 *   • ProTerminalChart no longer contains the extracted SVG rendering lifecycle
 *   • the renderer is a renderer: no viewport policy, no market data, no API
 *     fetching, no chart creation, no trading authority, no Smart Money
 *   • the parent keeps the interaction/hit-test/state/persistence authority
 *   • the Phase 0 contracts survive: null coordinates stay null (never x=0/y=0),
 *     the Fibonacci levels stay the shared resolved set, the triangle keeps its
 *     deterministic third vertex, the ray keeps its container-bound extension
 *   • drawing identity stays the stable drawing id (no index identity, no id
 *     generation inside the renderer)
 *   • the lifecycle order: chart → viewport attach → series → indicators →
 *     drawing attach → viewport wiring → drawing render
 *   • the runtime contract, driven through the real DrawingRenderer class with a
 *     deterministic chart/container mock: initial render, coordinate changes,
 *     null coordinates, selection, update, delete and cleanup
 *
 * The checks are structural (imports, specific calls and identifier ordering)
 * and comment-stripped, so they are architectural rather than tied to line
 * numbers or formatting.
 */

import fs from "node:fs";
import path from "node:path";
import type { Time } from "lightweight-charts";
import { DrawingRenderer, type DrawingRenderContext } from "../components/pro-scalping-terminal/DrawingRenderer";
import { defaultChartSettings } from "../components/pro-scalping-terminal/chart-settings";
import type { DrawingItem } from "../components/pro-scalping-terminal/ProTerminalChart";

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

function assert(condition: unknown, message: string): asserts condition {
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
 * when it is real code. `://` is preserved (URLs in strings stay intact).
 */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PRO_CHART = readSource("components/pro-scalping-terminal/ProTerminalChart.tsx");
const DRAWING_RENDERER = readSource("components/pro-scalping-terminal/DrawingRenderer.tsx");
const DRAWING_UTILS = readSource("components/pro-scalping-terminal/drawing-utils.ts");
const LIFECYCLE = readSource("tests/chart-renderer-lifecycle.test.ts");
const E2E = readSource("e2e/pro-terminal-viewport.smoke.spec.ts");

const PRO_CODE = stripComments(PRO_CHART);
const RENDER_CODE = stripComments(DRAWING_RENDERER);
const UTILS_CODE = stripComments(DRAWING_UTILS);

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

// ══════════════════════════════════════════════════════════════════
// 1. Existence + delegation
// ══════════════════════════════════════════════════════════════════

console.log("DrawingRenderer guard: existence");

check("DrawingRenderer exists, is exported and is imported by the parent", () => {
    assert(DRAWING_RENDERER.length > 0, "the module has content");
    assert(/export class DrawingRenderer\b/.test(DRAWING_RENDERER), "the renderer class is exported");
    assert(/export function DrawingSvgLayer\b/.test(DRAWING_RENDERER), "the SVG layer is exported");
    assert(
        /import\s*\{[^}]*\bDrawingRenderer\b[^}]*\}\s*from\s*["']\.\/DrawingRenderer["']/.test(PRO_CHART),
        "the parent imports the renderer"
    );
    assert(PRO_CODE.includes("new DrawingRenderer()"), "the parent constructs exactly one renderer");
    assertEqual(count(PRO_CODE, "new DrawingRenderer("), 1, "one renderer instance");
});

check("the parent delegates the drawing surface to the layer", () => {
    assert(PRO_CODE.includes("<DrawingSvgLayer scene={drawingScene}>"), "the parent renders the drawing layer");
    assert(PRO_CODE.includes("</DrawingSvgLayer>"), "the layer is closed");
    assert(PRO_CODE.includes("drawingRenderer.render(drawingElements, {"), "the parent feeds it the authoritative drawings");
    assert(PRO_CODE.includes("drawingRenderer.screenPosition(selectedDrawing)"), "the selection anchor comes from the renderer");
    assert(PRO_CODE.includes("drawingRenderer.screenPosition(textEditDrawing)"), "the label editor anchor comes from the renderer");
});

check("ProTerminalChart no longer contains the extracted SVG rendering lifecycle", () => {
    for (const gone of [
        "<svg",
        "</svg>",
        "strokeDasharray",
        "markerEnd",
        "fontFamily=\"monospace\"",
        "<marker",
        "<defs>",
        "drawingElements.map(",
        "drawings.map(",
        "drawingScreenPos",
        "extendRayToBounds",
        "triangleVertices",
        "containerSize.w} y1={y1}",
    ]) {
        assert(!PRO_CODE.includes(gone), `the parent must no longer contain ${gone}`);
    }
    // The renderer owns the projection + the paint.
    assert(RENDER_CODE.includes("export function DrawingSvgLayer"), "the layer lives in the renderer module");
    assert(RENDER_CODE.includes('"line"') && RENDER_CODE.includes('"polygon"') && RENDER_CODE.includes('"rect"'), "the renderer paints the SVG primitives");
    assert(RENDER_CODE.includes("resolveMarketPointToPixel("), "the renderer owns the market→pixel projection");
    // The AI direction badge is trading UI, not a drawing: it stays in the parent.
    assert(PRO_CODE.includes("ai-plan-badge"), "the AI badge stays parent-owned");
    assert(!RENDER_CODE.includes("ai-plan-badge"), "the renderer does not take over the AI badge");
});

// ══════════════════════════════════════════════════════════════════
// 2. ChartAnchoredOverlay decision (documented, deliberately NOT moved)
// ══════════════════════════════════════════════════════════════════

console.log("DrawingRenderer guard: ChartAnchoredOverlay stays put");

check("ChartAnchoredOverlay is general chart infrastructure, not the drawing SVG host", () => {
    // It bridges FVG/OB zones, the volume profile and every other layer that
    // anchors to the chart's transforms — the drawing surface is not its only
    // consumer, so it stays where it was and outside this extraction.
    assert(PRO_CODE.includes("new ChartAnchoredOverlay()"), "the parent still owns the anchored overlay bridge");
    assert(PRO_CODE.includes("anchoredOverlayRef.current?.destroy()"), "and still tears it down itself");
    assert(!RENDER_CODE.includes("ChartAnchoredOverlay"), "the drawing renderer must not touch it");
    assert(!RENDER_CODE.includes("chart-anchored-overlay"), "no dependency on the anchored overlay module");
});

// ══════════════════════════════════════════════════════════════════
// 3. No viewport authority
// ══════════════════════════════════════════════════════════════════

console.log("DrawingRenderer guard: no viewport authority");

check("DrawingRenderer never touches viewport policy", () => {
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
        "capture(",
        "restore(",
        "getVisibleLogicalRange",
        "setVisibleLogicalRange",
        "subscribeVisibleLogicalRangeChange",
        "isProgrammatic",
        "LogicalRange",
        "initialFit",
        "handleResize",
        "USER_PANNED",
        "FOLLOWING_LIVE",
        "handleRangeChange",
        "enterLiveFollow",
    ]) {
        assert(!RENDER_CODE.includes(forbidden), `DrawingRenderer must not reference ${forbidden}`);
    }
    // It only READS the chart's transforms.
    assert(RENDER_CODE.includes("resolveTimeX(") && RENDER_CODE.includes("resolvePriceY("), "it reads the chart's own transforms");
    assert(RENDER_CODE.includes("resolveMarketPointToPixel("), "and the shared two-axis resolver");
});

check("ProTerminalChart remains the single viewport authority", () => {
    assert(PRO_CODE.includes("new ViewportController()"), "the controller is still constructed in the parent");
    assert(PRO_CODE.includes("viewport.attach(chart.timeScale())"), "and attached to the time scale by the parent");
    assert(PRO_CODE.includes("prependStarted") && PRO_CODE.includes("prependCompleted"), "the parent sequences prepends");
    assert(PRO_CODE.includes("viewport.handleRangeChange(range)"), "and classifies range changes");
});

// ══════════════════════════════════════════════════════════════════
// 4/5/6/7/8. No market data, no fetching, no recreation, no trading, no Smart Money
// ══════════════════════════════════════════════════════════════════

console.log("DrawingRenderer guard: renderer, not a data provider");

check("no market-data authority", () => {
    for (const forbidden of [
        "useLiveCandles",
        "ChartDataEngine",
        "chart-data-engine",
        "fetchCandles",
        "loadOlder",
        "reconcile(",
        "useOrderFlow",
        "candles",
    ]) {
        assert(!RENDER_CODE.includes(forbidden), `DrawingRenderer must not reference ${forbidden}`);
    }
});

check("no API fetching and no chart recreation", () => {
    assert(!/\bfetch\s*\(/.test(RENDER_CODE), "DrawingRenderer never calls fetch(");
    assert(!RENDER_CODE.includes("/api/"), "no API path in the renderer");
    assert(!RENDER_CODE.includes("createChart("), "DrawingRenderer never creates a chart");
    assert(!RENDER_CODE.includes(".remove()"), "DrawingRenderer never removes the chart");
    assert(!RENDER_CODE.includes("addSeries("), "DrawingRenderer never creates a chart series");
});

check("no trading authority", () => {
    for (const forbidden of [
        "UnifiedTradingService",
        "/api/trading",
        "executeOrder",
        "placeOrder",
        "onClosePosition",
        "onCancelOrder",
        "onModifyPositionStops",
        "onPositionSelect",
        "pendingOrders",
        "positions",
    ]) {
        assert(!RENDER_CODE.includes(forbidden), `DrawingRenderer must not reference ${forbidden}`);
    }
});

check("no Smart Money authority", () => {
    for (const forbidden of [
        "detectSmartMoney",
        "smartMoney",
        "SmartMoney",
        "computeFvgs",
        "computeOrderBlocks",
        "computeEqualLevels",
        "computeSwings",
        "market-core",
        "structureOverlay",
        "fvg",
        "orderBlock",
    ]) {
        assert(!RENDER_CODE.includes(forbidden), `DrawingRenderer must not reference ${forbidden}`);
    }
    assert(PRO_CODE.includes("detectSmartMoney("), "the parent keeps the Smart Money detection");
});

// ══════════════════════════════════════════════════════════════════
// 9. Stable drawing identity
// ══════════════════════════════════════════════════════════════════

console.log("DrawingRenderer guard: drawing identity");

check("the renderer never invents or rewrites a drawing id", () => {
    assert(!RENDER_CODE.includes("Math.random"), "no id generation in the renderer");
    assert(!RENDER_CODE.includes("Date.now()"), "no id/time stamping in the renderer");
    assert(!RENDER_CODE.includes("d_${"), "the id format stays in the parent");
    assert(PRO_CODE.includes("id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`"), "the parent still mints ids");
});

check("drawing identity flows through as the drawing id, never an array index", () => {
    assert(RENDER_CODE.includes("id: d.id"), "every projected visual carries the drawing's own id");
    assert(RENDER_CODE.includes("key: v.id"), "the SVG elements are keyed by the drawing id");
    assert(!/key=\{\s*i\s*\}/.test(RENDER_CODE) && !RENDER_CODE.includes("key: i,"), "no index keys");
    // Selection resolves by id in the renderer, and the parent looks its own
    // selection up by id too.
    assert(RENDER_CODE.includes("drawings.find((d) => d.id === context.selectedDrawingId)"), "selection resolves by id in the renderer");
    assert(PRO_CODE.includes("drawingElements.find((d) => d.id === selectedDrawingId)"), "and the parent looks its selection up by id");
});

// ══════════════════════════════════════════════════════════════════
// 10/11/12/13. Coordinate, Fibonacci, triangle and ray contracts
// ══════════════════════════════════════════════════════════════════

console.log("DrawingRenderer guard: Phase 0 contracts");

check("coordinate contract: an unresolved axis yields null, never a zero pixel", () => {
    const zeroFallback = /(?:timeToCoordinate|priceToCoordinate|logicalToCoordinate)\s*\([\s\S]{0,160}?\?\?\s*0/g;
    assert(zeroFallback.exec(RENDER_CODE) === null, "no ?? 0 after a coordinate transform");
    assert(RENDER_CODE.includes("if (y === null) return null;"), "unresolvable price hides the horizontal line");
    assert(RENDER_CODE.includes("if (x === null) return null;"), "unresolvable time hides the vertical line");
    assert(RENDER_CODE.includes("if (!a || !b) return null;"), "unresolvable anchors hide the object");
    assert(RENDER_CODE.includes("if (!anchors) return null;"), "projection runs only on resolved anchors");
    // The shared helpers own the null-vs-0 rule.
    assert(DRAWING_UTILS.includes("They NEVER substitute 0"), "drawing-utils documents the rule");
    assert(UTILS_CODE.includes("return x === null || x === undefined || !Number.isFinite(x) ? null : Number(x);"), "time transform nulls out");
    assert(UTILS_CODE.includes("return y === null || y === undefined || !Number.isFinite(y) ? null : Number(y);"), "price transform nulls out");
});

check("Fibonacci contract: renderer and hit-test share the resolved level set", () => {
    assert(RENDER_CODE.includes("resolvedFiboLevels(d, cfg.tools.fiboLevels)"), "the committed levels come from the shared resolver");
    assert(RENDER_CODE.includes("resolvedFiboLevels(null, cfg.tools.fiboLevels)"), "and so does the live preview");
    assert(!/\[\s*0\s*,\s*0\.236/.test(RENDER_CODE), "no hardcoded level array in the renderer");
    assert(UTILS_CODE.includes("export function resolvedFiboLevels("), "one resolver");
    // The parent keeps its half of the shared contract (the hit-test).
    assert(PRO_CODE.includes("resolvedFiboLevels(d, cfgRef.current.tools.fiboLevels)"), "the hit-test uses the same resolver");
    assertEqual(count(UTILS_CODE, "export function resolvedFiboLevels("), 1, "exactly one level resolver");
});

check("triangle contract: deterministic third vertex, still a real polygon", () => {
    assert(RENDER_CODE.includes("triangleVertices(x1, y1, x2, y2)"), "the renderer derives the third vertex");
    assert(RENDER_CODE.includes("triangleVertices(dp.startX, dp.startY, dp.curX, dp.curY)"), "and so does the preview");
    assert(RENDER_CODE.includes('case "triangle":'), "the triangle render branch survives");
    assert(RENDER_CODE.includes('"polygon"'), "painted as a closed polygon");
    assert(UTILS_CODE.includes("return [[x1, y1], [x2, y2], [x1, y2]];"), "the third vertex is (x1, y2) — unchanged");
});

check("ray contract: anchored extension to the container boundary", () => {
    assertEqual(count(RENDER_CODE, "extendRayToBounds("), 2, "the committed ray and its preview both extend");
    assert(RENDER_CODE.includes("extendRayToBounds(x1, y1, x2, y2, width, height)"), "the committed ray uses the container bounds");
    assert(RENDER_CODE.includes("extendRayToBounds(dp.startX, dp.startY, dp.curX, dp.curY, width, height)"), "the preview does too");
    assert(UTILS_CODE.includes("export function extendRayToBounds("), "the shared extension helper is untouched");
});

// ══════════════════════════════════════════════════════════════════
// Interaction authority stays in the parent
// ══════════════════════════════════════════════════════════════════

console.log("DrawingRenderer guard: interaction authority");

check("the parent keeps the gestures, the tool, the state and the keyboard", () => {
    for (const anchor of [
        "handlePointerDown",
        "handlePointerMove",
        "handlePointerUp",
        "handlePointerCancel",
        "drawingInProgressRef",
        "activeDrawingToolRef",
        "hitTestAt(",
        "hitTestDrawing(",
        "hitTestTradeLine(",
        "deleteSelectedDrawing",
        "setSelectedDrawingId",
        "addEventListener(\"keydown\", onKey)",
        "toolCommitsDrawing(dp.tool, dist)",
        "setDrawingPreview",
        "commitDrawings",
        "const [drawingElements, setDrawingElements] = useState<DrawingItem[]>(drawings)",
    ]) {
        assert(PRO_CODE.includes(anchor), `the parent still owns ${anchor}`);
    }
});

check("the renderer owns no pointer/keyboard/selection state", () => {
    for (const forbidden of [
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
        "addEventListener",
        "onKey",
        "hitTest",
        "setSelectedDrawingId",
        "setDrawingElements",
        "commitDrawings",
        "onDrawingsChange",
        "localStorage",
        "firebase",
        "rtdb",
    ]) {
        assert(!RENDER_CODE.includes(forbidden), `DrawingRenderer must not reference ${forbidden}`);
    }
});

check("drawing persistence / serialization is untouched by this phase", () => {
    const PROPS = PRO_CHART.slice(PRO_CHART.indexOf("drawings?: DrawingItem[]"), PRO_CHART.indexOf("gridVisible?: boolean"));
    assert(PROPS.includes("drawings?: DrawingItem[]"), "the drawings prop is unchanged");
    assert(PROPS.includes("onDrawingsChange?: (drawings: DrawingItem[]) => void"), "the persistence callback is unchanged");
    assert(PRO_CHART.includes("export type DrawingItem = {"), "the drawing schema is unchanged");
    assert(PRO_CHART.includes("fiboLevels?: readonly number[];"), "the schema keeps its optional per-drawing levels");
});

check("the renderer is a pure SVG layer: no hooks, no memoization, no timers", () => {
    for (const forbidden of [
        "useState",
        "useEffect",
        "useMemo",
        "useCallback",
        "useRef",
        "useSyncExternalStore",
        "throttle",
        "debounce",
        "requestAnimationFrame",
        "setInterval",
        "setTimeout",
        "cache",
    ]) {
        assert(!RENDER_CODE.includes(forbidden), `DrawingRenderer must not contain ${forbidden}`);
    }
});

// ══════════════════════════════════════════════════════════════════
// Lifecycle ordering + cleanup
// ══════════════════════════════════════════════════════════════════

console.log("DrawingRenderer guard: lifecycle ordering");

check("chart → viewport attach → series → indicators → drawing attach → wiring → render", () => {
    const viewportAttach = PRO_CODE.indexOf("viewport.attach(chart.timeScale())");
    const seriesAttach = PRO_CODE.indexOf("seriesRenderer.attach(chart");
    const indicatorAttach = PRO_CODE.indexOf("indicatorRenderer.attach(chart");
    const drawingAttach = PRO_CODE.indexOf("drawingRenderer.attach(chart");
    const rangeWiring = PRO_CODE.indexOf("subscribeVisibleLogicalRangeChange");
    const render = PRO_CODE.indexOf("drawingRenderer.render(drawingElements, {");
    for (const [name, index] of [
        ["viewport.attach", viewportAttach],
        ["seriesRenderer.attach", seriesAttach],
        ["indicatorRenderer.attach", indicatorAttach],
        ["drawingRenderer.attach", drawingAttach],
        ["subscribeVisibleLogicalRangeChange", rangeWiring],
        ["drawingRenderer.render", render],
    ] as const) {
        assert(index >= 0, `missing lifecycle anchor ${name}`);
    }
    assert(viewportAttach < seriesAttach, "the viewport attaches before the series");
    assert(seriesAttach < indicatorAttach, "the series attach before the indicators");
    assert(indicatorAttach < drawingAttach, "the drawing renderer binds after the indicators");
    assert(drawingAttach < rangeWiring, "the drawing renderer binds before the viewport wiring");
    assert(rangeWiring < render, "the drawing surface is projected after the wiring");
});

check("the parent detaches the renderer in the chart effect cleanup", () => {
    assert(PRO_CODE.includes("drawingRenderer.detach()"), "the parent detaches the renderer");
    const attach = PRO_CODE.indexOf("drawingRenderer.attach(chart");
    const detach = PRO_CODE.indexOf("drawingRenderer.detach()");
    const indicatorDetach = PRO_CODE.indexOf("indicatorRenderer.detach()");
    assert(attach < detach, "detach happens after attach");
    assert(indicatorDetach < detach, "and downstream of the indicator teardown");
});

check("the renderer binds the transforms but never a range subscription", () => {
    assert(RENDER_CODE.includes("attach(chart: MarketTimeTransform | null, series: DrawingSeriesTransform | null)"), "attach takes only the two transforms");
    assert(RENDER_CODE.includes("this.chart = chart;") && RENDER_CODE.includes("this.series = series;"), "it stores them");
    assert(RENDER_CODE.includes("this.attached = true;"), "and records the binding");
    assert(!RENDER_CODE.includes("subscribe"), "it never subscribes to anything");
});

check("the runtime lifecycle harness was extended with the drawing milestones", () => {
    assert(LIFECYCLE.includes("DrawingRenderer"), "the harness imports the real renderer");
    for (const milestone of ["drawing.attach", "drawing.render", "drawing.detach"]) {
        assert(LIFECYCLE.includes(milestone), `the harness records ${milestone}`);
    }
});

check("the real-browser smoke spec is not weakened by this phase", () => {
    assert(E2E.includes("@playwright/test"), "it still runs in a real browser");
    assert(E2E.includes("data-pro-terminal-workspace"), "against the canonical Pro Terminal stack");
    assert(E2E.includes("__vpCalls"), "with the viewport call counter");
    assert(E2E.includes("fitContent") && E2E.includes("scrollToRealTime"), "and the viewport-mutation assertions");
});

// ══════════════════════════════════════════════════════════════════
// Runtime contract — the real DrawingRenderer + a deterministic mock
// ══════════════════════════════════════════════════════════════════

console.log("DrawingRenderer guard: runtime drawing behaviour");

const CFG = defaultChartSettings();
const T1 = 1_700_000_000; // seconds — the chart's own time axis
const T2 = 1_700_000_300;
const PRICE_A = 100;
const PRICE_B = 110;

/**
 * The smallest possible chart abstraction: the two transforms the renderer
 * reads, backed by explicit maps so a test can move a coordinate and watch the
 * geometry follow. Every read is counted, so "nothing was read after detach" is
 * provable rather than assumed.
 */
class MockChart {
    timeX = new Map<number, number | null>();
    priceY = new Map<number, number | null>();
    reads = 0;

    readonly timeScale = () => ({
        timeToCoordinate: (time: Time): number | null => {
            this.reads += 1;
            const x = this.timeX.get(Number(time));
            return x === undefined ? null : x;
        },
    });

    readonly chart = { timeScale: this.timeScale };

    readonly series = {
        priceToCoordinate: (price: number): number | null => {
            this.reads += 1;
            const y = this.priceY.get(price);
            return y === undefined ? null : y;
        },
        coordinateToPrice: (y: number): number | null => (Number.isFinite(y) ? 1000 - y : null),
    };
}

function makeRuntime() {
    const mock = new MockChart();
    mock.timeX.set(T1, 40);
    mock.timeX.set(T2, 240);
    mock.priceY.set(PRICE_A, 500);
    mock.priceY.set(PRICE_B, 400);
    const renderer = new DrawingRenderer();
    renderer.attach(mock.chart, mock.series);
    const context = (over: Partial<DrawingRenderContext> = {}): DrawingRenderContext => ({
        width: 800,
        height: 600,
        cfg: CFG,
        symbol: "BTCUSD",
        selectedDrawingId: null,
        preview: null,
        ...over,
    });
    const trend: DrawingItem = {
        id: "d_trend",
        type: "trendline",
        points: [{ time: T1 * 1000, price: PRICE_A }, { time: T2 * 1000, price: PRICE_B }],
    };
    return { mock, renderer, context, trend };
}

check("initial render: a real renderer instance projects the drawing to geometry ops", () => {
    const { renderer, context, trend } = makeRuntime();
    const scene = renderer.render([trend], context());
    assertEqual(scene.drawings.length, 1, "one visual");
    const v = scene.drawings[0];
    assert(v.kind === "trendline", "the trendline paints as a line");
    assertEqual([v.x1, v.y1, v.x2, v.y2], [40, 500, 240, 400], "the stored market anchors resolved to pixels");
    assertEqual(v.id, "d_trend", "identity is the drawing id");
    assertEqual([scene.width, scene.height, scene.visible], [800, 600, true], "the surface reports its container");
    assert(scene.preview === null && scene.selection === null, "nothing selected, nothing dragged");
    assert(renderer.isAttached(), "the renderer is bound to the chart transforms");
});

check("coordinate changes: the geometry is re-derived, never cached", () => {
    const { mock, renderer, context, trend } = makeRuntime();
    const first = renderer.render([trend], context()).drawings[0];
    // The user panned/zoomed: the chart's own transform now answers differently.
    mock.timeX.set(T1, 10);
    mock.priceY.set(PRICE_A, 520);
    const second = renderer.render([trend], context()).drawings[0];
    assert(first.kind === "trendline" && second.kind === "trendline", "same tool");
    assertEqual([second.x1, second.y1], [10, 520], "the anchor followed the transform");
    assertEqual([second.x2, second.y2], [240, 400], "the untouched anchor is unchanged");
    // A resize only changes the full-span math, not the anchors.
    const resized = renderer.render([trend], context({ width: 1200, height: 900 }));
    assertEqual(resized.drawings.length, 1, "still drawn");
    assertEqual(resized.width, 1200, "the surface reports the new width");
});

check("null coordinates: the object is hidden, never pinned to x=0/y=0", () => {
    const { mock, renderer, context, trend } = makeRuntime();
    const before = JSON.stringify(trend);
    // Timeframe switch: the stored timestamps no longer resolve on this axis.
    mock.timeX.set(T1, null);
    const scene = renderer.render([trend], context());
    assertEqual(scene.drawings, [], "an unresolvable time draws nothing");
    assertEqual(renderer.screenPosition(trend), null, "and reports no screen position");
    // Price scale not ready.
    mock.timeX.set(T1, 40);
    mock.priceY.set(PRICE_B, null);
    assertEqual(renderer.render([trend], context()).drawings, [], "an unresolvable price draws nothing");
    // Both resolve again → the object returns by itself.
    mock.priceY.set(PRICE_B, 400);
    const back = renderer.render([trend], context()).drawings[0];
    assert(back.kind === "trendline", "it renders again once resolvable");
    assertEqual([back.x1, back.y1, back.x2, back.y2], [40, 500, 240, 400], "with the correct geometry");
    assertEqual(JSON.stringify(trend), before, "the drawing's market data was never mutated");
    assertEqual(scene.drawings, [], "and nothing was pinned to the origin while it was unresolvable");
});

check("full-span tools keep their container bounds (horizontal / vertical)", () => {
    const { renderer, context } = makeRuntime();
    const horizontal: DrawingItem = { id: "h", type: "horizontal", points: [{ price: 100 }, { price: 100 }] };
    const vertical: DrawingItem = { id: "v", type: "vertical", points: [{ time: T1 * 1000, price: PRICE_A }, { time: T1 * 1000, price: PRICE_A }] };
    const scene = renderer.render([horizontal, vertical], context({ width: 640, height: 480 }));
    assertEqual(scene.drawings.length, 2, "both are drawn");
    const h = scene.drawings[0];
    const v = scene.drawings[1];
    assert(h.kind === "horizontal" && h.y === 500 && h.width === 640, "the horizontal line spans the container width");
    assert(h.kind === "horizontal" && h.label === "100.00", "and carries its formatted price label");
    assert(v.kind === "vertical" && v.x === 40 && v.height === 480, "the vertical line spans the container height");
});

check("selection: changing the selected id changes only the visual selection state", () => {
    const { renderer, context, trend } = makeRuntime();
    const unselected = renderer.render([trend], context());
    assertEqual(unselected.selection, null, "nothing selected");
    const selected = renderer.render([trend], context({ selectedDrawingId: "d_trend" }));
    assertEqual(selected.drawings, unselected.drawings, "the drawing geometry is untouched by selection");
    const outline = selected.selection;
    assert(outline !== null, "the selection outline appears");
    assertEqual(outline.handles.length, 2, "with its two endpoint handles");
    assertEqual([outline.anchorX, outline.anchorY], [40, 500], "anchored on the drawing");
    assertEqual(renderer.screenPosition(trend), { x1: 40, y1: 500, x2: 240, y2: 400 }, "the parent's HTML anchor matches the paint");
    // Deselect → back to no selection, same geometry.
    const deselected = renderer.render([trend], context({ selectedDrawingId: null }));
    assertEqual(deselected.selection, null, "the outline is gone");
    assertEqual(deselected.drawings, unselected.drawings, "the drawing is unchanged");
});

check("preview: the parent's gesture state projects without touching the drawing list", () => {
    const { renderer, context, trend } = makeRuntime();
    const scene = renderer.render([trend], context({
        preview: { tool: "horizontal", startX: 10, startY: 123, startPrice: 100, startTime: 0, curX: 90, curY: 123 },
    }));
    const preview = scene.preview;
    assert(preview !== null, "the preview is projected");
    assert(preview.kind === "horizontal", "the preview keeps its shape");
    assertEqual(preview.y, 123, "and its pixel anchor");
    assertEqual(scene.drawings.length, 1, "the committed drawing is unaffected");
});

check("update: editing a drawing keeps its identity and re-projects its geometry", () => {
    const { renderer, context, trend } = makeRuntime();
    const edited: DrawingItem = { ...trend, points: [{ time: T1 * 1000, price: PRICE_A }, { time: T2 * 1000, price: PRICE_A }] };
    const scene = renderer.render([edited], context({ selectedDrawingId: "d_trend" }));
    const visual = scene.drawings[0];
    assertEqual(visual.id, "d_trend", "the same drawing id");
    assert(visual.kind === "trendline", "still a trendline");
    assertEqual([visual.x2, visual.y2], [240, 500], "with the edited geometry");
    assert(scene.selection !== null, "the selection follows the same object");
});

check("delete: removing a drawing removes its visual representation", () => {
    const { renderer, context, trend } = makeRuntime();
    const other: DrawingItem = { id: "d_other", type: "trendline", points: [{ time: T1 * 1000, price: PRICE_B }, { time: T2 * 1000, price: PRICE_A }] };
    assertEqual(renderer.render([trend, other], context()).drawings.length, 2, "both drawn");
    const after = renderer.render([other], context({ selectedDrawingId: "d_trend" }));
    assertEqual(after.drawings.map((d) => d.id), ["d_other"], "only the survivor remains");
    assertEqual(after.selection, null, "the deleted object cannot stay selected");
});

check("cleanup: after detach the surface is empty and the chart is never read again", () => {
    const { mock, renderer, context, trend } = makeRuntime();
    renderer.render([trend], context());
    assert(renderer.isAttached(), "attached before detach");
    renderer.detach();
    assert(!renderer.isAttached(), "detach drops the binding");
    assertEqual(renderer.scene(), { width: 0, height: 0, visible: false, drawings: [], selection: null, preview: null }, "the scene is cleared");
    const readsBefore = mock.reads;
    const after = renderer.render([trend], context());
    assertEqual(after.drawings, [], "nothing is projected without a chart binding");
    assertEqual(mock.reads, readsBefore, "and no transform is consulted after detach");
    assertEqual(renderer.screenPosition(trend), null, "no screen position either");
});

check("a detached renderer still reports the container metrics (surface mounts at the right size)", () => {
    const renderer = new DrawingRenderer();
    const scene = renderer.render([], {
        width: 0,
        height: 0,
        cfg: CFG,
        symbol: "BTCUSD",
        selectedDrawingId: null,
        preview: null,
    });
    assertEqual(scene.visible, false, "invisible while the container has no width");
    const sized = renderer.render([], {
        width: 100,
        height: 50,
        cfg: CFG,
        symbol: "BTCUSD",
        selectedDrawingId: null,
        preview: null,
    });
    assertEqual([sized.width, sized.height, sized.visible], [100, 50, true], "and sized once it does");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
