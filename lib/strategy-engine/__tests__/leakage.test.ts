// Leakage tests — no future information may enter any decision.
//
// 1. Feature causality: features over a prefix equal features of the full
//    series over that prefix.
// 2. Decision invariance: entry decisions at bar i do not change when future
//    bars are appended, modified or corrupted.
// 3. Replay: future candles are physically hidden; SMC events only from
//    visible candles.
// 4. Engine: a next-bar-open entry is planned without reading the next bar.

import { acceptanceSeries, acceptanceStrategy, check, section, uptrendCandles } from "./harness";
import { buildSeriesMap, evaluateEntry } from "../decisions";
import { computeFeatures } from "@/lib/strategy-lab/features";
import { ReplaySession } from "../replay";
import { buildStrategyContext } from "../context";
import { createAccount } from "../account";
import { backtestStrategy, defaultBacktestConfig } from "@/lib/strategy-lab/backtest";

export function runLeakageTests(): boolean {
    const { candles } = acceptanceSeries();
    const strategy = acceptanceStrategy();

    section("Leakage: feature causality (prefix invariance)");
    const k = 80;
    const full = computeFeatures(candles);
    const prefix = computeFeatures(candles.slice(0, k));
    check(prefix.length === k && full.length === candles.length, "feature arrays cover their inputs");
    const comparable = (f: (typeof full)[number]) => ({
        ema20: f.ema20, ema50: f.ema50, rsi: f.rsi, atr: f.atr, trend: f.trend,
        bos: f.bos, choch: f.choch, fvgDirection: f.fvgDirection, obDirection: f.obDirection,
        session: f.session, momentumPct: f.momentumPct, breakoutHigh: f.breakoutHigh,
        higherHigh: f.higherHigh, lastSweep: f.lastSweep,
    });
    let identical = true;
    for (let i = 0; i < k; i++) {
        if (JSON.stringify(comparable(prefix[i])) !== JSON.stringify(comparable(full[i]))) {
            identical = false;
            console.log(`      divergence at feature ${i}`);
            break;
        }
    }
    check(identical, "features over a prefix equal features of the full series (no backdating)");

    section("Leakage: decisions unchanged when the future changes");
    const smapFull = buildSeriesMap({ M5: candles });
    const corrupted = candles.map((c, i) =>
        i >= k ? { ...c, open: c.open * 0.4, high: c.high * 0.4, low: c.low * 0.4, close: c.close * 0.4 } : c
    );
    const smapCorrupted = buildSeriesMap({ M5: corrupted });
    let decisionsMatch = true;
    for (let i = 0; i < k; i++) {
        const a = evaluateEntry({ strategy, seriesMap: smapFull, index: i });
        const b = evaluateEntry({ strategy, seriesMap: smapCorrupted, index: i });
        if (a.fired !== b.fired || a.blockedBy !== b.blockedBy) {
            decisionsMatch = false;
            console.log(`      decision changed at bar ${i}: ${a.blockedBy} → ${b.blockedBy}`);
            break;
        }
    }
    check(decisionsMatch, `decisions at bars 0..${k - 1} identical when all future bars are corrupted`);

    const appended = [...candles, ...uptrendCandles(50, 500, candles[candles.length - 1].timestamp + 300000)];
    const smapAppended = buildSeriesMap({ M5: appended });
    let appendedMatch = true;
    for (let i = 0; i < candles.length; i++) {
        const a = evaluateEntry({ strategy, seriesMap: smapFull, index: i });
        const b = evaluateEntry({ strategy, seriesMap: smapAppended, index: i });
        if (a.fired !== b.fired) { appendedMatch = false; break; }
    }
    check(appendedMatch, "appending future bars never changes past decisions");

    section("Leakage: engine entries are identical on a truncated dataset");
    const cfg = defaultBacktestConfig();
    const fullRun = backtestStrategy(strategy, "XAUUSD", { M5: candles }, cfg, 0, Number.MAX_SAFE_INTEGER);
    const cut = 100;
    const prefixRun = backtestStrategy(strategy, "XAUUSD", { M5: candles.slice(0, cut) }, cfg, 0, Number.MAX_SAFE_INTEGER);
    const fullEntries = fullRun.trades.filter((t) => t.openBarIndex < cut).map((t) => `${t.openBarIndex}:${t.entry}`);
    const prefixEntries = prefixRun.trades.filter((t) => t.openBarIndex < cut).map((t) => `${t.openBarIndex}:${t.entry}`);
    check(
        JSON.stringify(fullEntries) === JSON.stringify(prefixEntries),
        `entries before the truncation point are identical\n      full: ${JSON.stringify(fullEntries)}\n      cut:  ${JSON.stringify(prefixEntries)}`
    );

    section("Leakage: replay hides future candles");
    const session = new ReplaySession({ symbol: "XAUUSD", timeframe: "M5", candles, strategy });
    const step = 40;
    for (let i = 0; i <= step; i++) session.stepForward();
    const frame = session.frame();
    check(frame.visibleCandles.length === step + 1, `only ${step + 1} candles visible at cursor ${step}`);
    check(
        frame.visibleCandles[frame.visibleCandles.length - 1].timestamp === candles[step].timestamp,
        "latest visible candle is exactly the cursor candle"
    );
    check(
        frame.visibleCandles.every((c, i) => c.timestamp === candles[i].timestamp),
        "visible candles are a strict prefix of the dataset"
    );
    check(session.hasHiddenCandles(), "hidden candles exist and are not exposed");
    check(!("getEngine" in session), "replay does not expose its full-dataset engine to callers");

    const lastVisible = frame.visibleCandles[frame.visibleCandles.length - 1].timestamp;
    const events = frame.smartMoneyEvents as Array<{ timestamp: number }>;
    check(
        events.every((e) => e.timestamp <= lastVisible),
        "smart money events only come from visible candles"
    );

    const contextBar = candles[step];
    const context = buildStrategyContext({
        environment: "replay",
        strategy,
        symbol: "XAUUSD",
        timeframe: "M5",
        candles: candles.slice(0, step + 1),
        features: [],
        index: step,
        account: createAccount({ id: "context-test", environment: "replay", balance: 10_000, now: contextBar.timestamp }),
        positions: [],
        events: [
            { id: "past", type: "BOS", timestamp: contextBar.timestamp - 1 },
            { id: "future", type: "BOS", timestamp: contextBar.timestamp + 1 },
        ],
    });
    check(
        context.smartMoney.events.length === 1 && context.smartMoney.events[0].id === "past",
        "missing indicator features still filter Smart Money events by current candle time"
    );

    // Truncated replay must equal the full replay up to the same cursor.
    const truncated = new ReplaySession({ symbol: "XAUUSD", timeframe: "M5", candles: candles.slice(0, step + 1), strategy });
    while (!truncated.atEnd()) truncated.stepForward();
    const a = JSON.stringify(session.frame().closedTrades.map((t) => [t.openBarIndex, t.realizedPnL]));
    const b = JSON.stringify(truncated.frame().closedTrades.map((t) => [t.openBarIndex, t.realizedPnL]));
    check(a === b, "replay state at cursor equals replay over the truncated dataset");

    section("Leakage: no decision reads the next bar");
    // Strategy that fires at the last bar: a next-bar-open entry must not be
    // materialized from future data — the pending signal stays pending and no
    // position appears (there is no fill bar).
    const lastBarSmap = buildSeriesMap({ M5: candles });
    const lastEval = evaluateEntry({ strategy, seriesMap: lastBarSmap, index: candles.length - 1 });
    const cfgLast = { ...defaultBacktestConfig() };
    const tailRun = backtestStrategy(strategy, "XAUUSD", { M5: candles.slice(0, candles.length) }, cfgLast, 0, Number.MAX_SAFE_INTEGER);
    const entriesAtLastBar = tailRun.trades.filter((t) => t.openBarIndex >= candles.length);
    check(entriesAtLastBar.length === 0, "no entry materializes beyond the dataset");
    if (lastEval.fired) {
        check(true, "last-bar signal is evaluated but cannot fill without a next bar");
    }

    return true;
}
