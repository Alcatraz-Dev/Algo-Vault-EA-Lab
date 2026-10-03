// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — Challenge Guardian (risk awareness, NOT a signal bot).
//
// The Guardian explains the user's challenge risk in plain language: loss
// budget usage, drawdown proximity, exposure, streaks, time and distance to
// target. Deterministic insights come from metrics (always available); an
// OPTIONAL AI pass uses the canonical AI Router with a strictly structured
// prompt that separates FACTS / INTERPRETATIONS / RISK WARNINGS / UNCERTAINTY
// / LIMITATIONS. AI output NEVER touches challenge accounting — it is
// commentary only.
//
// Language rules enforced in copy: no "you will win", no "guaranteed profit",
// no "buy now to pass".
// ─────────────────────────────────────────────────────────────────────────────

import type {
    ChallengeMetrics,
    ChallengePolicy,
    ChallengeTrade,
    GuardianInsight,
} from "./types";

export interface GuardianInput {
    attemptId: string;
    policy: ChallengePolicy;
    metrics: ChallengeMetrics;
    openTrades: ChallengeTrade[];
    closedTrades: ChallengeTrade[];
    now: number;
    nextInsightId: () => string;
}

/** Deterministic, always-available Guardian insights. Pure and testable. */
export function buildGuardianInsights(input: GuardianInput): GuardianInsight[] {
    const { policy, metrics, openTrades, closedTrades, now, nextInsightId } = input;
    const insights: GuardianInsight[] = [];
    const push = (insight: Omit<GuardianInsight, "id" | "createdAt">) =>
        insights.push({ id: nextInsightId(), createdAt: now, ...insight });

    const warnAt = policy.warningUtilizationPct;

    // ── Daily loss budget ───────────────────────────────────────────────────
    if (metrics.dailyLossUsedPct >= 100) {
        push({
            kind: "RISK_WARNING",
            severity: "critical",
            message: `Today's permitted loss is fully used (${metrics.dailyLossUsedPct.toFixed(0)}%). Further losses breach the daily rule.`,
            utilizationPct: metrics.dailyLossUsedPct,
        });
    } else if (metrics.dailyLossUsedPct >= warnAt) {
        push({
            kind: "RISK_WARNING",
            severity: "warning",
            message: `You have used ${metrics.dailyLossUsedPct.toFixed(0)}% of today's permitted loss.`,
            utilizationPct: metrics.dailyLossUsedPct,
        });
    } else if (metrics.dailyLossUsedPct > 0) {
        push({
            kind: "FACT",
            severity: "info",
            message: `Today's loss usage: ${metrics.dailyLossUsedPct.toFixed(0)}% of the ${policy.dailyLossLimitPct}% daily limit. Remaining allowance: $${(metrics.remainingDailyLossCents / 100).toFixed(2)} virtual.`,
            utilizationPct: metrics.dailyLossUsedPct,
        });
    }

    // ── Drawdown ────────────────────────────────────────────────────────────
    if (metrics.drawdownUsedPct >= 100) {
        push({
            kind: "RISK_WARNING",
            severity: "critical",
            message: `Maximum drawdown reached (${metrics.currentDrawdownPct.toFixed(2)}% of ${policy.maxDrawdownPct}%). The challenge rule is breached.`,
            utilizationPct: metrics.drawdownUsedPct,
        });
    } else if (metrics.drawdownUsedPct >= warnAt) {
        push({
            kind: "RISK_WARNING",
            severity: "warning",
            message: `Drawdown has used ${metrics.drawdownUsedPct.toFixed(0)}% of the maximum allowance.`,
            utilizationPct: metrics.drawdownUsedPct,
        });
    }

    // ── Distance to target ──────────────────────────────────────────────────
    if (metrics.totalReturnPct > 0 && metrics.distanceToTargetPct > 0 && metrics.distanceToTargetPct <= 3) {
        push({
            kind: "FACT",
            severity: "info",
            message: `You are ${metrics.distanceToTargetPct.toFixed(1)}% away from the challenge target. Distance is not a forecast — targets can be given back as easily as they were earned.`,
            utilizationPct: metrics.targetProgressPct,
        });
    } else if (metrics.targetProgressPct > 0) {
        push({
            kind: "FACT",
            severity: "info",
            message: `Target progress: ${metrics.targetProgressPct.toFixed(0)}% of the ${policy.profitTargetPct}% objective.`,
            utilizationPct: metrics.targetProgressPct,
        });
    }

    // ── Exposure / risk per trade ───────────────────────────────────────────
    if (openTrades.length > 0) {
        push({
            kind: "FACT",
            severity: "info",
            message: `${openTrades.length} open position(s) with $${(metrics.openExposureCents / 100).toFixed(2)} notional exposure (${(metrics.openExposureCents / Math.max(metrics.equityCents, 1) * 100).toFixed(1)}% of equity).`,
            utilizationPct: null,
        });
        const withoutStop = openTrades.filter((t) => t.stopLossMicros === null);
        if (withoutStop.length > 0) {
            push({
                kind: "RISK_WARNING",
                severity: "warning",
                message: `${withoutStop.length} open position(s) have no stop-loss — their risk cannot be measured against the challenge limits.`,
                utilizationPct: null,
            });
        }
        const riskiest = openTrades.reduce<ChallengeTrade | null>((worst, trade) => {
            if (trade.riskCents === null) return worst;
            if (!worst || worst.riskCents === null || trade.riskCents > worst.riskCents) return trade;
            return worst;
        }, null);
        if (riskiest?.riskCents != null) {
            const riskPct = (riskiest.riskCents / Math.max(metrics.equityCents, 1)) * 100;
            if (riskPct >= policy.maxRiskPerTradePct * 0.8) {
                push({
                    kind: "RISK_WARNING",
                    severity: "warning",
                    message: `Your largest position risks ${riskPct.toFixed(2)}% of equity — near the ${policy.maxRiskPerTradePct}% per-trade limit.`,
                    utilizationPct: riskPct,
                });
            }
        }
    }

    // ── Consecutive losses ──────────────────────────────────────────────────
    const sortedClosed = [...closedTrades]
        .filter((t) => t.closedAt !== null)
        .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
    let streak = 0;
    for (let i = sortedClosed.length - 1; i >= 0; i--) {
        const pnl = sortedClosed[i].realizedPnLCents ?? 0;
        if (pnl < 0) streak++;
        else break;
    }
    if (streak >= 3) {
        push({
            kind: "GUIDANCE",
            severity: streak >= 5 ? "warning" : "info",
            message: `${streak} consecutive losing trades. Consistency rules reward risk discipline, not recovery sizing — consider reducing size or stepping back for the session.`,
            utilizationPct: null,
        });
    }

    // ── Time / trading days ─────────────────────────────────────────────────
    if (metrics.timeRemainingMs < 48 * 60 * 60 * 1000 && metrics.timeRemainingMs > 0) {
        push({
            kind: "FACT",
            severity: "warning",
            message: `Less than 48h remain before expiry (${Math.round(metrics.timeRemainingMs / 3_600_000)}h).`,
            utilizationPct: null,
        });
    }
    if (metrics.tradingDays < policy.minTradingDays) {
        const remainingDays = policy.minTradingDays - metrics.tradingDays;
        push({
            kind: "FACT",
            severity: "info",
            message: `${remainingDays} more trading day(s) needed to reach the ${policy.minTradingDays}-day minimum.`,
            utilizationPct: metrics.tradingDays / Math.max(policy.minTradingDays, 1) * 100,
        });
    }

    // ── Stale data advisory ─────────────────────────────────────────────────
    if (metrics.dataQuality === "stale") {
        push({
            kind: "RISK_WARNING",
            severity: "warning",
            message: "Market data is stale — breach evaluation is paused so no rule is decided on outdated prices.",
            utilizationPct: null,
        });
    }

    return insights;
}

// ──────────── Optional AI pass (canonical AI Router, structured output) ──────

/**
 * Build the server-side prompt for the Guardian AI pass. The five buckets
 * are mandatory in the response contract; the system prompt forbids
 * guarantees and profit promises.
 */
export function buildGuardianPrompt(input: {
    policy: ChallengePolicy;
    metrics: ChallengeMetrics;
    insights: GuardianInsight[];
    symbols: string[];
}): { system: string; user: string } {
    const { policy, metrics, insights, symbols } = input;

    const system = [
        "You are the AlgoVault Challenge Guardian — a risk-awareness assistant inside a SIMULATED trading challenge.",
        "Your job is to help the user understand their challenge risk. You are NOT a trading signal generator and you must never predict outcomes.",
        "",
        "Hard rules:",
        "- Never say or imply: 'you will win', 'guaranteed profit', 'guaranteed to pass', 'buy/enter now to pass'.",
        "- Never give specific entry signals or price targets.",
        "- Never claim AI accuracy or that analysis is investment advice.",
        "- Everything refers to VIRTUAL capital in a SIMULATED environment.",
        "",
        "Respond with exactly five sections, each as a bullet list, using these headers:",
        "FACTS",
        "INTERPRETATIONS",
        "RISK WARNINGS",
        "UNCERTAINTY",
        "LIMITATIONS",
        "FACTS must only contain numbers present in the provided data. INTERPRETATIONS must be framed as interpretation. RISK WARNINGS must reference concrete challenge limits. UNCERTAINTY must state what is unknown. LIMITATIONS must state that simulated results don't guarantee real outcomes and AI analysis may be wrong.",
    ].join("\n");

    const user = [
        "Challenge configuration:",
        JSON.stringify({
            startingBalanceCents: policy.startingBalanceCents,
            profitTargetPct: policy.profitTargetPct,
            maxDrawdownPct: policy.maxDrawdownPct,
            dailyLossLimitPct: policy.dailyLossLimitPct,
            minTradingDays: policy.minTradingDays,
            maxCalendarDays: policy.maxCalendarDays,
            maxConcurrentPositions: policy.maxConcurrentPositions,
            maxRiskPerTradePct: policy.maxRiskPerTradePct,
        }),
        "",
        "Current metrics:",
        JSON.stringify({
            equityCents: metrics.equityCents,
            totalReturnPct: metrics.totalReturnPct,
            currentDrawdownPct: metrics.currentDrawdownPct,
            drawdownUsedPct: metrics.drawdownUsedPct,
            dailyLossUsedPct: metrics.dailyLossUsedPct,
            targetProgressPct: metrics.targetProgressPct,
            distanceToTargetPct: metrics.distanceToTargetPct,
            tradingDays: metrics.tradingDays,
            openPositions: metrics.openPositions,
            openExposureCents: metrics.openExposureCents,
            timeRemainingMs: metrics.timeRemainingMs,
            dataQuality: metrics.dataQuality,
        }),
        "",
        "Deterministic Guardian observations:",
        insights.map((i) => `- [${i.kind}] ${i.message}`).join("\n") || "- (none)",
        "",
        `Symbols in play: ${symbols.join(", ") || "none"}`,
    ].join("\n");

    return { system, user };
}

/**
 * Parse the structured five-section response. Tolerant to formatting noise;
 * missing sections are returned empty (never invented).
 */
export interface GuardianSections {
    facts: string[];
    interpretations: string[];
    riskWarnings: string[];
    uncertainty: string[];
    limitations: string[];
}

export function parseGuardianAIResponse(
    raw: string,
    meta?: { provider: string; model: string; generatedAt: number; creditsCharged: number }
): GuardianSections {
    void meta;
    const sections: GuardianSections = {
        facts: [],
        interpretations: [],
        riskWarnings: [],
        uncertainty: [],
        limitations: [],
    };
    const headerMap: Record<string, keyof GuardianSections> = {
        facts: "facts",
        interpretations: "interpretations",
        "risk warnings": "riskWarnings",
        uncertainty: "uncertainty",
        limitations: "limitations",
    };

    let current: keyof GuardianSections | null = null;
    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const header = trimmed.replace(/^#+\s*/, "").replace(/[:*]\s*$/, "").toLowerCase();
        if (header in headerMap) {
            current = headerMap[header];
            continue;
        }
        const bullet = trimmed.replace(/^[-*•]\s*/, "");
        if (current && bullet) sections[current].push(bullet);
    }
    return sections;
}
