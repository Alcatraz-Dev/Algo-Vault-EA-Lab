/**
 * AlgoVault Bot Studio — Comprehensive Unit Tests
 *
 * Covers:
 *   1. Magic number derivation determinism & bounds
 *   2. Lifecycle state machine transitions & guards
 *   3. Visual graph compiler: valid graph -> canonical strategy
 *   4. Visual graph compiler: missing actions -> diagnostics
 *   5. AvScript compiler: valid source -> canonical strategy
 *   6. AvScript compiler: forbidden patterns / size guards
 */

import { deriveMagicNumber, isBotStudioMagicNumber } from "../magic-numbers";
import { canTransitionTo, validateTransition } from "../lifecycle";
import { compileNodeGraph } from "../compiler/visual-to-strategy";
import { compileAvScript } from "../compiler/avscript-to-strategy";
import type { NodeGraph } from "../compiler/types";
import { backtestStrategy, defaultBacktestConfig } from "@/lib/strategy-lab/backtest";
import type { MarketCandle } from "@/lib/market-data/types";
import { evaluateRule } from "@/lib/strategy-engine/decisions";
import type { CandleFeatures } from "@/lib/strategy-lab/features";
import { buildIndicatorSeries, describeIndicatorCondition, indicatorRowAt, INDICATOR_DEFS } from "@/lib/strategy-lab/indicator-library";
import { BOT_TEMPLATES } from "../templates";

function assert(condition: boolean, msg: string) {
    if (!condition) {
        throw new Error(`FAIL: ${msg}`);
    }
}

export function runBotStudioTests(): void {
    console.log("Running Bot Studio Unit Tests...\n");

    // ── 1. Magic Numbers ──
    console.log("• Testing Magic Number Registry...");
    const stratA = "STRAT_ALPHA_123";
    const stratB = "STRAT_BETA_456";

    const numA1 = deriveMagicNumber(stratA);
    const numA2 = deriveMagicNumber(stratA);
    const numB = deriveMagicNumber(stratB);

    assert(numA1 === numA2, "deriveMagicNumber must be strictly deterministic");
    assert(numA1 !== numB, "different strategy IDs should yield different numbers");
    assert(isBotStudioMagicNumber(numA1), "magic number must be in reserved range");
    assert(isBotStudioMagicNumber(numB), "magic number must be in reserved range");
    assert(!isBotStudioMagicNumber(99_999_999), "number below 100M must not be bot studio");
    assert(!isBotStudioMagicNumber(200_000_000), "number above 200M must not be bot studio");
    console.log("  ✓ Magic Numbers passed.");

    // ── 2. Lifecycle State Machine ──
    console.log("• Testing Lifecycle State Machine...");
    assert(canTransitionTo("draft", "validating"), "draft -> validating allowed");
    assert(canTransitionTo("validating", "ready"), "validating -> ready allowed");
    assert(canTransitionTo("ready", "starting"), "ready -> starting allowed");
    assert(canTransitionTo("starting", "running"), "starting -> running allowed");
    assert(canTransitionTo("running", "pausing"), "running -> pausing allowed");
    assert(canTransitionTo("pausing", "paused"), "pausing -> paused allowed");
    assert(canTransitionTo("paused", "stopping"), "paused -> stopping allowed");
    assert(canTransitionTo("stopping", "stopped"), "stopping -> stopped allowed");

    // Disallowed transitions
    assert(!canTransitionTo("draft", "running"), "draft -> running must be blocked");
    assert(!canTransitionTo("stopped", "pausing"), "stopped -> pausing must be blocked");

    let threw = false;
    try {
        validateTransition("BOT_TEST", "draft", "running");
    } catch {
        threw = true;
    }
    assert(threw, "validateTransition must throw on illegal transition");
    console.log("  ✓ Lifecycle state machine passed.");

    // ── 3. Visual Compiler ──
    console.log("• Testing Visual Graph Compiler...");
    const validGraph: NodeGraph = {
        nodes: [
            {
                id: "feed",
                kind: "market_data",
                data: { symbol: "EURUSD", timeframe: "H1", priceField: "close" },
            },
            {
                id: "ema20",
                kind: "indicator_ema",
                data: { period: 20 },
            },
            {
                id: "ema50",
                kind: "indicator_ema",
                data: { period: 50 },
            },
            {
                id: "cross",
                kind: "condition_cross_above",
                data: { label: "EMA20 crosses above EMA50" },
            },
            {
                id: "action",
                kind: "action_enter_long",
                data: {
                    riskPercent: 1.5,
                    slType: "atr",
                    slMultiplier: 2.0,
                    tpType: "risk_reward",
                    tpRatio: 2.5,
                },
            },
        ],
        edges: [
            { id: "e1", source: "feed", target: "ema20" },
            { id: "e2", source: "feed", target: "ema50" },
            { id: "e3", source: "ema20", target: "cross" },
            { id: "e4", source: "ema50", target: "cross" },
            { id: "e5", source: "cross", target: "action" },
        ],
        meta: {
            name: "Visual Test Strategy",
            symbol: "EURUSD",
            timeframe: "H1",
            direction: "long",
        },
    };

    const visualResult = compileNodeGraph(validGraph, "STRAT_VISUAL_TEST");
    assert(visualResult.ok, `Visual compiler failed: ${visualResult.diagnostics.map((d) => d.message).join(", ")}`);
    assert(visualResult.value !== undefined, "Compiled strategy value must exist");
    assert(visualResult.value?.asset === "EURUSD", "Asset must match");
    assert(visualResult.value?.risk.riskPercent === 1.5, "Risk percent must match");
    assert(visualResult.value?.entryRules.length === 1, "Must have 1 entry rule");
    console.log("  ✓ Visual Compiler valid graph passed.");

    // Visual Compiler failure on empty graph
    const emptyGraph: NodeGraph = {
        nodes: [],
        edges: [],
        meta: { name: "Empty", symbol: "EURUSD", timeframe: "H1", direction: "long" },
    };
    const emptyResult = compileNodeGraph(emptyGraph, "STRAT_EMPTY");
    assert(!emptyResult.ok, "Empty graph must fail compilation");
    console.log("  ✓ Visual Compiler validation guards passed.");

    // Engine-backed condition nodes compile to rules the engine evaluates
    console.log("• Testing Engine-backed condition nodes...");
    const engineGraph: NodeGraph = {
        nodes: [
            { id: "trend", kind: "engine_trend_bullish", data: { label: "Trend is bullish" } },
            { id: "rsi", kind: "engine_rsi_gt_50", data: { label: "RSI(14) > 50" } },
            { id: "sess", kind: "engine_session_london", data: { label: "London session" } },
            { id: "action", kind: "action_enter_long", data: { riskPercent: 1.0 } },
        ],
        edges: [
            { id: "e1", source: "trend", target: "action" },
            { id: "e2", source: "rsi", target: "action" },
            { id: "e3", source: "sess", target: "action" },
        ],
        meta: { name: "Engine Nodes", symbol: "EURUSD", timeframe: "H1", direction: "long" },
    };
    const engineResult = compileNodeGraph(engineGraph, "STRAT_ENGINE_TEST");
    assert(engineResult.ok, `Engine-node compile failed: ${engineResult.diagnostics.map((d) => d.message).join(", ")}`);
    assert(engineResult.value?.entryRules.length === 3, "Each engine node must yield one entry rule");
    const stubFeatures = {
        trend: "bullish",
        rsi: 55,
        session: "london",
        ema20: 1.1,
        ema50: 1.0,
        close: 1.2,
    } as unknown as CandleFeatures;
    for (const rule of engineResult.value?.entryRules ?? []) {
        assert(evaluateRule(rule, stubFeatures), `Engine rule ${rule.id} must pass on matching features`);
    }
    const bearishGraph: NodeGraph = {
        ...engineGraph,
        nodes: [{ id: "bear", kind: "engine_trend_bearish", data: {} }, engineGraph.nodes[3]],
        edges: [{ id: "e1", source: "bear", target: "action" }],
    };
    const bearishRules = compileNodeGraph(bearishGraph, "STRAT_ENGINE_BEAR").value?.entryRules ?? [];
    assert(bearishRules.length === 1 && !evaluateRule(bearishRules[0], stubFeatures), "Bearish trend rule must fail on bullish features");
    console.log("  ✓ Engine-backed condition nodes passed.");

    // ── 3b. Indicator library ──
    console.log("• Testing indicator library and indicator conditions...");
    const libCandles: MarketCandle[] = Array.from({ length: 300 }, (_, i) => {
        const close = 100 + Math.sin(i / 5) * 5 + i * 0.01;
        return { timestamp: i * 3600000, open: close, high: close + 1, low: close - 1, close, volume: 1 };
    });
    const libSeries = buildIndicatorSeries(libCandles);
    const sma5At4 = libSeries.sma_5[4];
    const expectedSma5 = libCandles.slice(0, 5).reduce((s, c) => s + c.close, 0) / 5;
    assert(Math.abs(sma5At4 - expectedSma5) < 1e-9, "sma_5 must equal the mean of the first 5 closes");
    assert(indicatorRowAt(libSeries, 3).sma_5 === null, "sma_5 must be null during warm-up");
    for (const def of INDICATOR_DEFS) {
        assert(Array.isArray(libSeries[def.key]), `Indicator ${def.key} must have a series`);
    }
    // Causality: a value at bar i must not change when later candles are added.
    const prefixSeries = buildIndicatorSeries(libCandles.slice(0, 150));
    for (const key of ["ema_20", "rsi_14", "donchian_high_20", "adx_14", "stoch_k_14", "bb_upper_20", "macd_line"]) {
        for (let i = 0; i < 150; i++) {
            const a = libSeries[key][i];
            const b = prefixSeries[key][i];
            const bothMissing = !Number.isFinite(a) && !Number.isFinite(b);
            assert(bothMissing || Math.abs(a - b) < 1e-9, `${key} at bar ${i} must not use future candles`);
        }
    }
    const crossCompile = compileNodeGraph({
        nodes: [
            { id: "c", kind: "indicator_condition", data: { indicator: "ema_20", operator: "crosses_above", compareTo: "ema_50" } },
            { id: "action", kind: "action_enter_long", data: { riskPercent: 1 } },
        ],
        edges: [{ id: "e1", source: "c", target: "action" }],
        meta: { name: "Cross", symbol: "EURUSD", timeframe: "H1", direction: "long" },
    }, "STRAT_CROSS");
    assert(crossCompile.ok, `Crossover condition must compile: ${crossCompile.diagnostics.map((d) => d.message).join(", ")}`);
    const crossRule = crossCompile.value?.entryRules[0];
    assert(!!crossRule, "Crossover condition must yield a rule");
    const crossedFeatures = {
        ind: { ema_20: 1.1, ema_50: 1.0 },
        indPrev: { ema_20: 0.9, ema_50: 1.0 },
    } as unknown as CandleFeatures;
    const notCrossedFeatures = {
        ind: { ema_20: 1.1, ema_50: 1.0 },
        indPrev: { ema_20: 1.2, ema_50: 1.0 },
    } as unknown as CandleFeatures;
    assert(evaluateRule(crossRule!, crossedFeatures), "crosses_above must pass when the series crosses this bar");
    assert(!evaluateRule(crossRule!, notCrossedFeatures), "crosses_above must fail when it was already above");
    const badCompile = compileNodeGraph({
        nodes: [
            { id: "c", kind: "indicator_condition", data: { indicator: "not_a_real_indicator", operator: "gt", value: 1 } },
            { id: "action", kind: "action_enter_long", data: { riskPercent: 1 } },
        ],
        edges: [{ id: "e1", source: "c", target: "action" }],
        meta: { name: "Bad", symbol: "EURUSD", timeframe: "H1", direction: "long" },
    }, "STRAT_BAD");
    assert(!badCompile.ok, "Unknown indicator must be a compile error");
    console.log("  ✓ Indicator library and conditions passed.");

    // ── 3d. Extended indicators and direction rules ──
    console.log("• Testing extended indicators and direction rules...");
    const flatCandles: MarketCandle[] = Array.from({ length: 40 }, (_, i) => ({
        timestamp: i * 3600000, open: 100, high: 101, low: 99, close: 100, volume: 1,
    }));
    const flatSeries = buildIndicatorSeries(flatCandles);
    assert(Math.abs(flatSeries.atr_14[20] - 2) < 1e-9, "ATR of a constant 2-point range must be 2");
    assert(Math.abs(flatSeries.atr_pct_14[20] - 2) < 1e-9, "ATR % must be ATR / close * 100");
    assert(Math.abs(flatSeries.keltner_upper_20[39] - (flatSeries.ema_20[39] + 4)) < 1e-9, "Keltner upper must be EMA 20 + 2 ATR");
    assert(Math.abs(flatSeries.wma_20[19] - 100) < 1e-9, "WMA of constant closes must equal the close");
    assert(flatSeries.momentum_10[10] === 0, "Momentum of flat closes must be 0");
    assert(flatSeries.candle_body_pct[5] === 0, "A doji candle must have 0% body");
    const wmaExpected = libCandles.slice(0, 20).reduce((s, c, k) => s + c.close * (k + 1), 0) / 210;
    assert(Math.abs(libSeries.wma_20[19] - wmaExpected) < 1e-9, "WMA 20 must weight the newest bar most");
    assert(Math.abs(libSeries.momentum_10[10] - (libCandles[10].close - libCandles[0].close)) < 1e-9, "Momentum 10 must be close minus close 10 bars ago");
    const bandPos = libSeries.bb_percent_b_20[50];
    assert(bandPos >= -1 && bandPos <= 2, "Bollinger %B must be a position around the bands");
    const risingCompile = compileNodeGraph({
        nodes: [
            { id: "c", kind: "indicator_condition", data: { indicator: "ema_20", operator: "rising" } },
            { id: "action", kind: "action_enter_long", data: { riskPercent: 1 } },
        ],
        edges: [{ id: "e1", source: "c", target: "action" }],
        meta: { name: "Rising", symbol: "EURUSD", timeframe: "H1", direction: "long" },
    }, "STRAT_RISING");
    assert(risingCompile.ok, "A rising condition needs no threshold and must compile");
    const risingRule = risingCompile.value?.entryRules[0];
    assert(!!risingRule, "Rising condition must yield a rule");
    const risingFeatures = { ind: { ema_20: 1.2 }, indPrev: { ema_20: 1.1 } } as unknown as CandleFeatures;
    const fallingFeatures = { ind: { ema_20: 1.0 }, indPrev: { ema_20: 1.1 } } as unknown as CandleFeatures;
    assert(evaluateRule(risingRule!, risingFeatures), "rising must pass when the indicator went up");
    assert(!evaluateRule(risingRule!, fallingFeatures), "rising must fail when the indicator went down");
    assert(!evaluateRule(risingRule!, { ind: { ema_20: 1.2 }, indPrev: null } as unknown as CandleFeatures), "rising must fail on the first bar");
    assert(
        describeIndicatorCondition({ indicator: "ema_20", operator: "falling" }) === "EMA 20 is falling",
        "A direction rule must read as a sentence without a threshold",
    );
    console.log("  ✓ Extended indicators and direction rules passed.");

    // ── 3c. Bot templates ──
    console.log("• Testing bot templates...");
    const templateIds = new Set<string>();
    for (const template of BOT_TEMPLATES) {
        assert(!templateIds.has(template.id), `Duplicate template id ${template.id}`);
        templateIds.add(template.id);
        const compiled = compileNodeGraph({
            nodes: template.nodes as NodeGraph["nodes"],
            edges: template.edges,
            meta: { name: template.name, symbol: "EURUSD", timeframe: "H1", direction: template.direction },
        }, `STRAT_T_${template.id}`);
        assert(
            compiled.ok,
            `Template ${template.id} must compile: ${compiled.diagnostics.map((d) => d.message).join(", ")}`,
        );
    }
    console.log(`  ✓ ${BOT_TEMPLATES.length} bot templates compiled.`);

    // ── 4. AvScript Compiler ──
    console.log("• Testing AvScript Compiler...");
    const sampleAvScript = `
strategy({
    name: "Golden Cross Bot",
    symbol: "EURUSD",
    timeframe: "H1",
    direction: "long"
});

const fast = indicators.ema(close, 20);
const slow = indicators.ema(slow, 50);

crossesAbove(fast, slow);

enterLong({
    riskPercent: 1.0,
    stopLoss: {
        type: "atr",
        multiplier: 2.0
    },
    takeProfit: {
        type: "riskReward",
        ratio: 2.0
    }
});
`;

    const avResult = compileAvScript(sampleAvScript, "STRAT_AV_TEST");
    assert(avResult.ok, `AvScript compiler failed: ${avResult.diagnostics.map((d) => d.message).join(", ")}`);
    assert(avResult.value?.name === "Golden Cross Bot", "Name must match");
    assert(avResult.value?.direction === "long", "Direction must match");
    assert(avResult.value?.risk.riskPercent === 1.0, "Risk must match");

    // AvScript Security Guard
    const evilScript = `
strategy({ name: "Unsafe", symbol: "EURUSD", timeframe: "H1" });
eval("alert(1)");
`;
    const evilResult = compileAvScript(evilScript, "STRAT_EVIL");
    assert(!evilResult.ok, "Unsafe AvScript constructs must be rejected");
    console.log("  ✓ AvScript Compiler passed.");

    // ── 5. Backtest Simulation Integration ──
    console.log("• Testing Backtest Engine Integration with Compiled Strategies...");
    const baseTime = Date.now() - 100 * 3600 * 1000;
    const testCandles: MarketCandle[] = [];
    let price = 1.0800;
    for (let i = 0; i < 100; i++) {
        const delta = (i % 2 === 0 ? 0.0010 : -0.0005);
        price += delta;
        testCandles.push({
            timestamp: baseTime + i * 3600 * 1000,
            open: price,
            high: price + 0.0015,
            low: price - 0.0010,
            close: price + delta,
            volume: 1000 + i * 10,
        });
    }

    // Run backtest on Visual compiled strategy
    const visualBacktest = backtestStrategy(
        visualResult.value!,
        "EURUSD",
        { H1: testCandles },
        defaultBacktestConfig(),
        0,
        Date.now()
    );
    assert(typeof visualBacktest.id === "string", "Backtest result must produce valid ID");
    assert(visualBacktest.metrics !== undefined, "Backtest must calculate metrics");
    assert(Array.isArray(visualBacktest.trades), "Trades must be an array");
    assert(Array.isArray(visualBacktest.equity), "Equity curve must exist");

    // Run backtest on AvScript compiled strategy
    const avBacktest = backtestStrategy(
        avResult.value!,
        "EURUSD",
        { H1: testCandles },
        defaultBacktestConfig(),
        0,
        Date.now()
    );
    assert(typeof avBacktest.id === "string", "AvScript backtest result must produce valid ID");
    assert(avBacktest.metrics !== undefined, "AvScript backtest must calculate metrics");
    console.log("  ✓ Backtest simulation on compiled strategies passed.");

    console.log("\n========================================");
    console.log("  ALL BOT STUDIO TESTS PASSED (100%)    ");
    console.log("========================================\n");
}

runBotStudioTests();

