// Metrics engine tests — equity, drawdown, daily loss, target, consistency.

import { createSuite } from "./harness";
import { computeMetrics, drawdownPct, dayKeyOf, tradingDayCount, evaluateConsistency, dailyPnlSeries, worstDailyLossPct } from "../metrics";
import { NOW, DAY, makePolicy, makeAttempt, makeAccount, makeOpenTrade } from "./fixtures";
import type { ChallengeTrade } from "../types";

export async function runMetricsTests(): Promise<boolean> {
    const s = createSuite("metrics");
    const policy = makePolicy();
    const starting = policy.startingBalanceCents; // 10,000,000 cents = $100k

    s.section("Drawdown modes");
    s.check(
        drawdownPct({ equityCents: 9_200_000, peakEquityCents: 10_000_000, startingBalanceCents: starting, mode: "static" }) === 8,
        "static: 8% drop from starting balance"
    );
    s.check(
        drawdownPct({ equityCents: 9_600_000, peakEquityCents: 12_000_000, startingBalanceCents: starting, mode: "trailing" }) === 20,
        "trailing: drop measured from peak equity"
    );
    s.check(
        drawdownPct({ equityCents: 11_000_000, peakEquityCents: 10_000_000, startingBalanceCents: starting, mode: "static" }) === 0,
        "gains never produce negative drawdown"
    );

    s.section("Flat account snapshot");
    const attempt = makeAttempt();
    const account = makeAccount(policy);
    const metrics = computeMetrics({
        attempt,
        account,
        policy,
        openTrades: [],
        closedTrades: [],
        marks: [],
        quoteAt: NOW,
        now: NOW,
    });
    s.check(metrics.equityCents === starting, "equity = starting balance when flat");
    s.check(metrics.totalReturnPct === 0, "return 0%");
    s.check(metrics.currentDrawdownPct === 0, "drawdown 0%");
    s.check(metrics.dailyPnLCcents === 0, "daily PnL 0");
    s.check(metrics.dailyLossUsedPct === 0, "daily loss usage 0");
    s.check(metrics.dataQuality === "fresh", "fresh quote → fresh data");
    s.check(metrics.targetProgressPct === 0, "target progress 0");
    s.check(metrics.distanceToTargetPct === policy.profitTargetPct, "distance = full target");
    s.check(metrics.openExposureCents === 0, "flat account has no exposure");

    s.section("Net exposure by symbol");
    const eurLong = makeOpenTrade({ tradeId: "eur_long", side: "long", sizeCentiLots: 100, entryPriceMicros: 1_100_000 });
    const eurShort = makeOpenTrade({ tradeId: "eur_short", side: "short", sizeCentiLots: 40, entryPriceMicros: 1_100_000 });
    const goldLong = makeOpenTrade({
        tradeId: "gold_long",
        symbol: "XAUUSD",
        market: "metals",
        side: "long",
        sizeCentiLots: 100,
        entryPriceMicros: 2_000_000_000,
    });
    const exposures = computeMetrics({
        attempt,
        account,
        policy,
        openTrades: [eurLong, eurShort, goldLong],
        closedTrades: [],
        marks: [
            { tradeId: "eur_long", unrealizedPnLCents: 0, markPriceMicros: 1_100_000, quoteAt: NOW },
            { tradeId: "eur_short", unrealizedPnLCents: 0, markPriceMicros: 1_100_000, quoteAt: NOW },
            { tradeId: "gold_long", unrealizedPnLCents: 0, markPriceMicros: 2_000_000_000, quoteAt: NOW },
        ],
        quoteAt: NOW,
        now: NOW,
    });
    s.check(exposures.symbolExposureCents.EURUSD === 6_600_000, "opposite EURUSD sides net to 0.60 lots");
    s.check(exposures.symbolNetExposureCents.EURUSD === 6_600_000, "net long exposure is signed positively");
    s.check(exposures.symbolExposureCents.XAUUSD === 20_000_000, "XAUUSD uses its instrument contract size, not the FX fallback");
    s.check(exposures.openExposureCents === 26_600_000, "account exposure sums per-symbol net positions");

    s.section("Daily loss usage is a PERCENT OF THE ALLOWANCE");
    const lossAccount = makeAccount(policy, { balanceCents: starting - 400_000, realizedPnLCents: -400_000 });
    const fullLossMetrics = computeMetrics({ attempt, account: lossAccount, policy, openTrades: [], closedTrades: [], marks: [], quoteAt: NOW, now: NOW });
    s.check(Math.abs(fullLossMetrics.dailyLossUsedPct - 100) < 0.001, `loss equal to limit → 100% used (got ${fullLossMetrics.dailyLossUsedPct})`);
    s.check(fullLossMetrics.remainingDailyLossCents === 0, "no remaining daily allowance at the limit");
    s.check(fullLossMetrics.dailyLossLimitCents === 400_000, "daily limit = 4% of day-start equity");

    const halfLossAccount = makeAccount(policy, { balanceCents: starting - 200_000, realizedPnLCents: -200_000 });
    const halfLoss = computeMetrics({ attempt, account: halfLossAccount, policy, openTrades: [], closedTrades: [], marks: [], quoteAt: NOW, now: NOW });
    s.check(Math.abs(halfLoss.dailyLossUsedPct - 50) < 0.001, `half the daily limit → 50% used (got ${halfLoss.dailyLossUsedPct})`);
    s.check(halfLoss.remainingDailyLossCents === 200_000, "$2,000 remaining of the daily allowance");

    s.section("Target progress and drawdown with marks");
    const marked = computeMetrics({
        attempt,
        account: makeAccount(policy),
        policy,
        openTrades: [makeOpenTrade()],
        closedTrades: [],
        marks: [{ tradeId: "trd_0001", unrealizedPnLCents: 500_000, markPriceMicros: 1_105_000, quoteAt: NOW }],
        quoteAt: NOW,
        now: NOW,
    });
    s.check(marked.equityCents === starting + 500_000, "equity includes unrealized mark");
    s.check(marked.totalReturnPct === 5, "5% return on +$5,000");
    s.check(marked.targetProgressPct === 50, "5% of 10% target = 50% progress");
    s.check(marked.unrealizedPnLCents === 500_000, "unrealized tracked separately from realized");

    const stale = computeMetrics({
        attempt,
        account: makeAccount(policy),
        policy,
        openTrades: [makeOpenTrade()],
        closedTrades: [],
        marks: [{ tradeId: "trd_0001", unrealizedPnLCents: 0, markPriceMicros: null, quoteAt: null }],
        quoteAt: NOW - 10 * 60_000,
        now: NOW,
    });
    s.check(stale.dataQuality === "stale", "missing marks → stale data (blocks breaches upstream)");

    s.section("Trading days accounting");
    const attemptWithDays = makeAttempt({
        tradingDayKeys: { "2026-01-02": NOW - 3 * DAY, "2026-01-05": NOW },
        dailyTradeCounts: { "2026-01-05": 2 },
    });
    const daysMetrics = computeMetrics({
        attempt: attemptWithDays,
        account: makeAccount(policy),
        policy,
        openTrades: [],
        closedTrades: [],
        marks: [],
        quoteAt: NOW,
        now: NOW,
    });
    s.check(daysMetrics.tradingDays === 2, "distinct trading days counted");
    s.check(daysMetrics.dailyTrades === 2, "today's trade count read from attempt");
    s.check(dayKeyOf(NOW) === "2026-01-05", "UTC day key");
    s.check(tradingDayCount(attemptWithDays) === 2, "tradingDayCount helper");

    s.section("Expiry");
    const expiredAttempt = makeAttempt({ expiresAt: NOW - 1 });
    const expired = computeMetrics({
        attempt: expiredAttempt,
        account: makeAccount(policy),
        policy,
        openTrades: [],
        closedTrades: [],
        marks: [],
        quoteAt: NOW,
        now: NOW,
    });
    s.check(expired.expired && expired.timeRemainingMs === 0, "expired flag after expiresAt");

    s.section("Consistency");
    const consistent = evaluateConsistency({
        policy: makePolicy({ consistency: { required: true, maxSingleDayPnlSharePct: 50, minTradesForConsistency: 10 } }),
        dailyPnl: [
            { dayKey: "2026-01-02", pnlCents: 300_000 },
            { dayKey: "2026-01-05", pnlCents: 300_000 },
        ],
        tradeCount: 12,
    });
    s.check(consistent.evaluated && consistent.passed, "split days pass the 50% consistency rule");
    s.check(Math.abs(consistent.bestDaySharePct - 50) < 0.001, "best-day share = 50%");

    const skewed = evaluateConsistency({
        policy: makePolicy({ consistency: { required: true, maxSingleDayPnlSharePct: 50, minTradesForConsistency: 10 } }),
        dailyPnl: [
            { dayKey: "2026-01-02", pnlCents: 900_000 },
            { dayKey: "2026-01-05", pnlCents: 100_000 },
        ],
        tradeCount: 12,
    });
    s.check(skewed.evaluated && !skewed.passed, "one dominant day fails consistency");
    s.check(skewed.bestDayKey === "2026-01-02", "dominant day identified");

    const tooFew = evaluateConsistency({
        policy: makePolicy({ consistency: { required: true, maxSingleDayPnlSharePct: 50, minTradesForConsistency: 10 } }),
        dailyPnl: [{ dayKey: "2026-01-02", pnlCents: 900_000 }],
        tradeCount: 3,
    });
    s.check(!tooFew.evaluated && tooFew.passed, "not evaluated below the trade threshold");

    s.section("Daily PnL series from closed trades");
    const closedTrades: ChallengeTrade[] = [
        makeOpenTrade({
            tradeId: "trd_a",
            status: "closed",
            closedAt: NOW - DAY,
            realizedPnLCents: 200_000,
            exitPriceMicros: 1_102_000,
            exitQuoteAt: NOW - DAY,
            exitReason: "manual",
        }),
        makeOpenTrade({
            tradeId: "trd_b",
            status: "closed",
            closedAt: NOW,
            realizedPnLCents: -50_000,
            exitPriceMicros: 1_099_500,
            exitQuoteAt: NOW,
            exitReason: "manual",
        }),
    ];
    const series = dailyPnlSeries({ attempt: makeAttempt({ tradingDayKeys: { "2026-01-04": NOW - DAY, "2026-01-05": NOW } }), closedTrades, finalEquityCents: starting });
    s.check(series.length === 2, "one entry per trading day with closes");
    s.check(series[0].pnlCents === 200_000 && series[1].pnlCents === -50_000, "PnL attributed to close days");
    s.check(worstDailyLossPct(series, starting) > 0, "worst daily loss percent computed");

    return s.finish();
}
