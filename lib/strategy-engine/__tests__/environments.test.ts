// Environment tests: Market Replay transport/state, manual trading during
// replay, and paper trading isolation + fail-closed guards.

import { acceptanceSeries, acceptanceStrategy, check, section } from "./harness";
import { PaperTradingSession } from "../paper";
import { ReplaySession } from "../replay";
import { PAPER_TRADING_LABEL } from "../paper";
import type { OrderIntent } from "../types";

export function runEnvironmentTests(): boolean {
    const { candles } = acceptanceSeries();
    const strategy = acceptanceStrategy();
    const costs = { spreadPips: 20, slippagePips: 1, commissionPerLot: 7 };

    section("Replay: transport controls");
    const replay = new ReplaySession({ symbol: "XAUUSD", timeframe: "M5", candles, strategy, initialBalance: 10_000, costs });
    check(replay.getIndex() === -1 && replay.visibleCandles().length === 0, "nothing revealed before the first step");

    replay.play();
    check(replay.isPlaying(), "play starts the session");
    replay.setSpeed(10);
    check(replay.getSpeed() === 10, "speed adjustable");
    replay.pause();
    check(!replay.isPlaying(), "pause stops the session");

    const f1 = replay.stepForward();
    check(f1 !== null && f1.index === 0 && f1.visibleCandles.length === 1, "step forward reveals exactly one candle");
    replay.stepForward();
    replay.stepForward();
    check(replay.getIndex() === 2 && replay.visibleCandles().length === 3, "cursor tracks revealed candles");

    const snapshotAt2 = JSON.stringify(replay.frame().account);
    replay.seek(60);
    check(replay.getIndex() === 60 && replay.visibleCandles().length === 61, "seek jumps forward");
    replay.stepBack();
    check(replay.getIndex() === 59, "step back moves one bar back");
    replay.seek(2);
    const restored = JSON.stringify(replay.frame().account);
    check(restored === snapshotAt2, "stepping back restores the exact account state (deterministic rebuild)");

    section("Replay: future stays hidden while stepping");
    replay.seek(10);
    const frame = replay.frame();
    check(
        frame.visibleCandles[frame.visibleCandles.length - 1].timestamp === candles[10].timestamp &&
            frame.visibleCandles.length === 11,
        "only bars 0..10 visible at cursor 10"
    );

    section("Replay: manual trading during replay");
    const manualReplay = new ReplaySession({ symbol: "XAUUSD", timeframe: "M5", candles, strategy, initialBalance: 10_000, costs });
    for (let i = 0; i <= 5; i++) manualReplay.stepForward();

    const intent: OrderIntent = { side: "BUY", type: "MARKET", quantity: 0.1, reason: "manual", source: "manual", stopLoss: 50, takeProfit: 5000 };
    const placed = manualReplay.placeOrder(intent);
    check(placed !== null && placed.order.status === "FILLED", "manual market order fills during replay");
    check(placed !== null && placed.position !== null, "manual order opens a position");
    const positionId = placed?.position?.id;

    // Advance a few bars, then step back past the entry → position must vanish…
    for (let i = 0; i < 3; i++) manualReplay.stepForward();
    manualReplay.seek(4);
    check(
        manualReplay.frame().positions.length === 0,
        "state before the manual entry has no position after stepping back"
    );
    // …and reappear when replaying forward (action log re-applied).
    manualReplay.seek(8);
    check(
        manualReplay.frame().positions.some((p) => p.id === positionId),
        "manual action re-applied when replaying forward"
    );

    const closed = manualReplay.closePosition(positionId as string);
    check(closed !== null && closed.status === "closed", "manual close works during replay");
    manualReplay.seek(6);
    manualReplay.seek(8);
    check(
        !manualReplay.frame().positions.some((p) => p.id === positionId),
        "manual close is also replayed deterministically"
    );
    check(
        manualReplay.frame().closedTrades.some((t) => t.id === closed?.id),
        "manually closed trade recorded in history"
    );

    section("Replay: manual-only session (no strategy attached)");
    const manualOnly = new ReplaySession({ symbol: "XAUUSD", timeframe: "M5", candles, initialBalance: 5_000 });
    for (let i = 0; i <= 20; i++) manualOnly.stepForward();
    check(manualOnly.frame().closedTrades.length === 0, "no automatic trades without a strategy");
    const mo = manualOnly.placeOrder({ side: "SELL", type: "MARKET", quantity: 0.2, reason: "manual", source: "manual" });
    check(mo !== null && mo.position !== null, "manual trading still works without a strategy");

    section("Paper: isolation between accounts");
    let wall = Date.UTC(2026, 0, 10);
    const mkPaper = (id: string, balance: number) =>
        new PaperTradingSession({
            accountId: id,
            symbol: "XAUUSD",
            timeframe: "M5",
            initialBalance: balance,
            strategy,
            costs,
            maxQuoteAgeMs: 60_000,
            wallClock: () => wall,
        });

    const paperA = mkPaper("paper-A", 10_000);
    const paperB = mkPaper("paper-B", 50_000);
    paperA.deposit(1_000);
    check(paperA.getAccount().balance === 11_000, "deposit lands in account A");
    check(paperB.getAccount().balance === 50_000, "account B unaffected (isolated state)");

    for (const c of candles) {
        wall += 1;
        paperA.feedQuote({ bid: c.close - 0.1, ask: c.close + 0.1, timestamp: wall });
        paperA.feedCandle(c);
        paperB.feedQuote({ bid: c.close - 0.1, ask: c.close + 0.1, timestamp: wall });
        paperB.feedCandle(c);
    }
    const aState = paperA.getAccount();
    const bState = paperB.getAccount();
    check(aState.id !== bState.id, "distinct account ids");
    check(aState.balance !== bState.balance, "balances never merged");
    check(paperA.getClosedTrades().length > 0 && paperB.getClosedTrades().length > 0, "both accounts traded independently");
    check(
        paperA.getClosedTrades().every((t) => t.symbol === "XAUUSD"),
        "account A history only contains its own trades"
    );

    section("Paper: fail-closed guards");
    let w2 = Date.UTC(2026, 0, 10);
    const guarded = new PaperTradingSession({
        symbol: "XAUUSD",
        timeframe: "M5",
        initialBalance: 10_000,
        maxQuoteAgeMs: 5_000,
        wallClock: () => w2,
    });

    // No quote yet → stale → order rejected.
    const noQuote = guarded.placeOrder({ side: "BUY", type: "MARKET", quantity: 0.1, reason: "manual", source: "manual" });
    check(noQuote.order.status === "REJECTED" && !!noQuote.rejected, "order without fresh data rejected (fail closed)");

    // Fresh quote → allowed.
    w2 += 1;
    guarded.feedQuote({ bid: 4000, ask: 4000.2, timestamp: w2 });
    guarded.feedCandle({ timestamp: w2, open: 4000, high: 4010, low: 3995, close: 4005, volume: 1 });
    const invalidProtection = guarded.placeOrder({ side: "BUY", type: "MARKET", quantity: 0.1, reason: "manual", source: "manual", stopLoss: 4001 });
    check(invalidProtection.order.status === "REJECTED", "invalid protective stop on the wrong side is rejected");
    const fresh = guarded.placeOrder({ side: "BUY", type: "MARKET", quantity: 0.1, reason: "manual", source: "manual" });
    check(fresh.order.status === "FILLED", "order with fresh quote fills");
    check(fresh.position !== null, "fresh paper market order creates a virtual position");

    // Quote goes stale → new orders and market closes fail closed.
    w2 += 60_000;
    const staleClose = fresh.position ? guarded.closePosition(fresh.position.id) : null;
    check(staleClose === null, "stale quote cannot close at a fallback candle price");
    const staleNow = guarded.placeOrder({ side: "BUY", type: "MARKET", quantity: 0.1, reason: "manual", source: "manual" });
    check(staleNow.order.status === "REJECTED", "stale quote → order rejected");
    guarded.feedQuote({ bid: 4001, ask: 4001.2, timestamp: w2 });
    const freshClose = fresh.position ? guarded.closePosition(fresh.position.id) : null;
    check(freshClose?.status === "closed", "fresh paper quote permits a market close");

    // Kill switch.
    guarded.feedQuote({ bid: 4000, ask: 4000.2, timestamp: w2 });
    guarded.engageKillSwitch();
    const killed = guarded.placeOrder({ side: "BUY", type: "MARKET", quantity: 0.1, reason: "manual", source: "manual" });
    check(killed.order.status === "REJECTED" && !!killed.rejected?.includes("kill_switch"), "kill switch blocks trading");
    guarded.releaseKillSwitch();
    const released = guarded.placeOrder({ side: "BUY", type: "MARKET", quantity: 0.1, reason: "manual", source: "manual" });
    check(released.order.status === "FILLED", "releasing the kill switch restores trading");

    // Halt (e.g. risk breach) blocks until resumed.
    guarded.halt("daily loss limit");
    const halted = guarded.placeOrder({ side: "BUY", type: "MARKET", quantity: 0.1, reason: "manual", source: "manual" });
    check(halted.order.status === "REJECTED", "halted account rejects orders");
    guarded.resume();
    const resumed = guarded.placeOrder({ side: "BUY", type: "MARKET", quantity: 0.1, reason: "manual", source: "manual" });
    check(resumed.order.status === "FILLED", "resume restores trading");

    check(guarded.status().label === PAPER_TRADING_LABEL, "UI label constant available at all times");
    check(guarded.status().mode === "paper", "status reports paper mode");

    return true;
}
