// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — settlement engine (pure, deterministic).
//
// Decides HOW an active attempt ends and builds the ChallengeResult that
// drives rewards and the performance report. Settlement is fail-closed: when
// required data is inconsistent the caller receives a BLOCKED outcome instead
// of a wrong verdict (service layer pauses the attempt and raises an admin
// signal rather than guessing).
// ─────────────────────────────────────────────────────────────────────────────

import { pctOf, roundHalfAwayFromZero } from "./money";
import { dayKeyOf, evaluateConsistency, worstDailyLossPct } from "./metrics";
import type {
    ChallengeAttempt,
    ChallengeMetrics,
    ChallengePolicy,
    ChallengeResult,
    ChallengeTrade,
    SettledStatus,
} from "./types";

export type SettlementVerdict =
    | { action: "none"; }
    | { action: "settle"; status: SettledStatus; reasonCode: string; reason: string }
    | { action: "blocked"; reasonCode: string; reason: string };

export interface SettlementInput {
    attempt: ChallengeAttempt;
    policy: ChallengePolicy;
    metrics: ChallengeMetrics;
    closedTrades: ChallengeTrade[];
    openPositionCount: number;
    now: number;
    /** Breach events observed on this evaluation pass (fresh data only). */
    breachTypes: string[];
    dailyPnl: Array<{ dayKey: string; pnlCents: number }>;
}

/**
 * Evaluate settlement for an ACTIVE/PAUSED attempt.
 *
 * Priority order (deterministic):
 *   1. wall-clock expiry            → EXPIRED
 *   2. max drawdown breach          → FAILED
 *   3. daily loss breach            → FAILED (or PAUSED per policy)
 *   4. target + min days + flat     → PASSED (when autoSettleOnTarget)
 */
export function evaluateSettlement(input: SettlementInput): SettlementVerdict {
    const { attempt, policy, metrics, openPositionCount, now, breachTypes, dailyPnl } = input;

    if (attempt.status !== "ACTIVE" && attempt.status !== "PAUSED") {
        return { action: "none" };
    }

    // Fail-closed: never settle a verdict on stale data.
    if (metrics.dataQuality === "stale" && breachTypes.length > 0) {
        return {
            action: "blocked",
            reasonCode: "STALE_MARKET_DATA",
            reason: "Settlement withheld while market data is stale. The attempt is paused instead of guessing.",
        };
    }

    if (now >= attempt.expiresAt) {
        return {
            action: "settle",
            status: "EXPIRED",
            reasonCode: "CALENDAR_EXPIRY",
            reason: `Challenge duration of ${policy.maxCalendarDays} calendar days elapsed before the profit target was completed.`,
        };
    }

    if (breachTypes.includes("DRAWDOWN_BREACH")) {
        return {
            action: "settle",
            status: "FAILED",
            reasonCode: "MAX_DRAWDOWN_BREACH",
            reason: `Maximum drawdown of ${policy.maxDrawdownPct}% was reached (mode: ${policy.maxDrawdownMode}).`,
        };
    }

    if (breachTypes.includes("DAILY_LOSS_BREACH")) {
        if (policy.dailyLossBreachAction === "pause") {
            return {
                action: "blocked",
                reasonCode: "DAILY_LOSS_PAUSE",
                reason: "Daily loss limit reached — the attempt is paused for the rest of the trading day by policy.",
            };
        }
        return {
            action: "settle",
            status: "FAILED",
            reasonCode: "DAILY_LOSS_BREACH",
            reason: `Daily loss limit of ${policy.dailyLossLimitPct}% was reached.`,
        };
    }

    const targetReached = metrics.totalReturnPct >= policy.profitTargetPct;
    const daysMet = metrics.tradingDays >= policy.minTradingDays;
    const flat = openPositionCount === 0;

    if (policy.autoSettleOnTarget && targetReached && daysMet && flat) {
        const consistency = evaluateConsistency({
            policy,
            dailyPnl,
            tradeCount: input.closedTrades.length,
        });
        if (policy.consistency.required && consistency.evaluated && !consistency.passed) {
            return {
                action: "settle",
                status: "FAILED",
                reasonCode: "CONSISTENCY_FAILED",
                reason: consistency.reason,
            };
        }
        return {
            action: "settle",
            status: "PASSED",
            reasonCode: "PROFIT_TARGET_REACHED",
            reason: `Profit target of ${policy.profitTargetPct}% reached with ${metrics.tradingDays} trading day(s) (minimum ${policy.minTradingDays}) and all positions closed.`,
        };
    }

    return { action: "none" };
}

/** Why an attempt canNOT pass right now — powers the dashboard's checklist. */
export interface PassRequirement {
    key: string;
    label: string;
    met: boolean;
    detail: string;
}

export function passRequirements(input: {
    policy: ChallengePolicy;
    metrics: ChallengeMetrics;
    openPositionCount: number;
}): PassRequirement[] {
    const { policy, metrics, openPositionCount } = input;
    const targetMet = metrics.totalReturnPct >= policy.profitTargetPct;
    const daysMet = metrics.tradingDays >= policy.minTradingDays;
    const drawdownOk = metrics.currentDrawdownPct < policy.maxDrawdownPct;
    const dailyOk = metrics.dailyLossUsedPct < 100;

    return [
        {
            key: "target",
            label: `Profit target ${policy.profitTargetPct}%`,
            met: targetMet,
            detail: targetMet
                ? `Reached (${metrics.totalReturnPct.toFixed(2)}%)`
                : `${metrics.totalReturnPct.toFixed(2)}% of ${policy.profitTargetPct}% — ${metrics.distanceToTargetPct.toFixed(1)}% to go`,
        },
        {
            key: "days",
            label: `Minimum ${policy.minTradingDays} trading days`,
            met: daysMet,
            detail: daysMet ? `${metrics.tradingDays}/${policy.minTradingDays} met` : `${metrics.tradingDays}/${policy.minTradingDays} — ${policy.minTradingDays - metrics.tradingDays} day(s) remaining`,
        },
        {
            key: "drawdown",
            label: `Max drawdown ${policy.maxDrawdownPct}%`,
            met: drawdownOk,
            detail: `${metrics.currentDrawdownPct.toFixed(2)}% used (${metrics.drawdownUsedPct.toFixed(0)}% of allowance)`,
        },
        {
            key: "daily",
            label: `Daily loss ${policy.dailyLossLimitPct}%`,
            met: dailyOk,
            detail: dailyOk ? `${metrics.dailyLossUsedPct.toFixed(0)}% used today` : "Daily limit reached",
        },
        {
            key: "flat",
            label: "All positions closed",
            met: openPositionCount === 0,
            detail: openPositionCount === 0 ? "Flat" : `${openPositionCount} position(s) still open`,
        },
    ];
}

/** Build the immutable result record from a settled attempt. */
export function buildChallengeResult(params: {
    attempt: ChallengeAttempt;
    policy: ChallengePolicy;
    metrics: ChallengeMetrics;
    closedTrades: ChallengeTrade[];
    status: SettledStatus;
    reasonCode: string;
    reason: string;
    dailyPnl: Array<{ dayKey: string; pnlCents: number }>;
    now: number;
    ruleBreachCount: number;
}): ChallengeResult {
    const { attempt, policy, metrics, closedTrades, status, reasonCode, reason, dailyPnl, now, ruleBreachCount } = params;

    const wins = closedTrades.filter((t) => (t.realizedPnLCents ?? 0) > 0);
    const losses = closedTrades.filter((t) => (t.realizedPnLCents ?? 0) < 0);
    const totalNet = closedTrades.reduce((sum, t) => sum + (t.realizedPnLCents ?? 0), 0);
    const fees = closedTrades.reduce(
        (sum, t) => sum + t.costs.spreadCostCents + t.costs.slippageCostCents + t.costs.commissionCents,
        0
    );
    const pnlValues = closedTrades.map((t) => t.realizedPnLCents ?? 0);
    const decided = wins.length + losses.length;
    const consistency = evaluateConsistency({ policy, dailyPnl, tradeCount: closedTrades.length });

    const endingEquityCents =
        status === "PASSED" || status === "FAILED" || status === "EXPIRED" || status === "CANCELLED"
            ? metrics.equityCents
            : metrics.equityCents;

    return {
        attemptId: attempt.id,
        status,
        reasonCode,
        reason,
        startingBalanceCents: policy.startingBalanceCents,
        endingEquityCents,
        totalPnLCents: metrics.totalPnLCents,
        totalReturnPct: pctOf(policy.startingBalanceCents, metrics.totalPnLCents),
        maxDrawdownPct: maxDrawdownOverSeries({
            equityCurve: metrics.equityCurve,
            startingBalanceCents: policy.startingBalanceCents,
            peakEquityCents: metrics.peakEquityCents,
            finalEquityCents: metrics.equityCents,
            mode: policy.maxDrawdownMode,
        }),
        worstDailyLossPct: worstDailyLossPct(dailyPnl, policy.startingBalanceCents),
        tradingDays: Object.keys(attempt.tradingDayKeys ?? {}).length,
        minTradingDays: policy.minTradingDays,
        tradeCount: closedTrades.length,
        winCount: wins.length,
        lossCount: losses.length,
        winRatePct: decided > 0 ? roundHalfAwayFromZero((wins.length / decided) * 10000) / 100 : 0,
        avgTradeCents: closedTrades.length > 0 ? roundHalfAwayFromZero(totalNet / closedTrades.length) : 0,
        bestTradeCents: pnlValues.length > 0 ? Math.max(...pnlValues) : 0,
        worstTradeCents: pnlValues.length > 0 ? Math.min(...pnlValues) : 0,
        totalFeesCents: fees,
        consistencyPassed: consistency.passed,
        ruleBreachCount,
        settledAt: now,
    };
}

/**
 * Worst drawdown (%) observed across the persisted equity curve plus the
 * final mark. Deterministic: same series → same number.
 */
export function maxDrawdownOverSeries(params: {
    equityCurve: Array<{ t: number; equityCents: number }>;
    startingBalanceCents: number;
    peakEquityCents: number;
    finalEquityCents: number;
    mode: "static" | "trailing";
}): number {
    const { equityCurve, startingBalanceCents, peakEquityCents, finalEquityCents, mode } = params;
    const points = [...equityCurve.map((p) => p.equityCents), finalEquityCents];
    let worst = 0;
    let peak = Math.max(startingBalanceCents, peakEquityCents);
    for (const equity of points) {
        peak = Math.max(peak, equity);
        const reference = mode === "trailing" ? Math.max(peak, 1) : Math.max(startingBalanceCents, 1);
        const drop = Math.max(0, reference - equity);
        worst = Math.max(worst, (drop / reference) * 100);
    }
    return Math.round(worst * 100) / 100;
}

/** Deterministic human explanation lines for the performance report. */
export function settlementExplanation(result: ChallengeResult, policy: ChallengePolicy): string[] {
    const lines: string[] = [];
    const fmt = (cents: number) => `$${(cents / 100).toFixed(2)} virtual`;
    lines.push(`Final status: ${result.status} (${result.reasonCode}).`);
    lines.push(result.reason);
    lines.push(
        `Equity moved from ${fmt(result.startingBalanceCents)} to ${fmt(result.endingEquityCents)} (${result.totalReturnPct >= 0 ? "+" : ""}${result.totalReturnPct.toFixed(2)}%, objective was +${policy.profitTargetPct}%).`
    );
    lines.push(`Maximum drawdown observed at settlement: ${result.maxDrawdownPct.toFixed(2)}% (limit ${policy.maxDrawdownPct}%).`);
    lines.push(`${result.tradingDays} trading day(s) (minimum ${policy.minTradingDays}, maximum ${policy.maxTradingDays}).`);
    lines.push(
        `${result.tradeCount} closed trade(s): ${result.winCount} profitable, ${result.lossCount} losing (win rate ${result.winRatePct.toFixed(1)}%, average ${fmt(result.avgTradeCents)}).`
    );
    lines.push(`Trading costs paid: ${fmt(result.totalFeesCents)} (spread, slippage, commission).`);
    if (result.ruleBreachCount > 0) lines.push(`${result.ruleBreachCount} rule breach event(s) recorded during the challenge.`);
    if (!result.consistencyPassed) lines.push(`Consistency requirement was not satisfied at settlement.`);
    lines.push("These outcomes describe simulated performance only and do not predict real-world results.");
    return lines;
}

/** Day key helper re-export for settlement callers. */
export { dayKeyOf };
