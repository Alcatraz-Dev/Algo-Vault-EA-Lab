// Settlement tests — deterministic pass/fail/expiry verdicts + report stats.

import { createSuite } from "./harness";
import { evaluateSettlement, passRequirements, buildChallengeResult, settlementExplanation, maxDrawdownOverSeries } from "../settlement";
import { computeMetrics, evaluateConsistency } from "../metrics";
import { NOW, DAY, makePolicy, makeAttempt, makeAccount, makeOpenTrade } from "./fixtures";
import type { ChallengeAttempt, ChallengePolicy, ChallengeTrade } from "../types";

function metricsFor(policy: ChallengePolicy, attempt: ChallengeAttempt, account = makeAccount(policy), quoteAt = NOW) {
    return computeMetrics({
        attempt,
        account,
        policy,
        openTrades: [],
        closedTrades: [],
        marks: [],
        quoteAt,
        now: NOW,
    });
}

const passingDays = () => {
    const days: Record<string, number> = {};
    for (let i = 1; i <= 5; i++) days[`2026-01-0${i}`] = NOW - i * DAY;
    return days;
};

export async function runSettlementTests(): Promise<boolean> {
    const s = createSuite("settlement");
    const policy = makePolicy();
    const starting = policy.startingBalanceCents;

    s.section("Profit target + min days + flat → PASSED");
    const passAttempt = makeAttempt({ policy, tradingDayKeys: passingDays() });
    const passAccount = makeAccount(policy, { balanceCents: starting + 1_100_000, realizedPnLCents: 1_100_000 });
    const verdict = evaluateSettlement({
        attempt: passAttempt,
        policy,
        metrics: metricsFor(policy, passAttempt, passAccount),
        closedTrades: [],
        openPositionCount: 0,
        now: NOW,
        breachTypes: [],
        dailyPnl: [],
    });
    s.check(verdict.action === "settle" && verdict.status === "PASSED", "target met, days met, flat → PASSED");
    s.check(verdict.action === "settle" && verdict.reasonCode === "PROFIT_TARGET_REACHED", "reason code is deterministic");

    s.section("Open positions block auto-pass");
    const withOpen = evaluateSettlement({
        attempt: passAttempt,
        policy,
        metrics: metricsFor(policy, passAttempt, passAccount),
        closedTrades: [],
        openPositionCount: 2,
        now: NOW,
        breachTypes: [],
        dailyPnl: [],
    });
    s.check(withOpen.action === "none", "target met but positions open → no settle yet");

    s.section("Min days not met blocks pass");
    const tooFewDays = makeAttempt({ policy, tradingDayKeys: { "2026-01-05": NOW } });
    const early = evaluateSettlement({
        attempt: tooFewDays,
        policy,
        metrics: metricsFor(policy, tooFewDays, passAccount),
        closedTrades: [],
        openPositionCount: 0,
        now: NOW,
        breachTypes: [],
        dailyPnl: [],
    });
    s.check(early.action === "none", "target met with 1/5 days → keep running");

    s.section("Breach verdicts");
    const dd = evaluateSettlement({
        attempt: makeAttempt({ policy }),
        policy,
        metrics: metricsFor(policy, makeAttempt({ policy })),
        closedTrades: [],
        openPositionCount: 0,
        now: NOW,
        breachTypes: ["DRAWDOWN_BREACH"],
        dailyPnl: [],
    });
    s.check(dd.action === "settle" && dd.status === "FAILED" && dd.reasonCode === "MAX_DRAWDOWN_BREACH", "drawdown breach → FAILED");

    const dl = evaluateSettlement({
        attempt: makeAttempt({ policy }),
        policy,
        metrics: metricsFor(policy, makeAttempt({ policy })),
        closedTrades: [],
        openPositionCount: 0,
        now: NOW,
        breachTypes: ["DAILY_LOSS_BREACH"],
        dailyPnl: [],
    });
    s.check(dl.action === "settle" && dl.status === "FAILED" && dl.reasonCode === "DAILY_LOSS_BREACH", "daily loss breach → FAILED (fail action)");

    const pausePolicy = makePolicy({ dailyLossBreachAction: "pause" });
    const paused = evaluateSettlement({
        attempt: makeAttempt({ policy: pausePolicy }),
        policy: pausePolicy,
        metrics: metricsFor(pausePolicy, makeAttempt({ policy: pausePolicy })),
        closedTrades: [],
        openPositionCount: 0,
        now: NOW,
        breachTypes: ["DAILY_LOSS_BREACH"],
        dailyPnl: [],
    });
    s.check(paused.action === "blocked" && paused.reasonCode === "DAILY_LOSS_PAUSE", "daily loss breach + pause policy → blocked (pause, not fail)");

    s.section("Fail-closed on stale data");
    const staleBlocked = evaluateSettlement({
        attempt: makeAttempt({ policy }),
        policy,
        metrics: { ...metricsFor(policy, makeAttempt({ policy })), dataQuality: "stale" },
        closedTrades: [],
        openPositionCount: 0,
        now: NOW,
        breachTypes: ["DRAWDOWN_BREACH"],
        dailyPnl: [],
    });
    s.check(staleBlocked.action === "blocked" && staleBlocked.reasonCode === "STALE_MARKET_DATA", "breach + stale data → settlement withheld");

    s.section("Calendar expiry");
    const expiredAttempt = makeAttempt({ policy, expiresAt: NOW - 1 });
    const expired = evaluateSettlement({
        attempt: expiredAttempt,
        policy,
        metrics: metricsFor(policy, expiredAttempt),
        closedTrades: [],
        openPositionCount: 0,
        now: NOW,
        breachTypes: [],
        dailyPnl: [],
    });
    s.check(expired.action === "settle" && expired.status === "EXPIRED", "wall-clock expiry → EXPIRED");

    s.section("Consistency gate at settlement");
    const consistencyPolicy = makePolicy({ consistency: { required: true, maxSingleDayPnlSharePct: 40, minTradesForConsistency: 5 } });
    const cAttempt = makeAttempt({ policy: consistencyPolicy, tradingDayKeys: passingDays() });
    const cAccount = makeAccount(consistencyPolicy, { balanceCents: 11_100_000, realizedPnLCents: 1_100_000 });
    const skewedDaily = [
        { dayKey: "2026-01-04", pnlCents: 1_000_000 },
        { dayKey: "2026-01-05", pnlCents: 100_000 },
    ];
    const consistencyCheck = evaluateConsistency({ policy: consistencyPolicy, dailyPnl: skewedDaily, tradeCount: 8 });
    s.check(consistencyCheck.evaluated && !consistencyCheck.passed, "skewed profit fails the consistency requirement");
    const cVerdict = evaluateSettlement({
        attempt: cAttempt,
        policy: consistencyPolicy,
        metrics: metricsFor(consistencyPolicy, cAttempt, cAccount),
        closedTrades: [
            makeOpenTrade({ tradeId: "c1", status: "closed", closedAt: NOW, realizedPnLCents: 100_000, exitPriceMicros: 1_101_000, exitQuoteAt: NOW, exitReason: "manual" }),
            makeOpenTrade({ tradeId: "c2", status: "closed", closedAt: NOW, realizedPnLCents: 100_000, exitPriceMicros: 1_101_000, exitQuoteAt: NOW, exitReason: "manual" }),
            makeOpenTrade({ tradeId: "c3", status: "closed", closedAt: NOW, realizedPnLCents: 100_000, exitPriceMicros: 1_101_000, exitQuoteAt: NOW, exitReason: "manual" }),
            makeOpenTrade({ tradeId: "c4", status: "closed", closedAt: NOW, realizedPnLCents: 100_000, exitPriceMicros: 1_101_000, exitQuoteAt: NOW, exitReason: "manual" }),
            makeOpenTrade({ tradeId: "c5", status: "closed", closedAt: NOW, realizedPnLCents: 100_000, exitPriceMicros: 1_101_000, exitQuoteAt: NOW, exitReason: "manual" }),
        ],
        openPositionCount: 0,
        now: NOW,
        breachTypes: [],
        dailyPnl: skewedDaily,
    });
    s.check(cVerdict.action === "settle" && cVerdict.status === "FAILED" && cVerdict.reasonCode === "CONSISTENCY_FAILED", "required consistency failure → FAILED at settlement");

    s.section("Already-terminal attempts are untouched");
    const settled = evaluateSettlement({
        attempt: makeAttempt({ policy, status: "PASSED", settledAt: NOW }),
        policy,
        metrics: metricsFor(policy, makeAttempt({ policy })),
        closedTrades: [],
        openPositionCount: 0,
        now: NOW,
        breachTypes: ["DRAWDOWN_BREACH"],
        dailyPnl: [],
    });
    s.check(settled.action === "none", "no re-settlement of a terminal attempt");

    s.section("Pass requirements checklist");
    const reqs = passRequirements({ policy, metrics: metricsFor(policy, passAttempt, passAccount), openPositionCount: 0 });
    s.check(reqs.length === 5, "five requirements tracked");
    s.check(reqs.find((r) => r.key === "target")?.met === true, "target requirement met");
    s.check(reqs.find((r) => r.key === "days")?.met === true, "days requirement met");
    s.check(reqs.find((r) => r.key === "flat")?.met === true, "flat requirement met");
    const failingReqs = passRequirements({ policy, metrics: metricsFor(policy, makeAttempt({ policy })), openPositionCount: 1 });
    s.check(
        ["target", "days", "flat"].every((key) => failingReqs.find((r) => r.key === key)?.met === false),
        "fresh attempt misses target / days / flat"
    );
    s.check(failingReqs.find((r) => r.key === "drawdown")?.met === true, "drawdown guardrail starts satisfied (0% used)");

    s.section("Result building");
    const closed: ChallengeTrade[] = [
        makeOpenTrade({ tradeId: "t1", status: "closed", closedAt: NOW, realizedPnLCents: 100_000, exitPriceMicros: 1_101_000, exitQuoteAt: NOW, exitReason: "manual" }),
        makeOpenTrade({ tradeId: "t2", status: "closed", closedAt: NOW, realizedPnLCents: 60_000, exitPriceMicros: 1_100_600, exitQuoteAt: NOW, exitReason: "manual" }),
        makeOpenTrade({ tradeId: "t3", status: "closed", closedAt: NOW, realizedPnLCents: -40_000, exitPriceMicros: 1_099_600, exitQuoteAt: NOW, exitReason: "manual" }),
        makeOpenTrade({ tradeId: "t4", status: "closed", closedAt: NOW, realizedPnLCents: -20_000, exitPriceMicros: 1_099_800, exitQuoteAt: NOW, exitReason: "stop_loss" }),
    ];
    const result = buildChallengeResult({
        attempt: passAttempt,
        policy,
        metrics: metricsFor(policy, passAttempt, passAccount),
        closedTrades: closed,
        status: "PASSED",
        reasonCode: "PROFIT_TARGET_REACHED",
        reason: "Target reached with 5 trading days.",
        dailyPnl: [{ dayKey: "2026-01-05", pnlCents: 100_000 }],
        now: NOW,
        ruleBreachCount: 1,
    });
    s.check(result.tradeCount === 4 && result.winCount === 2 && result.lossCount === 2, "trade statistics counted");
    s.check(result.winRatePct === 50, "win rate = 50%");
    s.check(result.totalFeesCents === 4 * (1200 + 400 + 350), "fees summed from all closed trades");
    s.check(result.bestTradeCents === 100_000 && result.worstTradeCents === -40_000, "best/worst trades");
    s.check(result.consistencyPassed === true, "consistency passed when no data contradicts");
    s.check(result.ruleBreachCount === 1, "breach count recorded");

    const explanation = settlementExplanation(result, policy);
    s.check(explanation[0].includes("PASSED"), "explanation leads with the final status");
    s.check(explanation.some((l) => l.includes("PROFIT_TARGET_REACHED")), "explanation includes the reason code");
    s.check(explanation.some((l) => l.toLowerCase().includes("simulated performance only")), "explanation carries the honesty disclaimer");

    s.section("Historical max drawdown over equity series");
    const worst = maxDrawdownOverSeries({
        equityCurve: [
            { t: 1, equityCents: 10_000_000 },
            { t: 2, equityCents: 9_100_000 },
            { t: 3, equityCents: 10_500_000 },
            { t: 4, equityCents: 9_900_000 },
        ],
        startingBalanceCents: starting,
        peakEquityCents: 10_500_000,
        finalEquityCents: 9_900_000,
        mode: "static",
    });
    s.check(Math.abs(worst - 9) < 0.01, `static worst DD = 9% from starting (got ${worst})`);

    const trailingWorst = maxDrawdownOverSeries({
        equityCurve: [
            { t: 1, equityCents: 10_000_000 },
            { t: 2, equityCents: 10_500_000 },
            { t: 3, equityCents: 9_450_000 },
        ],
        startingBalanceCents: starting,
        peakEquityCents: 10_500_000,
        finalEquityCents: 9_450_000,
        mode: "trailing",
    });
    s.check(Math.abs(trailingWorst - 10) < 0.01, `trailing worst DD = 10% from peak (got ${trailingWorst})`);

    return s.finish();
}
