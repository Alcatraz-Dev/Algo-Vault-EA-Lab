// Core engine tests: execution model, order state machine, position sizing,
// risk engine, account accounting and intrabar exit mechanics.

import { acceptanceStrategy, approx, check, section } from "./harness";
import { SimulationAdapter } from "../adapters";
import { applyFill, canTransition, createOrder, transitionOrder } from "../orders";
import {
    computeStops,
    cashValueForMove,
    legCosts,
    openSimPosition,
    processPositionBar,
    restingOrderFillPrice,
    roundLots,
    simSymbolSpec,
    stopFillPrice,
    targetFillPrice,
    type SimPosition,
} from "../simulation";
import { evaluateRisk, riskLimitsFromStrategy, tradeRiskPct } from "../risk";
import { applyRealized, createAccount, deposit, markAccount, withdraw } from "../account";
import type { MarketCandle } from "@/lib/market-data/types";
import type { OrderIntent } from "../types";

const SPEC = simSymbolSpec("XAUUSD");
const COSTS = { spreadPips: 20, slippagePips: 1, commissionPerLot: 7 };

function bar(open: number, high: number, low: number, close: number, t = 1_000): MarketCandle {
    return { timestamp: t, open, high, low, close, volume: 1 };
}

export function runCoreTests(): boolean {
    section("Execution model: fills, spread, slippage, commission, gaps");
    const adapter = new SimulationAdapter({
        symbol: "XAUUSD",
        executionModel: "next_bar_open",
        environment: "backtest",
        spreadPips: COSTS.spreadPips,
        slippagePips: COSTS.slippagePips,
        commissionPerLot: COSTS.commissionPerLot,
        spec: SPEC,
    });

    check(adapter.entryPrice("BUY") === null, "no price before any bar");
    const b1 = bar(4000, 4010, 3990, 4005, 1000);
    adapter.setBar(b1);
    check(adapter.entryPrice("BUY") === 4000, "next-bar-open entry plans from the bar open");
    check(adapter.marketPrice("BUY") === 4005.1, "simulated ask = mid + half spread (20 pips × 0.01 / 2)");
    check(adapter.marketPrice("SELL") === 4004.9, "simulated bid = mid − half spread");

    const intent: OrderIntent = { side: "BUY", type: "MARKET", quantity: 0.1, reason: "test", source: "strategy" };
    const report = adapter.submit(intent);
    check(report.filled && report.order.status === "FILLED", "market order fills immediately");
    check(report.order.avgFillPrice === 4000, "fill at the bar open (execution model honored)");

    const manual = adapter.submit({ ...intent, source: "manual", quantity: 0.05 });
    check(manual.order.avgFillPrice === 4005, "manual order fills at the current bar close");

    const costs = legCosts(0.1, SPEC, COSTS);
    check(approx(costs.spread, 10 * SPEC.pipValue * 0.1, 1e-9), "each execution leg pays half the full quoted spread");
    check(approx(costs.slippage, 1 * SPEC.pipValue * 0.1, 1e-9), "slippage cost uses configured cash value per pip per lot");
    check(approx(costs.commission, 7 * 0.1 * SPEC.contractSize, 1e-9), "commission per lot contract size");
    const eurCosts = legCosts(1, simSymbolSpec("EURUSD"), { spreadPips: 1, commissionPerLot: 0, slippagePips: 0 });
    check(approx(eurCosts.spread, 5), "EURUSD execution leg charges half the $10 pip-value spread");
    check(approx(cashValueForMove(0.001, 1, simSymbolSpec("EURUSD")), 100), "EURUSD 10-pip move converts to $100 for one lot");

    const strategy = acceptanceStrategy(); // 1% risk
    const fxSpec = simSymbolSpec("EURUSD");
    const fxRisk = openSimPosition({
        strategy,
        symbol: "EURUSD",
        side: "BUY",
        entryPrice: 1.1,
        atr: 0.001,
        balance: 10_000,
        spec: fxSpec,
        costs: { spreadPips: 1, slippagePips: 0, commissionPerLot: 0 },
        timestamp: 1,
        barIndex: 1,
        session: "london",
        regime: "trending",
    });
    check(fxRisk !== null && approx(fxRisk.quantity, 1, 0.011), `EURUSD sizing uses its $10 pip value (got ${fxRisk?.quantity})`);

    // Resting orders + gap handling
    check(restingOrderFillPrice("BUY", "LIMIT", 3995, bar(4000, 4010, 3990, 4005), SPEC) === 3995, "buy limit fills at its price when traded through");
    check(restingOrderFillPrice("BUY", "LIMIT", 3995, bar(3990, 3996, 3985, 3992), SPEC) === 3990, "gap through a buy limit fills at the BETTER open");
    check(restingOrderFillPrice("BUY", "LIMIT", 3995, bar(4000, 4010, 3998, 4005), SPEC) === null, "buy limit above the bar does not fill");
    check(restingOrderFillPrice("BUY", "STOP", 4008, bar(4000, 4010, 3990, 4005), SPEC) === 4008, "buy stop fills at the stop");
    check(restingOrderFillPrice("BUY", "STOP", 4008, bar(4020, 4030, 4015, 4025), SPEC) === 4020, "gap through a buy stop fills at the WORSE open");

    check(stopFillPrice("LONG", 3990, bar(4000, 4010, 3995, 4005), SPEC, true) === 3990, "stop fills at the stop when not gapped");
    check(stopFillPrice("LONG", 3990, bar(3985, 3992, 3980, 3988), SPEC, true) === 3985, "gapped stop fills at the open (never pretends)");
    check(targetFillPrice("LONG", 4020, bar(4030, 4035, 4025, 4032), SPEC, true) === 4030, "target fills at target");
    check(targetFillPrice("LONG", 4020, bar(4025, 4040, 4022, 4038), SPEC, true) === 4025, "favorable gap through target fills at open (better)");

    const rejected = adapter.submit({ side: "BUY", type: "LIMIT", quantity: 0.1, reason: "test", source: "manual" });
    check(rejected.order.status === "REJECTED", "limit without a price is rejected");

    const parked = adapter.submit({ ...intent, type: "LIMIT", price: 3900, source: "manual", quantity: 0.1 });
    check(parked.order.status === "OPEN" && !parked.filled, "far-away limit parks as a working order");
    check(adapter.workingOrders().length === 1, "working order tracked");
    check(adapter.cancel(parked.order.id) && adapter.workingOrders().length === 0, "working order cancelable");
    check(!adapter.cancel("does-not-exist"), "cancel of unknown order returns false");

    section("Order state machine");
    const o = createOrder("XAUUSD", intent, 1000);
    check(o.status === "CREATED", "order starts CREATED");
    const submitted = transitionOrder(o, "SUBMITTED", 1001);
    check(submitted.changed && submitted.order.status === "SUBMITTED", "CREATED → SUBMITTED allowed");
    check(!canTransition(o.status, "FILLED"), "CREATED → FILLED is invalid");
    const bad = transitionOrder(o, "FILLED", 1002);
    check(!bad.changed && !!bad.error, "invalid transition rejected with an error");
    const partial = applyFill(o, { price: 4000, quantity: 0.05, timestamp: 1003, commission: 0, slippageCost: 0, spreadCost: 0, liquidity: "ask" });
    check(partial.order.status === "PARTIALLY_FILLED", "half fill → PARTIALLY_FILLED");
    const full = applyFill(partial.order, { price: 4002, quantity: 0.05, timestamp: 1004, commission: 0, slippageCost: 0, spreadCost: 0, liquidity: "ask" });
    check(full.order.status === "FILLED" && approx(full.order.avgFillPrice, 4001, 1e-9), "second fill completes at average price 4001");
    const afterTerminal = applyFill(full.order, { price: 1, quantity: 1, timestamp: 1005, commission: 0, slippageCost: 0, spreadCost: 0, liquidity: "bid" });
    check(!afterTerminal.changed && !!afterTerminal.error, "no fills after FILLED");

    section("Position sizing (instrument-aware)");
    const sized = openSimPosition({
        strategy, symbol: "XAUUSD", side: "BUY", entryPrice: 4000, atr: 5, balance: 10_000,
        spec: SPEC, costs: COSTS, timestamp: 1, barIndex: 1, session: "london", regime: "trending",
    });
    // risk = 1 × ATR = 5 → riskAmount 100 → 100 / (5 × 100) = 0.2 lots
    check(sized !== null && approx(sized.quantity, 0.2, 0.001), `1% risk sizing → 0.2 lots (got ${sized?.quantity})`);
    if (sized) {
        check(approx(sized.entryPrice, 4000, 1e-9), "entry recorded");
        check(approx(sized.stopLoss, 3995, 1e-9), "SL = entry − 1 ATR");
        check(approx(sized.initialRisk, 5, 1e-9), "initial risk distance recorded");
        check(sized.entryCost > 0, "entry cost recorded");
    }

    const tinyRisk = openSimPosition({
        strategy, symbol: "XAUUSD", side: "BUY", entryPrice: 4000, atr: 5, balance: 10,
        spec: SPEC, costs: COSTS, timestamp: 1, barIndex: 1, session: "london", regime: "trending",
    });
    check(tinyRisk === null, "size below the instrument minimum is refused (never over-risks)");

    check(roundLots(0.1239, SPEC) === 0.12, "volumes round to the lot step");
    const fixedLotStrategy = acceptanceStrategy({ risk: { ...strategy.risk, mode: "fixed_lot", fixedLot: 500 } });
    const capped = openSimPosition({
        strategy: fixedLotStrategy, symbol: "XAUUSD", side: "BUY", entryPrice: 4000, atr: 5, balance: 10_000,
        spec: SPEC, costs: COSTS, timestamp: 1, barIndex: 1, session: "london", regime: "trending",
    });
    check(capped !== null && capped.quantity === SPEC.maxLot, "fixed lot clamped to the instrument maximum");

    section("Exit engine: SL, gap, targets, break-even, trailing");
    const pos = openSimPosition({
        strategy, symbol: "XAUUSD", side: "BUY", entryPrice: 4000, atr: 5, balance: 10_000,
        spec: SPEC, costs: COSTS, timestamp: 1, barIndex: 1, session: "london", regime: "trending",
    }) as SimPosition;
    const processInput = { strategy, spec: SPEC, costs: COSTS, gapAware: true, prevClose: 4000, atr: 5, barIndex: 2, timestamp: 2 };

    const stopActions = processPositionBar(pos, bar(3999, 4002, 3990, 3992, 2), processInput);
    check(stopActions.length === 1 && stopActions[0].type === "close" && stopActions[0].reason === "sl", "stop loss closes the position");
    check((stopActions[0] as { price: number }).price === 3995, "stop fills at the stop price");
    check(pos.status === "closed", "position finalized");

    const gapPos = openSimPosition({
        strategy, symbol: "XAUUSD", side: "BUY", entryPrice: 4000, atr: 5, balance: 10_000,
        spec: SPEC, costs: COSTS, timestamp: 1, barIndex: 1, session: "london", regime: "trending",
    }) as SimPosition;
    const gapActions = processPositionBar(gapPos, bar(3985, 3993, 3980, 3990, 2), { ...processInput, barIndex: 2 });
    check(
        gapActions.length === 1 && (gapActions[0] as { price: number }).price === 3985,
        "gapped stop fills at the open — worse than the stop (realistic)"
    );

    const tpPos = openSimPosition({
        strategy, symbol: "XAUUSD", side: "BUY", entryPrice: 4000, atr: 5, balance: 10_000,
        spec: SPEC, costs: COSTS, timestamp: 1, barIndex: 1, session: "london", regime: "trending",
    }) as SimPosition;
    // SL (3995) and TP1 (4010) both inside one bar → stop assumed first (documented).
    const both = processPositionBar(tpPos, bar(4000, 4012, 3994, 4011, 2), { ...processInput, barIndex: 2 });
    check(both.length === 1 && both[0].type === "close" && both[0].reason === "sl", "conservative ordering: stop before target inside one bar");

    const tpOnly = openSimPosition({
        strategy, symbol: "XAUUSD", side: "BUY", entryPrice: 4000, atr: 5, balance: 10_000,
        spec: SPEC, costs: COSTS, timestamp: 1, barIndex: 1, session: "london", regime: "trending",
    }) as SimPosition;
    const hit = processPositionBar(tpOnly, bar(4005, 4015, 4004, 4008, 2), { ...processInput, barIndex: 2 });
    check(hit.length === 1 && hit[0].type === "partial" && hit[0].reason === "tp1" && tpOnly.status === "closed", "target closes the position when reached");

    const beStrategy = acceptanceStrategy({
        takeProfit: { ...strategy.takeProfit, partialCloses: [{ atR: 2, closePercent: 40 }], moveBeAfterTp1: true },
    });
    const bePos = openSimPosition({
        strategy: beStrategy, symbol: "XAUUSD", side: "BUY", entryPrice: 4000, atr: 5, balance: 10_000,
        spec: SPEC, costs: COSTS, timestamp: 1, barIndex: 1, session: "london", regime: "trending",
    }) as SimPosition;
    const beActions = processPositionBar(bePos, bar(4005, 4015, 4004, 4008, 2), { ...processInput, strategy: beStrategy, barIndex: 2 });
    check(beActions.some((a) => a.type === "break_even"), "partial take-profit moves stop to break-even");
    check(approx(bePos.stopLoss, bePos.entryPrice, 1e-9), "stop now at entry");
    check(bePos.remainingQuantity < bePos.quantity && bePos.status === "open", "partial close keeps the rest running");

    section("Risk engine");
    const account = createAccount({ id: "a", environment: "backtest", balance: 10_000, now: 1000 });
    const limits = {
        ...riskLimitsFromStrategy(strategy),
        maxDailyLossPct: 5,
        maxDrawdownPct: 15,
        allowedSessions: ["london", "new_york"] as Array<"london" | "new_york">,
    };
    const marketIntent: OrderIntent = { side: "BUY", type: "MARKET", quantity: 0.1, reason: "test", source: "strategy" };
    const baseInput = { account, openPositions: 0, exposure: 0, equity: 10_000 };

    const okRisk = evaluateRisk(limits, {
        ...baseInput,
        intent: marketIntent,
        session: "london",
        riskPct: 1,
    });
    check(okRisk.allowed, `normal trade passes risk (${okRisk.reasons.join(", ")})`);

    const killSwitch = evaluateRisk({ ...limits, killSwitch: true }, { ...baseInput });
    check(!killSwitch.allowed && killSwitch.reasons.some((r) => r.startsWith("kill_switch")), "kill switch blocks everything");

    const halted = evaluateRisk(limits, { ...baseInput, account: { ...account, halted: true, haltReason: "stale feed" } });
    check(!halted.allowed && halted.reasons.some((r) => r.startsWith("account_halted")), "halted account blocks everything");

    const stale = evaluateRisk({ ...limits, maxDataAgeMs: 5000 }, { ...baseInput, dataTimestamp: 1000, now: 10_000 });
    check(!stale.allowed && stale.reasons.some((r) => r.startsWith("data_freshness")), "stale market data fails closed");

    const dailyLoss = evaluateRisk(limits, {
        ...baseInput,
        account: { ...account, dailyPnL: -600 },
        equity: 10_000,
    });
    check(!dailyLoss.allowed && dailyLoss.reasons.some((r) => r.startsWith("max_daily_loss")), "daily loss limit blocks new trades");

    const drawdown = evaluateRisk(limits, {
        ...baseInput,
        account: { ...account, drawdownPct: 25 },
    });
    check(!drawdown.allowed && drawdown.reasons.some((r) => r.startsWith("max_drawdown")), "drawdown limit blocks new trades");

    const tooMany = evaluateRisk(limits, { ...baseInput, intent: marketIntent, openPositions: strategy.risk.maxPositions });
    check(!tooMany.allowed && tooMany.reasons.some((r) => r.startsWith("max_open_positions")), "max open positions enforced");

    const badQty = evaluateRisk(limits, {
        ...baseInput,
        intent: { side: "BUY", type: "MARKET", quantity: 0, reason: "test", source: "strategy" },
    });
    check(!badQty.allowed && badQty.reasons.some((r) => r.startsWith("valid_quantity")), "invalid quantity rejected");

    const sessionBlocked = evaluateRisk(limits, {
        ...baseInput,
        intent: marketIntent,
        session: "asian",
    });
    check(!sessionBlocked.allowed && sessionBlocked.reasons.some((r) => r.startsWith("session_restriction")), "session restriction enforced");

    const riskPct = tradeRiskPct({ stopDistance: 5, quantity: 0.2, contractSize: 100, equity: 10_000 });
    check(approx(riskPct, 1, 1e-9), "risk % = stop × size × contract / equity");

    section("Account / portfolio");
    let acct = createAccount({ id: "paper-1", environment: "paper", balance: 1000, now: 1 });
    check(acct.balance === 1000 && acct.equity === 1000, "account starts balanced");
    acct = applyRealized(acct, 150, 2);
    check(acct.balance === 1150 && acct.realizedPnL === 150 && acct.dailyPnL === 150, "realized P&L updates balance, total and daily");
    check(acct.consecutiveLosses === 0, "a win leaves the consecutive-loss counter at zero");
    acct = applyRealized(acct, -50, 3);
    check(acct.balance === 1100 && acct.consecutiveLosses === 1, "a loss increments the consecutive-loss counter");
    acct = applyRealized(acct, 10, 4);
    check(acct.consecutiveLosses === 0, "a subsequent win resets the counter");
    acct = markAccount(acct, { positions: [], priceOf: () => 0, contractSizes: {} }, 5);
    check(acct.equity === 1110 && acct.drawdownPct === 0, "flat equity → no drawdown");
    acct = deposit(acct, 500, 6);
    acct = withdraw(acct, 200, 7);
    check(acct.balance === 1410 && acct.deposits === 500 && acct.withdrawals === 200, "paper deposits and withdrawals tracked");

    section("Stop planning");
    const plan = computeStops(strategy, 4000, 5, true, 2);
    check(approx(plan.sl, 3995, 1e-9) && approx(plan.tp1, 4010, 1e-9) && approx(plan.riskPrice, 5, 1e-9), "SL = 1 ATR, TP = 2R");

    return true;
}
