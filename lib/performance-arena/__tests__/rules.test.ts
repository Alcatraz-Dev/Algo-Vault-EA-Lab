// Rule engine tests — warnings, breaches, stale-data fail-closed behavior,
// and the deterministic pre-trade gate.

import { createSuite } from "./harness";
import { evaluateAccountRules, evaluatePreTrade } from "../rules";
import { computeMetrics } from "../metrics";
import { NOW, makePolicy, makeAttempt, makeAccount, makeOpenTrade, nextEventId } from "./fixtures";
import type { ChallengeAttempt, ChallengeMetrics, ChallengePolicy } from "../types";

function metricsFor(params: {
    policy: ChallengePolicy;
    attempt?: ChallengeAttempt;
    account?: ReturnType<typeof makeAccount>;
    quoteAt?: number;
    now?: number;
}): ChallengeMetrics {
    const policy = params.policy;
    const attempt = params.attempt ?? makeAttempt({ policy });
    return computeMetrics({
        attempt,
        account: params.account ?? makeAccount(policy),
        policy,
        openTrades: [],
        closedTrades: [],
        marks: [],
        quoteAt: params.quoteAt ?? (params.now ?? NOW),
        now: params.now ?? NOW,
    });
}

export async function runRuleTests(): Promise<boolean> {
    const s = createSuite("rules");
    const policy = makePolicy(); // $100k, target 10%, DD 8%, daily 4%, min 5 days, warn 80
    const starting = policy.startingBalanceCents;

    s.section("Profit target");
    const targetAttempt = makeAttempt({
        policy,
        tradingDayKeys: { "2026-01-02": 1, "2026-01-05": 2, "2026-01-06": 3, "2026-01-07": 4, "2026-01-08": 5 },
    });
    const targetCtx = {
        attempt: targetAttempt,
        policy,
        metrics: metricsFor({
            policy,
            attempt: targetAttempt,
            account: makeAccount(policy, { balanceCents: starting + 1_000_000, realizedPnLCents: 1_000_000 }),
        }),
        now: NOW,
        nextEventId,
    };
    const targetEvents = evaluateAccountRules(targetCtx);
    const targetReached = targetEvents.find((e) => e.ruleId === "PROFIT_TARGET" && e.type === "PROFIT_TARGET_REACHED");
    s.check(Boolean(targetReached), "10% return triggers PROFIT_TARGET_REACHED");
    s.check(
        targetReached?.message.includes("Close open positions") === true,
        "with min days met the message asks to close positions to settle"
    );
    const distanceEvent = evaluateAccountRules({
        ...targetCtx,
        metrics: metricsFor({ policy, account: makeAccount(policy) }),
    }).find((e) => e.ruleId === "PROFIT_TARGET");
    s.check(distanceEvent?.type === "RULE_WARNING" && distanceEvent.message.includes("away from the challenge target"), "distance-to-target message present");

    s.section("Daily loss warning / breach (fresh data)");
    const warnAccount = makeAccount(policy, { balanceCents: starting - 320_000, realizedPnLCents: -320_000 }); // 80% of 4% limit
    const warnEvents = evaluateAccountRules({ attempt: makeAttempt({ policy }), policy, metrics: metricsFor({ policy, account: warnAccount }), now: NOW, nextEventId });
    const dailyWarn = warnEvents.find((e) => e.ruleId === "DAILY_LOSS");
    s.check(dailyWarn?.type === "DAILY_LOSS_WARNING" && dailyWarn.severity === "WARNING", "80% daily usage → DAILY_LOSS_WARNING");
    s.check(dailyWarn?.message.includes("80%") === true, "warning message includes usage percent");

    const breachAccount = makeAccount(policy, { balanceCents: starting - 400_000, realizedPnLCents: -400_000 });
    const breachEvents = evaluateAccountRules({ attempt: makeAttempt({ policy }), policy, metrics: metricsFor({ policy, account: breachAccount }), now: NOW, nextEventId });
    const dailyBreach = breachEvents.find((e) => e.type === "DAILY_LOSS_BREACH");
    s.check(dailyBreach?.severity === "BREACH" && dailyBreach.blocking, "100% daily usage → blocking DAILY_LOSS_BREACH");

    s.section("Max drawdown warning / breach");
    const ddWarn = evaluateAccountRules({
        attempt: makeAttempt({ policy }),
        policy,
        metrics: metricsFor({ policy, account: makeAccount(policy, { balanceCents: starting - 640_000, realizedPnLCents: -640_000 }) }),
        now: NOW,
        nextEventId,
    }).find((e) => e.ruleId === "MAX_DRAWDOWN");
    s.check(ddWarn?.type === "DRAWDOWN_WARNING", "80% of drawdown allowance → DRAWDOWN_WARNING");

    const ddBreach = evaluateAccountRules({
        attempt: makeAttempt({ policy }),
        policy,
        metrics: metricsFor({ policy, account: makeAccount(policy, { balanceCents: starting - 800_000, realizedPnLCents: -800_000 }) }),
        now: NOW,
        nextEventId,
    }).find((e) => e.type === "DRAWDOWN_BREACH");
    s.check(ddBreach?.severity === "BREACH" && ddBreach.blocking, "8% drop → blocking DRAWDOWN_BREACH");

    s.section("Fail-closed: stale data downgrades breaches to warnings");
    const staleCtx = {
        attempt: makeAttempt({ policy }),
        policy,
        metrics: metricsFor({
            policy,
            account: makeAccount(policy, { balanceCents: starting - 800_000, realizedPnLCents: -800_000 }),
            quoteAt: NOW - 10 * 60_000,
        }),
        now: NOW,
        nextEventId,
    };
    s.check(staleCtx.metrics.dataQuality === "stale", "snapshot marked stale");
    const staleEvents = evaluateAccountRules(staleCtx);
    s.check(!staleEvents.some((e) => e.severity === "BREACH"), "no BREACH events on stale data");
    s.check(staleEvents.some((e) => e.ruleId === "MAX_DRAWDOWN" && e.severity === "WARNING"), "stale breach surfaces as warning instead");

    s.section("Minimum trading days");
    const noDays = evaluateAccountRules({ attempt: makeAttempt({ policy }), policy, metrics: metricsFor({ policy }), now: NOW, nextEventId });
    s.check(!noDays.some((e) => e.type === "MIN_TRADING_DAYS_REACHED"), "not reached with 0 days");
    const enoughDays = makeAttempt({
        policy,
        tradingDayKeys: { d1: 1, d2: 2, d3: 3, d4: 4, d5: 5 },
    });
    const daysEvents = evaluateAccountRules({ attempt: enoughDays, policy, metrics: metricsFor({ policy, attempt: enoughDays }), now: NOW, nextEventId });
    s.check(daysEvents.some((e) => e.type === "MIN_TRADING_DAYS_REACHED"), "reached with 5 days");

    s.section("Consistency advisory");
    const consistencyAttempt = makeAttempt({
        policy: makePolicy({ consistency: { required: true, maxSingleDayPnlSharePct: 50, minTradesForConsistency: 10 } }),
        tradingDayKeys: { d1: 1, d2: 2, d3: 3 },
    });
    const consistencyPolicy = consistencyAttempt.policy;
    const consistencyMetrics = metricsFor({
        policy: consistencyPolicy,
        attempt: consistencyAttempt,
        account: makeAccount(consistencyPolicy, { balanceCents: 11_200_000, realizedPnLCents: 1_200_000 }),
    });
    const consistencyEvents = evaluateAccountRules({ attempt: consistencyAttempt, policy: consistencyPolicy, metrics: consistencyMetrics, now: NOW, nextEventId });
    s.check(consistencyEvents.some((e) => e.type === "CONSISTENCY_WARNING"), "required consistency rule surfaces an advisory");

    s.section("Expiry rule events");
    const expiredAttempt = makeAttempt({ policy, expiresAt: NOW - 1 });
    const expiredEvents = evaluateAccountRules({ attempt: expiredAttempt, policy, metrics: metricsFor({ policy, attempt: expiredAttempt }), now: NOW, nextEventId });
    s.check(expiredEvents.some((e) => e.ruleId === "CHALLENGE_EXPIRY" && e.severity === "BREACH"), "expired challenge → breach event");

    s.section("Pre-trade gate: happy path");
    const basePre = {
        attempt: makeAttempt({ policy }),
        policy,
        metrics: metricsFor({ policy }),
        now: NOW,
        symbol: "EURUSD",
        sizeCentiLots: 10, // 0.10 lot
        stopLossMicros: 1_099_000,
        notionalCents: 11_000_00,
        riskCents: 50_00, // 0.5% of equity
        openPositions: 0,
        quotePrice: 1.1,
        session: "london",
        marketOpen: true,
        nextEventId,
    };
    const ok = evaluatePreTrade(basePre);
    s.check(ok.ok && ok.violations.length === 0, "valid order passes the gate");

    s.section("Pre-trade gate: rejections");
    s.check(!evaluatePreTrade({ ...basePre, symbol: "BTCUSD" }).ok, "market not allowed → rejected");
    s.check(!evaluatePreTrade({ ...basePre, marketOpen: false }).ok, "market closed (weekend) → rejected");
    s.check(!evaluatePreTrade({ ...basePre, session: "asian", policy: makePolicy({ allowedSessions: ["london"] }) }).ok, "session not allowed → rejected");
    s.check(
        !evaluatePreTrade({ ...basePre, policy: makePolicy({ allowedSymbols: ["XAUUSD"] }) }).ok,
        "symbol not on allow-list → rejected"
    );
    s.check(!evaluatePreTrade({ ...basePre, openPositions: policy.maxConcurrentPositions }).ok, "max concurrent positions → rejected");
    s.check(
        !evaluatePreTrade({
            ...basePre,
            attempt: makeAttempt({ policy, dailyTradeCounts: { [new Date(NOW).toISOString().slice(0, 10)]: policy.maxDailyTrades } }),
        }).ok,
        "daily trade cap → rejected"
    );
    s.check(
        !evaluatePreTrade({
            ...basePre,
            attempt: makeAttempt({ policy, tradingDayKeys: Object.fromEntries(Array.from({ length: policy.maxTradingDays }, (_, i) => [`d${i}`, i])) }),
        }).ok,
        "max trading days (new day) → rejected"
    );
    const sameDayAttempt = makeAttempt({
        policy,
        tradingDayKeys: {
            ...Object.fromEntries(Array.from({ length: policy.maxTradingDays }, (_, i) => [`d${i}`, i])),
            [new Date(NOW).toISOString().slice(0, 10)]: NOW,
        },
    });
    s.check(evaluatePreTrade({ ...basePre, attempt: sameDayAttempt }).ok, "max trading days but already active today → allowed (same-day continuation)");
    s.check(
        !evaluatePreTrade({ ...basePre, sizeCentiLots: Math.round((policy.positionSizePolicy.maxSizeLots + 1) * 100) }).ok,
        "oversized position → rejected"
    );
    s.check(!evaluatePreTrade({ ...basePre, riskCents: Math.round(starting * 0.03) }).ok, "risk above per-trade limit → rejected");
    s.check(!evaluatePreTrade({ ...basePre, notionalCents: Math.round(starting * 30) }).ok, "notional above position cap → rejected");
    s.check(
        !evaluatePreTrade({ ...basePre, notionalCents: Math.round(starting * 3), metrics: metricsFor({ policy }) }).ok,
        "leverage policy exceeded → rejected"
    );
    s.check(!evaluatePreTrade({ ...basePre, attempt: makeAttempt({ policy, status: "CANCELLED" }) }).ok, "non-ACTIVE attempt → rejected");
    s.check(
        !evaluatePreTrade({ ...basePre, attempt: makeAttempt({ policy, expiresAt: NOW - 1 }) }).ok,
        "expired attempt → rejected"
    );

    const hoursPre = evaluatePreTrade({ ...basePre, policy: makePolicy({ tradingHours: { startUtcHour: 8, endUtcHour: 12 } }), now: Date.UTC(2026, 0, 5, 15, 0, 0) });
    s.check(!hoursPre.ok && hoursPre.violations.some((v) => v.type === "TRADING_HOURS_VIOLATION"), "outside trading-hours window → rejected");

    s.section("Pre-trade advisories");
    const nearLimit = evaluatePreTrade({ ...basePre, riskCents: Math.round(starting * 0.019) });
    s.check(nearLimit.ok && nearLimit.advisories.some((a) => a.ruleId === "RISK_PER_TRADE"), "risk near the limit is advisory, not blocking");
    const noStop = evaluatePreTrade({ ...basePre, stopLossMicros: null, riskCents: null });
    s.check(noStop.ok && noStop.advisories.some((a) => a.message.includes("No stop-loss")), "missing stop surfaces an advisory");

    s.section("Determinism");
    const run1 = evaluateAccountRules({ attempt: makeAttempt({ policy }), policy, metrics: metricsFor({ policy, account: breachAccount }), now: NOW, nextEventId });
    const run2 = evaluateAccountRules({ attempt: makeAttempt({ policy }), policy, metrics: metricsFor({ policy, account: breachAccount }), now: NOW, nextEventId });
    const stripIds = (events: typeof run1) => JSON.stringify(events.map((e) => ({ ...e, eventId: "" })));
    s.check(stripIds(run1) === stripIds(run2), "identical inputs → identical rule output (ids excluded)");

    void makeOpenTrade;
    return s.finish();
}
