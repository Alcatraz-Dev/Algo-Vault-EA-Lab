// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — metrics engine (pure, deterministic).
//
// Everything here derives from integer-cents snapshots and integer-cents
// trade history. No randomness, no wall-clock reads beyond the explicit
// `now` argument — the same inputs always produce the same metrics.
// ─────────────────────────────────────────────────────────────────────────────

import {
    addCents,
    pctOf,
    pctOfCents,
} from "./money";
import { arenaSymbolSpec } from "./execution";
import {
    effectiveAggregateRiskPct,
    effectiveNotionalMultiple,
    netExposureCents,
    sumOpenRiskCents,
} from "./sizing";
import type {
    ChallengeAttempt,
    ChallengeMetrics,
    ChallengePolicy,
    ChallengeTrade,
    EquityPoint,
    VirtualAccount,
} from "./types";

/** UTC day key used for trading-day and daily-loss accounting. */
export function dayKeyOf(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
}

/** Distinct trading days recorded on the attempt (deterministic order). */
export function tradingDayCount(attempt: ChallengeAttempt): number {
    return Object.keys(attempt.tradingDayKeys ?? {}).length;
}

export function tradesOnDay(attempt: ChallengeAttempt, dayKey: string): number {
    return attempt.dailyTradeCounts?.[dayKey] ?? 0;
}

/**
 * Drawdown in percent of the reference equity:
 *   static   → reference = starting balance
 *   trailing → reference = peak equity
 * Drawdown is never negative (gains do not produce "negative drawdown").
 */
export function drawdownPct(params: {
    equityCents: number;
    peakEquityCents: number;
    startingBalanceCents: number;
    mode: ChallengePolicy["maxDrawdownMode"];
}): number {
    const { equityCents, peakEquityCents, startingBalanceCents, mode } = params;
    const reference = mode === "trailing" ? Math.max(peakEquityCents, 1) : Math.max(startingBalanceCents, 1);
    const drop = Math.max(0, reference - equityCents);
    return pctOf(reference, drop);
}

/**
 * Daily loss usage as a PERCENT OF THE ALLOWANCE (100 = limit reached,
 * 80 = warning threshold territory). Not percent-of-base.
 */
export function dailyLossUsedPct(params: {
    policy: ChallengePolicy;
    account: VirtualAccount;
    equityCents: number;
    startingBalanceCents: number;
}): number {
    const { policy, account, equityCents, startingBalanceCents } = params;
    const base = policy.dailyLossBase === "starting_balance" ? startingBalanceCents : Math.max(account.dayStartEquityCents, 1);
    const dayPnl = equityCents - Math.max(account.dayStartEquityCents, 0);
    if (dayPnl >= 0) return 0;
    const limitCents = pctOfCents(base, policy.dailyLossLimitPct);
    if (limitCents <= 0) return 100; // misconfigured limit ⇒ treat as fully used (fail-closed)
    return (Math.abs(dayPnl) / limitCents) * 100;
}

export interface MetricInputs {
    attempt: ChallengeAttempt;
    account: VirtualAccount;
    policy: ChallengePolicy;
    openTrades: ChallengeTrade[];
    closedTrades: ChallengeTrade[];
    /** Live marks per open trade (priceMicros → unrealized cents). */
    marks: Array<{ tradeId: string; unrealizedPnLCents: number; markPriceMicros: number | null; quoteAt: number | null }>;
    quoteAt: number | null;
    now: number;
    equityCurve?: EquityPoint[];
    maxLeverageRatioUsed?: number;
}

/**
 * Compute the canonical metrics snapshot. `dataQuality` is "fresh" only when
 * every open position has a live mark from a recent quote — the rule engine
 * refuses to raise BREACH events on stale data (fail-closed: pause over
 * corrupting results).
 */
export function computeMetrics(inputs: MetricInputs): ChallengeMetrics {
    const { attempt, account, policy, openTrades, marks, quoteAt, now, equityCurve } = inputs;

    const markByTrade = new Map(marks.map((m) => [m.tradeId, m]));
    const unrealized = openTrades.reduce((sum, trade) => {
        const mark = markByTrade.get(trade.tradeId);
        return sum + (mark?.unrealizedPnLCents ?? 0);
    }, 0);

    const balanceCents = account.balanceCents;
    const equityCents = addCents(balanceCents, unrealized);
    const realized = account.realizedPnLCents;
    const totalPnL = addCents(realized, unrealized);
    const starting = policy.startingBalanceCents;

    const totalReturnPct = pctOf(starting, totalPnL);
    const ddPct = drawdownPct({
        equityCents,
        peakEquityCents: Math.max(account.peakEquityCents, equityCents),
        startingBalanceCents: starting,
        mode: policy.maxDrawdownMode,
    });

    const dayPnl = addCents(equityCents, -account.dayStartEquityCents);
    const lossBase = policy.dailyLossBase === "starting_balance" ? starting : Math.max(account.dayStartEquityCents, 1);
    const dailyLossLimitCents = pctOfCents(lossBase, policy.dailyLossLimitPct);
    // Percent OF THE ALLOWANCE: 100 ⇒ the day's loss limit is fully used.
    const dailyLossUsed =
        dayPnl < 0 && dailyLossLimitCents > 0 ? (Math.abs(dayPnl) / dailyLossLimitCents) * 100 : dayPnl < 0 ? 100 : 0;
    const remainingDailyLoss = Math.max(0, addCents(dailyLossLimitCents, Math.min(0, dayPnl)));

    const targetCents = addCents(starting, pctOfCents(starting, policy.profitTargetPct));
    const targetProgressPct =
        totalPnL <= 0 ? 0 : Math.min(100, pctOf(pctOfCents(starting, policy.profitTargetPct), totalPnL));
    const distanceToTargetPct = Math.max(0, policy.profitTargetPct - totalReturnPct);

    const drawdownUsed = Math.min(100, (ddPct / Math.max(policy.maxDrawdownPct, 0.01)) * 100);

    // ── Exposure: NET per instrument, summed to the account total ────────
    // Long 0.5 + short 0.5 on one instrument is flat, not 1.0 of exposure. The
    // old sum-of-notionals model read hedged books as fully loaded and
    // rejected legitimate entries against the leverage ceiling.
    const markPriceOf = (trade: ChallengeTrade): number =>
        markByTrade.get(trade.tradeId)?.markPriceMicros ?? trade.entryPriceMicros;
    const symbolExposureCents: Record<string, number> = {};
    const symbolNetExposureCents: Record<string, number> = {};
    for (const symbol of Array.from(new Set(openTrades.map((trade) => trade.symbol.toUpperCase())))) {
        const sameSymbol = openTrades.filter((trade) => trade.symbol.toUpperCase() === symbol);
        const longLots = sameSymbol.filter((t) => t.side === "long").reduce((sum, t) => sum + t.sizeCentiLots, 0);
        const shortLots = sameSymbol.filter((t) => t.side === "short").reduce((sum, t) => sum + t.sizeCentiLots, 0);
        if (longLots === 0 && shortLots === 0) continue;
        const netCentiLots = longLots - shortLots;
        const netNotionalCents = netExposureCents({
            priceMicros: markPriceOf(sameSymbol[0]),
            centiLotsBySide: { long: longLots, short: shortLots },
            contractSize: contractSizeFor(sameSymbol[0]),
        });
        symbolExposureCents[symbol] = netNotionalCents;
        symbolNetExposureCents[symbol] = Math.sign(netCentiLots) * netNotionalCents;
    }
    const exposure = Object.values(symbolExposureCents).reduce((sum, value) => sum + value, 0);

    // ── Open risk: the sizing budget ─────────────────────────────────────
    const openRiskCents = sumOpenRiskCents(openTrades);
    const maxAggregateRiskPct = effectiveAggregateRiskPct(policy);
    const openRiskUsedPct = equityCents > 0 ? (openRiskCents / equityCents) * 100 : 0;
    const remainingRiskBudgetCents = Math.max(
        0,
        pctOfCents(equityCents, maxAggregateRiskPct) - openRiskCents
    );

    const staleMarks = openTrades.some((t) => {
        const mark = markByTrade.get(t.tradeId);
        return !mark || mark.markPriceMicros === null || mark.quoteAt === null;
    });
    const quoteFresh = quoteAt !== null && now - quoteAt < 60_000;
    const dataQuality: "fresh" | "stale" =
        openTrades.length === 0 ? (quoteFresh ? "fresh" : "stale") : !staleMarks && quoteFresh ? "fresh" : "stale";

    return {
        attemptId: attempt.id,
        asOf: now,
        dataQuality,
        startingBalanceCents: starting,
        balanceCents,
        equityCents,
        unrealizedPnLCents: unrealized,
        realizedPnLCents: realized,
        totalPnLCents: totalPnL,
        totalReturnPct,
        peakEquityCents: Math.max(account.peakEquityCents, equityCents),
        currentDrawdownPct: ddPct,
        drawdownUsedPct: drawdownUsed,
        drawdownAllowanceCents: Math.max(0, addCents(starting, -equityCents)),
        dailyPnLCcents: dayPnl,
        dailyLossUsedPct: dailyLossUsed,
        dailyLossLimitCents,
        remainingDailyLossCents: remainingDailyLoss,
        targetCents,
        targetProgressPct,
        distanceToTargetPct,
        tradingDays: tradingDayCount(attempt),
        minTradingDays: policy.minTradingDays,
        maxTradingDays: policy.maxTradingDays,
        dailyTrades: attempt.dailyTradeCounts?.[dayKeyOf(now)] ?? 0,
        maxDailyTrades: policy.maxDailyTrades,
        openPositions: openTrades.length,
        openExposureCents: exposure,
        openRiskCents,
        openRiskUsedPct,
        maxAggregateRiskPct,
        remainingRiskBudgetCents,
        symbolExposureCents,
        symbolNetExposureCents,
        maxLeverageRatio: policy.leveragePolicy.maxLeverageRatio,
        leverageUsedPct:
            equityCents > 0 ? Math.round((exposure / equityCents) * policy.leveragePolicy.maxLeverageRatio * 100) / 100 : 0,
        maxPositionNotionalMultiple: effectiveNotionalMultiple(policy),
        timeRemainingMs: Math.max(0, attempt.expiresAt - now),
        expired: now >= attempt.expiresAt,
        equityCurve: equityCurve ?? [],
        updatedAt: now,
    };
}

// Trades carry the market they belong to; contract size is resolved by the
// execution layer and cached here via a module-level registry set by
// ./execution.ts (pure fallback keeps metrics dependency-free).
let contractSizeResolver: ((symbol: string) => number) | null = null;

export function registerContractSizeResolver(resolver: (symbol: string) => number): void {
    contractSizeResolver = resolver;
}

function contractSizeFor(trade: { symbol: string }): number {
    return contractSizeResolver?.(trade.symbol) ?? arenaSymbolSpec(trade.symbol)?.contractSize ?? 100_000;
}

// ──────────── Consistency ────────────────────────────────────────────────────

export interface ConsistencyResult {
    required: boolean;
    passed: boolean;
    /** Best day's share of total profit (%), 0 when no profit. */
    bestDaySharePct: number;
    bestDayKey: string | null;
    evaluated: boolean;
    reason: string;
}

/**
 * Consistency: when total profit exists and enough trades were taken, a
 * single dominant day above the configured share fails the (optional)
 * consistency requirement. Without the required trade count it is simply
 * not evaluated.
 */
export function evaluateConsistency(params: {
    policy: ChallengePolicy;
    dailyPnl: Array<{ dayKey: string; pnlCents: number }>;
    tradeCount: number;
}): ConsistencyResult {
    const { policy, dailyPnl, tradeCount } = params;
    const profitDays = dailyPnl.filter((d) => d.pnlCents > 0);
    const totalProfit = profitDays.reduce((sum, d) => sum + d.pnlCents, 0);

    if (tradeCount < policy.consistency.minTradesForConsistency) {
        return {
            required: policy.consistency.required,
            passed: true,
            bestDaySharePct: 0,
            bestDayKey: null,
            evaluated: false,
            reason: `Consistency not evaluated below ${policy.consistency.minTradesForConsistency} trades.`,
        };
    }
    if (totalProfit <= 0) {
        return {
            required: policy.consistency.required,
            passed: !policy.consistency.required,
            bestDaySharePct: 0,
            bestDayKey: null,
            evaluated: false,
            reason: "No profitable days to evaluate.",
        };
    }

    const best = profitDays.reduce((a, b) => (b.pnlCents > a.pnlCents ? b : a), profitDays[0]);
    const sharePct = pctOf(totalProfit, best.pnlCents);
    const passed = sharePct <= policy.consistency.maxSingleDayPnlSharePct;
    return {
        required: policy.consistency.required,
        passed,
        bestDaySharePct: sharePct,
        bestDayKey: best.dayKey,
        evaluated: true,
        reason: passed
            ? `Best day contributes ${sharePct.toFixed(1)}% of profit (limit ${policy.consistency.maxSingleDayPnlSharePct}%).`
            : `Best day contributes ${sharePct.toFixed(1)}% of profit — above the ${policy.consistency.maxSingleDayPnlSharePct}% consistency limit.`,
    };
}

/** Daily PnL series from closed trades + final equity mark (deterministic). */
export function dailyPnlSeries(params: {
    attempt: ChallengeAttempt;
    closedTrades: ChallengeTrade[];
    finalEquityCents: number;
}): Array<{ dayKey: string; pnlCents: number }> {
    const { attempt, closedTrades } = params;
    void params.finalEquityCents; // reserved for future non-trade equity attribution
    const byDay = new Map<string, number>();
    for (const trade of closedTrades) {
        const day = trade.closedAt !== null ? dayKeyOf(trade.closedAt) : dayKeyOf(trade.entryAt);
        const net = trade.realizedPnLCents ?? 0;
        const grossBeforeCosts = net + trade.costs.spreadCostCents + trade.costs.slippageCostCents + trade.costs.commissionCents;
        // Attribute net PnL (with its own costs) to the day; costs are part
        // of that day's result so the series reconciles with total PnL.
        byDay.set(day, (byDay.get(day) ?? 0) + net + 0 * grossBeforeCosts);
    }
    // Apply non-trade equity movement (fees already netted; marks at settle)
    // to the final day so the series sums to the realized total.
    const days = Array.from(new Set([...Object.keys(attempt.tradingDayKeys ?? {}), ...byDay.keys()])).sort();
    if (days.length === 0) return [];
    const summed = Array.from(byDay.entries()).map(([dayKey, pnlCents]) => ({ dayKey, pnlCents }));
    return summed.sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0)).map((d) => ({ ...d, pnlCents: d.pnlCents })) ?? [];
}

/** Worst single-day loss percent across the series (for the report). */
export function worstDailyLossPct(dailyPnl: Array<{ dayKey: string; pnlCents: number }>, baseCents: number): number {
    let worst = 0;
    for (const day of dailyPnl) {
        if (day.pnlCents >= 0) continue;
        worst = Math.max(worst, pctOf(Math.max(baseCents, 1), Math.abs(day.pnlCents)));
    }
    return worst;
}
