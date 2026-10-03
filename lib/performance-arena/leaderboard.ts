// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — leaderboard engine (pure).
//
// Ranking is COMPOSITE: return, drawdown control, consistency, risk
// discipline and completion — never raw profit alone. Snapshots carry an
// explicit disclaimer: past simulated performance does not predict future
// success. Visibility is configurable (PUBLIC / COMMUNITY / PRIVATE) and
// entries expose privacy-conscious labels only — never emails, uids, balances
// or positions.
// ─────────────────────────────────────────────────────────────────────────────

import { defaultLeaderboardPolicy } from "./policies";
import { ARENA_DISCLAIMERS, type AttemptStatus, type ChallengeTier, type LeaderboardEntry, type LeaderboardPolicy, type LeaderboardSnapshot, type LeaderboardVisibility } from "./types";

export interface LeaderboardInput {
    attemptId: string;
    userId: string;
    tier: ChallengeTier;
    status: AttemptStatus;
    visibility: LeaderboardVisibility;
    totalReturnPct: number;
    maxDrawdownPct: number;
    maxDrawdownLimitPct: number;
    tradingDays: number;
    minTradingDays: number;
    tradeCount: number;
    /** 0–100 consistency score (100 = no dominant day). */
    consistencyScore: number;
    profitableDays: number;
    totalTradingDays: number;
    breached: boolean;
}

const clamp = (value: number, min = 0, max = 100): number => Math.min(max, Math.max(min, value));

/** Sub-scores in [0, 100] — each component is bounded so no single axis dominates by scale. */
export function componentScores(input: LeaderboardInput): {
    returnScore: number;
    drawdownScore: number;
    consistencyScore: number;
    riskDisciplineScore: number;
    completionScore: number;
} {
    // Return: 100 at +10% or better, linear below (negative → 0).
    const returnScore = clamp((input.totalReturnPct / 10) * 100);
    // Drawdown control: 100 when no drawdown used, 0 at/over the limit.
    const ddUsed = input.maxDrawdownLimitPct > 0 ? (input.maxDrawdownPct / input.maxDrawdownLimitPct) * 100 : 100;
    const drawdownScore = clamp(100 - ddUsed);
    const consistency = clamp(input.consistencyScore);
    // Risk discipline: breaches score 0; otherwise reward keeping drawdown
    // well inside the allowance (drawdown control is the observable proxy
    // for rule-compliant risk management in the arena dataset).
    const riskDisciplineScore = input.breached ? 0 : clamp(100 - ddUsed * 0.6);
    const completionScore = clamp(
        input.status === "PASSED" ? 100 : input.totalTradingDays > 0 ? (input.minTradingDays > 0 ? (input.tradingDays / input.minTradingDays) * 60 : 60) : 0
    );
    return { returnScore, drawdownScore, consistencyScore: consistency, riskDisciplineScore, completionScore };
}

export function scoreEntry(input: LeaderboardInput, policy: LeaderboardPolicy = defaultLeaderboardPolicy()): number {
    const s = componentScores(input);
    const raw =
        s.returnScore * policy.weights.return +
        s.drawdownScore * policy.weights.drawdown +
        s.consistencyScore * policy.weights.consistency +
        s.riskDisciplineScore * policy.weights.riskDiscipline +
        s.completionScore * policy.weights.completion;
    return Math.round(raw * 100) / 100;
}

/** Privacy-conscious display label — never an email or full uid. */
export function displayLabelFor(userId: string): string {
    const suffix = userId.slice(-6);
    return `Trader ${suffix}`;
}

/**
 * Build the leaderboard entries. PRIVATE profiles are excluded entirely;
 * COMMUNITY/PUBLIC are both included (the visibility controls whether the
 * snapshot is shared beyond the owner).
 */
export function buildLeaderboardEntries(
    inputs: LeaderboardInput[],
    policy: LeaderboardPolicy = defaultLeaderboardPolicy()
): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];

    for (const input of inputs) {
        if (input.visibility === "PRIVATE") continue;
        if (input.tradeCount < policy.minTrades) continue;
        if (!policy.includeStatuses.includes(input.status)) continue;

        const s = componentScores(input);
        entries.push({
            attemptId: input.attemptId,
            displayLabel: displayLabelFor(input.userId),
            tier: input.tier,
            status: input.status,
            totalReturnPct: Math.round(input.totalReturnPct * 100) / 100,
            maxDrawdownPct: Math.round(input.maxDrawdownPct * 100) / 100,
            tradingDays: input.tradingDays,
            tradeCount: input.tradeCount,
            consistencyScore: s.consistencyScore,
            riskDisciplineScore: s.riskDisciplineScore,
            profitableDayRatio: input.totalTradingDays > 0 ? Math.round((input.profitableDays / input.totalTradingDays) * 100) / 100 : 0,
            completionScore: s.completionScore,
            score: scoreEntry(input, policy),
        });
    }

    // Rank by composite score; ties broken by lower drawdown, then higher
    // completion, then attemptId for full determinism.
    entries.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.maxDrawdownPct !== b.maxDrawdownPct) return a.maxDrawdownPct - b.maxDrawdownPct;
        if (b.completionScore !== a.completionScore) return b.completionScore - a.completionScore;
        return a.attemptId < b.attemptId ? -1 : 1;
    });
    return entries;
}

export function buildLeaderboardSnapshot(params: {
    periodKey: string;
    visibility: LeaderboardVisibility;
    entries: LeaderboardEntry[];
    policy?: LeaderboardPolicy;
    now: number;
}): LeaderboardSnapshot {
    const policy = params.policy ?? defaultLeaderboardPolicy();
    return {
        snapshotId: `lb_${params.periodKey}`,
        periodKey: params.periodKey,
        visibility: params.visibility,
        generatedAt: params.now,
        entries: params.entries,
        policy,
        disclaimer: ARENA_DISCLAIMERS.leaderboard,
    };
}
