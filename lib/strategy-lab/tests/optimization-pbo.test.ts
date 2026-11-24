// ─────────────────────────────────────────────────────────────────────────────
// PBO × Strategy Lab optimizer.
//
// Proves the CSCV matrix comes from the optimizer's REAL runs, that block
// returns never use later equity, that repeated configurations are not counted
// as independent trials, and that PBO stays research evidence.
//
// Run: npm run test:optimization:pbo
// ─────────────────────────────────────────────────────────────────────────────

import type { EquityPoint, Strategy } from "../types";
import type { MarketCandle } from "@/lib/market-data/types";
import { defaultBacktestConfig } from "../backtest";
import { optimizeStrategy } from "../optimization";
import {
    DEFAULT_PBO_BLOCKS,
    blockReturnsFromEquity,
    buildOptimizationBlockReturns,
    optimizationBlockBoundaries,
    pboFromOptimizationSamples,
} from "../optimization-pbo";

let failures = 0;
function check(cond: boolean, label: string, detail?: unknown): void {
    if (cond) console.log(`  PASS: ${label}`);
    else {
        failures++;
        console.error(`  FAIL: ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
    }
}
function close(actual: number, expected: number, tolerance: number, label: string): void {
    const diff = Math.abs(actual - expected);
    check(diff <= tolerance, label, { actual, expected, diff });
}
function section(name: string): void {
    console.log(`\n${name}`);
}

// ── Block-return sampling ────────────────────────────────────────────────
section("block returns");
const boundaries = optimizationBlockBoundaries(0, 40, 4)!;
check(boundaries.length === 4 && boundaries[3] === 40, "shared boundaries cover the window", boundaries);
check(optimizationBlockBoundaries(10, 10, 4) === null, "an empty window is rejected");
check(optimizationBlockBoundaries(0, 40, 5) === null, "odd block counts are rejected");

const point = (time: number, balance: number): EquityPoint => ({ time, balance, equity: balance, drawdownPct: 0, drawdownAbs: 0 });
const equity: EquityPoint[] = [
    point(0, 100),
    point(10, 110),
    point(20, 99),
    point(30, 148.5),
    point(40, 160),
];
const series = blockReturnsFromEquity(equity, boundaries, 0)!;
check(series.length === 4, "one return per block");
close(series[0], 0.1, 1e-12, "block 1 return uses the boundary balance exactly");
close(series[1], 99 / 110 - 1, 1e-12, "block 2 return compounds from the previous boundary");
close(series[2], 148.5 / 99 - 1, 1e-12, "block 3 return compounds from the previous boundary");
close(series[3], 160 / 148.5 - 1, 1e-12, "block 4 return compounds from the previous boundary");

// A jump AFTER a boundary must not change the earlier block's return.
const leaked: EquityPoint[] = [point(0, 100), point(10, 110), point(25, 500), point(40, 500)];
const leakSeries = blockReturnsFromEquity(leaked, boundaries, 0)!;
close(leakSeries[0], 0.1, 1e-12, "a later jump cannot change an earlier block's return");
check(leakSeries[1] === 0, "a block with no balance at its boundary carries forward (0% from the boundary sample)", leakSeries);

const missingCoverage = blockReturnsFromEquity(
    [point(0, 100), point(5, 101)],
    boundaries,
    0,
);
check(missingCoverage === null, "coverage that stops early yields no series, never a fabricated return");

const nonPositive = blockReturnsFromEquity(
    [point(0, 100), point(10, 0), point(40, 0)],
    boundaries,
    0,
);
check(nonPositive === null, "a non-positive balance invalidates the series");

// ── Matrix construction / dedupe ─────────────────────────────────────────
section("matrix construction");
const flat = (value: number): EquityPoint[] => [point(0, 100), point(40, 100 * (1 + value))];

const duplicated: Array<{ configKey: string; equity: EquityPoint[] }> = [
    { configKey: "a", equity: flat(0.1) },
    { configKey: "a", equity: flat(0.1) },
    { configKey: "b", equity: flat(0.0) },
];
const built = buildOptimizationBlockReturns(duplicated, 0, 40, 4);
check(built.available, "matrix builds from two distinct configurations");
if (built.available) {
    check(built.configurations === 2, "a repeated configuration is ONE trial, not two", built.configurations);
}
const single = buildOptimizationBlockReturns([{ configKey: "a", equity: flat(0.1) }], 0, 40, 4);
check(!single.available, "one distinct configuration is insufficient");
if (!single.available) check(/two distinct/i.test(single.reason), "the reason names the missing configurations", single.reason);

// ── PBO over samples ─────────────────────────────────────────────────────
section("PBO over optimizer samples");
const blockCount = 8;
const dominantSamples = Array.from({ length: 4 }, (_, i) => ({
    configKey: `cfg-${i}`,
    returns: Array.from({ length: blockCount }, (_, b) => (i === 0 ? 0.02 + b * 0.0001 : ((b * 7 + i * 3) % 5) * 0.001 - 0.002)),
}));
const dominant = pboFromOptimizationSamples({ samples: dominantSamples, blocks: blockCount, sampledRuns: 6 });
check(dominant.available && dominant.pbo === 0, "the configuration that wins every block has PBO 0", dominant);
check(dominant.researchOnly === true, "PBO is explicitly research evidence");
check(dominant.sampledRuns === 6, "the number of sampled optimizer runs is recorded");
check(dominant.configurations === 4, "the number of distinct configurations is recorded");
check(/never authorises/i.test(dominant.note), "the note separates research evidence from trading authorization");

const duplicateSamples = [
    { configKey: "same", returns: Array.from({ length: blockCount }, () => 0.01) },
    { configKey: "same", returns: Array.from({ length: blockCount }, () => 0.01) },
];
const duplicatePbo = pboFromOptimizationSamples({ samples: duplicateSamples, blocks: blockCount, sampledRuns: 2 });
check(!duplicatePbo.available, "the same configuration twice does not fake two trials");
if (!duplicatePbo.available) check(/two distinct/i.test(duplicatePbo.reason ?? ""), "the reason is honest");

const shortSample = pboFromOptimizationSamples({
    samples: [
        { configKey: "a", returns: [0.01, 0.02] },
        { configKey: "b", returns: [0, 0, 0, 0, 0, 0, 0, 0] },
    ],
    blocks: blockCount,
    sampledRuns: 2,
});
check(!shortSample.available, "a run missing blocks makes PBO unavailable");

// ── Real optimizer run ───────────────────────────────────────────────────
section("optimizer integration");
const BASE = 1_750_000_000_000;
const STEP_MS = 15 * 60 * 1000;
function candles(n: number): MarketCandle[] {
    return Array.from({ length: n }, (_, i) => {
        const mid = 4000 + 24 * Math.sin(i / 11) + i * 0.06;
        return {
            timestamp: BASE + i * STEP_MS,
            open: mid,
            high: mid + 0.9,
            low: mid - 0.9,
            close: mid + 0.25 * Math.cos(i / 7),
            volume: 1000,
        };
    });
}
function strategy(): Strategy {
    return {
        id: "strat_pbo_integration",
        name: "PBO Integration",
        description: "Grid optimizer over synthetic candles",
        asset: "XAUUSD",
        direction: "long",
        timeframes: { macro: "M15", structure: "M15", setup: "M15", entry: "M15" },
        regimeFilter: [],
        entryRules: [],
        confirmationRules: [],
        stopLoss: { mode: "atr", atrMultiple: 1.5, levelOffset: 0, useSwing: false },
        takeProfit: {
            mode: "r",
            r1: 1,
            r2: 2,
            r3: 3,
            fixedDistance: 0,
            partialCloses: [
                { atR: 1, closePercent: 33 },
                { atR: 2, closePercent: 33 },
            ],
            moveBeAfterTp1: true,
            lockAfterTp2: true,
            trailingEnabled: false,
            trailingStopAtr: 1.5,
        },
        risk: { mode: "percent", riskPercent: 1, fixedLot: 0.01, maxPositions: 1, dailyLossLimitPct: 99, maxDrawdownPct: 99 },
        filters: {
            sessions: [],
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            volatilityMinAtrPct: 0,
            volatilityMaxAtrPct: 0,
            maxTradesPerDay: 99,
            cooldownCandles: 0,
        },
        executionModel: "next_bar_open",
        costs: { spreadPips: 20, commissionPerLot: 7, slippagePips: 1 },
        sourcePatternId: null,
        whyp: {
            discovered: "",
            conditionsSelected: "",
            occurrenceFrequency: "",
            historicalPerformance: "",
            weaknesses: "",
            poorRegimes: "",
            generatedByProvider: "test",
            version: "1.0.0",
            created: 1,
            updated: 1,
        } as unknown as Strategy["whyp"],
        version: "1.0.0",
        created: 1,
        updated: 1,
    } as Strategy;
}

const data = candles(480);
const from = data[0].timestamp;
const to = data[data.length - 1].timestamp;
const outcome = optimizeStrategy(
    strategy(),
    "XAUUSD",
    "M15",
    data,
    [
        { param: "slAtr", values: [1.0, 1.5, 2.0] },
        { param: "tp1R", values: [1, 1.5] },
    ],
    defaultBacktestConfig(),
    4,
    from,
    to,
);

check(outcome.results.length === 4, "the optimizer capped the grid at maxRuns", outcome.results.length);
check(outcome.pbo !== undefined, "the optimizer attaches a PBO summary");
if (outcome.pbo) {
    check(outcome.pbo.researchOnly === true, "PBO never authorizes trading");
    check(outcome.pbo.sampledRuns === outcome.results.length, "sampledRuns matches the runs performed");
    if (outcome.pbo.available) {
        check(outcome.pbo.pbo !== undefined && outcome.pbo.pbo >= 0 && outcome.pbo.pbo <= 1, "PBO is a probability");
        check(outcome.pbo.blocks === DEFAULT_PBO_BLOCKS, "the default block count is recorded");
        check((outcome.pbo.configurations ?? 0) >= 2, "at least two distinct configurations entered the matrix");
    } else {
        const reason = outcome.pbo.reason ?? "";
        check(reason.length > 0, "an unavailable PBO explains why", reason);
    }
}

console.log(`\n${failures === 0 ? "🎉 ALL OPTIMIZER-PBO TESTS PASSED" : `❌ ${failures} OPTIMIZER-PBO TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
