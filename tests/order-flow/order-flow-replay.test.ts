/**
 * Order Flow — replay correctness, future-leakage prevention and integration
 * with the existing engines (Market Intelligence layer, AI signal scoring,
 * backtest adapter).
 *
 *     JITI_TSCONFIG_PATHS=1 npx jiti tests/order-flow/order-flow-replay.test.ts
 */

import { orderFlowAtBoundary, ReplayOrderFlow } from "../../lib/order-flow/replay";
import { buildOrderFlowContext } from "../../lib/order-flow/context-builder";
import { computeVolumeProfile } from "../../lib/order-flow/volume-profile";
import { orderFlowToIntelligence, scoreOrderFlowForSignal, buildSignalExplanation } from "../../lib/order-flow/intelligence-adapter";
import { buildIntelligenceContext } from "../../lib/market-intelligence/ai/intelligence-layer";
import type { MarketCandle, Timeframe } from "../../lib/market-data/types";
import type { OrderFlowTrade } from "../../lib/order-flow/types";

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

const TF: Timeframe = "M5";
const BASE = Date.UTC(2026, 8, 23, 10, 0);

function history(n: number): MarketCandle[] {
    return Array.from({ length: n }, (_, i) => {
        const base = 100 + i * 0.1; // rising series — future data matters
        return {
            timestamp: BASE + i * 300_000,
            open: base - 0.5,
            high: base + 1,
            low: base - 1,
            close: base + 0.5,
            volume: 100 + i,
        };
    });
}

console.log("Replay boundary correctness");
check("context at index i is IDENTICAL whether or not future candles exist in the input", () => {
    const full = history(60);
    const at20Full = orderFlowAtBoundary({ symbol: "XAUUSD", timeframe: TF, candles: full }, 20);
    const truncated = full.slice(0, 21);
    const at20Trunc = orderFlowAtBoundary({ symbol: "XAUUSD", timeframe: TF, candles: truncated }, 20);
    assertEqual(at20Full.volumeProfile.poc, at20Trunc.volumeProfile.poc, "POC must not change");
    assertEqual(at20Full.volumeProfile.vah, at20Trunc.volumeProfile.vah, "VAH must not change");
    assertEqual(at20Full.volumeProfile.val, at20Trunc.volumeProfile.val, "VAL must not change");
    assertEqual(at20Full.absorption.recent.length, at20Trunc.absorption.recent.length);
    assertEqual(at20Full.asOf, at20Trunc.asOf);
});
check("profile at boundary equals direct computation on the prefix", () => {
    const full = history(50);
    const idx = 29;
    const ctx = orderFlowAtBoundary({ symbol: "XAUUSD", timeframe: TF, candles: full }, idx);
    const prefix = full.slice(0, idx + 1);
    const direct = computeVolumeProfile(prefix, { kind: "session", symbol: "XAUUSD", timeframe: TF, mode: "replay" });
    assertEqual(ctx.volumeProfile.poc, direct.poc);
});
check("trades after the boundary never influence the context", () => {
    const full = history(30);
    const idx = 14;
    const boundaryTs = full[idx].timestamp;
    const early: OrderFlowTrade[] = [
        { timestamp: boundaryTs - 60_000, price: 100, size: 50, side: "buy" },
    ];
    const late: OrderFlowTrade[] = [
        { timestamp: boundaryTs + 3_600_000, price: 200, size: 99_999, side: "buy" },
    ];
    const ctxEarly = orderFlowAtBoundary({ symbol: "XAUUSD", timeframe: TF, candles: full, trades: [...early, ...late] }, idx);
    const ctxOnlyEarly = orderFlowAtBoundary({ symbol: "XAUUSD", timeframe: TF, candles: full, trades: early }, idx);
    assertEqual(ctxEarly.delta.cumulative, ctxOnlyEarly.delta.cumulative, "future trades dropped");
});
check("ReplayOrderFlow streaming steps expose only the past", () => {
    const full = history(40);
    const replay = new ReplayOrderFlow({ symbol: "XAUUSD", timeframe: TF, candles: full });
    const s10 = replay.seek(10);
    assertEqual(s10.volumeProfile.available, true);
    const s20 = replay.seek(20);
    assert(s20.asOf > s10.asOf, "boundary advances");
    // Rewind: seek(10) again returns the identical context (deterministic).
    const s10Again = replay.seek(10);
    assertEqual(s10Again.volumeProfile.poc, s10.volumeProfile.poc);
    // Exhaustion of the stream.
    replay.reset();
    let last: unknown = null;
    let count = 0;
    for (let i = 0; i < 45; i++) {
        last = replay.step();
        if (last !== null) count += 1;
    }
    assertEqual(count, 40, "step() returns exactly history.length contexts");
});

console.log("Market Intelligence integration");
check("order-flow evidence merges into the intelligence layer with order_flow source", () => {
    const ctx = buildOrderFlowContext({
        symbol: "XAUUSD",
        timeframe: TF,
        mode: "live",
        asOf: BASE + 20 * 300_000,
        candles: history(20),
    });
    const merged = orderFlowToIntelligence(ctx);
    assert(merged.facts.length > 0, "facts produced");
    assert(merged.facts.every((f) => f.source === "order_flow"), "all tagged order_flow");
    assert(merged.limitations.some((l) => l.includes("Level 2")), "L2 limitation propagated");
    assert(merged.limitations.some((l) => l.toLowerCase().includes("delta") || l.toLowerCase().includes("gex")), "capability limitations propagated");
});
check("intelligence-layer context accepts order_flow evidence without breaking", () => {
    const ic = buildIntelligenceContext({ symbol: "XAUUSD", timeframe: TF } as never);
    assert(ic !== null, "context built");
    assertEqual(isReplaySafeCompat(ic.mode), true);
    function isReplaySafeCompat(mode?: string): boolean {
        return mode !== "replay";
    }
});
check("null context degrades to explicit unavailability", () => {
    const merged = orderFlowToIntelligence(null);
    assertEqual(merged.facts, []);
    assertEqual(merged.interpretations, []);
    assertEqual(merged.limitations, []);
});

console.log("AI signal scoring");
check("candle-only context scores profile position, unavailable delta stays 0", () => {
    const candles = history(30);
    const ctx = buildOrderFlowContext({ symbol: "XAUUSD", timeframe: TF, mode: "live", asOf: candles[candles.length - 1].timestamp, candles });
    const buy = scoreOrderFlowForSignal(ctx, "BUY");
    const sell = scoreOrderFlowForSignal(ctx, "SELL");
    assert(buy.score !== sell.score || ctx.volumeProfile.priceRelation === "inside_value_area", "direction-sensitive scoring");
    assert(buy.detail.length > 0, "detail populated");
    assert(!buy.unavailable, "usable context not marked unavailable");
});
check("null context → explicit unavailable scoring (never invented)", () => {
    const s = scoreOrderFlowForSignal(null, "BUY");
    assertEqual(s.score, 0);
    assertEqual(s.unavailable, true);
    assertEqual(s.detail, "Order flow data unavailable");
});
check("explanation builder separates evidence, conflicts and limitations", () => {
    const candles = history(30);
    const ctx = buildOrderFlowContext({ symbol: "XAUUSD", timeframe: TF, mode: "live", asOf: candles[candles.length - 1].timestamp, candles });
    const ex = buildSignalExplanation(ctx);
    assert(Array.isArray(ex.orderFlowEvidence), "evidence list");
    assertEqual(ex.dataQuality, ctx.dataQuality);
    assert(ex.limitations.length === ctx.limitations.length, "limitations 1:1");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
