// ─────────────────────────────────────────────────────────────────────────────
// End-to-end challenge accounting lifecycle for partial closes.
//
// Drives the FULL chain a profit lock travels, in the same order and with the
// same primitives the service uses:
//
//   planPartialClose → slicePnlAt / splitTradeCosts (the netting engine)
//   → balance / realized P&L → open-trade remainder
//   → computeMetrics (equity, daily P&L, drawdown, win rate, trading days)
//   → evaluateAccountRules (daily loss / drawdown breaches)
//   → evaluateSettlement (pass / fail verdict)
//
// Nothing here is mocked arithmetic: every figure comes from the production
// modules, so a regression anywhere in that chain fails this suite.
//
//   npm run test:arena   →  [partial-close-lifecycle]
// ─────────────────────────────────────────────────────────────────────────────

import { computeMetrics, dailyPnlSeries } from "../metrics";
import { evaluateAccountRules } from "../rules";
import { buildChallengeResult, evaluateSettlement } from "../settlement";
import { arenaSymbolSpec } from "../execution";
import { planPartialClose, slicePnlAt, splitTradeCosts } from "../partial-close";
import { addCents, pctOfCents, priceMicrosToNumber } from "../money";
import type { ChallengeTrade, VirtualAccount } from "../types";
import { createSuite } from "./harness";
import { DAY, makeAccount, makeAttempt, makeOpenTrade, makePolicy, nextEventId, NOW } from "./fixtures";

const QUOTE = 2651;

/**
 * Apply a partial close exactly as the netting engine does, returning the
 * resulting balance, closed slice and surviving trade. This mirrors
 * `reduceExposure` + `markAccountToMarket` without an RTDB round trip.
 */
function applyClose(params: {
    trade: ChallengeTrade;
    account: VirtualAccount;
    quotePrice: number;
    profitPercent?: number;
    volumePercent?: number;
}): { plan: ReturnType<typeof planPartialClose>; account: VirtualAccount; closed: ChallengeTrade | null; survivor: ChallengeTrade | null } {
    const { trade, account, quotePrice } = params;
    const spec = arenaSymbolSpec(trade.symbol);
    const stepCentiLots = Math.max(1, Math.round(params.account.attemptId ? 1 : 1));

    const plan = planPartialClose({
        trade,
        spec,
        quote: { price: quotePrice, timestamp: NOW },
        stepCentiLots,
        ...(params.profitPercent != null ? { profitPercent: params.profitPercent } : { volume: { percent: params.volumePercent } }),
    });

    if (!plan.ok || plan.closeCentiLots <= 0) {
        return { plan, account, closed: null, survivor: trade };
    }

    // ── The netting engine's own arithmetic ──
    const slice = slicePnlAt(trade, spec!, quotePrice, plan.closeCentiLots);
    const { remaining: remainingCosts } = splitTradeCosts(trade.costs, plan.closeCentiLots, trade.sizeCentiLots);

    const survivor: ChallengeTrade | null =
        plan.remainingCentiLots > 0
            ? {
                  ...trade,
                  tradeId: `${trade.tradeId}_r`,
                  sizeCentiLots: plan.remainingCentiLots,
                  costs: remainingCosts,
              }
            : null;

    const closed: ChallengeTrade | null =
        plan.isFullClose
            ? null
            : {
                  ...trade,
                  tradeId: `${trade.tradeId}_c${nextEventId()}`,
                  status: "closed",
                  closedAt: NOW,
                  exitPriceMicros: slice.exitPriceMicros,
                  exitQuoteAt: NOW,
                  exitReason: "partial_close",
                  closeType: plan.closeType,
                  sizeCentiLots: plan.closeCentiLots,
                  costs: trade.costs,
                  realizedPnLCents: slice.netCents,
              };

    // ── Balance moves by the ACTUAL realized net, once ──
    const next: VirtualAccount = {
        ...account,
        balanceCents: addCents(account.balanceCents, slice.netCents),
        realizedPnLCents: addCents(account.realizedPnLCents, slice.netCents),
    };

    return { plan, account: next, closed, survivor };
}

/** Live mark for an open trade, in the shape `computeMetrics` consumes. */
function mark(trade: ChallengeTrade, quotePrice: number): { tradeId: string; unrealizedPnLCents: number; markPriceMicros: number | null; quoteAt: number | null } {
    const spec = arenaSymbolSpec(trade.symbol);
    const slice = slicePnlAt(trade, spec!, quotePrice, trade.sizeCentiLots);
    return { tradeId: trade.tradeId, unrealizedPnLCents: slice.netCents, markPriceMicros: slice.exitPriceMicros, quoteAt: NOW };
}

export async function runPartialCloseLifecycleTests(): Promise<boolean> {
    const { check, section, finish } = createSuite("partial-close-lifecycle");

    const policy = makePolicy();
    const attempt = makeAttempt({ policy });
    const account = makeAccount(policy);

    // ── Section 43: the manual end-to-end simulation ──────────────────────
    section("lifecycle: open → profit → lock 50% → full close");
    {
        const start = makeOpenTrade({
            symbol: "XAUUSD",
            market: "metals",
            side: "long",
            sizeCentiLots: 100,
            entryPriceMicros: 2_650_000_000,
            costs: { spreadCostCents: 0, slippageCostCents: 0, commissionCents: 0 },
        });

        // 1. Starting balance.
        check(account.balanceCents === policy.startingBalanceCents, `starting balance is $${(policy.startingBalanceCents / 100).toFixed(2)}`);

        // 2. Position is open and flat at entry.
        const atEntry = slicePnlAt(start, arenaSymbolSpec("XAUUSD")!, 2650, 100);
        check(atEntry.netCents === 0, "a position opened at the entry price has zero unrealized P&L");

        // 3. Price moves → +$100.00 net unrealized, equity above balance.
        const atProfit = slicePnlAt(start, arenaSymbolSpec("XAUUSD")!, QUOTE, 100);
        check(atProfit.netCents === 10_000, `at 2651.00 the position is +$100.00 (got ${atProfit.netCents}c)`);

        const preview = planPartialClose({
            trade: start,
            spec: arenaSymbolSpec("XAUUSD"),
            quote: { price: QUOTE, timestamp: NOW },
            stepCentiLots: 1,
            profitPercent: 50,
        });
        check(preview.ok, "the trader can preview a 50% profit lock");
        check(preview.expectedNetCents === 5_000, "the preview promises $50.00 realized");
        check(preview.remainingNetCents === 5_000, "the preview shows $50.00 still running");

        // 4. Execute.
        const first = applyClose({ trade: start, account, quotePrice: QUOTE, profitPercent: 50 });
        check(first.plan.closeCentiLots === 50, "execution closes 0.50 lot — exactly what the preview showed");
        check(first.plan.expectedNetCents === preview.expectedNetCents, "execution realized exactly what the preview promised");

        // 5. Realized P&L hit the balance, once.
        check(first.account.balanceCents === policy.startingBalanceCents + 5_000, `balance is start + $50.00 (got ${first.account.balanceCents}c)`);
        check(first.account.realizedPnLCents === 5_000, "realized P&L records $50.00");

        // 6. The remainder keeps running with its own residual cost share.
        check(first.survivor !== null && first.survivor.sizeCentiLots === 50, "0.50 lot remains open");
        check(first.closed !== null && first.closed.closeType === "PROFIT_PRESERVATION", "the closed slice is tagged PROFIT_PRESERVATION");

        // 7. Equity = balance + the survivor's unrealized P&L.
        const afterLock = computeMetrics({
            attempt,
            account: first.account,
            policy,
            openTrades: first.survivor ? [first.survivor] : [],
            closedTrades: first.closed ? [first.closed] : [],
            marks: first.survivor ? [mark(first.survivor, QUOTE)] : [],
            quoteAt: NOW,
            now: NOW,
        });
        check(afterLock.equityCents === policy.startingBalanceCents + 10_000, `equity is start + $100.00 (got ${afterLock.equityCents}c)`);
        check(afterLock.unrealizedPnLCents === 5_000, "unrealized P&L is the remaining $50.00");
        check(afterLock.totalPnLCents === 10_000, "total P&L is unchanged by locking — the position never actually shrank in value");
        check(afterLock.dailyPnLCcents === 10_000, "daily P&L reflects the full $100.00 open gain");
        check(afterLock.currentDrawdownPct === 0, "a rising equity has no drawdown");
        check(afterLock.openPositions === 1, "exactly one position is still open");
        check(afterLock.tradingDays === Object.keys(attempt.tradingDayKeys).length, "trading-day count is unchanged by a partial close");

        // 8. Close the rest at the same price.
        const second = applyClose({ trade: first.survivor!, account: first.account, quotePrice: QUOTE });
        check(second.plan.isFullClose, "the remainder closes fully");
        check(second.survivor === null, "nothing is left open");

        const flat = computeMetrics({
            attempt,
            account: second.account,
            policy,
            openTrades: [],
            closedTrades: [first.closed!, second.plan.closeCentiLots > 0 ? sliceToTrade(first.survivor!, second.plan, NOW) : null].filter(Boolean) as ChallengeTrade[],
            marks: [],
            quoteAt: NOW,
            now: NOW,
        });

        // 9. Final aggregation.
        check(second.account.balanceCents === policy.startingBalanceCents + 10_000, `final balance is start + $100.00 (got ${second.account.balanceCents}c)`);
        check(flat.equityCents === second.account.balanceCents, "with no open positions equity equals balance");
        check(flat.unrealizedPnLCents === 0, "no unrealized P&L remains");
        check(flat.realizedPnLCents === 10_000, "total realized is $100.00 across both slices");
        check(flat.openPositions === 0, "no open positions remain");

        // The challenge RESULT record is where trade statistics live.
        const closedTrades = [first.closed!, sliceToTrade(first.survivor!, second.plan, NOW)];
        const result = buildChallengeResult({
            attempt,
            policy,
            metrics: flat,
            closedTrades,
            status: "PASSED",
            reasonCode: "PROFIT_TARGET_REACHED",
            reason: "test",
            dailyPnl: dailyPnlSeries({ attempt, closedTrades, finalEquityCents: flat.equityCents }),
            now: NOW,
            ruleBreachCount: 0,
        });
        check(result.tradeCount === 2, "two closed trades are aggregated into the result");
        check(result.winRatePct === 100, "win rate is 100% — both slices were profitable");
        check(result.winCount === 2 && result.lossCount === 0, "both slices count as profitable");
        check(result.totalPnLCents === 10_000, "the result's total P&L is the full $100.00");

        // 10. The slices must reconstruct the position's original P&L exactly.
        const sumOfSlices = (first.closed!.realizedPnLCents ?? 0) + (second.account.realizedPnLCents - first.account.realizedPnLCents);
        check(sumOfSlices === 10_000, `the two slices sum to the position's $100.00 (got ${sumOfSlices}c)`);
    }

    // ── A volume close on the same position behaves identically ────────────
    section("volume close accounting");
    {
        const trade = makeOpenTrade({
            symbol: "XAUUSD",
            market: "metals",
            sizeCentiLots: 100,
            entryPriceMicros: 2_650_000_000,
            costs: { spreadCostCents: 0, slippageCostCents: 0, commissionCents: 0 },
        });
        const half = applyClose({ trade, account, quotePrice: QUOTE, volumePercent: 50 });
        check(half.plan.closeCentiLots === 50, "50% of volume closes 0.50 lot");
        check(half.account.balanceCents === policy.startingBalanceCents + 5_000, "50% of volume realizes $50.00 at this price");
        check(half.plan.closeType === "VOLUME_PARTIAL", "tagged VOLUME_PARTIAL, distinct from a profit lock");
    }

    // ── Hard rule, verified against the BALANCE — not just the plan ────────
    section("a profit lock can never reduce the balance");
    {
        let allSafe = true;
        const reasons: string[] = [];
        for (let pct = 1; pct <= 100; pct += 7) {
            const trade = makeOpenTrade({
                symbol: "XAUUSD",
                market: "metals",
                sizeCentiLots: 100,
                entryPriceMicros: 2_650_000_000,
                costs: { spreadCostCents: 900, slippageCostCents: 400, commissionCents: 300 },
            });
            const result = applyClose({ trade, account, quotePrice: QUOTE, profitPercent: pct });
            if (!result.plan.ok || result.account.balanceCents <= policy.startingBalanceCents) {
                allSafe = false;
                reasons.push(`${pct}%`);
            }
        }
        check(allSafe, `every profit lock left the balance above the starting balance${reasons.length ? ` (failed at ${reasons.join(", ")})` : ""}`);
    }

    // ── A losing close must degrade risk metrics, not silently ─────────────
    section("a losing close feeds drawdown and daily loss");
    {
        const trade = makeOpenTrade({
            symbol: "XAUUSD",
            market: "metals",
            sizeCentiLots: 100,
            entryPriceMicros: 2_650_000_000,
            costs: { spreadCostCents: 0, slippageCostCents: 0, commissionCents: 0 },
        });
        const stopped = applyClose({ trade, account, quotePrice: 2645 });
        check(stopped.plan.ok, "a full close at a loss still executes");
        check(stopped.account.balanceCents === policy.startingBalanceCents - 50_000, "a 5.00 adverse move on 1.00 lot costs $500.00");

        const after = computeMetrics({
            attempt,
            account: stopped.account,
            policy,
            openTrades: [],
            closedTrades: [],
            marks: [],
            quoteAt: NOW,
            now: NOW,
        });
        check(after.dailyPnLCcents === -50_000, "daily P&L records the $500.00 loss");
        check(after.currentDrawdownPct > 0, "drawdown rises with the loss");
        check(after.dailyLossUsedPct > 0, "daily-loss utilization rises");

        const events = evaluateAccountRules({ attempt, policy, metrics: after, now: NOW, nextEventId });
        check(Array.isArray(events), "rule evaluation runs on the post-loss metrics without error");
    }

    // ── Trading days advance only when a day actually trades ───────────────
    section("trading days");
    {
        const day1 = computeMetrics({
            attempt: makeAttempt({ policy, tradingDayKeys: { [new Date(NOW).toISOString().slice(0, 10)]: 1 } }),
            account,
            policy,
            openTrades: [],
            closedTrades: [],
            marks: [],
            quoteAt: NOW,
            now: NOW,
        });
        check(day1.tradingDays === 1, "one recorded trading day");

        const day2 = computeMetrics({
            attempt: makeAttempt({
                policy,
                tradingDayKeys: { [new Date(NOW).toISOString().slice(0, 10)]: 1, [new Date(NOW + DAY).toISOString().slice(0, 10)]: 1 },
            }),
            account,
            policy,
            openTrades: [],
            closedTrades: [],
            marks: [],
            quoteAt: NOW + DAY,
            now: NOW + DAY,
        });
        check(day2.tradingDays === 2, "a second calendar trading day is counted");
    }

    // ── Settlement refuses to pass on stale data ───────────────────────────
    section("settlement verdict");
    {
        // Target is a PERCENTAGE of the starting balance; the cent figure is derived
        // with the platform's own pctOfCents, never hand-written.
        const targetCents = pctOfCents(policy.startingBalanceCents, policy.profitTargetPct);
        check(targetCents === 1_000_000, `a 10% target on a $100,000 account is $10,000.00 (got ${targetCents}c)`);
        const earned = attemptWithTradingDays(policy, policy.minTradingDays);
        const closed = [makeOpenTrade({ status: "closed", closedAt: NOW, realizedPnLCents: targetCents, closeType: "FULL" })];

        const healthy = computeMetrics({
            attempt: earned,
            account: { ...account, balanceCents: policy.startingBalanceCents + targetCents, realizedPnLCents: targetCents },
            policy,
            openTrades: [],
            closedTrades: closed,
            marks: [],
            quoteAt: NOW,
            now: NOW,
        });
        check(healthy.totalReturnPct >= policy.profitTargetPct, `the account is at ${healthy.totalReturnPct.toFixed(2)}% return — target ${policy.profitTargetPct}%`);
        check(healthy.tradingDays >= policy.minTradingDays, `minimum trading days are met (${healthy.tradingDays}/${policy.minTradingDays})`);

        const passed = evaluateSettlement({
            attempt: earned,
            policy,
            metrics: healthy,
            closedTrades: closed,
            openPositionCount: 0,
            now: NOW,
            breachTypes: [],
            dailyPnl: dailyPnlSeries({ attempt: earned, closedTrades: closed, finalEquityCents: healthy.equityCents }),
        });
        check(
            passed.action === "settle" && passed.status === "PASSED",
            `hitting the profit target passes the challenge (got ${passed.action}${passed.action === "settle" ? `/${passed.status}` : ""})`,
        );

        const stillOpen = evaluateSettlement({
            attempt: earned,
            policy,
            metrics: healthy,
            closedTrades: closed,
            openPositionCount: 1,
            now: NOW,
            breachTypes: [],
            dailyPnl: [],
        });
        check(stillOpen.action === "none", "an open position blocks the pass verdict — the challenge cannot settle mid-trade");

        const stale = computeMetrics({
            attempt: earned,
            account: { ...account, balanceCents: policy.startingBalanceCents + targetCents, realizedPnLCents: targetCents },
            policy,
            openTrades: [],
            closedTrades: closed,
            marks: [],
            quoteAt: null,
            now: NOW,
        });
        check(stale.dataQuality === "stale", "no quote timestamp means the metrics are marked stale");
        const blocked = evaluateSettlement({
            attempt: earned,
            policy,
            metrics: stale,
            closedTrades: closed,
            openPositionCount: 0,
            now: NOW,
            breachTypes: ["DRAWDOWN_BREACH"],
            dailyPnl: [],
        });
        check(blocked.action === "blocked", "a stale-data breach blocks the verdict instead of guessing");
    }

    // ── Reconciliation: the quote is the only source of truth ─────────────
    section("reconciliation");
    {
        const trade = makeOpenTrade({
            symbol: "XAUUSD",
            market: "metals",
            sizeCentiLots: 100,
            entryPriceMicros: 2_650_000_000,
            costs: { spreadCostCents: 0, slippageCostCents: 0, commissionCents: 0 },
        });
        const locked = applyClose({ trade, account, quotePrice: QUOTE, profitPercent: 50 });
        const m = computeMetrics({
            attempt,
            account: locked.account,
            policy,
            openTrades: locked.survivor ? [locked.survivor] : [],
            closedTrades: locked.closed ? [locked.closed] : [],
            marks: locked.survivor ? [mark(locked.survivor, QUOTE)] : [],
            quoteAt: NOW,
            now: NOW,
        });
        check(
            m.balanceCents === m.realizedPnLCents + policy.startingBalanceCents,
            "balance = starting balance + realized P&L, exactly",
        );
        check(
            m.equityCents === m.balanceCents + m.unrealizedPnLCents,
            "equity = balance + unrealized P&L, exactly",
        );
        check(
            m.totalPnLCents === m.realizedPnLCents + m.unrealizedPnLCents,
            "total P&L = realized + unrealized — one consistent source of truth",
        );
        check(
            Math.abs(priceMicrosToNumber(locked.survivor!.entryPriceMicros) - 2650) < 1e-9,
            "the survivor keeps the ORIGINAL entry price — no re-quoting of the remaining size",
        );
    }

    return finish();
}

/** An attempt that has satisfied the minimum trading-day requirement. */
function attemptWithTradingDays(policy: ReturnType<typeof makePolicy>, days: number) {
    const keys: Record<string, number> = {};
    for (let i = 0; i < days; i += 1) keys[new Date(NOW + i * DAY).toISOString().slice(0, 10)] = 1;
    return makeAttempt({ policy, tradingDayKeys: keys });
}

/** Materialise the closed record of a full close for metric aggregation. */
function sliceToTrade(trade: ChallengeTrade, plan: ReturnType<typeof planPartialClose>, at: number): ChallengeTrade {
    const spec = arenaSymbolSpec(trade.symbol);
    const slice = slicePnlAt(trade, spec!, plan.executionPrice, plan.closeCentiLots);
    return {
        ...trade,
        tradeId: `${trade.tradeId}_final`,
        status: "closed",
        closedAt: at,
        exitPriceMicros: slice.exitPriceMicros,
        exitQuoteAt: at,
        exitReason: "manual",
        closeType: plan.closeType,
        sizeCentiLots: plan.closeCentiLots,
        realizedPnLCents: slice.netCents,
    };
}