/**
 * Phase 3D — Pro Terminal renderer lifecycle *runtime* harness.
 *
 * Runs with:
 *
 *     npx jiti tests/chart-renderer-lifecycle.test.ts
 *
 * Complements the two source guards (`tests/chart-surface-guard.test.ts`,
 * `tests/indicator-renderer-guard.test.ts`) and the real-browser smoke probe
 * (`e2e/pro-terminal-viewport.smoke.spec.ts`). The guards prove the *shape* of
 * the architecture; the smoke spec proves it renders. This harness proves the
 * *runtime contract*: who runs first, what is created, what is reused, what is
 * torn down in what order, and — critically — that the renderer boundary never
 * mutates viewport state.
 *
 * ## How it exercises real production code (not a fake script)
 *
 *   • `ViewportController` (lib/chart-engine/viewport), `SeriesRenderer` and
 *     `IndicatorRenderer` are imported and instantiated for real. Every
 *     assertion below is about behaviour those classes actually produced.
 *   • The mock chart mimics only the lightweight-charts surface the four
 *     authorities consume, and it *records* the calls the production code makes
 *     into it (`chart.addSeries:*`, `chart.addPane`, `chart.remove`,
 *     `series.setData:*`, `timeScale.*`, …). Those entries are ground truth
 *     written by real production code paths, not by the test.
 *   • The three renderer instances are additionally *instrumented*: a thin
 *     wrapper records the milestone (`viewport.attach`, `series.attach`,
 *     `indicator.syncLayers`, …) and then delegates to the real method, which
 *     always runs. Nothing is stubbed.
 *
 * ## Why ChartSurface / ProTerminalChart are not mounted
 *
 * Both are React components whose lifecycle lives in effects. Mounting them
 * needs a DOM plus a React test renderer; this repo has neither (no jsdom /
 * happy-dom / @testing-library, and adding one is explicitly out of scope for a
 * test-hardening phase). Rather than fabricate application infrastructure, the
 * harness drives the *smallest real lifecycle boundary*: it mirrors
 * ProTerminalChart's chart effect and its data / study-pane / layer / type
 * effects call-for-call, and it **verifies that mirror against the production
 * source at runtime** (`production mirror fidelity` below). If someone reorders
 * the production effect, the fidelity check fails before the ordering checks
 * can drift.
 *
 * ## What is deliberately NOT here
 *
 * No pixels, no styling, no performance measurement, no indicator mathematics
 * (values are synthetic arrays — the parent owns the math). The indicator
 * families are fed synthetic aligned arrays purely to prove the *renderer*
 * commits them and touches no viewport state.
 *
 * ## Known limitation of the pane model (documented, not asserted)
 *
 * `MockChart` models the two lightweight-charts pane semantics that change the
 * topology the renderer produces: `addPane()` appends, and removing the last
 * series of a non-main pane releases that pane implicitly (the library's
 * `cleanupIfPaneIsEmpty`). It does NOT model the library's remaining internals.
 *
 * Reading that same library source surfaced a PRE-EXISTING pane-index
 * staleness: `syncLayers` remembers a pane by numeric index, so turning off an
 * *earlier* pane-owning layer while a *later* pane-owning layer stays on makes
 * the explicit `removePane(index)` target a shifted index (the real library
 * also re-indexes on its own implicit release, so the two can disagree). That
 * behaviour is byte-identical in the committed pre-extraction
 * `ProTerminalChart.tsx` (`git show HEAD:…`), so Phase 3C preserved it rather
 * than introduced it. Phase 3D is a lifecycle-contract phase that must not
 * change chart behaviour, so this harness does not assert that transition; it
 * is reported as a deferred finding instead of being pinned as "expected".
 *
 * ## Phase 3E addition: the drawing surface
 *
 * `DrawingRenderer` is imported and instantiated for real, bound to the same
 * mock chart in the production order (after the indicators, before the viewport
 * subscriptions) and driven through its real `render` pass in section 14. The
 * mock chart gained exactly the two transforms the drawing surface reads
 * (`timeToCoordinate` on the time scale, `priceToCoordinate` on the series)
 * plus a read counter, so "the drawings follow the chart" and "the surface goes
 * quiet after detach" are proven from production behaviour rather than assumed.
 * The mock still models no DOM: the drawing renderer projects geometry, and the
 * harness asserts on that geometry — which is exactly what the SVG layer paints.
 */

import fs from "node:fs";
import path from "node:path";
import {
    AreaSeries,
    BarSeries,
    BaselineSeries,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    type IChartApi,
    type LineWidth,
    type UTCTimestamp,
} from "lightweight-charts";
import {
    SeriesRenderer,
    type PriceBar,
    type PriceSeriesRefs,
} from "../components/pro-scalping-terminal/SeriesRenderer";
import {
    IndicatorRenderer,
    type IndicatorLayerOptions,
    type IndicatorSeriesData,
    type IndicatorSeriesRefs,
    type IndicatorValues,
} from "../components/pro-scalping-terminal/IndicatorRenderer";
import {
    DrawingRenderer,
    type DrawingRenderContext,
    type DrawingScene,
} from "../components/pro-scalping-terminal/DrawingRenderer";
import { defaultChartSettings } from "../components/pro-scalping-terminal/chart-settings";
import type { ChartLayerId } from "../components/pro-scalping-terminal/chart-layers";
import type { ChartType, Candle, DrawingItem } from "../components/pro-scalping-terminal/ProTerminalChart";
import type { LogicalRange } from "../lib/chart-engine/coordinate-mapping";
import {
    ViewportController,
    type ViewportSnapshot,
    type ViewportTimeScaleLike,
} from "../lib/chart-engine/viewport";

// ── test scaffolding (same shape as the existing jiti suites) ───────────────

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
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

function assertEqual<T>(actual: T, expected: T, message = ""): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${message} Expected ${b} but got ${a}`);
}

// ══════════════════════════════════════════════════════════════════
// Deterministic event recorder
// ══════════════════════════════════════════════════════════════════

/**
 * Architectural milestones in call order. Entries are written by instrumented
 * calls into the real authorities and by the mock chart/time-scale boundary the
 * real code calls — never inserted by hand to fake an order.
 */
let events: string[] = [];
const resetEvents = (): void => { events = []; };
const log = (event: string): void => { events.push(event); };
const indexOfEvent = (event: string): number => events.indexOf(event);
const countEvent = (event: string): number => events.filter((e) => e === event).length;
const eventsStartingWith = (prefix: string): string[] => events.filter((e) => e.startsWith(prefix));
/** Mark a position in the log so a segment can be asserted in isolation. */
const markEvents = (): number => events.length;
const eventsSince = (mark: number): string[] => events.slice(mark);

/** A milestone assertion that reports the whole order when it fails. */
function assertBefore(first: string, second: string): void {
    const a = indexOfEvent(first);
    const b = indexOfEvent(second);
    assert(a >= 0, `milestone "${first}" was never recorded (order: ${events.join(" → ")})`);
    assert(b >= 0, `milestone "${second}" was never recorded (order: ${events.join(" → ")})`);
    assert(a < b, `expected "${first}" before "${second}" (order: ${events.join(" → ")})`);
}

type AnyMethod = (...args: unknown[]) => unknown;

/**
 * Instrument an instance so its real call path is recorded. The wrapper always
 * invokes the original implementation — this is a recorder, not a stub.
 */
function instrument<T extends object, K extends keyof T>(
    prefix: string,
    target: T,
    methods: readonly K[]
): void {
    const bag = target as unknown as Record<string, unknown>;
    for (const method of methods) {
        const key = String(method);
        const original = target[method] as unknown as AnyMethod;
        if (typeof original !== "function") continue;
        bag[key] = (...args: unknown[]): unknown => {
            log(`${prefix}.${key}`);
            return original.apply(target, args);
        };
    }
}

// ══════════════════════════════════════════════════════════════════
// Mock lightweight-charts (the consumed subset only)
// ══════════════════════════════════════════════════════════════════

/** Mirrors `timeScale.rightOffset: 6` in ChartSurface's createChart options. */
const RIGHT_OFFSET_BARS = 6;
/** Mirrors `PINE_PANE_STRETCH` in ProTerminalChart. */
const PINE_PANE_STRETCH = 0.35;
/** Mirrors `PANE_STRETCH` in IndicatorRenderer. */
const PANE_STRETCH = { supertrend: 0.25, rsi: 0.3, delta: 0.25, macd: 0.3, stochastic: 0.3, atr: 0.25 };

type SeriesKind = "candlestick" | "histogram" | "line" | "area" | "baseline" | "bar" | "unknown";

function seriesKind(definition: unknown): SeriesKind {
    if (definition === CandlestickSeries) return "candlestick";
    if (definition === HistogramSeries) return "histogram";
    if (definition === LineSeries) return "line";
    if (definition === AreaSeries) return "area";
    if (definition === BaselineSeries) return "baseline";
    if (definition === BarSeries) return "bar";
    return "unknown";
}

class MockPriceLine {
    constructor(readonly options: Record<string, unknown>) {}
}

class MockPane {
    stretchFactor: number | null = null;
    readonly series: MockSeries[] = [];
    constructor(readonly index: number) {}
    setStretchFactor(factor: number): void {
        log(`pane.stretch:${this.index}:${factor}`);
        this.stretchFactor = factor;
    }
}

class MockSeries {
    readonly priceLines: MockPriceLine[] = [];
    dataCommits = 0;
    updates = 0;
    lastData: readonly unknown[] | null = null;
    /** Reads by the drawing surface (price → y). Phase 3E. */
    coordinateReads = 0;

    constructor(
        private readonly chart: MockChart,
        readonly id: number,
        readonly kind: SeriesKind,
        /** The pane index at creation — what the renderer remembers. */
        readonly pane: number,
        /** The pane object itself, so removal follows the series. */
        readonly paneRef: MockPane,
        readonly options: Record<string, unknown>
    ) {}

    private note(op: string): void {
        this.chart.noteMutation(this.kind, op);
    }

    setData(data: readonly unknown[]): void {
        this.note("setData");
        log(`series.setData:${this.kind}`);
        this.dataCommits += 1;
        this.lastData = data;
    }

    update(bar: unknown): void {
        void bar;
        this.note("update");
        log(`series.update:${this.kind}`);
        this.updates += 1;
    }

    applyOptions(options: Record<string, unknown>): void {
        this.note("applyOptions");
        log(`series.applyOptions:${this.kind}`);
        Object.assign(this.options, options);
    }

    createPriceLine(options: Record<string, unknown>): MockPriceLine {
        this.note("createPriceLine");
        log(`series.createPriceLine:${this.kind}`);
        const line = new MockPriceLine(options);
        this.priceLines.push(line);
        return line;
    }

    removePriceLine(line: MockPriceLine): void {
        this.note("removePriceLine");
        log(`series.removePriceLine:${this.kind}`);
        const i = this.priceLines.indexOf(line);
        if (i >= 0) this.priceLines.splice(i, 1);
    }

    visible(): boolean {
        return this.options.visible !== false;
    }

    /**
     * The drawing surface's own read of the price axis (Phase 3E): price → y.
     * Deliberately a pure read — it neither mutates the chart nor records a
     * mutation, so a projection can never show up as a chart write.
     */
    priceToCoordinate(price: number): number | null {
        this.coordinateReads += 1;
        return Number.isFinite(price) ? 600 - price : null;
    }

    /** The inverse read the live preview's measurement labels use. */
    coordinateToPrice(y: number): number | null {
        return Number.isFinite(y) ? 600 - y : null;
    }
}

class MockTimeScale implements ViewportTimeScaleLike {
    range: LogicalRange | null = null;
    barCount = 0;
    /** Index space mirror, so `getVisibleRange` reports coherent TIME anchors. */
    times: number[] = [];
    barSpacing = 8;
    /** Whole-viewport pan offset in pixels (the chart's own index→x shift). */
    xShift = 0;
    /** Reads by the drawing surface (time → x). Phase 3E. */
    coordinateReads = 0;
    readonly calls = { fitContent: 0, scrollToRealTime: 0, setVisibleLogicalRange: 0 };
    readonly writtenRanges: LogicalRange[] = [];
    private readonly subscribers: Array<(range: LogicalRange | null) => void> = [];

    subscribe(fn: (range: LogicalRange | null) => void): void {
        this.subscribers.push(fn);
    }

    subscribeVisibleLogicalRangeChange(fn: (range: LogicalRange | null) => void): void {
        log("timeScale.subscribeRange");
        this.subscribers.push(fn);
    }

    unsubscribeVisibleLogicalRangeChange(fn: (range: LogicalRange | null) => void): void {
        log("timeScale.unsubscribeRange");
        const i = this.subscribers.indexOf(fn);
        if (i >= 0) this.subscribers.splice(i, 1);
    }

    applyOptions(options: Record<string, unknown>): void {
        /* bar spacing / borders: not part of the lifecycle contract */
        void options;
    }

    /**
     * The drawing surface's own read of the time axis (Phase 3E): time → x. A
     * timestamp the loaded window does not contain is UNRESOLVABLE — null,
     * never 0 (the Phase 0 coordinate contract). A read is not a mutation.
     */
    timeToCoordinate(time: unknown): number | null {
        this.coordinateReads += 1;
        const index = this.times.indexOf(Number(time));
        return index < 0 ? null : index * this.barSpacing + this.xShift;
    }

    /** The inverse read (used by the parent's pointer math, not by the renderer). */
    coordinateToTime(x: number): number | null {
        const index = Math.round((x - this.xShift) / this.barSpacing);
        return this.times[index] ?? null;
    }

    private emit(): void {
        const snapshot = this.range ? { ...this.range } : null;
        for (const fn of [...this.subscribers]) fn(snapshot);
    }

    getVisibleLogicalRange(): LogicalRange | null {
        return this.range ? { ...this.range } : null;
    }

    setVisibleLogicalRange(range: LogicalRange): void {
        this.calls.setVisibleLogicalRange += 1;
        this.writtenRanges.push({ ...range });
        this.range = { ...range };
        this.emit();
    }

    fitContent(): void {
        this.calls.fitContent += 1;
        this.barSpacing = 4;
        this.range = this.barCount > 0 ? { from: 0, to: this.barCount - 1 + RIGHT_OFFSET_BARS } : null;
        this.emit();
    }

    scrollToRealTime(): void {
        this.calls.scrollToRealTime += 1;
        if (this.barCount <= 0) return;
        const to = this.barCount - 1 + RIGHT_OFFSET_BARS;
        const span = this.range ? this.range.to - this.range.from : 100;
        this.range = { from: to - span, to };
        this.emit();
    }

    /** Coherent TIME view (same index space as `times`). */
    getVisibleRange(): { from: unknown; to: unknown } | null {
        const r = this.range;
        if (!r || this.times.length === 0) return null;
        const last = this.times.length - 1;
        const from = Math.max(0, Math.min(last, Math.floor(r.from)));
        const to = Math.max(0, Math.min(last, Math.ceil(r.to)));
        return { from: this.times[from], to: this.times[to] };
    }

    /** Test-only: the user pans/zooms → native range event. */
    userSetsRange(range: LogicalRange): void {
        this.range = { ...range };
        this.emit();
    }

    mutatingCalls(): number {
        return this.calls.fitContent + this.calls.scrollToRealTime + this.calls.setVisibleLogicalRange;
    }

    resetCalls(): void {
        this.calls.fitContent = 0;
        this.calls.scrollToRealTime = 0;
        this.calls.setVisibleLogicalRange = 0;
        this.writtenRanges.length = 0;
    }
}

class MockChart {
    readonly panesList: MockPane[] = [new MockPane(0)];
    /** Flat list of live series (any pane), for ownership/count assertions. */
    readonly series: MockSeries[] = [];
    readonly ts = new MockTimeScale();
    removed = false;
    /** Chart operations attempted after `remove()` — must stay empty. */
    readonly postRemoveMutations: string[] = [];
    private nextId = 1;

    noteMutation(kind: string, op: string): void {
        if (this.removed) this.postRemoveMutations.push(`${op}:${kind}`);
    }

    addSeries(
        definition: unknown,
        options: Record<string, unknown>,
        paneIndex?: number
    ): MockSeries {
        const kind = seriesKind(definition);
        const pane = Math.min(paneIndex ?? 0, this.panesList.length - 1);
        this.noteMutation(kind, "addSeries");
        log(`chart.addSeries:${kind}@pane${pane}`);
        const series = new MockSeries(this, this.nextId++, kind, pane, this.panesList[pane], options);
        this.panesList[pane].series.push(series);
        this.series.push(series);
        return series;
    }

    removeSeries(series: MockSeries): void {
        this.noteMutation(series.kind, "removeSeries");
        log(`chart.removeSeries:${series.kind}`);
        const i = this.series.indexOf(series);
        if (i >= 0) this.series.splice(i, 1);
        const pane = series.paneRef;
        const pi = pane.series.indexOf(series);
        if (pi >= 0) pane.series.splice(pi, 1);
        // lightweight-charts releases a non-main pane whose last series left it
        // (`cleanupIfPaneIsEmpty`), which is what shifts later pane indices.
        if (pane.series.length === 0 && this.panesList.length > 1) {
            const idx = this.panesList.indexOf(pane);
            this.panesList.splice(idx, 1);
            log(`pane.autoRelease:${idx}`);
        }
    }

    panes(): MockPane[] {
        return this.panesList;
    }

    addPane(): MockPane {
        this.noteMutation("pane", "addPane");
        log("chart.addPane");
        const pane = new MockPane(this.panesList.length);
        this.panesList.push(pane);
        return pane;
    }

    removePane(index: number): void {
        this.noteMutation("pane", "removePane");
        log(`chart.removePane:${index}`);
        // The library no-ops on the last pane and asserts on an out-of-range
        // index; the renderer wraps the call in try/catch.
        if (this.panesList.length === 1) return;
        if (index < 0 || index >= this.panesList.length) throw new Error("Invalid pane index");
        this.panesList.splice(index, 1);
    }

    priceScale(id: string): { applyOptions: (options: Record<string, unknown>) => void } {
        return {
            applyOptions: (options: Record<string, unknown>): void => {
                void options;
                log(`priceScale.applyOptions:${id}`);
            },
        };
    }

    applyOptions(options: Record<string, unknown>): void {
        void options;
        log("chart.applyOptions");
    }

    timeScale(): MockTimeScale {
        return this.ts;
    }

    subscribeCrosshairMove(fn: unknown): void {
        void fn;
        log("chart.subscribeCrosshairMove");
    }

    unsubscribeCrosshairMove(fn: unknown): void {
        void fn;
    }

    remove(): void {
        log("chart.remove");
        this.removed = true;
    }

    asChart(): IChartApi {
        return this as unknown as IChartApi;
    }
}

// ══════════════════════════════════════════════════════════════════
// Handle slots (refs) + harness
// ══════════════════════════════════════════════════════════════════

type Slot<T> = { current: T | null };
const slot = <T,>(): Slot<T> => ({ current: null });

type TripleGroup = { basis: MockSeries; upper: MockSeries; lower: MockSeries };

function makePriceRefs() {
    const candle = slot<MockSeries>();
    const volume = slot<MockSeries>();
    const line = slot<MockSeries>();
    const area = slot<MockSeries>();
    const baseline = slot<MockSeries>();
    const bar = slot<MockSeries>();
    const activePrice = slot<MockSeries>();
    const activeType: { current: ChartType } = { current: "candlestick" };
    const refs = {
        candle, volume, line, area, baseline, bar, activePrice, activeType,
    } as unknown as PriceSeriesRefs;
    return { refs, candle, volume, line, area, baseline, bar, activePrice, activeType };
}

function makeIndicatorRefs() {
    const bb = slot<TripleGroup>();
    const kc = slot<TripleGroup>();
    const dc = slot<{ upper: MockSeries; lower: MockSeries; mid: MockSeries }>();
    const supertrend = slot<{ line: MockSeries; pane: number | null }>();
    const supertrendPane = slot<number>();
    const heikinAshi = slot<MockSeries>();
    const rsi = slot<{ rsi: MockSeries; pane: number | null; lines: MockPriceLine[] }>();
    const rsiPane = slot<number>();
    const macd = slot<{ macd: MockSeries; signal: MockSeries; pane: number | null }>();
    const macdPane = slot<number>();
    const ma = slot<Record<string, MockSeries>>();
    const ichimoku = slot<{ spanA: MockSeries; spanB: MockSeries }>();
    const stochastic = slot<{ k: MockSeries; d: MockSeries; pane: number | null; lines: MockPriceLine[] }>();
    const stochasticPane = slot<number>();
    const atr = slot<{ line: MockSeries; pane: number | null }>();
    const atrPane = slot<number>();
    const delta = slot<{ hist: MockSeries; line: MockSeries }>();
    const deltaPane = slot<number>();
    const refs = {
        bb, kc, dc, supertrend, supertrendPane, heikinAshi, rsi, rsiPane, macd, macdPane,
        ma, ichimoku, stochastic, stochasticPane, atr, atrPane, delta, deltaPane,
    } as unknown as IndicatorSeriesRefs;
    return {
        refs, bb, kc, dc, supertrend, supertrendPane, heikinAshi, rsi, rsiPane, macd, macdPane,
        ma, ichimoku, stochastic, stochasticPane, atr, atrPane, delta, deltaPane,
    };
}

const COLORS = defaultChartSettings().colors;
const LINE_WIDTH: LineWidth = 2;
const PRICE_PRECISION = 2;
const MA_LAYERS: Record<string, { color: string }> = {
    ema50: { color: "#fb7185" },
    ema200: { color: "#f59e0b" },
    sma20: { color: "#94a3b8" },
    sma50: { color: "#22d3ee" },
    sma200: { color: "#60a5fa" },
};

const HOUR_SECONDS = 3600;
const T0 = 1_700_000_000;

function makeCandles(count: number, startSec = T0): Candle[] {
    return Array.from({ length: count }, (_, i) => ({
        timestamp: (startSec + i * HOUR_SECONDS) * 1000,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100.5 + i,
        volume: 10 + i,
        symbol: "BTCUSD",
        timeframe: "H1",
        finalized: true,
    }));
}

const toBar = (candle: Candle): PriceBar => ({
    time: Math.floor(candle.timestamp / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
});

const alignedValues = (n: number, base = 1): IndicatorValues =>
    Array.from({ length: n }, (_, i) => base + i);

interface Harness {
    chart: MockChart;
    ts: MockTimeScale;
    viewport: ViewportController;
    series: SeriesRenderer;
    indicators: IndicatorRenderer;
    /** Phase 3E: the drawing surface — projection + paint over the same chart. */
    drawing: DrawingRenderer;
    price: ReturnType<typeof makePriceRefs>;
    indicator: ReturnType<typeof makeIndicatorRefs>;
    /** Series created by the parent (VWAP/EMA9/EMA20), not by the renderers. */
    parentSeries: MockSeries[];
    /** Series created by the Pine-study effect mirror. */
    studySeries: MockSeries[];
    readonly studyPaneIndex: number | null;
    applyLayers(layers: Partial<Record<ChartLayerId, boolean>>): void;
    commitCandles(candles: Candle[], key?: string): void;
    setChartType(type: ChartType): void;
    commitIndicators(payload: IndicatorSeriesData): void;
    /** Project the drawing list exactly as the production render pass does. */
    renderDrawings(drawings: DrawingItem[], over?: Partial<DrawingRenderContext>): DrawingScene;
    /** The parent's HTML overlay anchor (selection toolbar / label editor). */
    drawingScreenPosition(d: DrawingItem): { x1: number; y1: number; x2: number; y2: number } | null;
    syncStudyPane(hasStudy: boolean): void;
    resize(): void;
    cleanup(): void;
    surfaceCleanup(): void;
}

/**
 * Mounts the renderer stack the way ProTerminalChart does: the chart object
 * first (ChartSurface), then the chart effect (viewport reset + attach, series
 * attach, indicator attach, viewport wiring), then the parent-owned VWAP/EMA
 * line series. The data / study / layer / indicator-data effects are returned
 * as explicit steps so a test can drive them in the production declaration
 * order.
 */
function mount(): Harness {
    resetEvents();

    // ── ChartSurface boundary: one chart instance, created once ──
    // (React effect body — modelled here, source-verified in section 0.)
    log("surface.createChart");
    const chart = new MockChart();
    const chartRef: Slot<MockChart> = { current: chart };

    // ── ProTerminalChart render phase: one singleton per authority ──
    const price = makePriceRefs();
    const indicator = makeIndicatorRefs();
    const viewport = new ViewportController();
    const series = new SeriesRenderer(price.refs);
    const indicators = new IndicatorRenderer(indicator.refs);
    const drawing = new DrawingRenderer();

    instrument("viewport", viewport, [
        "reset", "attach", "subscribe", "detach", "initialFit", "refit",
        "prependStarted", "prependCompleted", "capture", "restore",
        "handleDataAppend", "handleDataMutation", "enterLiveFollow", "handleResize",
    ] as const);
    instrument("series", series, [
        "attach", "detach", "setCandleData", "setVolumeData", "syncChartType",
        "applyAppearance", "setVolumeVisible", "updateTail", "clearData",
    ] as const);
    instrument("indicator", indicators, ["attach", "detach", "syncLayers", "setData"] as const);
    instrument("drawing", drawing, ["attach", "render", "detach", "screenPosition"] as const);

    // ── chart effect (ProTerminalChart) ──
    log("effect.chart.begin");
    viewport.reset("initial");
    viewport.attach(chart.timeScale());
    series.attach(chart.asChart(), {
        colors: COLORS,
        pricePrecision: PRICE_PRECISION,
        lineWidth: LINE_WIDTH,
        volumeVisible: false,
    });
    indicators.attach(chart.asChart());

    // The drawing surface binds the chart's own transforms — the same point in
    // the production chart effect (after the indicators, before the viewport
    // subscriptions). It binds nothing else: no range subscription, no data.
    drawing.attach(chart.asChart(), price.candle.current);

    // Parent-owned price overlays created by the same effect (VWAP/EMA9/EMA20).
    const parentSeries: MockSeries[] = [
        chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1 }),
        chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 1 }),
        chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 1 }),
    ];

    const ts = chart.timeScale();
    chart.subscribeCrosshairMove(() => {});
    const handleVisibleRange = (range: LogicalRange | null): void => {
        viewport.handleRangeChange(range);
    };
    ts.subscribeVisibleLogicalRangeChange(handleVisibleRange);
    const unsubscribeViewport = viewport.subscribe(() => {});
    log("effect.chart.ready");

    // ── effect-local state mirrors ──
    let lastKey = "";
    let lastCandles: Candle[] = [];
    const studySeries: MockSeries[] = [];
    let studyPaneIndex: number | null = null;

    const syncStudyPane = (hasStudy: boolean): void => {
        // Mirrors the Pine-study effect: tear down the previous study, then
        // create its pane (appended to the end) BEFORE the layer effect runs.
        for (const s of studySeries) chart.removeSeries(s);
        studySeries.length = 0;
        if (studyPaneIndex !== null) {
            chart.removePane(studyPaneIndex);
            studyPaneIndex = null;
        }
        if (!hasStudy) return;
        const mainIndex = 0;
        const paneIndex = chart.panes().length;
        chart.addPane();
        studyPaneIndex = paneIndex;
        chart.panes()[mainIndex]?.setStretchFactor(1);
        if (paneIndex !== mainIndex) chart.panes()[paneIndex]?.setStretchFactor(PINE_PANE_STRETCH);
        studySeries.push(
            chart.addSeries(LineSeries, {
                color: "#e2e8f0",
                lineWidth: 1,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
            }, paneIndex)
        );
    };

    const commitCandles = (candles: Candle[], key = "BTCUSD|H1"): void => {
        if (!price.candle.current) return; // parent guard: no series, no commit
        if (candles.length === 0) {
            series.clearData();
            viewport.handleDataMutation(0);
            lastCandles = [];
            return;
        }
        const bars = candles.map(toBar);
        const previous = lastCandles;
        const previousCount = previous.length;
        const keyChanged = key !== lastKey;
        const prepended =
            !keyChanged &&
            previousCount > 0 &&
            bars.length > previousCount &&
            bars[0].time < Math.floor(previous[0].timestamp / 1000);

        if (keyChanged) {
            const prevKey = lastKey;
            const prevTimeframe = prevKey.includes("|") ? prevKey.split("|")[1] : "";
            const timeframe = key.split("|")[1];
            viewport.reset(prevKey === "" ? "initial" : prevTimeframe !== timeframe ? "timeframe" : "symbol");
        }

        let snapshot: ViewportSnapshot | null = null;
        if (!keyChanged && previousCount > 0) {
            const previousTimes = previous.map((c) => Math.floor(c.timestamp / 1000));
            snapshot = prepended ? viewport.prependStarted(previousTimes) : viewport.capture(previousTimes);
        }

        // The data swap lands: the chart's index space now holds the new bars.
        ts.times = bars.map((b) => b.time as number);
        ts.barCount = bars.length;

        series.setCandleData(bars);
        viewport.setBarCount(bars.length);
        if (snapshot) {
            const newTimes = bars.map((b) => b.time as number);
            if (prepended) viewport.prependCompleted(snapshot, newTimes);
            else viewport.restore(snapshot, newTimes);
        }
        series.setVolumeData(candles, bars);

        if (keyChanged || (previousCount === 0 && bars.length > 0)) viewport.initialFit();

        lastKey = key;
        lastCandles = candles;
    };

    const setChartType = (type: ChartType): void => {
        series.syncChartType(lastCandles, type);
    };

    const applyLayers = (layers: Partial<Record<ChartLayerId, boolean>>): void => {
        const options: IndicatorLayerOptions = {
            layers,
            colors: COLORS,
            pricePrecision: PRICE_PRECISION,
            maLayers: MA_LAYERS,
        };
        indicators.syncLayers(options);
    };

    const commitIndicators = (payload: IndicatorSeriesData): void => {
        indicators.setData(payload);
    };

    // ── the drawing surface (Phase 3E) ──
    // The production parent projects on every render pass with the container
    // metrics + its resolved settings; the harness supplies the same shape with
    // a fixed 900×520 container so the pixel math stays deterministic.
    const DRAWING_VIEW = { width: 900, height: 520 };
    const drawingContext = (over: Partial<DrawingRenderContext> = {}): DrawingRenderContext => ({
        width: DRAWING_VIEW.width,
        height: DRAWING_VIEW.height,
        cfg: defaultChartSettings(),
        symbol: "BTCUSD",
        selectedDrawingId: null,
        preview: null,
        ...over,
    });
    const renderDrawings = (drawings: DrawingItem[], over: Partial<DrawingRenderContext> = {}): DrawingScene =>
        drawing.render(drawings, drawingContext(over));
    const drawingScreenPosition = (d: DrawingItem) => drawing.screenPosition(d);

    const resize = (): void => {
        viewport.handleResize();
    };

    const cleanup = (): void => {
        // Mirrors the chart effect's teardown, in order.
        ts.unsubscribeVisibleLogicalRangeChange(handleVisibleRange);
        unsubscribeViewport();
        viewport.detach();
        series.detach();
        indicators.detach();
        drawing.detach();
    };

    const surfaceCleanup = (): void => {
        chartRef.current = null;
        log("surface.clearRef");
        chart.remove();
    };

    return {
        chart,
        ts,
        viewport,
        series,
        indicators,
        drawing,
        price,
        indicator,
        parentSeries,
        studySeries,
        get studyPaneIndex() {
            return studyPaneIndex;
        },
        applyLayers,
        commitCandles,
        setChartType,
        commitIndicators,
        renderDrawings,
        drawingScreenPosition,
        syncStudyPane,
        resize,
        cleanup,
        surfaceCleanup,
    };
}

/** Series the price/indicator renderers own (everything else is parent-owned). */
function rendererSeries(h: Harness): MockSeries[] {
    const foreign = new Set<MockSeries>([...h.parentSeries, ...h.studySeries]);
    return h.chart.series.filter((s) => !foreign.has(s));
}

const seriesOfKind = (h: Harness, kind: SeriesKind): MockSeries[] =>
    rendererSeries(h).filter((s) => s.kind === kind);

/** Any recorded call into the viewport authority. */
const viewportCalls = (list: string[]): string[] => list.filter((e) => e.startsWith("viewport."));

// ══════════════════════════════════════════════════════════════════
// 0. Production mirror fidelity (runtime tie back to the real source)
// ══════════════════════════════════════════════════════════════════

const ROOT = path.resolve(__dirname, "..");
const readSource = (rel: string): string => fs.readFileSync(path.resolve(ROOT, rel), "utf8");
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PRO_CHART = readSource("components/pro-scalping-terminal/ProTerminalChart.tsx");
const PRO_CODE = stripComments(PRO_CHART);
const SURFACE_SOURCE = readSource("components/pro-scalping-terminal/ChartSurface.tsx");
const SURFACE_CODE = stripComments(SURFACE_SOURCE);

/** Assert `a` appears before `b` in a source string (both must exist). */
function sourceBefore(code: string, a: string, b: string): void {
    const ia = code.indexOf(a);
    const ib = code.indexOf(b);
    assert(ia >= 0, `production source is missing the anchor ${JSON.stringify(a)}`);
    assert(ib >= 0, `production source is missing the anchor ${JSON.stringify(b)}`);
    assert(ia < ib, `production source no longer orders ${JSON.stringify(a)} before ${JSON.stringify(b)}`);
}

console.log("Production mirror fidelity");

check("the harness mirrors the production mount order", () => {
    sourceBefore(PRO_CODE, 'viewport.reset("initial")', "viewport.attach(chart.timeScale())");
    sourceBefore(PRO_CODE, "viewport.attach(chart.timeScale())", "seriesRenderer.attach(chart");
    sourceBefore(PRO_CODE, "seriesRenderer.attach(chart", "indicatorRenderer.attach(chart");
    sourceBefore(PRO_CODE, "indicatorRenderer.attach(chart", "subscribeVisibleLogicalRangeChange");
    sourceBefore(PRO_CODE, "subscribeVisibleLogicalRangeChange", "viewport.subscribe(");
});

check("the harness mirrors the production data / layer / data-commit order", () => {
    sourceBefore(PRO_CODE, "seriesRenderer.setCandleData(", "viewport.setBarCount(");
    sourceBefore(PRO_CODE, "viewport.setBarCount(", "seriesRenderer.setVolumeData(");
    sourceBefore(PRO_CODE, "studyPaneRef.current = paneIndex", "indicatorRenderer.syncLayers(");
    sourceBefore(PRO_CODE, "indicatorRenderer.syncLayers(", "indicatorRenderer.setData(");
    sourceBefore(PRO_CODE, "seriesRenderer.setCandleData(", "indicatorRenderer.setData(");
});

check("the harness mirrors the production drawing-surface mount order", () => {
    sourceBefore(PRO_CODE, "indicatorRenderer.attach(chart", "drawingRenderer.attach(chart");
    sourceBefore(PRO_CODE, "drawingRenderer.attach(chart", "subscribeVisibleLogicalRangeChange");
    sourceBefore(PRO_CODE, "subscribeVisibleLogicalRangeChange", "drawingRenderer.render(drawingElements, {");
});

check("the harness mirrors the production teardown order", () => {
    sourceBefore(PRO_CODE, "unsubscribeVisibleLogicalRangeChange(handleVisibleRange)", "viewport.detach()");
    sourceBefore(PRO_CODE, "viewport.detach()", "seriesRenderer.detach()");
    sourceBefore(PRO_CODE, "seriesRenderer.detach()", "indicatorRenderer.detach()");
    sourceBefore(PRO_CODE, "indicatorRenderer.detach()", "drawingRenderer.detach()");
});

check("ChartSurface keeps the create-once / clear-ref-before-remove contract", () => {
    assertEqual(SURFACE_CODE.split("createChart(").length - 1, 1, "one createChart call");
    assertEqual(SURFACE_CODE.split("chart.remove()").length - 1, 1, "one chart.remove() call");
    sourceBefore(SURFACE_CODE, "chartRef.current = chart", "chartRef.current = null");
    sourceBefore(SURFACE_CODE, "chartRef.current = null", "chart.remove()");
});

// ══════════════════════════════════════════════════════════════════
// 1. Mount ordering
// ══════════════════════════════════════════════════════════════════

console.log("Mount ordering");

check("chart → viewport → series → indicators → wiring → data", () => {
    const h = mount();
    const candles = makeCandles(120);
    h.commitCandles(candles);
    h.syncStudyPane(false);
    h.applyLayers({});
    h.commitIndicators({ candles });

    assertEqual(indexOfEvent("surface.createChart"), 0, "the chart is created first");
    assertBefore("surface.createChart", "viewport.reset");
    assertBefore("viewport.reset", "viewport.attach");
    assertBefore("viewport.attach", "series.attach");
    assertBefore("series.attach", "indicator.attach");
    assertBefore("indicator.attach", "timeScale.subscribeRange");
    assertBefore("timeScale.subscribeRange", "viewport.subscribe");
    assertBefore("viewport.subscribe", "series.setCandleData");
});

check("SeriesRenderer.attach creates the six primary series, in order, once", () => {
    const h = mount();
    const created = eventsStartingWith("chart.addSeries:").slice(0, 6);
    assertEqual(created, [
        "chart.addSeries:candlestick@pane0",
        "chart.addSeries:histogram@pane0",
        "chart.addSeries:line@pane0",
        "chart.addSeries:area@pane0",
        "chart.addSeries:baseline@pane0",
        "chart.addSeries:bar@pane0",
    ], "the six price/volume series are created once, in the documented order");
    assert(h.price.candle.current !== null, "the candle handle is published");
    assert(h.price.activePrice.current === h.price.candle.current, "candlestick is the active price series at attach");
    assertEqual(h.price.activeType.current, "candlestick", "the active type starts as candlestick");
});

check("IndicatorRenderer.attach binds the chart and creates nothing", () => {
    const h = mount();
    const afterSeries = eventsStartingWith("chart.addSeries:").length;
    const panesBefore = h.chart.panes().length;
    // attach already ran during mount; a second explicit attach must be inert.
    h.indicators.attach(h.chart.asChart());
    assertEqual(eventsStartingWith("chart.addSeries:").length, afterSeries, "no series created by attach");
    assertEqual(h.chart.panes().length, panesBefore, "no pane created by attach");
    assert(h.indicators.isAttached(), "the renderer is bound to the live chart");
});

// ══════════════════════════════════════════════════════════════════
// 2. ChartSurface lifecycle (instance ownership)
// ══════════════════════════════════════════════════════════════════

console.log("ChartSurface lifecycle");

check("exactly one chart instance exists for the whole lifecycle", () => {
    const h = mount();
    const instance = h.chart;
    h.commitCandles(makeCandles(200));
    h.syncStudyPane(true);
    h.applyLayers({ bollingerBands: true, rsiPane: true });
    h.setChartType("line");
    h.setChartType("area");
    h.resize();
    h.applyLayers({ bollingerBands: false, rsiPane: true });
    assert(h.chart === instance, "the chart identity never changes");
    assertEqual(countEvent("surface.createChart"), 1, "createChart ran exactly once");
    assertEqual(countEvent("chart.remove"), 0, "nothing removed the chart early");
});

check("cleanup clears the caller's ref before exactly one chart.remove()", () => {
    const h = mount();
    h.commitCandles(makeCandles(50));
    h.cleanup();
    h.surfaceCleanup();
    assertEqual(countEvent("chart.remove"), 1, "chart.remove() ran exactly once");
    assertBefore("surface.clearRef", "chart.remove");
    assertEqual(h.chart.postRemoveMutations, [], "no renderer mutated the chart after removal");
});

// ══════════════════════════════════════════════════════════════════
// 3. Viewport lifecycle
// ══════════════════════════════════════════════════════════════════

console.log("Viewport lifecycle");

check("viewport.reset runs before viewport.attach, and attach before the renderers", () => {
    const h = mount();
    assertBefore("viewport.reset", "viewport.attach");
    assertBefore("viewport.attach", "series.attach");
    assert(h.viewport.isAttached(), "the controller is attached to the chart's time scale");
});

check("data / layer / chart-type churn never recreates or resets the controller", () => {
    const h = mount();
    h.commitCandles(makeCandles(200));
    h.commitIndicators({ candles: makeCandles(200) });
    const resetsAfterFirstCommit = countEvent("viewport.reset");
    const attaches = countEvent("viewport.attach");
    const instance = h.viewport;

    // Same instrument/timeframe: forming update, reconcile, layers, type switch.
    h.commitCandles(makeCandles(200));
    h.applyLayers({ bollingerBands: true });
    h.applyLayers({ bollingerBands: false });
    h.setChartType("line");
    h.setChartType("bar");
    h.resize();

    assert(h.viewport === instance, "one controller for the lifecycle");
    assertEqual(countEvent("viewport.attach"), attaches, "attach happened exactly once");
    assertEqual(countEvent("viewport.reset"), resetsAfterFirstCommit, "no reset from data/layer/type churn");
    assertEqual(countEvent("series.attach"), 1, "the series renderer was attached once");
    assertEqual(countEvent("indicator.attach"), 1, "the indicator renderer was attached once");
});

// ══════════════════════════════════════════════════════════════════
// 4. SeriesRenderer lifecycle
// ══════════════════════════════════════════════════════════════════

console.log("SeriesRenderer lifecycle");

check("attach sits after the viewport and before the viewport subscriptions", () => {
    mount();
    assertBefore("viewport.attach", "series.attach");
    assertBefore("series.attach", "timeScale.subscribeRange");
});

check("chart-type switching never creates a chart or a series", () => {
    const h = mount();
    h.commitCandles(makeCandles(120));
    const primaryAdds = (): number =>
        ["candlestick", "histogram", "line", "area", "baseline", "bar"]
            .reduce((total, kind) => total + countEvent(`chart.addSeries:${kind}@pane0`), 0);
    const addsBefore = primaryAdds();
    const seriesCountBefore = h.chart.series.length;
    const chartBefore = h.chart;

    for (const type of ["line", "area", "baseline", "bar", "candlestick"] as ChartType[]) {
        h.setChartType(type);
    }

    assert(h.chart === chartBefore, "the chart instance survived the switch");
    assertEqual(countEvent("surface.createChart"), 1, "no chart recreated");
    assertEqual(h.chart.series.length, seriesCountBefore, "no series created or destroyed");
    assertEqual(primaryAdds(), addsBefore, "the six primary series were never recreated");
    assertEqual(h.price.activeType.current, "candlestick", "the switch published the final type");
    assert(h.price.activePrice.current === h.price.candle.current, "the active price series follows the type");
});

check("only one price series is visible at a time", () => {
    const h = mount();
    h.commitCandles(makeCandles(60));
    h.setChartType("area");
    const visible = [h.price.candle.current, h.price.line.current, h.price.area.current, h.price.baseline.current, h.price.bar.current]
        .filter((s): s is MockSeries => s !== null)
        .filter((s) => s.visible());
    assertEqual(visible.length, 1, "exactly one price series is visible");
    assert(visible[0] === h.price.area.current, "the requested type is the visible one");
});

// ══════════════════════════════════════════════════════════════════
// 5. IndicatorRenderer lifecycle
// ══════════════════════════════════════════════════════════════════

console.log("IndicatorRenderer lifecycle");

check("attach creates no panes and no indicator series (byte-for-byte contract)", () => {
    const h = mount();
    assertEqual(countEvent("indicator.attach"), 1, "attach was called once");
    assertEqual(h.chart.panes().length, 1, "only the main pane exists after attach");
    assertEqual(countEvent("chart.addSeries:candlestick@pane0"), 1, "no Heikin-Ashi series at attach");
    assertEqual(h.indicator.bb.current, null, "no indicator handle exists at attach");
    assertEqual(h.indicator.rsi.current, null, "no RSI handle exists at attach");
});

check("syncLayers creates the layer structures it is asked for", () => {
    const h = mount();
    h.applyLayers({ bollingerBands: true, rsiPane: true, macdPane: true });
    assert(h.indicator.bb.current !== null, "Bollinger group created");
    assertEqual(h.indicator.bb.current?.basis.pane, 0, "Bollinger lives on the main pane");
    assert(h.indicator.rsi.current !== null, "RSI series created");
    assertEqual(h.indicator.rsi.current?.lines.length, 2, "RSI owns its 30/70 guides");
    assert(h.indicator.macd.current !== null, "MACD series created");
    assertEqual(h.chart.panes().length, 3, "main + RSI pane + MACD pane");
});

check("Pine study pane is created before the indicator panes (pane order preserved)", () => {
    const h = mount();
    h.syncStudyPane(true);
    const studyPane = h.studyPaneIndex;
    assert(studyPane !== null, "the study pane was created");
    h.applyLayers({ rsiPane: true });
    assert(h.indicator.rsiPane.current !== null, "the RSI pane was created after the study pane");
    assert(
        h.indicator.rsiPane.current! > studyPane!,
        `indicator pane (${h.indicator.rsiPane.current}) must stack above the study pane (${studyPane})`
    );
});

// ══════════════════════════════════════════════════════════════════
// 6. Pane parity (topology produced by the real syncLayers)
// ══════════════════════════════════════════════════════════════════

console.log("Pane parity");

check("pane creation order, index assignment and stretch factors are preserved", () => {
    const h = mount();
    h.syncStudyPane(true);
    h.applyLayers({
        supertrend: true,
        rsiPane: true,
        delta: true,
        macdPane: true,
        stochasticPane: true,
        atrPane: true,
    });

    // Main (0) · study (1) · then the renderer appends in its own check order:
    // supertrend · rsi · delta · macd · stochastic · atr.
    assertEqual(h.chart.panes().length, 8, "main + study + six indicator panes");
    assertEqual(h.studyPaneIndex, 1, "the study pane was appended first");
    assertEqual(h.indicator.supertrendPane.current, 2, "supertrend pane index");
    assertEqual(h.indicator.rsiPane.current, 3, "RSI pane index");
    assertEqual(h.indicator.deltaPane.current, 4, "delta pane index");
    assertEqual(h.indicator.macdPane.current, 5, "MACD pane index");
    assertEqual(h.indicator.stochasticPane.current, 6, "stochastic pane index");
    assertEqual(h.indicator.atrPane.current, 7, "ATR pane index");

    assertEqual(h.chart.panesList[1].stretchFactor, PINE_PANE_STRETCH, "study pane stretch");
    assertEqual(h.chart.panesList[2].stretchFactor, PANE_STRETCH.supertrend, "supertrend stretch");
    assertEqual(h.chart.panesList[3].stretchFactor, PANE_STRETCH.rsi, "RSI stretch");
    assertEqual(h.chart.panesList[4].stretchFactor, PANE_STRETCH.delta, "delta stretch");
    assertEqual(h.chart.panesList[5].stretchFactor, PANE_STRETCH.macd, "MACD stretch");
    assertEqual(h.chart.panesList[6].stretchFactor, PANE_STRETCH.stochastic, "stochastic stretch");
    assertEqual(h.chart.panesList[7].stretchFactor, PANE_STRETCH.atr, "ATR stretch");
});

check("every indicator series is owned by the pane created for it", () => {
    const h = mount();
    h.applyLayers({ supertrend: true, rsiPane: true, macdPane: true, atrPane: true });
    assertEqual(h.indicator.supertrend.current?.line.pane, h.indicator.supertrendPane.current, "supertrend series pane");
    assertEqual(h.indicator.rsi.current?.rsi.pane, h.indicator.rsiPane.current, "RSI series pane");
    assertEqual(h.indicator.macd.current?.macd.pane, h.indicator.macdPane.current, "MACD series pane");
    assertEqual(h.indicator.macd.current?.signal.pane, h.indicator.macdPane.current, "MACD signal pane");
    assertEqual(h.indicator.atr.current?.line.pane, h.indicator.atrPane.current, "ATR series pane");

    // Main-pane layers stay on pane 0 (no new pane is created for them).
    h.applyLayers({ supertrend: true, rsiPane: true, macdPane: true, atrPane: true, heikinAshi: true, bollingerBands: true });
    assertEqual(h.indicator.heikinAshi.current?.pane, 0, "Heikin-Ashi stays on the main pane");
    assertEqual(h.indicator.bb.current?.basis.pane, 0, "Bollinger stays on the main pane");
    assertEqual(h.chart.panes().length, 5, "no extra pane for the main-pane layers");
});

// ══════════════════════════════════════════════════════════════════
// 7. Layer reconciliation
// ══════════════════════════════════════════════════════════════════

console.log("Layer reconciliation");

check("initial → enable → disable → enable another → disable first", () => {
    const h = mount();
    const baseline = h.chart.series.length;

    h.applyLayers({});
    assertEqual(h.chart.series.length, baseline, "an all-off layer state creates nothing");
    assertEqual(h.chart.panes().length, 1, "no pane for an empty layer state");

    // enable an indicator
    h.applyLayers({ bollingerBands: true });
    const bb = h.indicator.bb.current;
    assert(bb !== null, "Bollinger created");
    const linesWithBb = seriesOfKind(h, "line").length;

    // …and reconcile it again: the existing series must be reused.
    h.applyLayers({ bollingerBands: true });
    assert(h.indicator.bb.current === bb, "the same Bollinger handle is reused");
    assertEqual(seriesOfKind(h, "line").length, linesWithBb, "no duplicate series accumulated");

    // disable it
    h.applyLayers({});
    assertEqual(h.indicator.bb.current, null, "Bollinger removed when the layer turns off");
    assertEqual(h.chart.series.length, baseline, "series count returned to the baseline");
    assertEqual(h.chart.panes().length, 1, "no pane left behind");

    // enable another indicator
    h.applyLayers({ rsiPane: true });
    assert(h.indicator.rsi.current !== null, "RSI created");
    assertEqual(h.chart.panes().length, 2, "RSI owns one pane");
    assertEqual(h.indicator.rsi.current?.lines.length, 2, "its guides came with it");

    // enable one more while the first stays on → reuse, no duplicates
    const rsi = h.indicator.rsi.current;
    const rsiPane = h.indicator.rsiPane.current;
    h.applyLayers({ rsiPane: true, macdPane: true });
    assert(h.indicator.rsi.current === rsi, "turning MACD on does not recreate RSI");
    assertEqual(h.indicator.rsiPane.current, rsiPane, "the RSI pane is untouched");
    assertEqual(h.chart.panes().length, 3, "MACD appended its own pane");
    assertEqual(seriesOfKind(h, "histogram").length, 1, "no duplicate volume/delta histograms");

    // disable the first indicator again (a no-op reconcile) and then the other
    h.applyLayers({ macdPane: true });
    assertEqual(h.indicator.rsi.current, null, "RSI stays off");
    assert(h.indicator.macd.current !== null, "MACD survives the reconcile");
    h.applyLayers({});
    assertEqual(h.indicator.macd.current, null, "MACD removed");
    assertEqual(h.chart.series.length, baseline, "no renderer series accumulated");
});

check("turning off a later pane leaves the earlier pane intact", () => {
    const h = mount();
    h.applyLayers({ rsiPane: true, macdPane: true });
    const rsi = h.indicator.rsi.current;
    const rsiPane = h.indicator.rsiPane.current;
    assert(h.chart.panes().length === 3, "main + RSI + MACD before the toggle");

    h.applyLayers({ rsiPane: true }); // MACD off, RSI stays on
    assertEqual(h.indicator.macd.current, null, "MACD removed");
    assert(h.indicator.rsi.current === rsi, "RSI is untouched");
    assertEqual(h.indicator.rsiPane.current, rsiPane, "the RSI pane did not move");
    assertEqual(h.chart.panes().length, 2, "main + RSI remain");
});

check("repeated toggling never accumulates series or panes", () => {
    const h = mount();
    const baseline = h.chart.series.length;
    for (let i = 0; i < 3; i++) {
        h.applyLayers({ rsiPane: true, macdPane: true, atrPane: true });
        assertEqual(h.chart.panes().length, 4, "three indicator panes, once each");
        assertEqual(h.indicator.rsi.current !== null && h.indicator.macd.current !== null && h.indicator.atr.current !== null, true, "all three created");
        h.applyLayers({});
        assertEqual(h.chart.panes().length, 1, "panes released on every cycle");
        assertEqual(h.chart.series.length, baseline, "series released on every cycle");
        assertEqual(h.indicator.rsi.current, null, "RSI handle dropped");
    }
});

check("layer toggling changes neither the chart nor the renderer instances", () => {
    const h = mount();
    h.commitCandles(makeCandles(40));
    const chart = h.chart;
    const series = h.series;
    const indicators = h.indicators;
    const viewport = h.viewport;
    const resets = countEvent("viewport.reset");
    h.applyLayers({ bollingerBands: true, rsiPane: true });
    h.applyLayers({ keltnerChannels: true });
    h.applyLayers({});
    assert(h.chart === chart && h.series === series && h.indicators === indicators && h.viewport === viewport,
        "the four authorities are stable across layer churn");
    assertEqual(countEvent("surface.createChart"), 1, "no chart recreation");
    assertEqual(countEvent("viewport.reset"), resets, "no reset from layer churn");
});

// ══════════════════════════════════════════════════════════════════
// 8. Data commit
// ══════════════════════════════════════════════════════════════════

console.log("Data commit");

check("setData writes the requested families and touches nothing else", () => {
    const h = mount();
    const candles = makeCandles(90);
    h.applyLayers({ bollingerBands: true, rsiPane: true, macdPane: true, atrPane: true, stochasticPane: true });
    h.ts.resetCalls();
    const mark = markEvents();

    h.commitIndicators({
        candles,
        bollinger: { basis: alignedValues(90), upper: alignedValues(90, 2), lower: alignedValues(90, -1) },
        rsi: alignedValues(90),
        macd: { macd: alignedValues(90), signal: alignedValues(90, 0.5) },
        atr: alignedValues(90),
        stochastic: { k: alignedValues(90), d: alignedValues(90) },
    });

    const segment = eventsSince(mark);
    assertEqual(segment.filter((e) => e === "indicator.setData").length, 1, "exactly one indicator commit");
    assert(h.indicator.bb.current!.basis.dataCommits > 0, "Bollinger basis received data");
    assert(h.indicator.rsi.current!.rsi.dataCommits > 0, "RSI received data");
    assert(h.indicator.macd.current!.signal.dataCommits > 0, "MACD signal received data");
    assertEqual(viewportCalls(segment), [], "no viewport method was called by the commit");
    assertEqual(h.ts.mutatingCalls(), 0, "no viewport mutation, fit or scroll");
});

check("an indicator data commit performs no market-data fetch", () => {
    const h = mount();
    h.applyLayers({ bollingerBands: true });
    const realFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
        fetchCalls += 1;
        throw new Error("IndicatorRenderer must never fetch");
    }) as unknown as typeof fetch;
    try {
        h.commitIndicators({
            candles: makeCandles(40),
            bollinger: { basis: alignedValues(40), upper: alignedValues(40), lower: alignedValues(40) },
        });
    } finally {
        globalThis.fetch = realFetch;
    }
    assertEqual(fetchCalls, 0, "no fetch during the indicator commit");
});

check("only the families whose series exist are written", () => {
    const h = mount();
    h.applyLayers({ bollingerBands: true });
    const candles = makeCandles(30);
    const before = h.indicator.bb.current!.basis.dataCommits;
    h.commitIndicators({
        candles,
        bollinger: { basis: alignedValues(30), upper: alignedValues(30), lower: alignedValues(30) },
        // rsi/macd/atr families are present but their series do not exist.
        rsi: alignedValues(30),
        macd: { macd: alignedValues(30), signal: alignedValues(30) },
        atr: alignedValues(30),
    });
    assertEqual(h.indicator.bb.current!.basis.dataCommits, before + 1, "the existing family was fed");
    assertEqual(h.indicator.rsi.current, null, "no RSI series was conjured by the data");
    assertEqual(h.indicator.macd.current, null, "no MACD series was conjured by the data");
    assertEqual(h.indicator.atr.current, null, "no ATR series was conjured by the data");
});

// ══════════════════════════════════════════════════════════════════
// 9. Cleanup ordering
// ══════════════════════════════════════════════════════════════════

console.log("Cleanup ordering");

check("teardown runs subscriptions → viewport → series → indicator → chart.remove", () => {
    const h = mount();
    h.commitCandles(makeCandles(150));
    h.applyLayers({ rsiPane: true, macdPane: true });
    h.cleanup();
    h.surfaceCleanup();

    assertBefore("timeScale.unsubscribeRange", "viewport.detach");
    assertBefore("viewport.detach", "series.detach");
    assertBefore("series.detach", "indicator.detach");
    assertBefore("indicator.detach", "surface.clearRef");
    assertBefore("surface.clearRef", "chart.remove");
    assertEqual(countEvent("chart.remove"), 1, "one chart removal");
    assertEqual(countEvent("series.detach"), 1, "one series detach");
    assertEqual(countEvent("indicator.detach"), 1, "one indicator detach");
    assertEqual(countEvent("viewport.detach"), 1, "one viewport detach");
    assertEqual(h.chart.postRemoveMutations, [], "no renderer mutated the chart after chart.remove()");
});

check("detach drops every renderer handle before the chart is gone", () => {
    const h = mount();
    h.commitCandles(makeCandles(80));
    h.applyLayers({ bollingerBands: true, rsiPane: true, macdPane: true, supertrend: true, atrPane: true });
    h.cleanup();
    assertEqual(h.price.candle.current, null, "candle handle cleared");
    assertEqual(h.price.activePrice.current, null, "active price handle cleared");
    assertEqual(h.indicator.bb.current, null, "Bollinger handles cleared");
    assertEqual(h.indicator.rsi.current, null, "RSI handles cleared");
    assertEqual(h.indicator.macd.current, null, "MACD handles cleared");
    assertEqual(h.indicator.supertrend.current, null, "supertrend handles cleared");
    assertEqual(h.indicator.atr.current, null, "ATR handles cleared");
    assert(!h.viewport.isAttached(), "the viewport released its time scale");
});

// ══════════════════════════════════════════════════════════════════
// 10. Double cleanup semantics
// ══════════════════════════════════════════════════════════════════

console.log("Double cleanup");

check("detach is idempotent: a second detach is inert and never throws", () => {
    const h = mount();
    h.commitCandles(makeCandles(60));
    h.applyLayers({ rsiPane: true });
    h.cleanup();
    const after = events.length;

    let threw = false;
    try {
        h.viewport.detach();
        h.series.detach();
        h.indicators.detach();
    } catch {
        threw = true;
    }

    assert(!threw, "a second detach does not throw");
    // Only the three idempotent detach milestones — no chart/series/pane op.
    assertEqual(
        eventsSince(after),
        ["viewport.detach", "series.detach", "indicator.detach"],
        "a second detach performs zero chart operations"
    );
    assertEqual(countEvent("chart.remove"), 0, "detach never removes the chart");
    assertEqual(h.chart.postRemoveMutations, [], "no post-removal mutation");
});

check("chart removal is single-shot (React runs the effect cleanup once)", () => {
    // The renderers above are defensive; ChartSurface's `chart.remove()` is
    // deliberately not. The harness documents that contract instead of
    // inventing a double-remove guarantee the production code does not give.
    assertEqual(SURFACE_CODE.split("chart.remove()").length - 1, 1, "exactly one removal site");
    assert(
        !/if\s*\([^)]*\)\s*return;[^}]*chartRef\.current = null/.test(SURFACE_CODE),
        "ChartSurface intentionally has no double-remove guard"
    );
});

// ══════════════════════════════════════════════════════════════════
// 11. Rerender stability
// ══════════════════════════════════════════════════════════════════

console.log("Rerender stability");

check("mount → data → layer → type → resize leaves no duplicate instances", () => {
    const h = mount();
    const chart = h.chart;
    const viewport = h.viewport;
    const series = h.series;
    const indicators = h.indicators;
    const candles = makeCandles(220);

    h.commitCandles(candles);
    h.syncStudyPane(true);
    h.applyLayers({ bollingerBands: true, rsiPane: true });
    h.commitIndicators({
        candles,
        bollinger: { basis: alignedValues(220), upper: alignedValues(220), lower: alignedValues(220) },
        rsi: alignedValues(220),
    });
    h.commitCandles(makeCandles(220));
    h.applyLayers({ bollingerBands: true, rsiPane: true, macdPane: true });
    h.setChartType("line");
    h.setChartType("area");
    h.resize();
    h.applyLayers({ bollingerBands: true, rsiPane: true, macdPane: true });

    assert(h.chart === chart, "one chart instance");
    assert(h.viewport === viewport, "one ViewportController instance");
    assert(h.series === series, "one SeriesRenderer instance");
    assert(h.indicators === indicators, "one IndicatorRenderer instance");
    assertEqual(countEvent("surface.createChart"), 1, "one createChart");
    assertEqual(countEvent("viewport.attach"), 1, "one viewport attach");
    assertEqual(countEvent("series.attach"), 1, "one series attach");
    assertEqual(countEvent("indicator.attach"), 1, "one indicator attach");
    assertEqual(countEvent("chart.addSeries:candlestick@pane0"), 1, "one primary candle series");
    assertEqual(countEvent("chart.addSeries:histogram@pane0"), 1, "one volume series");
    assertEqual(countEvent("chart.addSeries:area@pane0"), 1, "one area series");
    assertEqual(countEvent("chart.addSeries:bar@pane0"), 1, "one bar series");
    assertEqual(h.indicator.bb.current?.basis.pane, 0, "Bollinger reused, not duplicated");
    assertEqual(h.chart.panes().length, 4, "main + study + RSI + MACD, each exactly once");
    assertEqual(h.chart.postRemoveMutations, [], "nothing mutated after removal");
});

// ══════════════════════════════════════════════════════════════════
// 12. Chart type switching
// ══════════════════════════════════════════════════════════════════

console.log("Chart type switching");

check("candlestick → line → area → baseline → bar → candlestick recreates nothing", () => {
    const h = mount();
    h.commitCandles(makeCandles(120));
    const adds = (): number => eventsStartingWith("chart.addSeries:").length;
    const addsBefore = adds();
    const panesBefore = h.chart.panes().length;
    const commitsBefore = h.price.candle.current!.dataCommits;

    for (const type of ["line", "area", "baseline", "bar", "candlestick"] as ChartType[]) {
        h.setChartType(type);
    }

    assertEqual(adds(), addsBefore, "no series created during the cycle");
    assertEqual(h.chart.panes().length, panesBefore, "no pane created during the cycle");
    assertEqual(countEvent("surface.createChart"), 1, "the chart survived");
    assertEqual(countEvent("viewport.attach"), 1, "the viewport was not recreated");
    assertEqual(countEvent("indicator.syncLayers"), 0, "IndicatorRenderer is not involved in a type switch");
    assertEqual(h.price.candle.current!.dataCommits, commitsBefore, "the candle commit was not repeated");
    assertEqual(h.price.activeType.current, "candlestick", "the active type is published");
});

// ══════════════════════════════════════════════════════════════════
// 13. Historical prepend safety
// ══════════════════════════════════════════════════════════════════

console.log("Historical prepend safety");

check("prepend compensation is viewport-owned and applied exactly once", () => {
    const h = mount();
    const initial = makeCandles(200);
    h.commitCandles(initial);
    h.applyLayers({ bollingerBands: true, rsiPane: true });
    h.commitIndicators({
        candles: initial,
        bollinger: { basis: alignedValues(200), upper: alignedValues(200), lower: alignedValues(200) },
        rsi: alignedValues(200),
    });
    h.setChartType("candlestick");

    const older = makeCandles(120, T0 - 120 * HOUR_SECONDS);
    const combined = [...older, ...initial];
    h.ts.resetCalls();
    const seriesBefore = h.chart.series.length;

    h.commitCandles(combined);

    assertEqual(countEvent("viewport.prependStarted"), 1, "the viewport captured the pre-prepend anchors");
    assertEqual(countEvent("viewport.prependCompleted"), 1, "the viewport applied the compensation");
    assertEqual(h.ts.calls.setVisibleLogicalRange, 1, "exactly one logical-range write for the whole page");
    assertEqual(h.ts.calls.fitContent, 0, "a prepend never fits content");
    assertEqual(h.ts.calls.scrollToRealTime, 0, "a prepend never scrolls to real time");
    assertEqual(h.chart.series.length, seriesBefore, "the prepend created no series");
});

check("renderer data/layer commits make zero viewport calls (boundary proof)", () => {
    const h = mount();
    h.commitCandles(makeCandles(200));
    h.ts.resetCalls();
    const mark = markEvents();

    // Everything a renderer can do, with no viewport sequencing around it.
    h.applyLayers({ bollingerBands: true, rsiPane: true, macdPane: true, supertrend: true, atrPane: true, heikinAshi: true });
    h.commitIndicators({
        candles: makeCandles(200),
        bollinger: { basis: alignedValues(200), upper: alignedValues(200), lower: alignedValues(200) },
        rsi: alignedValues(200),
        macd: { macd: alignedValues(200), signal: alignedValues(200) },
        supertrend: alignedValues(200),
        heikinAshi: { open: alignedValues(200), high: alignedValues(200), low: alignedValues(200), close: alignedValues(200) },
        atr: alignedValues(200),
    });
    h.setChartType("line");
    h.setChartType("bar");

    const segment = eventsSince(mark);
    assertEqual(viewportCalls(segment), [], "the renderers performed no viewport call");
    assertEqual(h.ts.mutatingCalls(), 0, "no fit, no scroll, no logical-range write");
});

// ══════════════════════════════════════════════════════════════════
// 14. Drawing surface (Phase 3E)
// ══════════════════════════════════════════════════════════════════

console.log("Drawing surface");

/** A trendline anchored on two candles of `candles`, in MARKET coordinates. */
const drawingOn = (candles: Candle[], id = "d1", a = 10, b = 40): DrawingItem => ({
    id,
    type: "trendline",
    points: [
        { time: candles[a].timestamp, price: candles[a].close },
        { time: candles[b].timestamp, price: candles[b].close },
    ],
});

check("the drawing renderer attaches after the indicators and before the wiring", () => {
    mount();
    assertBefore("indicator.attach", "drawing.attach");
    assertBefore("drawing.attach", "timeScale.subscribeRange");
    assertBefore("timeScale.subscribeRange", "viewport.subscribe");
});

check("before the chart's data lands a drawing cannot resolve — never pinned to 0", () => {
    const h = mount();
    const d = drawingOn(makeCandles(120));
    const empty = h.renderDrawings([d]);
    assertEqual(empty.drawings, [], "no timestamp resolves on an empty chart axis");
    assertEqual([empty.width, empty.visible], [900, true], "the surface still mounts at its container size");
});

check("a drawing projects from market coordinates once the data is on the chart", () => {
    const h = mount();
    const candles = makeCandles(120);
    h.commitCandles(candles);
    const scene = h.renderDrawings([drawingOn(candles)]);
    assertEqual(scene.drawings.length, 1, "one visual");
    const v = scene.drawings[0];
    assert(v.kind === "trendline", "a trendline");
    // x = index × barSpacing; y = 600 − price (the mock's own price axis).
    assertEqual([v.x1, v.y1], [10 * h.ts.barSpacing, 600 - candles[10].close], "anchored on candle 10");
    assertEqual([v.x2, v.y2], [40 * h.ts.barSpacing, 600 - candles[40].close], "through candle 40");
    assertEqual(v.id, "d1", "identity is the drawing id");
});

check("pan, zoom and resize re-derive the pixels from the chart — never from a cache", () => {
    const h = mount();
    const candles = makeCandles(120);
    h.commitCandles(candles);
    const d = drawingOn(candles);
    const before = h.renderDrawings([d]).drawings[0];
    assert(before.kind === "trendline", "trendline");

    // Zoom: the time scale's own bar spacing changes (whatever the initial
    // fit settled on, doubled here).
    h.ts.barSpacing = h.ts.barSpacing * 2;
    const zoomed = h.renderDrawings([d]).drawings[0];
    assert(zoomed.kind === "trendline", "trendline");
    assertEqual(zoomed.x1, before.x1 * 2, "the x followed the new bar spacing");

    // Pan: the whole index space shifts horizontally.
    h.ts.xShift = -160;
    const panned = h.renderDrawings([d]).drawings[0];
    assert(panned.kind === "trendline", "trendline");
    assertEqual(panned.x1, zoomed.x1 - 160, "the x followed the pan");

    // Resize: the container metrics are re-read, the anchors are untouched.
    const wide = h.renderDrawings([d], { width: 1400 });
    assertEqual(wide.width, 1400, "the surface reports the new width");
    assertEqual(wide.drawings, h.renderDrawings([d]).drawings, "a resize never moves a market anchor");
});

check("the drawing pass touches no viewport state (boundary proof)", () => {
    const h = mount();
    const candles = makeCandles(160);
    h.commitCandles(candles);
    h.ts.resetCalls();
    const mark = markEvents();

    h.renderDrawings([drawingOn(candles)]);
    h.renderDrawings([drawingOn(candles)], { selectedDrawingId: "d1" });
    h.renderDrawings([drawingOn(candles)], {
        preview: { tool: "trendline", startX: 5, startY: 6, startPrice: 1, startTime: 0, curX: 55, curY: 66 },
    });

    assertEqual(viewportCalls(eventsSince(mark)), [], "the drawing surface performed no viewport call");
    assertEqual(h.ts.mutatingCalls(), 0, "no fit, no scroll, no logical-range write");
});

check("historical prepend keeps the drawing on its market anchor (no second compensation)", () => {
    const h = mount();
    const initial = makeCandles(200);
    h.commitCandles(initial);
    const d = drawingOn(initial, "d1", 50, 90);
    const before = h.renderDrawings([d]).drawings[0];
    assert(before.kind === "trendline", "trendline");

    const older = makeCandles(120, T0 - 120 * HOUR_SECONDS);
    h.commitCandles([...older, ...initial]);
    assertEqual(countEvent("viewport.prependStarted"), 1, "the viewport owned the prepend compensation");

    const after = h.renderDrawings([d]).drawings[0];
    assert(after.kind === "trendline", "still a trendline");
    // The prepended page pushed the anchors 120 bars along in index space; the
    // x is the chart's own answer for the UNCHANGED timestamp, so the renderer
    // added no compensation of its own on top of the viewport's.
    assertEqual(after.x1, (50 + 120) * h.ts.barSpacing, "the anchor followed the candles, not a manual offset");
    assertEqual(after.y1, before.y1, "the price anchor is untouched by a prepend");
});

check("an unresolvable drawing is hidden, persists, and returns by itself", () => {
    const h = mount();
    const candles = makeCandles(120);
    h.commitCandles(candles);
    const d = drawingOn(candles);
    const frozen = JSON.stringify(d);

    // Timeframe switch: the chart now holds bars on a different time axis.
    h.commitCandles(makeCandles(120, T0 + 1000 * HOUR_SECONDS), "BTCUSD|M5");
    assertEqual(h.renderDrawings([d]).drawings, [], "hidden while the timestamps do not resolve");
    assertEqual(JSON.stringify(d), frozen, "the drawing's market data was never mutated");

    // Back on the original context the same object renders again, unassisted.
    h.commitCandles(candles, "BTCUSD|H1");
    assertEqual(h.renderDrawings([d]).drawings.length, 1, "it renders again once resolvable");
});

check("selection and the live preview are visual state only", () => {
    const h = mount();
    const candles = makeCandles(120);
    h.commitCandles(candles);
    const d = drawingOn(candles);

    const plain = h.renderDrawings([d]);
    const selected = h.renderDrawings([d], { selectedDrawingId: "d1" });
    assertEqual(plain.selection, null, "nothing selected");
    assertEqual(selected.drawings, plain.drawings, "selection never changes the drawing geometry");
    assert(selected.selection !== null, "the selection outline appears");
    assertEqual(
        h.drawingScreenPosition(d),
        { x1: 10 * h.ts.barSpacing, y1: 600 - candles[10].close, x2: 40 * h.ts.barSpacing, y2: 600 - candles[40].close },
        "the parent's HTML overlay anchor matches the painted geometry"
    );

    const preview = h.renderDrawings([d], {
        preview: { tool: "rectangle", startX: 5, startY: 6, startPrice: 1, startTime: 0, curX: 55, curY: 66 },
    }).preview;
    assert(preview !== null && preview.kind === "rectangle", "the preview projects in pixel space");
    assertEqual([preview.x, preview.y, preview.w, preview.h], [5, 6, 50, 60], "with the parent's drag rectangle");
});

check("detach clears the drawing surface and stops reading the chart", () => {
    const h = mount();
    const candles = makeCandles(120);
    h.commitCandles(candles);
    const d = drawingOn(candles);
    const candle = h.price.candle.current;
    assert(candle !== null, "the candle series exists");
    h.renderDrawings([d]);
    const reads = candle.coordinateReads;
    const timeReads = h.ts.coordinateReads;

    h.cleanup();
    assert(!h.drawing.isAttached(), "the drawing renderer released the chart");

    h.renderDrawings([d]);
    assertEqual(h.drawing.scene().drawings, [], "the surface is empty after detach");
    assertEqual(candle.coordinateReads, reads, "no price read after the detach");
    assertEqual(h.ts.coordinateReads, timeReads, "no time read after the detach");
    assertEqual(h.chart.postRemoveMutations, [], "the drawing surface mutated nothing");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
