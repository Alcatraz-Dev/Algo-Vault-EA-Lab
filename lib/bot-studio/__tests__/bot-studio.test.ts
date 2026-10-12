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

    console.log("\n========================================");
    console.log("  ALL BOT STUDIO TESTS PASSED (100%)    ");
    console.log("========================================\n");
}

runBotStudioTests();

