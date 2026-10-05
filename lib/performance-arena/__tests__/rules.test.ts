// Rule engine tests — warnings, breaches, stale-data fail-closed behavior,
// and the deterministic pre-trade gate.

import { createSuite } from "./harness";
import { evaluateAccountRules, evaluatePreTrade } from "../rules";
import { computeMetrics } from "../metrics";
import { arenaSymbolSpec } from "../execution";
import { toPriceMicros } from "../money";
import { effectiveNotionalMultiple } from "../sizing";
import { normalizeChallengePolicy } from "../policies";
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
    // EURUSD is 100,000 units per lot, so one lot carries ~$110,000 of notional:
    // 110% of the $100K account in NOTIONAL. At a 10-pip stop that same lot
    // risks about $120, or 0.12% of equity. Notional is not risk — which is
    // exactly why the gate must size on the stop distance. Under the old
    // notional-to-equity rule the legal maximum was 0.22 lots and a 5-lot
    // position could never be opened at all.
    const basePre = {
        attempt: makeAttempt({ policy }),
        policy,
        metrics: metricsFor({ policy }),
        now: NOW,
        symbol: "EURUSD",
        side: "long" as const,
        sizeCentiLots: 10, // 0.10 lot
        stopLossMicros: 1_099_000, // 10 pips below 1.10000
        takeProfitMicros: null,
        entryPriceMicros: 1_100_000,
        openPositions: 0,
        quotePrice: 1.1,
        session: "london",
        marketOpen: true,
        nextEventId,
    };
    const ok = evaluatePreTrade(basePre);
    s.check(ok.ok && ok.violations.length === 0, "valid order passes the gate");
    const fiveLots = evaluatePreTrade({ ...basePre, sizeCentiLots: 500 });
    s.check(
        fiveLots.ok && (fiveLots.sizing?.notionalPctOfEquity ?? 0) > 500 && (fiveLots.sizing?.riskPctOfEquity ?? 100) < 1,
        "5 lots of EURUSD: 550% of equity in notional, under 1% in risk — the order is legal"
    );
    s.check(
        fiveLots.sizing !== null && (fiveLots.sizing.rewardRiskRatio === null || Number.isFinite(fiveLots.sizing.rewardRiskRatio)),
        "sizing solve reports a reward:risk"
    );

    s.section("Pre-trade gate: markets and schedules");
    const cryptoTrade = evaluatePreTrade({ ...basePre, symbol: "BTCUSD", session: null, policy: makePolicy({ weekendTrading: "blocked", tradingHours: { startUtcHour: 8, endUtcHour: 12 }, allowedSessions: ["london"] }) });
    s.check(cryptoTrade.ok, "supported crypto symbol remains tradeable around the clock when the feed is fresh");
    s.check(!evaluatePreTrade({ ...basePre, symbol: "BTCUSD", policy: makePolicy({ allowedMarkets: ["forex"] }) }).ok, "explicit market policy still blocks excluded crypto");
    s.section("Pre-trade gate: rejections");
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
    // Risk is measured from the stop distance, so widening the stop (not the
    // notional) is what pushes a trade over the per-trade cap. EURUSD is 100,000
    // units per lot, so a 100-pip stop costs ~$1,000 per lot: 4 lots ≈ 4% of a
    // $100K account → rejected, while the same 4 lots at a 10-pip stop risks
    // under 0.5% and is comfortably legal.
    const wideStop = evaluatePreTrade({ ...basePre, sizeCentiLots: 400, stopLossMicros: 1_090_000 });
    s.check(
        !wideStop.ok && wideStop.violations.some((v) => v.ruleId === "RISK_PER_TRADE"),
        "4 lots at a 100-pip stop → rejected on per-trade risk (not notional)"
    );
    s.check(
        evaluatePreTrade({ ...basePre, sizeCentiLots: 400 }).ok,
        "the same 4 lots at a 10-pip stop is legal — proof the gate reads risk, not notional"
    );
    s.check(
        evaluatePreTrade({ ...basePre, sizeCentiLots: 500 }).ok,
        "5.00 lots EURUSD at a 10-pip stop is legal: ~0.6% risk, 5.5× notional inside the 20× leverage policy"
    );
    s.check(
        !evaluatePreTrade({ ...basePre, sizeCentiLots: 1000 }).ok,
        "10.00 lots (above the 5-lot policy cap) → rejected"
    );
    // Existing exposure pushes the account past the leverage policy: 5 lots of
    // EURUSD is $550K of notional against $100K equity, so one more lot would
    // exceed 20× only if exposure were already loaded.
    const loadedMetrics = computeMetrics({
        attempt: makeAttempt({ policy }),
        account: makeAccount(policy, { exposureCents: Math.round(starting * 19) }),
        policy,
        openTrades: [makeOpenTrade({ tradeId: "trd_a", symbol: "GBPUSD", sizeCentiLots: 1900, entryPriceMicros: 1_300_000 })],
        closedTrades: [],
        marks: [],
        quoteAt: NOW,
        now: NOW,
    });
    s.check(
        !evaluatePreTrade({ ...basePre, metrics: loadedMetrics }).ok,
        "combined exposure above the leverage policy → rejected"
    );

    s.section("Side-aware leverage netting with instrument-specific contract sizes");
    // One EURUSD lot is $110,000 of notional on a $100,000 account, so the 20×
    // leverage ceiling binds around the 18th lot — reachable only when the
    // account is already loaded. 2× is used here so the netting behaviour is
    // observable with a legal lot size.
    const netPolicy = makePolicy({ leveragePolicy: { maxLeverageRatio: 2 } });
    const eurEntryMicros = toPriceMicros(1.1);
    const eurLongMetrics = computeMetrics({
        attempt: makeAttempt({ policy: netPolicy }),
        account: makeAccount(netPolicy),
        policy: netPolicy,
        openTrades: [makeOpenTrade({ tradeId: "existing-eur", side: "long", sizeCentiLots: 100, entryPriceMicros: eurEntryMicros })],
        closedTrades: [],
        marks: [{ tradeId: "existing-eur", unrealizedPnLCents: 0, markPriceMicros: eurEntryMicros, quoteAt: NOW }],
        quoteAt: NOW,
        now: NOW,
    });
    s.check(
        eurLongMetrics.openExposureCents / starting === 1.1,
        "one EURUSD lot is 1.1× equity of notional"
    );
    const offset = evaluatePreTrade({
        ...basePre,
        policy: netPolicy,
        attempt: makeAttempt({ policy: netPolicy }),
        metrics: eurLongMetrics,
        side: "short",
        sizeCentiLots: 100,
        stopLossMicros: 1_101_000, // short stop sits above entry
        entryPriceMicros: eurEntryMicros,
    });
    s.check(offset.ok, "an opposing order nets the existing exposure to zero instead of doubling account leverage");

    const sameSide = evaluatePreTrade({
        ...basePre,
        policy: netPolicy,
        attempt: makeAttempt({ policy: netPolicy }),
        metrics: eurLongMetrics,
        side: "long",
        sizeCentiLots: 100,
        entryPriceMicros: eurEntryMicros,
    });
    const sameSideLeverage = sameSide.violations.find((event) => event.ruleId === "LEVERAGE");
    s.check(!sameSide.ok && sameSideLeverage?.currentValue === 2.2, "same-side order is still rejected at 2.2× equity");

    s.check(
        arenaSymbolSpec("XAUUSD")!.contractSize === 100,
        "gold notional uses the metal contract size (100 oz), not the FX size"
    );
    const goldEntryMicros = toPriceMicros(2_000);
    // A $1 stop (100 gold pips) risks $100 per lot, so 5 lots risks $500 — 0.5%
    // of a $100K account. That keeps risk out of the way when the assertion is
    // about notional/leverage ceilings.
    const goldStopMicros = toPriceMicros(1_999);
    const goldPre = {
        ...basePre,
        symbol: "XAUUSD",
        side: "long" as const,
        sizeCentiLots: 100,
        stopLossMicros: goldStopMicros,
        entryPriceMicros: goldEntryMicros,
    };
    const goldMetrics = computeMetrics({
        attempt: makeAttempt({ policy: netPolicy }),
        account: makeAccount(netPolicy),
        policy: netPolicy,
        openTrades: [makeOpenTrade({
            tradeId: "existing-gold",
            symbol: "XAUUSD",
            market: "metals",
            side: "long",
            sizeCentiLots: 100,
            entryPriceMicros: goldEntryMicros,
        })],
        closedTrades: [],
        marks: [{ tradeId: "existing-gold", unrealizedPnLCents: 0, markPriceMicros: goldEntryMicros, quoteAt: NOW }],
        quoteAt: NOW,
        now: NOW,
    });
    s.check(
        goldMetrics.openExposureCents / starting === 2,
        "one gold lot is 2× equity of notional at the metal contract size"
    );
    const goldOrder = evaluatePreTrade({
        ...goldPre,
        policy: netPolicy,
        attempt: makeAttempt({ policy: netPolicy }),
        metrics: goldMetrics,
    });
    const goldLeverage = goldOrder.violations.find((event) => event.ruleId === "LEVERAGE");
    s.check(!goldOrder.ok, "second XAUUSD lot exceeds a 2× account leverage cap");
    s.check(goldLeverage?.currentValue === 4, "gold leverage counts the existing and new lot at the metal contract size");

    // Per-instrument ceiling: 5 lots of gold is $1,000,000 against $100,000
    // equity = 10×, so a 3× policy rejects it and a 10× policy accepts it.
    const strictSymbol = makePolicy({ maxPositionNotionalMultiple: 3 });
    const strictGold = evaluatePreTrade({
        ...goldPre,
        policy: strictSymbol,
        attempt: makeAttempt({ policy: strictSymbol }),
        metrics: metricsFor({ policy: strictSymbol }),
        sizeCentiLots: 500,
    });
    s.check(
        !strictGold.ok && strictGold.violations.some((event) => event.ruleId === "POSITION_SIZE" && event.message.includes("exposure would reach")),
        "per-symbol gold limit is evaluated using native metal contract size"
    );
    const lenientSymbol = makePolicy({ maxPositionNotionalMultiple: 10 });
    s.check(
        evaluatePreTrade({
            ...goldPre,
            policy: lenientSymbol,
            attempt: makeAttempt({ policy: lenientSymbol }),
            metrics: metricsFor({ policy: lenientSymbol }),
            sizeCentiLots: 500,
        }).ok,
        "the same 5 gold lots is legal under a 10× per-instrument ceiling"
    );
    s.check(!evaluatePreTrade({ ...basePre, attempt: makeAttempt({ policy, status: "CANCELLED" }) }).ok, "non-ACTIVE attempt → rejected");
    s.check(
        !evaluatePreTrade({ ...basePre, attempt: makeAttempt({ policy, expiresAt: NOW - 1 }) }).ok,
        "expired attempt → rejected"
    );

    const hoursPre = evaluatePreTrade({ ...basePre, policy: makePolicy({ tradingHours: { startUtcHour: 8, endUtcHour: 12 } }), now: Date.UTC(2026, 0, 5, 15, 0, 0) });
    s.check(!hoursPre.ok && hoursPre.violations.some((v) => v.type === "TRADING_HOURS_VIOLATION"), "outside trading-hours window → rejected");

    s.section("Pre-trade advisories");
    // At a 10-pip stop even a 5-lot ticket risks only ~0.6%, so the 80%-of-limit
    // advisory needs a wider stop: 100 pips puts 1.6 lots at ~1.63%, inside the
    // 2% cap but above the 1.6% advisory threshold.
    const nearLimit = evaluatePreTrade({ ...basePre, sizeCentiLots: 160, stopLossMicros: 1_090_000 });
    s.check(
        nearLimit.ok && nearLimit.advisories.some((a) => a.ruleId === "RISK_PER_TRADE"),
        "risk just under the per-trade cap is advisory, not blocking"
    );
    const noStop = evaluatePreTrade({ ...basePre, stopLossMicros: null });
    s.check(
        noStop.ok && noStop.advisories.some((a) => a.message.includes("No stop-loss")),
        "missing stop surfaces an advisory"
    );
    const wrongSideStop = evaluatePreTrade({ ...basePre, side: "short", stopLossMicros: 1_090_000 });
    s.check(
        wrongSideStop.ok && wrongSideStop.advisories.some((a) => a.message.includes("wrong side")),
        "a stop on the wrong side is reported as unmeasurable risk, not as a missing stop"
    );

    s.section("Risk-reducing orders bypass every entry gate");
    // Capacity and sizing stand down for a reduction, because a flat or hedged
    // book is strictly safer than an open one: the daily-trade cap, the
    // concurrent-position cap, the trading-day cap, and the risk/notional/
    // leverage ceilings must all stand aside.
    const boxedIn = makeAttempt({
        policy,
        dailyTradeCounts: { [new Date(NOW).toISOString().slice(0, 10)]: policy.maxDailyTrades },
        tradingDayKeys: Object.fromEntries(Array.from({ length: policy.maxTradingDays }, (_, i) => [`d${i}`, i])),
    });
    const asEntry = evaluatePreTrade({ ...basePre, attempt: boxedIn });
    s.check(!asEntry.ok, "the same order is rejected as an entry (daily trades + trading days exhausted)");
    s.check(
        asEntry.violations.some((v) => v.ruleId === "MAX_DAILY_TRADES") && asEntry.violations.some((v) => v.ruleId === "MAX_TRADING_DAYS"),
        "entry rejection names the capacity limits that were hit"
    );

    const fatBook = computeMetrics({
        attempt: boxedIn,
        account: makeAccount(policy, { exposureCents: Math.round(starting * 19) }),
        policy,
        openTrades: Array.from({ length: policy.maxConcurrentPositions }, (_, i) =>
            makeOpenTrade({
                tradeId: `trd_${i}`,
                symbol: "EURUSD",
                sizeCentiLots: 100,
                entryPriceMicros: 1_100_000,
                riskCents: Math.round(starting * 0.03),
            })
        ),
        closedTrades: [],
        marks: [],
        quoteAt: NOW,
        now: NOW,
    });
    const asExit = evaluatePreTrade({ ...basePre, attempt: boxedIn, metrics: fatBook, intent: "reduce" });
    s.check(
        asExit.ok,
        "a fully loaded book (positions + risk + leverage exhausted) still allows the risk-reducing order"
    );
    s.check(
        asExit.advisories.some((a) => a.type === "RISK_REDUCING_ALLOWED"),
        "the bypass is recorded in the audit trail"
    );
    s.check(
        !evaluatePreTrade({ ...basePre, attempt: boxedIn, metrics: fatBook }).ok,
        "the identical order against the same loaded book is rejected as an entry"
    );

    // Terminal state is NOT bypassed: a settled challenge is unwound by the
    // settlement engine, not by a new order.
    s.check(
        !evaluatePreTrade({ ...basePre, intent: "reduce", attempt: makeAttempt({ policy, status: "CANCELLED" }) }).ok,
        "a terminal challenge blocks reductions too — settlement owns the final accounting"
    );

    s.section("Aggregate open-risk ceiling");
    // Two trades that are each inside the 2% per-trade cap still breach the 6%
    // aggregate limit together — the guard that protects a leveraged book.
    const half = evaluatePreTrade({ ...basePre, sizeCentiLots: 250 });
    s.check(half.ok, "2.5% risk trade alone is inside the aggregate cap");
    // Two open positions at 2.4% each = 4.8% of equity already committed; the
    // aggregate cap is 6%, so a 1.5%-risk entry has to be rejected.
    const spentBudget = computeMetrics({
        attempt: makeAttempt({ policy }),
        account: makeAccount(policy),
        policy,
        openTrades: [
            makeOpenTrade({ tradeId: "trd_r1", symbol: "EURUSD", sizeCentiLots: 250, entryPriceMicros: 1_100_000, riskCents: Math.round(starting * 0.024) }),
            makeOpenTrade({ tradeId: "trd_r2", symbol: "GBPUSD", sizeCentiLots: 250, entryPriceMicros: 1_300_000, riskCents: Math.round(starting * 0.024) }),
        ],
        closedTrades: [],
        marks: [],
        quoteAt: NOW,
        now: NOW,
    });
    s.check(
        (spentBudget.openRiskUsedPct ?? 0) > 4.7 && (spentBudget.remainingRiskBudgetCents ?? 0) < Math.round(starting * 0.013),
        "metrics report the aggregate risk budget actually consumed"
    );
    const halfRisky = evaluatePreTrade({ ...basePre, metrics: spentBudget, sizeCentiLots: 300, stopLossMicros: 800_000 });
    const overAggregate = halfRisky;
    s.check(
        !overAggregate.ok && overAggregate.violations.some((v) => v.ruleId === "AGGREGATE_RISK"),
        "open risk already at the aggregate cap → next entry rejected"
    );
    s.check(
        overAggregate.violations.find((v) => v.ruleId === "AGGREGATE_RISK")?.message.includes("Maximum size") === true,
        "aggregate rejection names the maximum size that would be accepted"
    );

    s.section("Legacy notional-percentage policy still loads without rejecting normal orders");
    // The shipped definitions predate `maxPositionNotionalMultiple` and carry
    // `maxPositionPctOfEquity: 25`. Read literally that is a 0.25× cap, which on
    // a $100k account is 0.22 lots of EURUSD — small enough that an ordinary
    // 1-lot order gets rejected for "41.6% of equity". Normalization on read
    // must reinterpret it as `max(10, 0.25) = 10×`, so a stored legacy policy
    // behaves exactly like a freshly-created one with no data migration.
    const legacyPolicy = normalizeChallengePolicy({
        ...makePolicy(),
        maxPositionNotionalMultiple: undefined as unknown as number,
        maxPositionPctOfEquity: 25,
    });
    s.check(
        effectiveNotionalMultiple(legacyPolicy) === 10,
        "legacy maxPositionPctOfEquity 25 maps to a 10× notional ceiling, not 0.25×"
    );
    const legacyAttempt = makeAttempt({ policy: legacyPolicy });
    const legacyMetrics = computeMetrics({
        attempt: legacyAttempt,
        account: makeAccount(legacyPolicy),
        policy: legacyPolicy,
        openTrades: [],
        closedTrades: [],
        marks: [],
        quoteAt: NOW,
        now: NOW,
    });
    const legacyOneLot = evaluatePreTrade({
        attempt: legacyAttempt,
        policy: legacyPolicy,
        metrics: legacyMetrics,
        now: NOW,
        symbol: "EURUSD",
        side: "long",
        sizeCentiLots: 100,
        stopLossMicros: 1_099_000,
        takeProfitMicros: null,
        entryPriceMicros: 1_100_000,
        openPositions: 0,
        quotePrice: 1.1,
        session: "london",
        marketOpen: true,
        nextEventId,
    });
    s.check(
        legacyOneLot.ok,
        "a 1-lot EURUSD order passes under a legacy policy (the old rule rejected it)"
    );
    // An admin who genuinely wants a strict ceiling must still be able to
    // express it — the legacy field is a floor, not an unbounded override.
    const strictLegacy = normalizeChallengePolicy({
        ...makePolicy(),
        maxPositionNotionalMultiple: undefined as unknown as number,
        maxPositionPctOfEquity: 300,
    });
    s.check(
        effectiveNotionalMultiple(strictLegacy) === 10,
        "an intentionally loose legacy percentage is clamped up to the modern ceiling"
    );
    const strictModern = normalizeChallengePolicy({ ...makePolicy(), maxPositionNotionalMultiple: 0.5, maxPositionPctOfEquity: 300 });
    s.check(
        effectiveNotionalMultiple(strictModern) === 3,
        "a legacy percentage larger than the modern field wins (max of the two)"
    );

    s.section("Determinism");
    const run1 = evaluateAccountRules({ attempt: makeAttempt({ policy }), policy, metrics: metricsFor({ policy, account: breachAccount }), now: NOW, nextEventId });
    const run2 = evaluateAccountRules({ attempt: makeAttempt({ policy }), policy, metrics: metricsFor({ policy, account: breachAccount }), now: NOW, nextEventId });
    const stripIds = (events: typeof run1) => JSON.stringify(events.map((e) => ({ ...e, eventId: "" })));
    s.check(stripIds(run1) === stripIds(run2), "identical inputs → identical rule output (ids excluded)");

    void makeOpenTrade;
    return s.finish();
}
