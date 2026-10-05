/**
 * Dashboard trend projection — standalone test suite.
 *
 * Follows the repo's runner convention (see tests/chart-engine/chart-engine.test.ts):
 *
 *     node scripts/jiti-tsrun.mjs tests/dashboard/trend-projection.test.ts
 *
 * The projection is the dashed "trend projection" line on the dashboard's Live
 * Chart widget, so it must be exact for deterministic inputs and honest
 * (null / flat) when there is nothing to fit.
 */

import { trendProjection, type TrendSample } from "../../components/dashboard/trend-projection";

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
}

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

function linear(count: number, start: number, step: number): TrendSample[] {
    return Array.from({ length: count }, (_, i) => ({ time: i, close: start + i * step }));
}

console.log("trend-projection");

check("perfect uptrend extrapolates the slope past the last close", () => {
    const candles = linear(40, 100, 1); // 100 … 139
    const result = trendProjection(candles, { lookback: 30, horizon: 8 });
    assert(result, "expected a projection");
    assert(result!.direction === "up", `expected up, got ${result!.direction}`);
    assert(Math.abs(result!.slope - 1) < 1e-9, `slope ${result!.slope}`);
    assert(Math.abs(result!.price - 147) < 1e-9, `price ${result!.price}`);
    assert(result!.lastClose === 139, `lastClose ${result!.lastClose}`);
    assert(result!.bars === 30, `bars ${result!.bars}`);
    assert(Math.abs(result!.rSquared - 1) < 1e-9, `rSquared ${result!.rSquared}`);
});

check("downtrend projects below the last close", () => {
    const candles = linear(40, 200, -2);
    const result = trendProjection(candles, { lookback: 20, horizon: 5 });
    assert(result, "expected a projection");
    assert(result!.direction === "down", `expected down, got ${result!.direction}`);
    const last = candles[candles.length - 1].close;
    assert(result!.price < last, `projected ${result!.price} should be below ${last}`);
    assert(Math.abs(result!.price - (last - 10)) < 1e-9, `price ${result!.price}`);
});

check("a flat series projects the same price and reports flat", () => {
    const candles = linear(30, 500, 0);
    const result = trendProjection(candles, { lookback: 30, horizon: 10 });
    assert(result, "expected a projection");
    assert(result!.direction === "flat", `expected flat, got ${result!.direction}`);
    assert(Math.abs(result!.price - 500) < 1e-9, `price ${result!.price}`);
    assert(Math.abs(result!.slope) < 1e-9, `slope ${result!.slope}`);
});

check("returns null when there are fewer candles than the minimum window", () => {
    assert(trendProjection(linear(7, 100, 1)) === null, "expected null for 7 candles");
    assert(trendProjection([], {}) === null, "expected null for an empty series");
});

check("returns null instead of fitting garbage", () => {
    const broken = [
        { time: 0, close: Number.NaN },
        { time: 1, close: Number.POSITIVE_INFINITY },
        { time: 2, close: Number.NaN },
        { time: 3, close: 1 },
        { time: 4, close: 2 },
        { time: 5, close: 3 },
        { time: 6, close: 4 },
        { time: 7, close: 5 },
        { time: 8, close: 6 },
        { time: 9, close: Number.NaN },
    ];
    // Only 7 usable points remain after filtering → below the 8-point minimum.
    assert(trendProjection(broken) === null, "expected null after filtering non-finite closes");
    assert(trendProjection(null as unknown as TrendSample[]) === null, "expected null for null input");
});

check("only the most recent `lookback` candles drive the projection", () => {
    // Long flat history, then a sharp 4-point-per-bar run at the end. With a
    // lookback of 10 the projection must follow the recent run, not the flat.
    const candles: TrendSample[] = [
        ...linear(30, 100, 0),
        ...linear(10, 100, 4).map((c, i) => ({ time: 30 + i, close: c.close })),
    ];
    const result = trendProjection(candles, { lookback: 10, horizon: 2 });
    assert(result, "expected a projection");
    assert(result!.bars === 10, `bars ${result!.bars}`);
    assert(result!.direction === "up", `expected up, got ${result!.direction}`);
    assert(result!.price > result!.lastClose, "projection should sit above the last close");
    assert(Math.abs(result!.slope - 4) < 1e-9, `slope ${result!.slope}`);
});

check("noisy data still yields a bounded r² and a finite price", () => {
    const candles: TrendSample[] = Array.from({ length: 60 }, (_, i) => ({
        time: i,
        close: 1000 + i * 0.5 + Math.sin(i) * 3,
    }));
    const result = trendProjection(candles, { lookback: 40, horizon: 6 });
    assert(result, "expected a projection");
    assert(Number.isFinite(result!.price), `price not finite: ${result!.price}`);
    assert(result!.rSquared >= 0 && result!.rSquared <= 1, `rSquared out of range: ${result!.rSquared}`);
    assert(result!.direction === "up", `expected a rising fit, got ${result!.direction}`);
});

check("non-finite options fall back to null rather than NaN output", () => {
    assert(trendProjection(linear(20, 100, 1), { lookback: Number.NaN }) === null, "expected null for NaN lookback");
    assert(trendProjection(linear(20, 100, 1), { horizon: Number.NaN }) === null, "expected null for NaN horizon");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
