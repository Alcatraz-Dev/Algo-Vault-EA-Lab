/**
 * Pro Scalping Terminal — self-verifying checks for the pure modules.
 *
 * The repo has no global test-runner install (bare describe/it files elsewhere
 * under tests/ are not type-clean either), so this suite is a standalone
 * runnable: `npx jiti tests/pro-scalping-terminal.test.ts` executes every
 * check and exits non-zero on the first failure. The pure modules under test
 * are exactly the ones the terminal UI depends on.
 */

import {
    computeJournalAnalytics,
    fmtPrice,
    parseTrades,
    positionSize,
    sessionState,
    type TerminalTrade,
} from "../components/pro-scalping-terminal/terminal-utils";
import { CHART_LAYERS, LAYER_REQUIREMENTS, defaultLayerState } from "../components/pro-scalping-terminal/chart-layers";
import {
    INDICATOR_PARAMS,
    defaultIndicatorParams,
    hasIndicatorParams,
    indicatorLabel,
    indicatorParamSpecs,
    isIndicatorCustomised,
    mergeIndicatorSettings,
    resolveIndicatorParams,
    withAlpha,
    withIndicatorParam,
    withoutIndicatorParams,
} from "../components/pro-scalping-terminal/indicator-params";
import {
    AI_DECISION_FRESH_MS,
    candelActionRequest,
    candelObservations,
    candelObservationType,
    isFreshLlmDecision,
    terminalAiStatus,
} from "../components/pro-scalping-terminal/terminal-ai-status";
import type { TerminalIntelligencePayload } from "../components/pro-scalping-terminal/IntelligencePanel";
import { executePine } from "../lib/pine-runtime/runtime";
import type { PineExecutionResult } from "../lib/pine-runtime/runtime";
import { TA } from "../lib/pine-runtime/builtins";
import {
    createPineSource as buildPineFromVisual,
    CONDITION_PREREQUISITES,
    DEFAULT_VISUAL_EDGES,
    DEFAULT_VISUAL_NODES,
    VISUAL_NODE_LIBRARY,
    type VisualEdge,
    type VisualNode,
} from "../components/tradingview/visual-builder";

/** Deterministic synthetic series: ramp up, then dump — exercises trend flips. */
const CANDLES = Array.from({ length: 120 }, (_, i) => {
    const drift = i < 80 ? i * 0.5 : 40 - (i - 80) * 1.2;
    const wave = Math.sin(i / 3) * 1.5;
    const close = 100 + drift + wave;
    return {
        time: 1_700_000_000 + i * 900,
        open: close - 0.4,
        high: close + 1.2,
        low: close - 1.2,
        close,
        volume: 1000 + (i % 7) * 120,
    };
});

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

console.log("Terminal price formatting");
check("uses broker-style digits per symbol family", () => {
    assertEqual(fmtPrice(2358.4, "XAUUSD"), "2358.40");
    assertEqual(fmtPrice(1.084523, "EURUSD"), "1.08452");
    assertEqual(fmtPrice(155.3216, "USDJPY"), "155.322");
    assertEqual(fmtPrice(20120.123, "NAS100"), "20120.12");
});
check("renders em-dash for missing values instead of a fabricated number", () => {
    assertEqual(fmtPrice(null, "EURUSD"), "—");
    assertEqual(fmtPrice(undefined, "EURUSD"), "—");
    assertEqual(fmtPrice(Number.NaN, "EURUSD"), "—");
});

console.log("Session state");
check("marks the active UTC windows and names the overlap", () => {
    // 2026-09-23 is a Wednesday; 14:00 UTC is London + NY + overlap.
    const wed = sessionState(Date.UTC(2026, 8, 23, 14, 0));
    const byKey = new Map(wed.rows.map((r) => [r.key, r]));
    assert(byKey.get("london")?.active === true, "London should be active at 14:00 UTC");
    assert(byKey.get("new_york")?.active === true, "NY should be active at 14:00 UTC");
    assert(byKey.get("overlap")?.active === true, "Overlap should be active at 14:00 UTC");
    assert(byKey.get("asian")?.active === false, "Asia should be closed at 14:00 UTC");
    assertEqual(wed.weekend, false);
    assertEqual(wed.activeLabel, "London / NY overlap");
});
check("flags the weekend with a positive Asia-open countdown", () => {
    // 2026-09-26 is a Saturday.
    const sat = sessionState(Date.UTC(2026, 8, 26, 12, 0));
    assertEqual(sat.weekend, true);
    assertEqual(sat.activeLabel, "Weekend — market closed");
    assertEqual(sat.nextEventLabel, "Asia opens");
    assert((sat.nextEventInMin ?? 0) > 0, "Countdown to Monday open should be positive");
});
check("always reports a next event during the week", () => {
    const st = sessionState(Date.UTC(2026, 8, 23, 3, 30)); // Asia, Wednesday
    assert(st.nextEventInMin !== null, "nextEventInMin should be set");
    assert((st.nextEventInMin as number) > 0, "Countdown should be positive");
});

console.log("Journal parsing and analytics");
const trades: TerminalTrade[] = [
    { id: "1", symbol: "XAUUSD", direction: "long", setup: "Sweep", result: "win", r: 2.0, createdAt: 1, session: "NY", timeframe: "M5" },
    { id: "2", symbol: "XAUUSD", direction: "long", setup: "Sweep", result: "loss", r: -1.0, createdAt: 2, session: "NY", timeframe: "M5" },
    { id: "3", symbol: "EURUSD", direction: "long", setup: "FVG", result: "win", r: 1.5, createdAt: 3, session: "London", timeframe: "M1" },
];
check("derives win rate over decided trades and real R sums", () => {
    const a = computeJournalAnalytics(trades);
    assertEqual(a.total, 3);
    assert(a.winRate !== null && Math.abs(a.winRate - 66.666) < 0.1, `winRate ${a.winRate} should be ~66.7`);
    assert(a.netR !== null && Math.abs(a.netR - 2.5) < 1e-9, `netR ${a.netR} should be 2.5`);
    assert(a.profitFactor !== null && Math.abs(a.profitFactor - 3.5) < 1e-9, `profitFactor ${a.profitFactor} should be 3.5`);
    assertEqual(a.best, 2.0);
    assertEqual(a.worst, -1.0);
});
check("tracks the current streak from the newest entry", () => {
    assertEqual(computeJournalAnalytics(trades).streak, { kind: "win", count: 1 });
});
check("groups by setup with per-group net R", () => {
    const sweep = computeJournalAnalytics(trades).bySetup.find((b) => b.key === "Sweep");
    assertEqual(sweep?.n, 2);
    assert(sweep && Math.abs(sweep.netR - 1.0) < 1e-9, `sweep netR ${sweep?.netR} should be 1.0`);
});
check("returns null metrics on an empty journal instead of zeros", () => {
    const a = computeJournalAnalytics([]);
    assertEqual(a.total, 0);
    assertEqual(a.winRate, null);
    assertEqual(a.netR, null);
    assertEqual(a.streak, null);
});
check("parses raw API records and skips unlabelled rows", () => {
    const raw = [
        { id: "a", symbol: "XAUUSD", result: "WIN", resultR: 2.1, createdAt: 10 },
        { id: "b", symbol: "BTCUSD", outcome: "LOSS", r: -0.8 },
        { id: "c", symbol: "EURUSD", note: "no result yet" },
        null,
    ];
    const parsed = parseTrades(raw);
    assertEqual(parsed.length, 2);
    assertEqual(parsed[0].result, "win");
    assert(parsed[0].r !== null && Math.abs(parsed[0].r - 2.1) < 1e-9, "first trade R should be 2.1");
    assertEqual(parsed[1].result, "loss");
});

console.log("Position sizing");
check("sizes a long from balance, risk % and stop distance", () => {
    const s = positionSize(10_000, 1, 2358.5, 2350.0, "XAUUSD");
    assert(s !== null, "sizing should resolve");
    if (!s) return;
    assert(Math.abs(s.riskAmount - 100) < 1e-9, "risk amount should be 100");
    assert(Math.abs(s.stopDistance - 8.5) < 1e-9, "stop distance should be 8.5");
    assert(Math.abs(s.lots - 100 / (8.5 * 100)) < 1e-9, "lots should be risk / (distance × 100 oz)");
});
check("refuses degenerate inputs instead of returning a size", () => {
    assertEqual(positionSize(0, 1, 100, 90, "EURUSD"), null);
    assertEqual(positionSize(10_000, 0, 100, 90, "EURUSD"), null);
    assertEqual(positionSize(10_000, 1, 100, 100, "EURUSD"), null);
    assertEqual(positionSize(Number.NaN, 1, 100, 90, "EURUSD"), null);
});

console.log("Pine runtime — new TA math + apply-to-chart chain");
check("tuple destructuring binds ta.macd outputs (regression: was silently dropped)", () => {
    const r = executePine(
        `//@version=6\nindicator("t", overlay=false)\n[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)\nplot(macdLine, title="macd")\nplot(signalLine, title="signal")`,
        CANDLES
    );
    assertEqual(r.errors, []);
    const macd = r.plots.find((p) => p.title === "macd");
    const signal = r.plots.find((p) => p.title === "signal");
    assert(macd && macd.values.some((v) => v !== null && v !== 0), "macd plot should carry real MACD values");
    assert(signal && signal.values.some((v) => v !== null), "signal plot should carry values");
    assert(macd && signal && !macd.values.every((v, i) => v === signal.values[i]), "macd and signal must differ (was close-fallback before)");
});
check("ta.supertrend flips direction and hugs the trailing band", () => {
    const [line, dir] = TA.supertrend(
        CANDLES.map((c) => c.high),
        CANDLES.map((c) => c.low),
        CANDLES.map((c) => c.close),
        10,
        3
    );
    assert(line.length === CANDLES.length && dir.length === CANDLES.length, "outputs align 1:1 with candles");
    assert(dir.some((d) => d === 1) && dir.some((d) => d === -1), "trend should flip on the synthetic ramp+dump");
    const last = CANDLES.length - 1;
    assert(Number.isFinite(line[last]), "last supertrend value is finite");
    if (dir[last] === 1) assert(line[last] <= CANDLES[last].high, "in an uptrend the line trails below price");
    if (dir[last] === -1) assert(line[last] >= CANDLES[last].low, "in a downtrend the line trails above price");
});
check("ta.keltner / ta.donchian / ta.willr produce aligned, bounded series", () => {
    const [kcMid, kcUp, kcLow] = TA.keltner(
        CANDLES.map((c) => c.high),
        CANDLES.map((c) => c.low),
        CANDLES.map((c) => c.close),
        20,
        2
    );
    const idx = 100;
    assert(kcUp[idx] > kcMid[idx] && kcMid[idx] > kcLow[idx], "Keltner bands must bracket the midline");
    const [dcUp, dcLow, dcMid] = TA.donchian(
        CANDLES.map((c) => c.high),
        CANDLES.map((c) => c.low),
        20
    );
    assert(dcUp[idx] >= dcMid[idx] && dcMid[idx] >= dcLow[idx], "Donchian upper ≥ mid ≥ lower");
    const wr = TA.willr(
        CANDLES.map((c) => c.high),
        CANDLES.map((c) => c.low),
        CANDLES.map((c) => c.close),
        14
    );
    assert(wr[idx] <= 0 && wr[idx] >= -100, `Williams %R ${wr[idx]} must sit in [−100, 0]`);
});
check("ta.fisher stays finite and ta.cmf is bounded (−1, 1)", () => {
    const [fisher] = TA.fisherTransform(
        CANDLES.map((c) => c.high),
        CANDLES.map((c) => c.low),
        9
    );
    assert(fisher.slice(9).every((v) => Number.isFinite(v)), "Fisher values are finite (clamp works)");
    const cmfVals = TA.cmf(
        CANDLES.map((c) => c.high),
        CANDLES.map((c) => c.low),
        CANDLES.map((c) => c.close),
        CANDLES.map((c) => c.volume),
        20
    );
    assert(cmfVals[100] > -1 && cmfVals[100] < 1, "CMF must stay within (−1, 1)");
});
check("history index resolves one bar back (dcUpper[1] semantics)", () => {
    const r = executePine(
        `//@version=6\nindicator("t", overlay=false)\nprevClose = close\nprev = prevClose[1]\nplot(prev, title="prev")`,
        CANDLES
    );
    const prev = r.plots.find((p) => p.title === "prev");
    assert(prev && prev.values[10] === CANDLES[9].close, "close[1] at bar 10 equals bar 9 close");
});
check("apply-to-chart chain: generated visual Pine executes with real plots", () => {
    const source = buildPineFromVisual(DEFAULT_VISUAL_NODES, DEFAULT_VISUAL_EDGES);
    assert(source.includes("ta.ema(close, 20)"), "generator emits the EMA study");
    assert(source.includes("ta.crossover(fastMa, slowMa)"), "generator emits the crossover condition");
    const r = executePine(source, CANDLES);
    assertEqual(r.errors, []);
    assert(r.plots.length >= 2, `default graph should plot both MAs, got ${r.plots.length}`);
    const fast = r.plots.find((p) => p.title === "Fast MA");
    assert(fast && fast.values.some((v) => v !== null && Number.isFinite(v)), "Fast MA plot has finite values");
});
check("every library node kind emits runtime-executable Pine", () => {
    for (const entry of VISUAL_NODE_LIBRARY) {
        const node: VisualNode = { id: `n_${entry.kind}`, kind: entry.kind, x: 0, y: 0 };
        const edges: VisualEdge[] = [
            { from: "price", to: `n_${entry.kind}` },
            { from: `n_${entry.kind}`, to: "entry" },
        ];
        const nodes: VisualNode[] = [
            { id: "price", kind: "price", x: 0, y: 0 },
            node,
            { id: "entry", kind: "long_entry", x: 0, y: 0 },
        ];
        // Condition nodes bring their prerequisite studies into the graph so
        // the generated condition references declared series only.
        for (const req of CONDITION_PREREQUISITES[entry.kind] ?? []) {
            nodes.push({ id: `req_${req}`, kind: req, x: 0, y: 0 });
            edges.push({ from: "price", to: `req_${req}` });
            edges.push({ from: `req_${req}`, to: `n_${entry.kind}` });
        }
        const source = buildPineFromVisual(nodes, edges);
        const r = executePine(source, CANDLES);
        assertEqual(r.errors, []);
        // "Real" means either a declared study series, an inline ta.* condition,
        // or a pure logic/execution node that intentionally has no series.
        const declaresStudy = /\w+\s*=\s*[^\n]*\bta\./.test(source) || /=\s*volume\b/.test(source) || (source.includes("[") && source.includes("] = ta."));
        const inlineTaCondition = /if [^\n]*\bta\./.test(source);
        assert(
            r.plots.length > 0 || declaresStudy || inlineTaCondition || entry.category === "Market Data" || entry.category === "Execution" || entry.category === "Risk" || entry.kind === "and",
            `node ${entry.kind} should introduce drawable output or declare a real study`
        );
    }
});
check("strategy graph emits strategy.entry and a risk-managed exit", () => {
    const source = buildPineFromVisual(
        [
            { id: "p", kind: "price", x: 0, y: 0 },
            { id: "ma", kind: "moving_average", x: 0, y: 0 },
            { id: "x", kind: "crossover", x: 0, y: 0 },
            { id: "e", kind: "long_entry", x: 0, y: 0 },
            { id: "r", kind: "risk_manager", x: 0, y: 0 },
        ],
        [
            { from: "p", to: "ma" },
            { from: "ma", to: "x" },
            { from: "x", to: "e" },
            { from: "e", to: "r" },
        ]
    );
    assert(source.includes("strategy.entry"), "long entry is emitted");
    assert(source.includes("strategy.exit"), "risk manager is emitted");
    const r = executePine(source, CANDLES);
    assertEqual(r.errors, []);
    assert(r.strategy !== null, "runtime recognises the strategy");
});
check("keltner squeeze condition compiles through the full chain", () => {
    const nodes: VisualNode[] = [
        { id: "p", kind: "price", x: 0, y: 0 },
        { id: "bb", kind: "bollinger", x: 0, y: 0 },
        { id: "kc", kind: "keltner", x: 0, y: 0 },
        { id: "sq", kind: "kc_squeeze", x: 0, y: 0 },
        { id: "e", kind: "long_entry", x: 0, y: 0 },
        { id: "pl", kind: "plot", x: 0, y: 0 },
    ];
    const edges: VisualEdge[] = [
        { from: "p", to: "bb" },
        { from: "p", to: "kc" },
        { from: "bb", to: "sq" },
        { from: "kc", to: "sq" },
        { from: "sq", to: "e" },
    ];
    const source = buildPineFromVisual(nodes, edges);
    assert(source.includes("bbUpper < kcUpper"), "squeeze condition emitted");
    const r = executePine(source, CANDLES);
    assertEqual(r.errors, []);
    assert(r.plots.length >= 4, "BB + KC studies are plotted");
});

console.log("Chart layer vocabulary");
check("exposes every layer id in the default state map", () => {
    const state = defaultLayerState();
    for (const layer of CHART_LAYERS) {
        assert(typeof state[layer.id] === "boolean", `layer ${layer.id} missing from default state`);
    }
});
check("does not default-on an unavailable layer", () => {
    for (const layer of CHART_LAYERS) {
        if (!layer.available) assertEqual(layer.defaultOn, false);
    }
});
check("every unavailable or estimated layer documents an inline unlock explanation", () => {
    for (const layer of CHART_LAYERS) {
        const req = LAYER_REQUIREMENTS[layer.id];
        if (!layer.available) {
            assert(req !== undefined, `unavailable layer ${layer.id} missing from LAYER_REQUIREMENTS (picker would show a dead chip)`);
            assert(req!.reason.length > 20, `${layer.id}: reason must be a real explanation`);
            assert(req!.unlock.length > 5, `${layer.id}: unlock must name the data class`);
            assert(req!.sources.length > 5, `${layer.id}: sources must name concrete feeds`);
        } else if (req !== undefined) {
            assertEqual(req.estimated, true, `available layer ${layer.id} may only carry an estimated-flag entry`);
        }
    }
});

console.log("Indicator parameter schema");
check("parametric layers resolve exactly the shipped defaults", () => {
    // An untouched workspace must compute what it computed before settings
    // existed — the resolved defaults ARE the old literals.
    assertEqual(resolveIndicatorParams("bollingerBands", null), { period: 20, mult: 2, color: "#60a5fa", lineWidth: 1 });
    assertEqual(resolveIndicatorParams("rsiPane", null), { period: 14, upper: 70, lower: 30, color: "#c084fc", lineWidth: 1 });
    assertEqual(resolveIndicatorParams("ema9", null), { period: 9, color: "#38bdf8", lineWidth: 1 });
    assertEqual(defaultIndicatorParams("adxPane"), { period: 14, color: "#38bdf8", lineWidth: 1 });
    assertEqual(defaultIndicatorParams("awesomeOscillator"), { fast: 5, slow: 34 });
    assertEqual(defaultIndicatorParams("ichimokuCloud"), { tenkan: 9, kijun: 26, senkouB: 52 });
});
check("the settings gear exists only for identity-colour indicators", () => {
    for (const id of [
        "vwap", "ema9", "ema20", "ema50", "ema200", "sma20", "sma50", "sma200", "wma",
        "bollingerBands", "keltnerChannels", "donchianChannels", "supertrend", "ichimokuCloud",
        "rsiPane", "macdPane", "stochasticPane", "atrPane", "adxPane", "awesomeOscillator", "obvPane",
    ] as const) {
        assert(hasIndicatorParams(id), `${id} should expose a settings gear`);
    }
    // Semantic-colour layers carry meaning in their colour — no fake controls.
    for (const id of [
        "supportResistance", "fvg", "orderBlocks", "sessionLevels", "dailyPivots",
        "parabolicSar", "heikinAshi", "delta", "volumeProfile", "poc",
    ] as const) {
        assert(!hasIndicatorParams(id), `${id} must expose NO gear (semantic colour)`);
    }
    // Signed histograms take no colour input either.
    assert(indicatorParamSpecs("awesomeOscillator").every((s) => s.kind === "number"), "AO exposes lengths only");
});
check("edits round-trip: clamp, store, relabel, reset-to-default drops the key", () => {
    let s = withIndicatorParam({}, "ema9", "period", 55);
    assertEqual(s, { ema9: { period: 55 } });
    assert(isIndicatorCustomised("ema9", s), "an edited layer reads as customised");
    assertEqual(indicatorLabel("ema9", "EMA 9", s), "EMA 55", "chip label follows the chart");
    s = withIndicatorParam(s, "ema9", "period", 9);
    assertEqual(s, {}, "returning to the default drops the stored override");
    assert(!isIndicatorCustomised("ema9", s), "default == absent");
    assertEqual(indicatorLabel("ema9", "EMA 9", s), "EMA 9");
    assertEqual(withoutIndicatorParams({ ema9: { period: 55 }, wma: { period: 30 } }, "ema9"), { wma: { period: 30 } });
    assertEqual(indicatorLabel("obvPane", "OBV", { obvPane: { color: "#ffffff" } }), "OBV", "labels without a period never change");
});
check("out-of-range and non-finite inputs clamp onto the spec", () => {
    assertEqual(withIndicatorParam({}, "bollingerBands", "mult", 0.1), { bollingerBands: { mult: 0.5 } }, "min clamp");
    assertEqual(withIndicatorParam({}, "bollingerBands", "mult", 99), { bollingerBands: { mult: 10 } }, "max clamp");
    assertEqual(withIndicatorParam({}, "bollingerBands", "mult", 2.34567), { bollingerBands: { mult: 2.3 } }, "step snap");
    assertEqual(withIndicatorParam({}, "rsiPane", "upper", 400), { rsiPane: { upper: 100 } });
    assertEqual(withIndicatorParam({}, "ema9", "period", -50), { ema9: { period: 1 } });
    assertEqual(withIndicatorParam({}, "bollingerBands", "mult", Number.NaN), {}, "non-finite reads as the default ⇒ nothing stored");
});
check("corrupt persisted settings are sanitised on load", () => {
    const merged = mergeIndicatorSettings({
        ema9: { period: 9999 }, // clamped to 500 → kept as an override
        bollingerBands: { period: 20, mult: 2, color: "#60a5fa", lineWidth: 1 }, // all defaults → dropped
        supportResistance: { color: "#fff" }, // no schema → dropped
        keltnerChannels: "nope", // not an object → dropped
        unknownLayer: { period: 7 }, // no schema → dropped
    });
    assertEqual(merged, { ema9: { period: 500 } });
    assertEqual(mergeIndicatorSettings(null), {});
    assertEqual(mergeIndicatorSettings("junk"), {});
});
check("withAlpha renders a colour at the requested opacity", () => {
    assertEqual(withAlpha("#38bdf8", 55), "rgba(56, 189, 248, 0.55)");
    assertEqual(withAlpha("#abc", 50), "rgba(170, 187, 204, 0.5)");
    assertEqual(withAlpha("rgba(34, 211, 238, 0.5)", 100), "rgba(34, 211, 238, 1)");
    assertEqual(withAlpha("hsl(0 0% 0%)", 50), "hsl(0 0% 0%)", "unknown formats pass through unchanged");
});
check("the schema never offers a colour input where colour is semantic", () => {
    for (const [id, specs] of Object.entries(INDICATOR_PARAMS)) {
        if (id === "awesomeOscillator" || id === "ichimokuCloud") continue;
        assert(
            specs.some((s) => s.kind === "color"),
            `${id} should offer exactly the identity colour inputs it draws`
        );
    }
    assert(
        INDICATOR_PARAMS.ichimokuCloud!.every((s) => s.kind === "number"),
        "Ichimoku cloud spans keep their fixed bullish/bearish hues"
    );
});

console.log("AI status chip — truthful live status");
check("a fresh LLM decision is recognised only inside the window", () => {
    const now = 1_700_000_000_000;
    assert(isFreshLlmDecision(now - 5_000, now), "a 5s-old decision is fresh spend");
    assert(isFreshLlmDecision(now - AI_DECISION_FRESH_MS, now), "the boundary counts as fresh");
    assert(!isFreshLlmDecision(now - AI_DECISION_FRESH_MS - 1, now), "older than the window is a cache hit");
    assert(!isFreshLlmDecision(null, now), "no cachedAt ⇒ not counted");
    assert(!isFreshLlmDecision(now, null), "no receipt time ⇒ cannot judge");
    assert(!isFreshLlmDecision(0, now), "epoch-0 means absent");
    assert(isFreshLlmDecision(now + 2_000, now), "client clock behind the server still reads fresh");
});
check("no AI activity reports a deterministic status with both sides named", () => {
    const s = terminalAiStatus({ llmDecisions: 0, candelCalls: 0, aiDrawEnabled: false, decisionLayer: "ok" });
    assertEqual(s.tone, "neutral");
    assert(s.label.includes("Deterministic") && s.label.includes("0 AI calls"), s.label);
    assertEqual(s.totalCalls, 0);
    assertEqual(s.aiActive, false);
    assert(s.tooltip.includes("no LLM calls"), "tooltip states the core is LLM-free");
    assert(s.tooltip.includes("Intelligence decision panel") && s.tooltip.includes("Candel"), "tooltip names the AI-backed surfaces");
});
check("every real AI call is counted and surfaces in the label", () => {
    const one = terminalAiStatus({ llmDecisions: 1, candelCalls: 0, aiDrawEnabled: false, decisionLayer: "ok" });
    assertEqual(one.tone, "info");
    assertEqual(one.label, "AI assist · 1 call");
    assertEqual(one.totalCalls, 1);
    const many = terminalAiStatus({ llmDecisions: 1, candelCalls: 2, aiDrawEnabled: true, decisionLayer: "ok" });
    assertEqual(many.label, "AI assist · 3 calls");
    assertEqual(many.totalCalls, 3);
    assert(many.tooltip.includes("AI Draw armed"), many.tooltip);
    assert(many.tooltip.includes("1 fresh LLM decision"), many.tooltip);
});
check("AI Draw armed with zero spend reads as armed, not as spend", () => {
    const s = terminalAiStatus({ llmDecisions: 0, candelCalls: 0, aiDrawEnabled: true, decisionLayer: "loading" });
    assertEqual(s.tone, "info");
    assertEqual(s.label, "AI Draw on · 0 calls");
    assertEqual(s.totalCalls, 0);
});
check("activity that cannot be verified surfaces as a warning, never hidden", () => {
    const s = terminalAiStatus({ llmDecisions: 2, candelCalls: 0, aiDrawEnabled: false, decisionLayer: "unavailable" });
    assertEqual(s.tone, "warning");
    assert(s.label.includes("unknown"), s.label);
    assert(s.tooltip.includes("unreachable"), "tooltip explains why it is unverified");
    assert(s.tooltip.includes("no LLM calls"), "the deterministic half is still named");
});

console.log("Candel — quick actions and observation honesty");
check("every quick action maps to a free-tier task carrying real context", () => {
    const PRO_ONLY = ["DEEP_STRATEGY_RESEARCH", "LONG_CONTEXT_RESEARCH", "HYPOTHESIS_GENERATION"];
    for (const key of ["market", "setup", "structure", "risk", "move", "position", "compare", "proposal"]) {
        const req = candelActionRequest(`quick: ${key}`, "XAUUSD", "M5");
        assert(req !== null, `quick: ${key} must resolve`);
        assert(!PRO_ONLY.includes(req!.task), `${key} must not dead-end on a Pro-only task`);
        assert(req!.question.includes("XAUUSD") && req!.question.includes("M5"), `${key} question carries symbol/timeframe`);
    }
    assertEqual(candelActionRequest("quick: market", "XAUUSD", "M5")!.task, "FAST_MARKET_CLASSIFICATION");
    assertEqual(candelActionRequest("nonsense: x", "XAUUSD", "M5"), null, "unknown actions are dropped, never fabricated");
});
check("decision factors are classified honestly for the panel", () => {
    assertEqual(candelObservationType("market_facts"), "fact");
    assertEqual(candelObservationType("deterministic"), "fact");
    assertEqual(candelObservationType("policy"), "limitation");
    assertEqual(candelObservationType("llm"), "interpretation");
    assertEqual(candelObservationType("jev"), "interpretation");
    assertEqual(candelObservationType("memory"), "interpretation");
});
check("observations map from the payload and vanish with it", () => {
    const payload: TerminalIntelligencePayload = {
        success: true,
        symbol: "XAUUSD",
        timeframe: "M5",
        decision: {
            state: "READY",
            direction: "long",
            confidence: 0.8,
            rationale: "…",
            factors: [
                { source: "market_facts", label: "Trend", value: "up" },
                { source: "llm", label: "Read", value: "fresh demand" },
            ],
            jev: null,
            llm: null,
            validationStatus: "ok",
        },
        cachedAt: 1,
    };
    const obs = candelObservations(payload);
    assertEqual(obs.length, 2);
    assertEqual(obs[0], { type: "fact", text: "Trend — up" });
    assertEqual(obs[1], { type: "interpretation", text: "Read — fresh demand" });
    assertEqual(candelObservations(null), []);
    assertEqual(candelObservations({ success: false, symbol: "X", timeframe: "M5", decision: null }), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
