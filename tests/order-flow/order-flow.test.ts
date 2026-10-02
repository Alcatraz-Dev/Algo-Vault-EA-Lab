/**
 * Order Flow engine — standalone test suite (repo convention: jiti runner).
 *
 *     npx jiti tests/order-flow/order-flow.test.ts
 *
 * Covers: volume profile (POC/VAH/VAL/HVN/LVN), delta + cumulative delta,
 * divergence, footprint aggregation, imbalances, absorption, exhaustion,
 * large trades, liquidity events, heatmap state, GEX, capability detection,
 * data-quality states, AI context generation, replay/no-future-leakage,
 * incremental updates, empty/partial/stale data, unsupported providers,
 * missing options/Level-2 data.
 */

import {
    computeVolumeProfile,
    computeSessionProfile,
    DevelopingVolumeProfile,
} from "../../lib/order-flow/volume-profile";
import { computeDelta, CumulativeDeltaTracker, detectDeltaDivergences } from "../../lib/order-flow/delta";
import { computeEstimatedDelta, detectEstimatedDeltaDivergences } from "../../lib/order-flow/delta-proxy";
import { computeFootprint } from "../../lib/order-flow/footprint";
import { detectAbsorption } from "../../lib/order-flow/absorption";
import { detectExhaustion } from "../../lib/order-flow/exhaustion";
import { detectLargeTrades, percentile } from "../../lib/order-flow/large-trades";
import { detectLiquidityEvents, detectSweepsAndReplenishment, bookImbalance, buildHeatmapState } from "../../lib/order-flow/liquidity";
import { computeGex, blackScholesGamma, gexLevels } from "../../lib/order-flow/gex";
import { assessOptionChain } from "../../lib/order-flow/gex/validation";
import {
    canonicalCapabilities,
    isFeatureUsable,
    resolveFeatureAvailability,
    overallDataQuality,
} from "../../lib/order-flow/capabilities";
import { deriveFeatureAvailability } from "../../lib/order-flow/types";
import { CanonicalCandleProvider, resolveCapabilities } from "../../lib/order-flow/normalizer";
import { classifyByTickRule, classificationQuality } from "../../lib/order-flow/tick-classifier";
import { buildOrderFlowContext, buildOrderFlowConfluence } from "../../lib/order-flow/context-builder";
import {
    mergeOrderFlowSettings,
    sanitizeOrderFlowSettings,
    DEFAULT_ORDER_FLOW_SETTINGS,
    orderFlowGate,
} from "../../lib/order-flow/settings";
import {
    validateTrade,
    validateTradeBatch,
    validateL2Snapshot,
    validateOptionQuote,
} from "../../lib/order-flow/validation";
import type { MarketCandle, Timeframe } from "../../lib/market-data/types";
import type { OrderFlowTrade, L2Snapshot, OptionQuote } from "../../lib/order-flow/types";

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
function approx(actual: number, expected: number, eps = 1e-6, msg = ""): void {
    if (!(Math.abs(actual - expected) <= eps)) throw new Error(`${msg} expected ≈${expected}, got ${actual}`);
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const TF: Timeframe = "M5";

/** Candle with a heavy-volume node at `priceLevel` (bar index i). */
function profileCandles(n: number): MarketCandle[] {
    return Array.from({ length: n }, (_, i) => {
        const base = 100 + Math.sin(i / 4) * 2; // oscillate around 100
        const heavy = i % 5 === 0;
        return {
            timestamp: Date.UTC(2026, 8, 23, 10, 0) + i * 5 * 60_000,
            open: base - 0.5,
            high: base + 1,
            low: base - 1,
            close: base + 0.5,
            volume: heavy ? 1000 : 100,
        };
    });
}

const trades: OrderFlowTrade[] = [
    { timestamp: 1_000, price: 100, size: 10, side: "buy" },
    { timestamp: 2_000, price: 100.5, size: 20, side: "buy" },
    { timestamp: 3_000, price: 100.2, size: 5, side: "sell" },
    { timestamp: 310_000, price: 100.8, size: 15, side: "sell" },
    { timestamp: 320_000, price: 101, size: 30, side: "buy" },
];

const l2: L2Snapshot[] = [
    {
        timestamp: 1_000,
        bids: [{ price: 99.9, size: 50 }, { price: 99.8, size: 20 }],
        asks: [{ price: 100.1, size: 30 }, { price: 100.2, size: 10 }],
    },
    {
        timestamp: 2_000,
        bids: [{ price: 99.9, size: 500 }, { price: 99.8, size: 20 }],
        asks: [{ price: 100.1, size: 30 }, { price: 100.2, size: 10 }],
    },
    {
        timestamp: 3_000,
        bids: [{ price: 99.9, size: 500 }, { price: 99.8, size: 20 }],
        asks: [{ price: 100.1, size: 3 }, { price: 100.2, size: 10 }],
    },
];

const options: OptionQuote[] = [
    { strike: 95, expiration: Date.now() + 30 * 86_400_000, type: "put", openInterest: 5000, impliedVolatility: 0.25, underlyingPrice: 100 },
    { strike: 100, expiration: Date.now() + 30 * 86_400_000, type: "call", openInterest: 8000, impliedVolatility: 0.2, underlyingPrice: 100 },
    { strike: 100, expiration: Date.now() + 30 * 86_400_000, type: "put", openInterest: 3000, impliedVolatility: 0.22, underlyingPrice: 100 },
    { strike: 105, expiration: Date.now() + 30 * 86_400_000, type: "call", openInterest: 2000, impliedVolatility: 0.18, underlyingPrice: 100 },
];

// ── volume profile ───────────────────────────────────────────────────────────

console.log("Volume profile");
check("computes POC at the heaviest volume zone", () => {
    const p = computeVolumeProfile(profileCandles(60), { kind: "session", symbol: "XAUUSD", timeframe: TF, mode: "live", bins: 24 });
    assert(p.poc !== null, "POC set");
    assert(p.poc! > 96 && p.poc! < 104, `POC ${p.poc} within data range`);
    assert(p.totalVolume > 0, "total volume accumulated");
});
check("VAH ≥ POC ≥ VAL and value area brackets the POC", () => {
    const p = computeVolumeProfile(profileCandles(60), { kind: "session", symbol: "XAUUSD", timeframe: TF, mode: "live", bins: 24, valueAreaPercent: 70 });
    assert(p.vah !== null && p.val !== null && p.poc !== null, "levels set");
    assert(p.vah! >= p.poc!, "VAH ≥ POC");
    assert(p.poc! >= p.val!, "POC ≥ VAL");
});
check("HVN/LVN reported and HVN holds the POC price", () => {
    const p = computeVolumeProfile(profileCandles(60), { kind: "session", symbol: "XAUUSD", timeframe: TF, mode: "live", bins: 24, nodesCount: 3 });
    assertEqual(p.hvn.length, 3);
    assertEqual(p.lvn.length, 3);
    const pocBin = p.volumeByPrice.find((b) => b.price === p.poc);
    assert(p.hvn.includes(p.poc as number) || (pocBin && p.volumeByPrice.filter((b) => b.volume >= (pocBin?.volume ?? 0)).length === 1), "POC among HVNs");
});
check("session profile restricts to the last UTC day", () => {
    const candles = [
        ...profileCandles(6).map((c) => ({ ...c, timestamp: Date.UTC(2026, 8, 22, 12, 0) })),
        ...profileCandles(6).map((c) => ({ ...c, timestamp: Date.UTC(2026, 8, 23, 12, 0) })),
    ];
    const p = computeSessionProfile(candles, { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    const day = new Date(Date.UTC(2026, 8, 23, 12, 0)).toISOString().slice(0, 10);
    assert(new Date(p.rangeStart).toISOString().slice(0, 10) === day, "starts in last day");
    assertEqual(p.barCount, 6);
});
check("empty input → INSUFFICIENT_HISTORY with null levels", () => {
    const p = computeVolumeProfile([], { kind: "session", symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assertEqual(p.poc, null);
    assertEqual(p.dataQuality, "INSUFFICIENT_HISTORY");
    assertEqual(p.dataQuality, "INSUFFICIENT_HISTORY");
});
check("visible-range profile respects the time window", () => {
    const all = profileCandles(20);
    const start = all[10].timestamp;
    const p = computeVolumeProfile(all, { kind: "visible_range", symbol: "XAUUSD", timeframe: TF, mode: "live", rangeStart: start, rangeEnd: all[19].timestamp, bins: 12 });
    assertEqual(p.barCount, 10);
});
check("profile is deterministic (same input → identical output)", () => {
    const c = profileCandles(40);
    const a = computeVolumeProfile(c, { kind: "session", symbol: "XAUUSD", timeframe: TF, mode: "live", bins: 16 });
    const b = computeVolumeProfile(c, { kind: "session", symbol: "XAUUSD", timeframe: TF, mode: "live", bins: 16 });
    assertEqual(a.poc, b.poc);
    assertEqual(a.vah, b.vah);
    assertEqual(a.val, b.val);
});
check("developing profile only reflects ingested candles", () => {
    const c = profileCandles(20);
    const dvp = new DevelopingVolumeProfile({ symbol: "XAUUSD", timeframe: TF, mode: "replay" }, { bins: 12 });
    for (const candle of c.slice(0, 10)) dvp.update(candle);
    const snap = dvp.snapshot();
    assertEqual(snap.barCount, 10);
    // Future candles cannot affect it:
    for (const candle of c.slice(10)) dvp.update(candle);
    const later = dvp.snapshot();
    assert(later.barCount === 20, "later snapshot includes newer candles");
    assertEqual(snap.rangeEnd, c[9].timestamp, "earlier snapshot end at candle 10");
});

// ── delta ────────────────────────────────────────────────────────────────────

console.log("Delta engine");
check("delta = buy − sell with per-bucket buy/sell split", () => {
    const r = computeDelta(trades, { symbol: "XAUUSD", timeframe: TF, mode: "live", bucketMs: 60_000 });
    approx(r.buyVolume, 60);
    approx(r.sellVolume, 20);
    approx(r.delta, 40);
    approx(r.deltaPercent, 40 / 80 * 100);
    assertEqual(r.dataQuality, "HIGH");
});
check("cumulative delta equals running total across buckets", () => {
    const r = computeDelta(trades, { symbol: "XAUUSD", timeframe: TF, mode: "live", bucketMs: 60_000 });
    // Trade timestamps 1000..320000ms → minute buckets 0..5.
    const sum = r.buckets.reduce((s, b) => s + b.delta, 0);
    approx(r.cumulativeDelta, sum);
    approx(r.cumulativeDelta, 40);
});
check("delta acceleration measures bucket-over-bucket change", () => {
    const r = computeDelta(trades, { symbol: "XAUUSD", timeframe: TF, mode: "live", bucketMs: 60_000 });
    const last = r.buckets[r.buckets.length - 1];
    const prior = r.buckets[r.buckets.length - 2];
    approx(r.deltaAcceleration, last.delta - prior.delta);
});
check("no trades → UNAVAILABLE, never fake delta", () => {
    const r = computeDelta([], { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assertEqual(r.dataQuality, "UNAVAILABLE");
    assertEqual(r.delta, 0);
    assertEqual(r.buckets.length, 0);
});
check("CumulativeDeltaTracker streams O(1) updates and rolls buckets", () => {
    const t = new CumulativeDeltaTracker({ timeframe: TF, bucketMs: 60_000 });
    for (const tr of trades.slice(0, 3)) t.update(tr); // bucket 0: buy 30, sell 5
    const mid = t.snapshot();
    approx(mid.buyVolume, 30);
    approx(mid.sellVolume, 5);
    t.update(trades[3]); // bucket 5 → rolls bucket 0 (buy 30, sell 5), forming bucket has sell 15
    const after = t.snapshot();
    approx(after.buyVolume, 30);
    approx(after.sellVolume, 20);
    approx(after.delta, -15, 1e-6, "forming bucket delta");
    approx(after.cumulativeDelta, 30 - 5 - 15, 1e-6, "rolled + forming");
});
check("divergence: price up with falling delta fires PRICE_UP_DELTA_DOWN", () => {
    const seq: OrderFlowTrade[] = [];
    const mk = (ts: number, price: number, size: number, side: "buy" | "sell") => ({ timestamp: ts, price, size, side });
    // Bucket 0: strong buy → delta +100, price 100→101.
    seq.push(mk(1_000, 100, 100, "buy"), mk(2_000, 101, 100, "buy"));
    // Bucket 1: price rises to 102 but heavy sell delta.
    seq.push(mk(61_000, 101.5, 120, "sell"), mk(62_000, 102, 20, "buy"));
    const r = computeDelta(seq, { symbol: "XAUUSD", timeframe: TF, mode: "live", bucketMs: 60_000 });
    const prices = [101, 102];
    const divs = detectDeltaDivergences(r, prices, { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assert(divs.some((d) => d.type === "PRICE_UP_DELTA_DOWN"), `expected PRICE_UP_DELTA_DOWN, got ${JSON.stringify(divs.map((d) => d.type))}`);
});
check("divergence: cumulative flip fires PRICE_UP_CUM_DELTA_DOWN", () => {
    const seq: OrderFlowTrade[] = [];
    const mk = (ts: number, price: number, size: number, side: "buy" | "sell") => ({ timestamp: ts, price, size, side });
    seq.push(mk(1_000, 100, 200, "buy"), mk(2_000, 100.5, 10, "sell"));
    // Bucket 1: massive sell (cum flips negative) while price edges up.
    seq.push(mk(61_000, 100.6, 500, "sell"), mk(62_000, 101, 10, "buy"));
    const r = computeDelta(seq, { symbol: "XAUUSD", timeframe: TF, mode: "live", bucketMs: 60_000 });
    const divs = detectDeltaDivergences(r, [100.5, 101], { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assert(divs.some((d) => d.type === "PRICE_UP_CUM_DELTA_DOWN"), `got ${JSON.stringify(divs.map((d) => d.type))}`);
});
check("no divergence when price and delta agree", () => {
    const seq: OrderFlowTrade[] = [
        { timestamp: 1_000, price: 100, size: 50, side: "buy" },
        { timestamp: 61_000, price: 101, size: 80, side: "buy" },
    ];
    const r = computeDelta(seq, { symbol: "XAUUSD", timeframe: TF, mode: "live", bucketMs: 60_000 });
    const divs = detectDeltaDivergences(r, [100, 101], { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assertEqual(divs, []);
});

// ── tick classifier ──────────────────────────────────────────────────────────

console.log("Tick classifier");
check("tick rule labels up-ticks buy and down-ticks sell", () => {
    const raw: OrderFlowTrade[] = [
        { timestamp: 1, price: 100, size: 1, side: "buy" },
        { timestamp: 2, price: 101, size: 1, side: "buy" },
        { timestamp: 3, price: 100.5, size: 1, side: "buy" },
        { timestamp: 4, price: 100.5, size: 1, side: "buy" },
    ];
    const cls = classifyByTickRule(raw);
    assertEqual(cls[1].side, "buy");
    assertEqual(cls[2].side, "sell");
    assertEqual(cls[3].side, "sell"); // zero-tick inherits
    assertEqual(classificationQuality(cls), "PARTIAL");
});

// ── footprint ────────────────────────────────────────────────────────────────

console.log("Footprint");
check("aggregates bid × ask cells per bar with delta", () => {
    const fp = computeFootprint(trades, { symbol: "XAUUSD", timeframe: TF, mode: "live", density: 4 });
    assertEqual(fp.bars.length, 2);
    const bar0 = fp.bars[0];
    assert(bar0.cells.length > 0, "cells present");
    const cellSum = bar0.cells.reduce((s, c) => s + c.askVolume, 0);
    approx(cellSum, 30); // buys in bucket 0: 10 + 20
    approx(bar0.delta, 30 - 5);
    assertEqual(fp.dataQuality, "HIGH");
});
check("empty trades → UNAVAILABLE footprint", () => {
    const fp = computeFootprint([], { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assertEqual(fp.dataQuality, "UNAVAILABLE");
    assertEqual(fp.bars.length, 0);
});
check("stacked imbalance fires across ≥N consecutive dominant cells", () => {
    // One bar, 8 price cells; three consecutive mid cells are heavy buys.
    const t: OrderFlowTrade[] = [
        { timestamp: 1_000, price: 100.05, size: 10, side: "sell" },
        { timestamp: 1_100, price: 100.25, size: 40, side: "buy" },
        { timestamp: 1_200, price: 100.45, size: 40, side: "buy" },
        { timestamp: 1_300, price: 100.65, size: 40, side: "buy" },
        { timestamp: 1_400, price: 100.75, size: 10, side: "sell" },
    ];
    const fp = computeFootprint(t, { symbol: "XAUUSD", timeframe: TF, mode: "live", density: 8 });
    const all = fp.bars.flatMap((b) => b.imbalances);
    assert(all.some((e) => e.type === "STACKED_BUY_IMBALANCE"), `got ${JSON.stringify(all.map((e) => e.type))}`);
    const stacked = all.find((e) => e.type === "STACKED_BUY_IMBALANCE");
    assert(stacked && stacked.levels >= 3, "stack depth ≥ 3");
});

// ── absorption ───────────────────────────────────────────────────────────────

console.log("Absorption");
check("high volume + capped body + repeated level fires absorption", () => {
    const base = 100;
    const cs: MarketCandle[] = [];
    for (let i = 0; i < 20; i++) {
        cs.push({ timestamp: Date.UTC(2026, 8, 23, 10, 0) + i * 300_000, open: base, high: base + 1, low: base - 1, close: base, volume: 100 });
    }
    // Absorption candidate: 3× volume, tiny body, same zone.
    cs.push({ timestamp: Date.UTC(2026, 8, 23, 10, 0) + 20 * 300_000, open: base - 0.2, high: base + 1, low: base - 1, close: base + 0.2, volume: 400 });
    const events = detectAbsorption(cs, { symbol: "XAUUSD", timeframe: TF, mode: "live", sensitivity: 0.8, window: 10 });
    assert(events.length === 1, `expected 1 event, got ${events.length}`);
    assertEqual(events[0].type, "BUY_ABSORPTION");
    assert(events[0].evidence.length >= 2, "≥2 evidence classes");
});
check("ordinary high-volume full-body bar is NOT absorption", () => {
    const cs: MarketCandle[] = [];
    for (let i = 0; i < 20; i++) {
        cs.push({ timestamp: Date.UTC(2026, 8, 23, 10, 0) + i * 300_000, open: 100, high: 101, low: 99, close: 100, volume: 100 });
    }
    cs.push({ timestamp: Date.UTC(2026, 8, 23, 10, 0) + 20 * 300_000, open: 100, high: 102, low: 100, close: 101.9, volume: 400 });
    const events = detectAbsorption(cs, { symbol: "XAUUSD", timeframe: TF, mode: "live", sensitivity: 0.8, window: 10 });
    assertEqual(events, []);
});

// ── exhaustion ───────────────────────────────────────────────────────────────

console.log("Exhaustion");
check("3.5× ATR extension with failed breakout fires exhaustion", () => {
    const cs: MarketCandle[] = [];
    for (let i = 0; i < 20; i++) {
        cs.push({ timestamp: Date.UTC(2026, 8, 23, 10, 0) + i * 300_000, open: 100, high: 100.5, low: 99.5, close: 100, volume: 100 });
    }
    // Blow-off: huge body up but closes back below the prior high, with a
    // weak close (close in the lower 40% of the bar) → extension + volume
    // expansion + failed breakout + weak close = 4 evidence classes.
    cs.push({ timestamp: Date.UTC(2026, 8, 23, 10, 0) + 20 * 300_000, open: 100, high: 105, low: 99.8, close: 101.8, volume: 300 });
    const events = detectExhaustion(cs, { symbol: "XAUUSD", timeframe: TF, mode: "live", sensitivity: 1, window: 14 });
    assert(events.length >= 1, `expected ≥1, got ${events.length}`);
    assertEqual(events[0].type, "BUY_EXHAUSTION");
    assert(events[0].evidence.length >= 3, `≥3 evidence classes, got ${JSON.stringify(events[0].evidence)}`);
});
check("normal trending bar does not fire exhaustion", () => {
    const cs: MarketCandle[] = [];
    for (let i = 0; i < 25; i++) {
        cs.push({ timestamp: Date.UTC(2026, 8, 23, 10, 0) + i * 300_000, open: 100 + i * 0.1, high: 100.8 + i * 0.1, low: 99.8 + i * 0.1, close: 100.6 + i * 0.1, volume: 100 });
    }
    const events = detectExhaustion(cs, { symbol: "XAUUSD", timeframe: TF, mode: "live", sensitivity: 1, window: 14 });
    assertEqual(events, []);
});

// ── large trades ─────────────────────────────────────────────────────────────

console.log("Large trades");
check("percentile + rolling-multiple rules detect an outlier trade", () => {
    const t: OrderFlowTrade[] = Array.from({ length: 100 }, (_, i) => ({ timestamp: i + 1, price: 100, size: 10, side: i % 2 ? "buy" : "sell" }));
    t.push({ timestamp: 500, price: 100.5, size: 500, side: "buy" });
    const events = detectLargeTrades(t, { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assert(events.length === 1, `expected 1, got ${events.length}`);
    assertEqual(events[0].type, "LARGE_BUY");
    assert(events[0].thresholdRule === "percentile" || events[0].thresholdRule === "rolling_multiple", "rule recorded");
    approx(events[0].size, 500);
});
check("percentile helper is nearest-rank deterministic", () => {
    approx(percentile([1, 2, 3, 4, 5], 0.98), 5);
    approx(percentile([10, 20, 30], 0.5), 20);
});

// ── liquidity ────────────────────────────────────────────────────────────────

console.log("Liquidity engine");
check("wall detection on persistent oversized level", () => {
    const events = detectLiquidityEvents(l2, { symbol: "XAUUSD", timeframe: TF, mode: "live", wallThreshold: 400, wallPersistence: 2 });
    assert(events.some((e) => e.type === "LIQUIDITY_WALL" && e.side === "bid"), JSON.stringify(events.map((e) => e.type)));
    const wall = events.find((e) => e.type === "LIQUIDITY_WALL");
    assert(wall && wall.persistence === 2, "persistence counted");
});
check("added/removed fire on ratio jumps", () => {
    const events = detectLiquidityEvents(l2, { symbol: "XAUUSD", timeframe: TF, mode: "live", wallThreshold: 0 });
    assert(events.some((e) => e.type === "LIQUIDITY_ADDED" && e.side === "bid" && e.newSize === 500 && e.previousSize === 50), "bid added");
    assert(events.some((e) => e.type === "LIQUIDITY_REMOVED" && e.side === "ask" && e.newSize === 3 && e.previousSize === 30), "ask removed");
});
check("sweep + replenishment on best-bid drop/restore", () => {
    const deep: L2Snapshot[] = [
        { timestamp: 1, bids: [{ price: 100, size: 10 }], asks: [{ price: 100.2, size: 10 }] },
        { timestamp: 2, bids: [{ price: 99.5, size: 10 }], asks: [{ price: 100.2, size: 10 }] },
        { timestamp: 3, bids: [{ price: 100, size: 10 }], asks: [{ price: 100.2, size: 10 }] },
    ];
    const events = detectSweepsAndReplenishment(deep, { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assert(events.some((e) => e.type === "LIQUIDITY_SWEEP" && e.side === "bid"), "sweep fired");
    assert(events.some((e) => e.type === "LIQUIDITY_REPLENISHED"), "replenishment fired");
});
check("book imbalance is signed and bounded", () => {
    const imb = bookImbalance(l2[0], 5);
    approx(imb, (70 - 40) / 110);
    const heavyBid = bookImbalance({ timestamp: 1, bids: [{ price: 99, size: 1000 }], asks: [{ price: 101, size: 1 }] }, 5);
    assert(heavyBid > 0.9, "heavy bid ≈ 1");
});
check("heatmap state aggregates cells with wall flags and bounds", () => {
    const hs = buildHeatmapState(l2, { symbol: "XAUUSD", timeframe: TF, mode: "live", wallThreshold: 400, maxCells: 4 });
    assertEqual(hs.cells.length, 4, "bounded to maxCells (keeps newest)");
    assertEqual(hs.maxSize, 500);
    assert(hs.cells.some((c) => c.isWall), "wall cell flagged");
});
check("no L2 → UNAVAILABLE heatmap state", () => {
    const hs = buildHeatmapState([], { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assertEqual(hs.dataQuality, "UNAVAILABLE");
    assertEqual(hs.cells.length, 0);
});

// ── GEX ──────────────────────────────────────────────────────────────────────

console.log("GEX");
check("blackScholesGamma peaks near ATM and decays away", () => {
    const atm = blackScholesGamma(100, 100, 0.2, 0.1);
    const otm = blackScholesGamma(100, 120, 0.2, 0.1);
    assert(atm > otm, `atm ${atm} > otm ${otm}`);
    assert(atm > 0, "gamma positive");
});
check("GEX computes net = call − put and finds walls", () => {
    const g = computeGex(options, { underlying: "SPY", mode: "live" }, Date.now());
    assertEqual(g.dataQuality, "HIGH");
    assert(g.callGex > 0 && g.putGex > 0, "both sides accumulated");
    assertEqual(g.netGex, g.callGex - g.putGex);
    assert(g.callWalls.length > 0, "call walls present");
    assert(g.expirations.length === 1, "one expiry in chain");
});
check("empty/invalid chain → INSUFFICIENT_HISTORY, never fabricated GEX", () => {
    const g = computeGex([], { underlying: "SPY", mode: "live" });
    assertEqual(g.dataQuality, "INSUFFICIENT_HISTORY");
    assertEqual(g.gammaFlip, null);
});
check("gexLevels honours display options", () => {
    const g = computeGex(options, { underlying: "SPY", mode: "live" }, Date.now());
    const all = gexLevels(g, { showWalls: true, showGammaFlip: true });
    const wallsOnly = gexLevels(g, { showWalls: true, showGammaFlip: false });
    assert(all.length >= wallsOnly.length, "flip optional");
    assertEqual(gexLevels(null).length, 0);
});
check("chain assessment rejects thin/broken chains", () => {
    const good = assessOptionChain(options);
    assert(good.usable, "valid chain usable");
    const thin = assessOptionChain([options[0]]);
    assert(!thin.usable, "single quote unusable");
    assert(thin.issues.length > 0, "issues reported");
});

// ── validation ───────────────────────────────────────────────────────────────

console.log("Validation (fail-closed)");
check("rejects impossible trades", () => {
    assert(validateTrade({ timestamp: -1, price: 100, size: 1, side: "buy" }).value === null, "negative ts");
    assert(validateTrade({ timestamp: 1, price: -5, size: 1, side: "buy" }).value === null, "negative price");
    assert(validateTrade({ timestamp: 1, price: 100, size: 0, side: "buy" }).value === null, "zero size");
    assert(validateTrade({ timestamp: 1, price: 100, size: 1, side: " sideways" }).value === null, "bad side");
    assert(validateTrade({ timestamp: Date.now() + 999_999_999, price: 100, size: 1, side: "buy" }).value === null, "future ts");
});
check("rejects crossed L2 books", () => {
    const r = validateL2Snapshot({ timestamp: 1, bids: [{ price: 101, size: 1 }], asks: [{ price: 100, size: 1 }] });
    assertEqual(r.value, null);
    assertEqual(r.reason, "crossed-book");
});
check("rejects expired/stale option quotes", () => {
    assert(validateOptionQuote({ strike: 100, expiration: Date.now() - 1000, type: "call", openInterest: 1, impliedVolatility: 0.2, underlyingPrice: 100 }).value === null, "expired");
    assert(validateOptionQuote({ strike: 100, expiration: Date.now() + 86_400_000, type: "call", openInterest: -1, impliedVolatility: 0.2, underlyingPrice: 100 }).value === null, "negative OI");
    assert(validateOptionQuote({ strike: 100, expiration: Date.now() + 86_400_000, type: "call", openInterest: 1, impliedVolatility: 99, underlyingPrice: 100 }).value === null, "absurd IV");
});
check("trade batch rejects non-monotonic streams", () => {
    const { trades: ok, rejected } = validateTradeBatch([
        { timestamp: 10, price: 100, size: 1, side: "buy" },
        { timestamp: 5, price: 100, size: 1, side: "buy" }, // out of order
        { timestamp: 20, price: 100, size: 1, side: "buy" },
    ]);
    assertEqual(ok.length, 2);
    assertEqual(rejected, 1);
});

// ── capabilities ─────────────────────────────────────────────────────────────

console.log("Capability detection");
check("canonical provider: candles only, everything else false", () => {
    const caps = canonicalCapabilities();
    assertEqual(caps.candles, true);
    assertEqual(caps.trades, false);
    assertEqual(caps.bidAskClassification, false);
    assertEqual(caps.level2, false);
    assertEqual(caps.historicalLevel2, false);
    assertEqual(caps.options, false);
    assertEqual(caps.openInterest, false);
    assertEqual(caps.impliedVolatility, false);
});
check("candle-only provider: profile + delta estimated, footprint/heatmap/GEX UNAVAILABLE", () => {
    const avail = resolveFeatureAvailability(new CanonicalCandleProvider());
    assert(isFeatureUsable(avail.volumeProfile), "volumeProfile usable");
    assertEqual(avail.volumeProfile.quality, "ESTIMATED");
    assertEqual(avail.delta.quality, "ESTIMATED");
    assertEqual(avail.cumulativeDelta.quality, "ESTIMATED");
    assert(isFeatureUsable(avail.delta), "estimated delta usable (clearly labelled)");
    assert(avail.delta.reason.toLowerCase().includes("not bid/ask"), "delta reason states it is not bid/ask delta");
    assertEqual(avail.footprint.quality, "UNAVAILABLE");
    assertEqual(avail.heatmap.quality, "UNAVAILABLE");
    assertEqual(avail.gex.quality, "UNAVAILABLE");
    assert(avail.delta.reason.length > 10, "explanation present");
});
check("no volume: delta is UNAVAILABLE, not estimated", () => {
    const avail = deriveFeatureAvailability({ ...canonicalCapabilities(), candles: false });
    assertEqual(avail.delta.quality, "UNAVAILABLE");
    assertEqual(avail.cumulativeDelta.quality, "UNAVAILABLE");
});
check("overall quality grades by best data class", () => {
    assertEqual(overallDataQuality(canonicalCapabilities()), "ESTIMATED");
    assertEqual(overallDataQuality({ ...canonicalCapabilities(), bidAskClassification: true }), "HIGH");
    assertEqual(overallDataQuality({ ...canonicalCapabilities(), candles: false }), "UNAVAILABLE");
});
check("declared-but-unimplemented provider capabilities are demoted", () => {
    const liar = {
        id: "liar",
        describeCapabilities: () => ({ ...canonicalCapabilities(), trades: true, bidAskClassification: true, level2: true, options: true }),
    };
    const caps = resolveCapabilities(liar);
    assertEqual(caps.trades, false, "no getTrades → false");
    assertEqual(caps.level2, false, "no getL2 → false");
    assertEqual(caps.options, false, "no chain → false");
});

// ── AI context ───────────────────────────────────────────────────────────────

console.log("OrderFlowContext (AI evidence)");
check("candle-only context: estimated delta labelled, true delta stays unavailable", () => {
    const asOf = Date.UTC(2026, 8, 23, 12, 0);
    const ctx = buildOrderFlowContext({
        symbol: "XAUUSD",
        timeframe: TF,
        mode: "live",
        asOf,
        candles: profileCandles(40).filter((c) => c.timestamp <= asOf),
    });
    assert(ctx.volumeProfile.available, "profile available");
    assertEqual(ctx.delta.available, false, "true delta NOT available from candles");
    assert(ctx.deltaEstimated.available, "estimated delta available");
    assertEqual(ctx.deltaEstimated.dataQuality, "ESTIMATED");
    assertEqual(ctx.deltaEstimated.method, "candle-body-direction-volume");
    assert(ctx.deltaEstimated.value !== null, "estimated delta value present");
    assert(ctx.deltaEstimated.cumulative !== null, "estimated cumulative present");
    assert(ctx.facts.some((f) => f.kind === "FACT" && f.text.includes("Estimated delta") && f.text.includes("not bid/ask")), "estimated-delta fact carries the not-bid/ask caveat");
    assertEqual(ctx.footprint.available, false);
    assertEqual(ctx.heatmap.available, false);
    assertEqual(ctx.gex.available, false);
    assert(ctx.facts.some((f) => f.kind === "FACT" && f.text.includes("POC")), "POC fact present");
    assert(ctx.limitations.some((l) => l.toLowerCase().includes("level 2")), "L2 limitation stated");
    assert(ctx.limitations.some((l) => l.toLowerCase().includes("gex") || l.toLowerCase().includes("options")), "GEX limitation stated");
    assertEqual(ctx.dataQuality, "ESTIMATED");
});
check("estimated delta: volume-less feed yields INSUFFICIENT_HISTORY, not a flat zero series", () => {
    const candles: MarketCandle[] = [
        { timestamp: 1_000, open: 100, high: 101, low: 99, close: 101 },
        { timestamp: 2_000, open: 101, high: 102, low: 100, close: 100 },
    ];
    const r = computeEstimatedDelta(candles, { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assertEqual(r.dataQuality, "INSUFFICIENT_HISTORY");
    assertEqual(r.buckets.length, 0);
});
check("estimated delta: up-candle volume signed positive, doji contributes zero", () => {
    const candles: MarketCandle[] = [
        { timestamp: 1_000, open: 100, high: 101, low: 99, close: 101, volume: 50 },
        { timestamp: 2_000, open: 101, high: 102, low: 100, close: 100, volume: 30 },
        { timestamp: 3_000, open: 100, high: 100.5, low: 99.5, close: 100, volume: 20 },
    ];
    const r = computeEstimatedDelta(candles, { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assertEqual(r.dataQuality, "ESTIMATED");
    assertEqual(r.method, "candle-body-direction-volume");
    approx(r.buckets[0].delta, 50);
    approx(r.buckets[1].delta, -30);
    approx(r.buckets[2].delta, 0, 1e-9, "doji contributes zero");
    approx(r.delta, 20);
    approx(r.cumulativeDelta, 20);
    approx(r.deltaPercent, ((50 - 30) / 80) * 100);
});
check("estimated delta: divergence detection emits ESTIMATED events", () => {
    const candles: MarketCandle[] = [
        { timestamp: 1_000, open: 100, high: 101, low: 99, close: 100.8, volume: 60 },
        { timestamp: 2_000, open: 100.8, high: 101.5, low: 100.2, close: 101.2, volume: 10 },
    ];
    const r = computeEstimatedDelta(candles, { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    const events = detectEstimatedDeltaDivergences(r, [100.8, 101.2], { symbol: "XAUUSD", timeframe: TF, mode: "live" });
    assert(events.some((e) => e.type === "PRICE_UP_DELTA_DOWN"), "price-up/delta-down divergence fired");
    assert(events.every((e) => e.quality === "ESTIMATED" && e.method === "candle-body-direction-volume"), "events carry estimated provenance");
});
check("true trades suppress the estimated proxy (no double counting)", () => {
    const asOf = Date.UTC(2026, 8, 23, 12, 0);
    const candles = profileCandles(20).map((c, i) => ({ ...c, timestamp: asOf - (20 - i) * 300_000 }));
    const t: OrderFlowTrade[] = trades.map((tr, i) => ({ ...tr, timestamp: asOf - (5 - i) * 1_000 }));
    const ctx = buildOrderFlowContext({ symbol: "XAUUSD", timeframe: TF, mode: "live", asOf, candles, trades: t });
    assert(ctx.delta.available, "true delta available");
    assertEqual(ctx.deltaEstimated.available, false, "proxy suppressed when true delta exists");
});
check("asOf boundary drops future candles (defensive)", () => {
    const all = profileCandles(40);
    const asOf = all[19].timestamp + 1;
    const ctx = buildOrderFlowContext({ symbol: "XAUUSD", timeframe: TF, mode: "replay", asOf, candles: all });
    assertEqual(ctx.volumeProfile.kind, "session");
    // The context must only reflect candles ≤ asOf even though 40 were passed.
    const direct = computeVolumeProfile(all.filter((c) => c.timestamp <= asOf), { kind: "session", symbol: "XAUUSD", timeframe: TF, mode: "replay" });
    assertEqual(ctx.volumeProfile.poc, direct.poc);
});
check("trade data unlocks delta facts and confluence evidence", () => {
    const asOf = Date.UTC(2026, 8, 23, 12, 0);
    const candles = profileCandles(20).map((c, i) => ({ ...c, timestamp: asOf - (20 - i) * 300_000 }));
    const t: OrderFlowTrade[] = trades.map((tr, i) => ({ ...tr, timestamp: asOf - (5 - i) * 1_000 }));
    const ctx = buildOrderFlowContext({ symbol: "XAUUSD", timeframe: TF, mode: "live", asOf, candles, trades: t });
    assert(ctx.delta.available, "delta available");
    assert(ctx.delta.value !== null && ctx.delta.value > 0, "positive delta");
    assert(ctx.confluence !== null, "confluence built");
    assert(ctx.confluence!.bullEvidence.includes("POSITIVE_DELTA"), "bull evidence contains POSITIVE_DELTA");
    assert(ctx.facts.some((f) => f.text.includes("Delta")), "delta fact present");
});
check("confluence separates evidence and conflicts", () => {
    const r = buildOrderFlowConfluence({
        candles: [{ close: 101 }],
        vp: { poc: 100, vah: 102, val: 99 },
        delta: { delta: 50, cumulative: 120 },
        imbalances: [{ type: "STACKED_BUY_IMBALANCE" }],
        liquidityEvents: [{ type: "LIQUIDITY_WALL", side: "bid" }],
        absorptionEvents: [],
        exhaustionEvents: [{ type: "BUY_EXHAUSTION" }],
        largeTrades: [{ type: "LARGE_BUY" }],
    });
    assert(r.direction === "bullish", `direction ${r.direction}`);
    assert(r.bullEvidence.includes("PRICE_ABOVE_POC"), "above POC");
    assert(r.bullEvidence.includes("LIQUIDITY_SUPPORT"), "liquidity support");
    assert(r.conflicts.length === 1, "exhaustion flagged as conflict");
});

// ── settings & flags ─────────────────────────────────────────────────────────

console.log("Settings & flags");
check("sanitize clamps absurd settings to safe ranges", () => {
    const s = sanitizeOrderFlowSettings({ valueAreaPercent: 999, imbalanceThreshold: -5, profileBins: "not-a-number", deltaMode: "quantum" });
    approx(s.valueAreaPercent, 95);
    approx(s.imbalanceThreshold, 1.2);
    approx(s.profileBins, DEFAULT_ORDER_FLOW_SETTINGS.profileBins);
    assertEqual(s.deltaMode, "aggressor");
});
check("merge overlays partial stored settings over defaults", () => {
    const s = mergeOrderFlowSettings({ valueAreaPercent: 80 });
    approx(s.valueAreaPercent, 80);
    assertEqual(s.footprintDensity, DEFAULT_ORDER_FLOW_SETTINGS.footprintDensity);
});
check("feature flags default on and gate correctly", () => {
    assert(orderFlowGate("orderFlow.enabled") === true, "master flag on");
    assert(orderFlowGate("orderFlow.gex") === true, "gex flag on");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
