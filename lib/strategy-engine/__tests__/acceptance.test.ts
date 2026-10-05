// Acceptance tests (spec §52): the deterministic test strategy must produce
// the SAME decisions across Chart(evaluateStrategySignal) / Backtest / Replay /
// Paper. Execution prices may differ per environment; conditions may not.

import {
    acceptanceSeries,
    acceptanceStrategy,
    approx,
    check,
    section,
} from "./harness";
import { buildSeriesMap, evaluateEntry } from "../decisions";
import {
    evaluateStrategySignal,
    backtestStrategy,
    defaultBacktestConfig,
} from "@/lib/strategy-lab/backtest";
import { computeFeatures } from "@/lib/strategy-lab/features";
import { ReplaySession } from "../replay";
import { PaperTradingSession } from "../paper";

export function runAcceptanceTests(): boolean {
    const { candles, bosAvailableAt } = acceptanceSeries();
    const strategy = acceptanceStrategy();
    const seriesMap = buildSeriesMap({ M5: candles });

    section("Acceptance: EMA20>EMA50 AND RSI>50 AND bullish BOS → LONG");
    const before = evaluateEntry({ strategy, seriesMap, index: bosAvailableAt - 1 });
    check(!before.fired, `no signal before BOS confirms (blocked: ${before.blockedBy})`);
    check(before.blockedBy === "entry_rules", "blocked specifically by entry rules");

    const at = evaluateEntry({ strategy, seriesMap, index: bosAvailableAt });
    check(at.fired, `signal fires exactly when bullish BOS is confirmed (bar ${bosAvailableAt})`);
    check(
        at.conditions.includes("EMA20 > EMA50") && at.conditions.includes("RSI > 50") && at.conditions.includes("Bullish BOS"),
        "all three conditions reported"
    );

    // Each condition is genuinely required.
    const rsiImpossible = acceptanceStrategy({
        entryRules: strategy.entryRules.map((r) => (r.indicator === "rsi" ? { ...r, value: 99 } : r)),
    });
    const rsiBlocked = evaluateEntry({ strategy: rsiImpossible, seriesMap, index: bosAvailableAt });
    check(!rsiBlocked.fired && rsiBlocked.blockedBy === "entry_rules", "RSI > 99 blocks the entry");

    const noBos = acceptanceStrategy({
        entryRules: strategy.entryRules.filter((r) => r.group !== "structure"),
    });
    let firstFiredWithoutBos = -1;
    for (let i = 5; i < candles.length; i++) {
        if (evaluateEntry({ strategy: noBos, seriesMap, index: i }).fired) {
            firstFiredWithoutBos = i;
            break;
        }
    }
    check(
        firstFiredWithoutBos !== -1 && firstFiredWithoutBos < bosAvailableAt,
        `without the BOS rule the signal appears earlier (bar ${firstFiredWithoutBos} < ${bosAvailableAt})`
    );

    section("Acceptance: Chart / forward signal parity");
    const chartSignal = evaluateStrategySignal(strategy, { M5: candles }, candles[bosAvailableAt].timestamp);
    check(chartSignal.fired, "forward/chart evaluator fires at the same bar");
    const chartLast = evaluateStrategySignal(strategy, { M5: candles });
    const engineLast = evaluateEntry({ strategy, seriesMap, index: candles.length - 1 });
    check(chartLast.fired === engineLast.fired, "forward evaluator and engine agree on the latest bar");

    section("Acceptance: backtest execution (next-bar-open, 1% risk, SL=1ATR, TP=2ATR)");
    const cfg = defaultBacktestConfig();
    const result = backtestStrategy(strategy, "XAUUSD", { M5: candles }, cfg, candles[0].timestamp, candles[candles.length - 1].timestamp);
    check(result.trades.length >= 1, `backtest produced trades (${result.trades.length})`);

    const t0 = result.trades[0];
    if (t0) {
        check(t0.direction === "BUY", "first trade is LONG");
        check(t0.openBarIndex === bosAvailableAt + 1, `entry fills at next bar open (bar ${t0.openBarIndex})`);
        check(approx(t0.entry, candles[t0.openBarIndex].open, 0.005), "entry price = next bar open");

        const signalFeatures = computeFeatures(candles)[bosAvailableAt];
        check(approx(t0.entry - t0.sl, signalFeatures.atr, 0.02), "SL distance = 1 × ATR at signal bar");

        const risk = t0.entry - t0.sl;
        check(approx(t0.tp1, t0.entry + 2 * risk, 0.02), "TP distance = 2 × risk = 2 ATR");

        const expectedVolume = Math.round((100 / (risk * 100)) * 100) / 100; // 1% of 10 000
        check(approx(t0.volume, expectedVolume, 0.011), `position sized at 1% equity (got ${t0.volume}, expected ~${expectedVolume})`);
        check(t0.closeBarIndex >= t0.openBarIndex, "no look-ahead: exit never precedes entry");
    }

    section("Acceptance: replay uses the SAME engine → identical trades");
    const replay = new ReplaySession({
        symbol: "XAUUSD",
        timeframe: "M5",
        candles,
        strategy,
        initialBalance: cfg.initialBalance,
        costs: { spreadPips: cfg.spreadPips, slippagePips: cfg.slippagePips, commissionPerLot: cfg.commissionPerLot },
    });
    while (!replay.atEnd()) replay.stepForward();
    const replayTrades = replay.frame().closedTrades;
    check(replayTrades.length === result.trades.length, `replay trades == backtest trades (${replayTrades.length} vs ${result.trades.length})`);

    const backtestShape = result.trades.map((t) => `${t.openBarIndex}->${t.closeBarIndex}:${t.pnlGross.toFixed(2)}`);
    const replayShape = replayTrades.map((t) => `${t.openBarIndex}->${t.closeBarIndex}:${t.realizedPnL.toFixed(2)}`);
    check(
        JSON.stringify(backtestShape) === JSON.stringify(replayShape),
        `trade-by-trade parity\n      backtest: ${JSON.stringify(backtestShape)}\n      replay:   ${JSON.stringify(replayShape)}`
    );

    section("Acceptance: paper uses real quotes, virtual capital, same conditions");
    let wall = Date.UTC(2026, 0, 10);
    const paper = new PaperTradingSession({
        symbol: "XAUUSD",
        timeframe: "M5",
        initialBalance: cfg.initialBalance,
        strategy,
        costs: { spreadPips: cfg.spreadPips, slippagePips: cfg.slippagePips, commissionPerLot: cfg.commissionPerLot },
        maxQuoteAgeMs: 60_000,
        wallClock: () => wall,
    });
    for (const c of candles) {
        paper.feedQuote({ bid: c.close - 0.1, ask: c.close + 0.1, timestamp: wall });
        paper.feedCandle(c);
        wall += 1;
    }
    const paperTrades = paper.getClosedTrades();
    check(paper.status().label === "PAPER TRADING", "paper session always labelled PAPER TRADING");
    check(paper.getAccount().environment === "paper", "account is a paper account");
    check(paperTrades.length >= 1, `paper trading took the same signal (${paperTrades.length} trades)`);

    if (t0 && paperTrades[0]) {
        const paperSignalIndex = Number(paperTrades[0].meta?.signalIndex ?? -1);
        check(
            paperSignalIndex === bosAvailableAt,
            `paper fired on the SAME signal bar (paper ${paperSignalIndex} vs backtest ${bosAvailableAt})`
        );
        const paperRisk = Math.abs(paperTrades[0].entryPrice - paperTrades[0].stopLoss);
        const backtestRisk = t0.entry - t0.sl;
        check(
            Math.abs(paperRisk - backtestRisk) / backtestRisk < 0.1,
            "SL = 1 ATR relative to the actual fill (execution price may differ, distance consistent)"
        );
    }

    return true;
}
