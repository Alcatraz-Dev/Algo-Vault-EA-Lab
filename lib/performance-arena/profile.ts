// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — trader performance profile (pure aggregation).
//
// The AlgoVault Trader Profile is a verified SIMULATED performance history:
// what was attempted, completed, passed, failed — plus consistency, markets
// and badges. It is not an investment recommendation, not a track record of
// real trading, and carries an explicit disclaimer wherever it renders.
// ─────────────────────────────────────────────────────────────────────────────

import { roundHalfAwayFromZero } from "./money";
import { ARENA_DISCLAIMERS, type AttemptSummary, type ChallengeAttempt, type ChallengeResult, type LeaderboardVisibility, type MarketCategory, type TraderPerformanceProfile, type ChallengeTier } from "./types";

export interface ProfileHistoryItem {
    attempt: ChallengeAttempt;
    result: ChallengeResult | null;
    markets: MarketCategory[];
}

const TRADING_STYLE_BY_MARKET: Record<MarketCategory, string> = {
    forex: "FX",
    metals: "Metals",
    indices: "Index CFDs",
    crypto: "Crypto",
    equities: "Equities",
};

export function buildTraderProfile(params: {
    userId: string;
    history: ProfileHistoryItem[];
    avPoints: number;
    badges: string[];
    visibility: LeaderboardVisibility;
    now: number;
}): TraderPerformanceProfile {
    const { userId, history, avPoints, badges, visibility, now } = params;

    const summaries: AttemptSummary[] = history.map(({ attempt, result }) => ({
        attemptId: attempt.id,
        definitionKey: attempt.definitionKey,
        tier: attempt.policy ? tierFromStartingBalance(attempt.policy.startingBalanceCents) : "custom",
        status: attempt.status,
        totalReturnPct: result?.totalReturnPct ?? 0,
        maxDrawdownPct: result?.maxDrawdownPct ?? 0,
        tradingDays: result?.tradingDays ?? Object.keys(attempt.tradingDayKeys ?? {}).length,
        tradeCount: result?.tradeCount ?? 0,
        startedAt: attempt.startedAt,
        endedAt: attempt.settledAt,
    }));

    // Order newest first for display; aggregates use all completed runs.
    summaries.sort((a, b) => b.startedAt - a.startedAt);
    const completed = summaries.filter((s) => s.status === "PASSED" || s.status === "FAILED" || s.status === "EXPIRED");
    const returns = completed.map((s) => s.totalReturnPct);
    const drawdowns = completed.map((s) => s.maxDrawdownPct);

    const marketSet = new Set<MarketCategory>();
    for (const item of history) for (const m of item.markets) marketSet.add(m);

    const best = returns.length > 0 ? Math.max(...returns) : 0;
    const avgReturn = returns.length > 0 ? roundHalfAwayFromZero((returns.reduce((a, b) => a + b, 0) / returns.length) * 100) / 100 : 0;
    const avgDrawdown = drawdowns.length > 0 ? roundHalfAwayFromZero((drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length) * 100) / 100 : 0;

    // Consistency score: share of completed runs that respected their
    // drawdown envelope (100 = every run stayed within limits).
    const cleanRuns = completed.filter((s) => {
        const item = history.find((h) => h.attempt.id === s.attemptId);
        const limit = item?.attempt.policy.maxDrawdownPct ?? 100;
        return s.maxDrawdownPct <= limit && s.status === "PASSED";
    });
    const consistencyScore = completed.length > 0 ? roundHalfAwayFromZero((cleanRuns.length / completed.length) * 100) : 0;

    const markets = Array.from(marketSet).sort();
    const tradingStyles = markets.map((m) => TRADING_STYLE_BY_MARKET[m]);

    const failed = summaries.filter((s) => s.status === "FAILED").length;
    const expired = summaries.filter((s) => s.status === "EXPIRED").length;
    const cancelled = summaries.filter((s) => s.status === "CANCELLED").length;
    const passed = summaries.filter((s) => s.status === "PASSED").length;

    return {
        userId,
        displayLabel: `Trader ${userId.slice(-6)}`,
        visibility,
        attempted: summaries.length,
        completed: completed.length,
        passed,
        failed: failed + expired,
        expired,
        cancelled,
        bestReturnPct: best,
        avgReturnPct: avgReturn,
        avgDrawdownPct: avgDrawdown,
        consistencyScore,
        profitableDayRatio: 0,
        totalTrades: summaries.reduce((sum, s) => sum + s.tradeCount, 0),
        markets,
        tradingStyles,
        badges: Array.from(new Set(badges)),
        avPoints,
        history: summaries,
        updatedAt: now,
        disclaimer: `${ARENA_DISCLAIMERS.simulated} ${ARENA_DISCLAIMERS.noGuarantees} ${ARENA_DISCLAIMERS.challengeScope}`,
    };
}

function tierFromStartingBalance(startingBalanceCents: number): ChallengeTier {
    const dollars = startingBalanceCents / 100;
    if (dollars <= 10_000) return "starter";
    if (dollars <= 25_000) return "standard";
    if (dollars <= 100_000) return "pro";
    if (dollars <= 200_000) return "elite";
    return "custom";
}
