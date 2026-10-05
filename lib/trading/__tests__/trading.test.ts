import { createSuite } from "@/lib/performance-arena/__tests__/harness";
import { computeMetrics } from "@/lib/performance-arena/metrics";
import { evaluateSettlement, type SettlementInput } from "@/lib/performance-arena/settlement";
import { makeAccount, makeAttempt, makePolicy, NOW } from "@/lib/performance-arena/__tests__/fixtures";
import type { MarketCandle } from "@/lib/market-data/types";
import type { OrderIntent } from "@/lib/strategy-engine/types";
import { PaperTradingSession } from "@/lib/strategy-engine/paper";
import { challengeFeatureState, evaluateChallenge, evaluateChallengeRules } from "../challenges";
import { DisabledBrokerAdapter, historicalMarketDataProvider, SimulatorExecutionProvider } from "../providers";
import { calculateExposure, calculateMargin, calculatePotentialLoss, calculatePotentialProfit, calculateRiskPercent, calculateRiskReward } from "../risk";
import { areBrokerConnectionsEnabled, areChallengesEnabled, arePayoutsEnabled, isBrokerConnectionsEnabled, isFundedProgramEnabled, isLiveTradingEnabled, isPaperTradingEnabled, tradingFlagSnapshot, TRADING_FLAG_ENV } from "../feature-flags";

function withEnv<T>(name: string, value: string | undefined, run: () => T): T {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    try { return run(); }
    finally {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
    }
}

export async function runTradingTests(): Promise<boolean> {
    const s = createSuite("provider-neutral-trading");
    const near = (a: number | null, b: number, epsilon = 1e-8) => a !== null && Math.abs(a - b) <= epsilon;

    s.section("Capability flags fail closed");
    withEnv(TRADING_FLAG_ENV.paperTrading, undefined, () => s.check(isPaperTradingEnabled(), "paper trading defaults enabled"));
    withEnv(TRADING_FLAG_ENV.paperTrading, "false", () => s.check(!isPaperTradingEnabled(), "paper trading can be disabled"));
    withEnv(TRADING_FLAG_ENV.challenges, undefined, () => s.check(!areChallengesEnabled() && challengeFeatureState() === "BLOCKED", "challenges default disabled"));
    s.check(!areBrokerConnectionsEnabled() && !isLiveTradingEnabled() && !isFundedProgramEnabled() && !arePayoutsEnabled(), "broker/live/funded/payout capabilities are hard-off");
    s.check(!tradingFlagSnapshot().liveTradingEnabled && !tradingFlagSnapshot().fundedProgramEnabled, "feature snapshot never advertises live/funded execution");
    // A mis-set environment variable must not be able to arm an unreleased capability.
    withEnv(TRADING_FLAG_ENV.liveTrading, "true", () => withEnv(TRADING_FLAG_ENV.brokerConnections, "true", () => withEnv(TRADING_FLAG_ENV.fundedProgram, "true", () => withEnv(TRADING_FLAG_ENV.payouts, "true", () => {
        s.check(!isLiveTradingEnabled() && !areBrokerConnectionsEnabled() && !isBrokerConnectionsEnabled() && !isFundedProgramEnabled() && !arePayoutsEnabled(), "env cannot arm live/broker/funded/payout capabilities");
        const forced = tradingFlagSnapshot();
        s.check(!forced.liveTradingEnabled && !forced.brokerConnectionsEnabled && !forced.fundedProgramEnabled && !forced.payoutsEnabled, "snapshot stays closed even with hostile env values");
    }))));

    s.section("Broker implementation is permanently blocked");
    const broker = new DisabledBrokerAdapter();
    const brokerCalls = await Promise.all([
        broker.authenticate(), broker.getAccount(), broker.getPositions(), broker.getOrders(),
        broker.placeOrder(), broker.modifyOrder(), broker.cancelOrder(), broker.closePosition(),
    ]);
    s.check(brokerCalls.length === 8 && brokerCalls.every((result) => result.status === "BLOCKED"), "every broker capability is blocked, including reads");

    s.section("Simulator provider uses the existing paper engine");
    let now = 1_000;
    const session = new PaperTradingSession({ accountId: "paper-owner-1", symbol: "XAUUSD", timeframe: "M5", initialBalance: 10_000, wallClock: () => now });
    session.feedQuote({ bid: 2_000, ask: 2_000.1, timestamp: now });
    const candle: MarketCandle = { timestamp: now, open: 2_000, high: 2_001, low: 1_999, close: 2_000, volume: 1 };
    session.feedCandle(candle);
    const provider = new SimulatorExecutionProvider((userId, accountId) => userId === "owner" && accountId === session.accountId ? session : null, () => now);

    const account = await provider.getAccount("owner", session.accountId);
    s.check(account.status === "AVAILABLE" && account.value.mode === "SIMULATOR" && account.value.balance === 10_000, "normalized account reflects canonical virtual account");
    s.check((await provider.getAccount("intruder", session.accountId)).status === "UNAVAILABLE", "ownership resolver denies unauthorized reads");

    const workingIntent: OrderIntent = { side: "BUY", type: "LIMIT", quantity: 0.1, price: 1_900, reason: "test", source: "manual", clientOrderId: "client-limit-1" };
    const working = await provider.placeOrder({ userId: "owner", accountId: session.accountId, intent: workingIntent });
    s.check(working.status === "AVAILABLE" && working.value.status === "OPEN" && working.value.submittedAt === now, "working order includes canonical submitted time");
    const modified = await provider.modifyOrder({ userId: "owner", accountId: session.accountId, orderId: "client-limit-1", price: 1_850 });
    s.check(modified.status === "AVAILABLE" && modified.value.requestedPrice === 1_850, "order modification is reconciled to engine state");
    const cancelled = await provider.cancelOrder({ userId: "owner", accountId: session.accountId, orderId: "client-limit-1" });
    s.check(cancelled.status === "AVAILABLE" && cancelled.value.status === "CANCELLED" && cancelled.value.cancelledAt === now, "cancelled order remains authoritative with timestamp");
    s.check(session.getOrders().some((order) => order.clientOrderId === "client-limit-1" && order.status === "CANCELLED"), "session history reflects cancel state");
    s.check((await provider.placeOrder({ userId: "owner", accountId: session.accountId, intent: workingIntent })).status === "AVAILABLE", "duplicate attempt returns a deterministic rejection record");
    const stopLimit = await provider.placeOrder({ userId: "owner", accountId: session.accountId, intent: { ...workingIntent, type: "STOP_LIMIT", price: 2_010, stopLimitPrice: 2_011, clientOrderId: "unsupported-stop-limit" } });
    s.check(stopLimit.status === "AVAILABLE" && stopLimit.value.status === "REJECTED", "unsupported stop-limit fails closed rather than pretending to fill");

    const marketIntent: OrderIntent = { side: "BUY", type: "MARKET", quantity: 0.1, stopLoss: 1_999, takeProfit: 2_005, reason: "test", source: "manual", clientOrderId: "client-market-1" };
    const fill = await provider.placeOrder({ userId: "owner", accountId: session.accountId, intent: marketIntent });
    s.check(fill.status === "AVAILABLE" && fill.value.status === "FILLED" && fill.value.executionPrice === 2_000.1 && fill.value.filledAt === now, "market fill is quote-backed and carries lifecycle time");
    const positions = await provider.getPositions("owner", session.accountId);
    s.check(positions.status === "AVAILABLE" && positions.value.length === 1 && positions.value[0]?.provider === "SIMULATOR", "position state comes from canonical engine");
    if (positions.status === "AVAILABLE" && positions.value[0]) {
        const updated = await provider.modifyPosition({ userId: "owner", accountId: session.accountId, positionId: positions.value[0].positionId, stopLoss: 1_999.5, takeProfit: 2_006 });
        s.check(updated.status === "AVAILABLE" && updated.value.stopLoss === 1_999.5, "position protection updates existing engine position");
    }
    now += 1;
    session.feedQuote({ bid: 2_001, ask: 2_001.1, timestamp: now });
    s.check((await provider.closePosition({ userId: "owner", accountId: session.accountId, positionId: positions.status === "AVAILABLE" ? positions.value[0]!.positionId : "missing" })).status === "AVAILABLE", "position close uses a fresh executable quote");
    s.check((await withEnv(TRADING_FLAG_ENV.paperTrading, "false", () => provider.placeOrder({ userId: "owner", accountId: session.accountId, intent: { ...marketIntent, clientOrderId: "paper-disabled-order" } }))).status === "BLOCKED", "paper feature flag blocks mutations");

    s.section("Market-data boundaries do not fake availability");
    const realtime = historicalMarketDataProvider.subscribeRealtime("XAUUSD", "M1", () => undefined);
    s.check(realtime.status === "UNAVAILABLE", "historical adapter refuses realtime subscription");
    realtime.unsubscribe();
    s.check((await historicalMarketDataProvider.getQuote("NOT_A_SYMBOL")).status === "UNAVAILABLE", "unknown symbol is unavailable");

    s.section("Risk calculations are side-aware and reuse canonical specs");
    const long = { symbol: "EURUSD", side: "LONG" as const, quantity: 1, entryPrice: 1.1, stopLoss: 1.099, takeProfit: 1.102, equity: 10_000 };
    const short = { ...long, side: "SHORT" as const, stopLoss: 1.101, takeProfit: 1.098 };
    s.check(near(calculatePotentialLoss(long), 100) && near(calculatePotentialProfit(long), 200), "long potential loss/profit use simulator pip economics");
    s.check(near(calculatePotentialProfit(short), 200) && near(calculateRiskReward(short), 2), "short potential profit/RR use correct direction");
    s.check(near(calculateRiskPercent(long), 1), "risk percent is relative to equity");
    s.check(calculatePotentialProfit({ ...long, takeProfit: 1.09 }) === null, "wrong-side target fails closed");
    s.check(calculatePotentialLoss({ ...long, symbol: "UNKNOWN" }) === null, "unknown symbol does not receive fabricated default risk");
    s.check(near(calculateMargin(1.1, 1, "EURUSD", 100), 1_100) && near(calculateExposure(1.1, 1, "EURUSD"), 110_000), "margin/exposure use canonical contract size");

    s.section("Challenge adapter delegates to Arena rule and settlement engines");
    const policy = makePolicy();
    const attempt = makeAttempt({ policy });
    const virtualAccount = makeAccount(policy);
    const metrics = computeMetrics({ attempt, account: virtualAccount, policy, openTrades: [], closedTrades: [], marks: [], quoteAt: NOW, now: NOW });
    const settlement: SettlementInput = { attempt, policy, metrics, closedTrades: [], openPositionCount: 0, now: NOW, breachTypes: [], dailyPnl: [] };
    const disabled = await withEnv(TRADING_FLAG_ENV.challenges, "false", () => evaluateChallenge(settlement));
    s.check(disabled.action === "blocked" && disabled.reasonCode === "CHALLENGES_DISABLED", "disabled challenge has explicit blocked outcome");
    const enabled = await withEnv(TRADING_FLAG_ENV.challenges, "true", () => evaluateChallenge(settlement));
    s.check(JSON.stringify(enabled) === JSON.stringify(evaluateSettlement(settlement)), "enabled challenge composes existing Arena settlement logic");
    s.check((await withEnv(TRADING_FLAG_ENV.challenges, "false", () => evaluateChallengeRules({} as never))).status === "BLOCKED", "disabled rule engine reports blocked, not empty evidence");

    return s.finish();
}
