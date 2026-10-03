// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena × Strategy Research — challenge-rule compatibility.
//
// Answers one question: "would this strategy's historical behaviour fit this
// challenge's rules?" — deterministically, from backtest metrics the platform
// already produces. It NEVER claims the backtest predicts challenge or live
// results; that limitation is part of the verdict copy.
// ─────────────────────────────────────────────────────────────────────────────

import { roundHalfAwayFromZero } from "./money";
import type { ChallengePolicy } from "./types";

export interface StrategyMetricsInput {
    strategyName: string;
    backtestReturnPct: number;
    maxDrawdownPct: number;
    worstDayLossPct: number;
    tradeCount: number;
    avgTradesPerDay: number;
    /** Best single day as % of total profit (0 when unavailable). */
    bestDaySharePct?: number;
    profitableDayRatio?: number;
    markets?: string[];
}

export type CompatVerdict = "compatible" | "cautions" | "incompatible" | "insufficient_data";

export interface CompatFinding {
    key: string;
    label: string;
    verdict: "pass" | "warn" | "fail";
    detail: string;
}

export interface StrategyCompatibility {
    verdict: CompatVerdict;
    findings: CompatFinding[];
    /** Max theoretical attempt risk implied by the challenge rules. */
    challengeRulesSummary: string;
    disclaimer: string;
}

export function assessStrategyCompatibility(params: {
    strategy: StrategyMetricsInput;
    policy: ChallengePolicy;
}): StrategyCompatibility {
    const { strategy, policy } = params;
    const findings: CompatFinding[] = [];

    if (strategy.tradeCount < 5) {
        return {
            verdict: "insufficient_data",
            findings: [
                {
                    key: "sample",
                    label: "Sample size",
                    verdict: "warn",
                    detail: `Only ${strategy.tradeCount} trade(s) in the backtest — too few to judge challenge compatibility.`,
                },
            ],
            challengeRulesSummary: summaryOf(policy),
            disclaimer:
                "Backtest results do not guarantee challenge or live results. Simulated performance can differ from future market conditions.",
        };
    }

    // 1. Drawdown envelope
    const ddRatio = policy.maxDrawdownPct > 0 ? strategy.maxDrawdownPct / policy.maxDrawdownPct : Infinity;
    if (ddRatio > 1) {
        findings.push({
            key: "drawdown",
            label: "Max drawdown vs challenge limit",
            verdict: "fail",
            detail: `Historical max drawdown ${strategy.maxDrawdownPct.toFixed(2)}% exceeds the challenge limit ${policy.maxDrawdownPct}%. Under identical behaviour the attempt would breach.`,
        });
    } else if (ddRatio > 0.7) {
        findings.push({
            key: "drawdown",
            label: "Max drawdown vs challenge limit",
            verdict: "warn",
            detail: `Historical max drawdown uses ${(ddRatio * 100).toFixed(0)}% of the ${policy.maxDrawdownPct}% allowance — little headroom for live variance.`,
        });
    } else {
        findings.push({
            key: "drawdown",
            label: "Max drawdown vs challenge limit",
            verdict: "pass",
            detail: `Historical max drawdown ${strategy.maxDrawdownPct.toFixed(2)}% fits inside the ${policy.maxDrawdownPct}% limit.`,
        });
    }

    // 2. Daily loss limit vs worst historical day
    const dayRatio = policy.dailyLossLimitPct > 0 ? Math.abs(strategy.worstDayLossPct) / policy.dailyLossLimitPct : Infinity;
    if (dayRatio > 1) {
        findings.push({
            key: "daily",
            label: "Worst day vs daily loss limit",
            verdict: "fail",
            detail: `Worst historical day (${strategy.worstDayLossPct.toFixed(2)}%) exceeds the ${policy.dailyLossLimitPct}% daily loss limit.`,
        });
    } else if (dayRatio > 0.7) {
        findings.push({
            key: "daily",
            label: "Worst day vs daily loss limit",
            verdict: "warn",
            detail: `Worst historical day uses ${(dayRatio * 100).toFixed(0)}% of the daily loss allowance.`,
        });
    } else {
        findings.push({
            key: "daily",
            label: "Worst day vs daily loss limit",
            verdict: "pass",
            detail: `Worst historical day fits inside the ${policy.dailyLossLimitPct}% daily loss limit.`,
        });
    }

    // 3. Daily trade capacity
    if (strategy.avgTradesPerDay > policy.maxDailyTrades) {
        findings.push({
            key: "frequency",
            label: "Trade frequency vs daily cap",
            verdict: "fail",
            detail: `Strategy averages ${strategy.avgTradesPerDay.toFixed(1)} trades/day — above the ${policy.maxDailyTrades} daily cap.`,
        });
    } else if (strategy.avgTradesPerDay > policy.maxDailyTrades * 0.8) {
        findings.push({
            key: "frequency",
            label: "Trade frequency vs daily cap",
            verdict: "warn",
            detail: `Trade frequency is close to the ${policy.maxDailyTrades}/day cap.`,
        });
    } else {
        findings.push({
            key: "frequency",
            label: "Trade frequency vs daily cap",
            verdict: "pass",
            detail: `Average ${strategy.avgTradesPerDay.toFixed(1)} trades/day fits the ${policy.maxDailyTrades} daily cap.`,
        });
    }

    // 4. Consistency (when configured and data available)
    if (policy.consistency.required && strategy.bestDaySharePct !== undefined && strategy.bestDaySharePct > 0) {
        if (strategy.bestDaySharePct > policy.consistency.maxSingleDayPnlSharePct) {
            findings.push({
                key: "consistency",
                label: "Consistency rule",
                verdict: "fail",
                detail: `Best day contributes ${strategy.bestDaySharePct.toFixed(0)}% of profit — above the ${policy.consistency.maxSingleDayPnlSharePct}% consistency limit.`,
            });
        } else {
            findings.push({
                key: "consistency",
                label: "Consistency rule",
                verdict: "pass",
                detail: `Best day share ${strategy.bestDaySharePct.toFixed(0)}% fits the ${policy.consistency.maxSingleDayPnlSharePct}% limit.`,
            });
        }
    }

    // 5. Minimum trading days feasibility
    if (strategy.avgTradesPerDay > 0) {
        findings.push({
            key: "min-days",
            label: "Minimum trading days",
            verdict: "pass",
            detail: `A strategy trading most days can reach the ${policy.minTradingDays}-day minimum within ${policy.maxCalendarDays} calendar days.`,
        });
    }

    const failed = findings.some((f) => f.verdict === "fail");
    const warned = findings.some((f) => f.verdict === "warn");

    return {
        verdict: failed ? "incompatible" : warned ? "cautions" : "compatible",
        findings,
        challengeRulesSummary: summaryOf(policy),
        disclaimer:
            "Backtest results do not guarantee challenge or live results. This check compares historical behaviour with challenge rules — it is informational, not a forecast.",
    };
}

function summaryOf(policy: ChallengePolicy): string {
    return [
        `Target +${policy.profitTargetPct}%`,
        `Max DD ${policy.maxDrawdownPct}%`,
        `Daily loss ${policy.dailyLossLimitPct}%`,
        `Min days ${policy.minTradingDays}`,
        `${policy.maxDailyTrades} trades/day`,
        `${policy.maxConcurrentPositions} max positions`,
        `Risk/trade ≤ ${policy.maxRiskPerTradePct}%`,
    ].join(" · ");
}

export function roundPct(value: number): number {
    return roundHalfAwayFromZero(value * 100) / 100;
}
