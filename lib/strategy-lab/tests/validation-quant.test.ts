// ─────────────────────────────────────────────────────────────────────────────
// Purged validation × Strategy Lab integration test.
//
// Proves the quant layer is wired to the EXISTING backtest engine (not a second
// engine): each fold is evaluated by `backtestStrategy`, out-of-sample trade
// returns are pooled, and the experiment record is reproducible.
//
// Synthetic candles only. No network, no RTDB, no AI, no Math.random.
// Run: npm run test:quant:integration
// ─────────────────────────────────────────────────────────────────────────────

import type { MarketCandle } from "@/lib/market-data/types";
import type { Strategy } from "../types";
import { defaultBacktestConfig } from "../backtest";
import { validateStrategyPurged } from "../validation-quant";

let failures = 0;
function check(cond: boolean, label: string, detail?: unknown): void {
    if (cond) {
        console.log(`  PASS: ${label}`);
    } else {
        failures++;
        console.error(`  FAIL: ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
    }
}

const BASE = 1_750_000_000_000;
const STEP_MS = 15 * 60 * 1000;

/** Deterministic wave + drift: produces both winning and losing trades. */
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
        id: "strat_quant_integration",
        name: "Purged Validation Integration",
        description: "Empty-rule smoke strategy over synthetic candles",
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

console.log("\nstrategy-lab purged validation");

const series = candles(420);
const input = {
    strategy: strategy(),
    symbol: "XAUUSD" as const,
    timeframe: "M15" as const,
    config: defaultBacktestConfig(),
    candles: series,
    folds: 3,
    labelSpan: 2,
    embargoSamples: 1,
    trials: 1,
    seed: 11,
};

const first = validateStrategyPurged(input);
check(!("available" in first), "validation executes over synthetic candles", first);
if ("available" in first) {
    console.log(`\n❌ ${failures + 1} INTEGRATION TEST(S) FAILED`);
    process.exit(1);
}

check(first.foldResults.length === 3, "one backtest pair per fold", first.foldResults.length);
check(
    first.foldResults.every((f) => f.train.metrics && f.test.metrics),
    "each fold ran the existing backtest engine for train and test",
);
check(first.totalTrainTrades > 0, "training slices produced trades", first.totalTrainTrades);
check(first.totalTestTrades > 0, "test slices produced out-of-sample trades", first.totalTestTrades);
check(first.pooledTestReturns.length === first.totalTestTrades, "pooled returns come from real trades");
check(first.dsr.available === true, "pooled OOS returns produce a DSR", first.dsr);
check(first.composite.verdict !== "SUPPORTED" || (first.dsr.available && first.dsr.dsr >= 0.95), "verdict is evidence-bound");
check(first.experiment.method === "PURGED_KFOLD", "experiment record names the method");
check(first.experiment.parameters.labelSpan === 2, "label span is recorded for reproducibility");

const second = validateStrategyPurged(input);
if (!("available" in second)) {
    check(second.experiment.experimentId === first.experiment.experimentId, "identical inputs → identical experiment id");
    check(
        JSON.stringify(second.pooledTestReturns) === JSON.stringify(first.pooledTestReturns),
        "identical inputs → identical out-of-sample returns (deterministic engine)",
    );
} else {
    check(false, "second run executed");
}

const tooFew = validateStrategyPurged({ ...input, candles: series.slice(0, 100) });
check("available" in tooFew && tooFew.available === false, "insufficient candles → unavailable, never a fake validation");

const badFolds = validateStrategyPurged({ ...input, folds: 1 });
check("available" in badFolds && badFolds.available === false, "one fold → unavailable");

console.log(`\n${failures === 0 ? "🎉 ALL QUANT-INTEGRATION TESTS PASSED" : `❌ ${failures} INTEGRATION TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
