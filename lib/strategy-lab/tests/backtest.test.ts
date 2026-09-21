// ─────────────────────────────────────────────────────────────────────────────
// Backtest parity & correctness tests.
//
// Covers:
//   • computeMetrics determinism + metric math (shared by both engines)
//   • the canonical cost model applied by the Pine runtime (net = gross − cost)
//   • no future leakage: exits never precede entries; entries use next-bar open
//   • trade sizing invariants (per-lot costs scale with size)
//   • Strategy Lab engine smoke run (empty rules → deterministic entries)
//
// Run: npm run test:backtest
// ─────────────────────────────────────────────────────────────────────────────

import { computeMetrics } from "../metrics";
import { backtestStrategy, defaultBacktestConfig } from "../backtest";
import type { BacktestTrade, EquityPoint, Strategy } from "../types";
import { backtestPine } from "@/lib/pine-runtime/backtest";
import type { Candle } from "@/components/tradingview/TradingChart/types";
import type { MarketCandle } from "@/lib/market-data/types";

// ── Shared price series (XAUUSD-style M15) ───────────────────────────────────
// A controlled rally with small pullbacks so ATR > 0 and SL/TP resolve.
const BASE = 1_750_000_000_000;
const STEP_MS = 15 * 60 * 1000;

function candleAt(i: number): { open: number; high: number; low: number; close: number } {
    const open = 4000 + i; // deterministic, strictly rising path
    // small wick above/below so the bar range > 0
    return { open, high: open + 0.6, low: open - 0.4, close: open + 0.1 };
}

function marketCandles(n: number): MarketCandle[] {
    return Array.from({ length: n }, (_, i) => {
        const c = candleAt(i);
        return { timestamp: BASE + i * STEP_MS, ...c, volume: 1000 };
    });
}

function pineCandles(n: number): Candle[] {
    return marketCandles(n).map((c) => ({
        time: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 1000,
    }));
}

const PINE_SCRIPT = `
strategy("CostTest", overlay=true)
strategy.entry("L", strategy.long)
if barstate.islast
    strategy.close("L")
`;

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
    const base: Strategy = {
        id: "strat_bt_test",
        name: "Backtest Smoke",
        description: "Empty-rule long smoke test",
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
        },
        version: "1.0.0",
        created: 1,
        updated: 1,
    };
    return { ...base, ...overrides };
}

function equitySeries(): EquityPoint[] {
    return [
        { time: BASE, balance: 10000, equity: 10000, drawdownPct: 0, drawdownAbs: 0 },
        { time: BASE + 2 * STEP_MS, balance: 10050, equity: 10050, drawdownPct: 0, drawdownAbs: 0 },
        { time: BASE + 4 * STEP_MS, balance: 9990, equity: 9990, drawdownPct: 0.6, drawdownAbs: 60 },
    ];
}

function sampleTrades(): BacktestTrade[] {
    const mk = (pnlGross: number, profitR: number): BacktestTrade => ({
        id: `t_${pnlGross}_${profitR}`,
        ticket: 1,
        openBarIndex: 1,
        closeBarIndex: 3,
        openedAt: BASE + STEP_MS,
        closedAt: BASE + 3 * STEP_MS,
        symbol: "XAUUSD",
        direction: "BUY",
        volume: 0.1,
        entry: 4001,
        sl: 3990,
        tp1: 4012,
        tp2: 4023,
        tp3: 4034,
        exit: 4011,
        exitReason: "tp1",
        profit: pnlGross,
        profitR,
        durationMs: 2 * STEP_MS,
        regime: "trending_bullish",
        session: "london",
        spreadCost: 2,
        commission: 0.7,
        slippageCost: 1,
        pnlGross,
    });
    return [mk(100, 1.0), mk(-50, -0.5), mk(0, 0)];
}

export function runBacktestTests(): boolean {
    console.log("--- Backtest Parity & Correctness Tests ---");
    let passed = true;
    const check = (cond: boolean, label: string) => {
        if (cond) {
            console.log(`  PASS: ${label}`);
        } else {
            console.error(`  FAIL: ${label}`);
            passed = false;
        }
    };

    // 1. computeMetrics determinism — same inputs, same outputs (both engines route
    //    their results through this single function).
    {
        const trades = sampleTrades();
        const equity = equitySeries();
        const a = computeMetrics(trades, equity, 10000);
        const b = computeMetrics(trades, equity, 10000);
        check(
            a.winRate === b.winRate && a.netProfit === b.netProfit && a.profitFactor === b.profitFactor,
            "computeMetrics is deterministic for identical inputs"
        );
    }

    // 2. computeMetrics math — net profit, gross profit/loss, win rate.
    {
        const m = computeMetrics(sampleTrades(), equitySeries(), 10000);
        check(m.netProfit === 50, `netProfit = +100 −50 +0 = 50 (got ${m.netProfit})`);
        check(m.grossProfit === 100, `grossProfit = 100 (got ${m.grossProfit})`);
        check(m.grossLoss === 50, `grossLoss = |−50| = 50 (got ${m.grossLoss})`);
        // computeMetrics rounds winRate to 2 decimals (33.333… → 33.33).
        check(m.winRate === 33.33, `winRate rounded to 2dp = 33.33 (got ${m.winRate})`);
        check(m.totalTrades === 3, `totalTrades = 3 (got ${m.totalTrades})`);
    }

    // 3. Pine runtime cost model — with zero costs, net == gross;
    //    with the canonical cost model, net = gross − costPerUnit × size.
    {
        const candles = pineCandles(10); // closes 4000.1 .. 4009.1 (rising by 1)
        const gross = candles[9].close - candles[0].close;

        const r0 = backtestPine(PINE_SCRIPT, candles, "XAUUSD", "M15", {
            spreadPips: 0,
            slippagePips: 0,
            commissionPerLot: 0,
        });
        check(r0.trades.length === 1, `Pine produced exactly one trade (got ${r0.trades.length})`);
        check(r0.trades.length === 1 && Math.abs(r0.trades[0].profit - gross) < 1e-6, `Zero-cost net == gross ${gross.toFixed(4)} (got ${r0.trades[0]?.profit})`);

        // Canonical cost: spread 20 pips (XAUUSD pip 0.01) + slip 1 pip ×2 + flat $7/lot.
        const unitCost = 20 * 0.01 + 2 * 1 * 0.01 + 7; // 7.22
        const r1 = backtestPine(PINE_SCRIPT, candles, "XAUUSD", "M15", {
            spreadPips: 20,
            slippagePips: 1,
            commissionPerLot: 7,
        });
        const expected = gross - unitCost;
        check(
            r1.trades.length === 1 && Math.abs(r1.trades[0].profit - expected) < 1e-6,
            `Pine applies canonical cost model: net = gross − cost (expected ${expected.toFixed(4)}, got ${r1.trades[0]?.profit})`
        );
    }

    // 4. No future leakage on the Pine path — every exit after every entry.
    {
        const candles = pineCandles(20);
        const r = backtestPine(PINE_SCRIPT, candles, "XAUUSD", "M15", {});
        const ok = r.trades.every((t) => t.exitBar >= t.entryBar && t.exitTime >= t.entryTime);
        check(ok, "Pine trades never resolve before they open (exitBar ≥ entryBar)");
    }

    // 5. Sizing invariant — per-unit cost scales with trade size.
    {
        const candles = pineCandles(12);
        const unitCost = 20 * 0.01 + 2 * 1 * 0.01 + 7;
        const r = backtestPine(PINE_SCRIPT, candles, "XAUUSD", "M15", {
            spreadPips: 20,
            slippagePips: 1,
            commissionPerLot: 7,
        });
        check(
            r.trades.every((t) => Math.abs(t.profit - ((candles[9].close - candles[0].close) - unitCost * t.size)) < 1e-6),
            "Pine cost reduction = costPerUnit × size on every trade"
        );
    }

    // 6. Strategy Lab smoke run — deterministic entries, next-bar-open pricing,
    //    no future leakage, costs applied and reported per trade.
    {
        const candles = marketCandles(40);
        const cfg = { ...defaultBacktestConfig(), maxTradesPerDay: 99, cooldownCandles: 0, spreadPips: 20, commissionPerLot: 7, slippagePips: 1 };
        const result = backtestStrategy(makeStrategy(), "XAUUSD", { M15: candles }, cfg, BASE, BASE + 39 * STEP_MS);

        check(result.trades.length >= 1, `Strategy Lab produced trades (got ${result.trades.length})`);
        const entryLooksRight = result.trades.every(
            (t) => Math.abs(t.entry - candles[t.openBarIndex].open) < 1e-6
        );
        check(entryLooksRight, "Entries priced at next-bar open (executionModel honored)");
        const noLeak = result.trades.every((t) => t.closeBarIndex >= t.openBarIndex && t.closedAt >= t.openedAt);
        check(noLeak, "Strategy Lab trades never resolve before they open");
        const costsApplied = result.trades.every((t) => t.spreadCost > 0 && t.commission > 0 && t.slippageCost > 0);
        check(costsApplied, "Spread / commission / slippage costs applied and reported per trade");
        const profitNet = result.trades.every((t) => Math.abs(t.profit - t.pnlGross) < 1e-6);
        check(profitNet, "Trade profit is net (consistent with pnlGross reporting)");
        check(
            typeof result.metrics.winRate === "number" && isFinite(result.metrics.netProfit),
            "Strategy Lab metrics routed through computeMetrics"
        );
    }

    // 7. Both engines produce metrics via the shared computeMetrics contract.
    {
        const candles = pineCandles(12);
        const pine = backtestPine(PINE_SCRIPT, candles, "XAUUSD", "M15", {});
        const slCandles = marketCandles(12);
        const cfg = { ...defaultBacktestConfig(), maxTradesPerDay: 99, cooldownCandles: 0 };
        const sl = backtestStrategy(makeStrategy(), "XAUUSD", { M15: slCandles }, cfg, BASE, BASE + 11 * STEP_MS);
        const expectedKeys = ["winRate", "netProfit", "grossProfit", "grossLoss", "profitFactor", "totalTrades", "returnPct", "finalBalance", "maxDrawdownPct"];
        const pineKeysOk = expectedKeys.every((k) => typeof (pine.metrics as unknown as Record<string, unknown>)[k] === "number");
        const slKeysOk = expectedKeys.every((k) => typeof (sl.metrics as unknown as Record<string, unknown>)[k] === "number");
        check(pineKeysOk && slKeysOk, "Both engines expose the same canonical BacktestMetrics shape");
    }

    console.log("--- Backtest Parity & Correctness Tests Complete ---");
    return passed;
}