// Leaderboard tests — composite scoring (never raw profit), visibility, ties.

import { createSuite } from "./harness";
import { buildLeaderboardEntries, buildLeaderboardSnapshot, componentScores, scoreEntry, displayLabelFor } from "../leaderboard";
import { defaultLeaderboardPolicy } from "../policies";
import type { LeaderboardInput } from "../leaderboard";

function input(overrides: Partial<LeaderboardInput>): LeaderboardInput {
    return {
        attemptId: "att_a",
        userId: "user_abcdefgh",
        tier: "pro",
        status: "PASSED",
        visibility: "COMMUNITY",
        totalReturnPct: 10,
        maxDrawdownPct: 2,
        maxDrawdownLimitPct: 8,
        tradingDays: 6,
        minTradingDays: 5,
        tradeCount: 20,
        consistencyScore: 90,
        profitableDays: 4,
        totalTradingDays: 6,
        breached: false,
        ...overrides,
    };
}

export async function runLeaderboardTests(): Promise<boolean> {
    const s = createSuite("leaderboard");
    const policy = defaultLeaderboardPolicy();

    s.section("Composite score — not raw profit");
    const hotHead = input({
        attemptId: "att_hot",
        totalReturnPct: 20,
        maxDrawdownPct: 7.2, // 90% of the 8% limit
        consistencyScore: 40,
        status: "FAILED",
        breached: true,
    });
    const steady = input({
        attemptId: "att_steady",
        totalReturnPct: 8,
        maxDrawdownPct: 0.8, // 10% of the limit
        consistencyScore: 95,
    });
    const hotScore = scoreEntry(hotHead, policy);
    const steadyScore = scoreEntry(steady, policy);
    s.check(steadyScore > hotScore, `steady 8% run outranks reckless 20% run (${steadyScore} > ${hotScore})`);

    const hotComponents = componentScores(hotHead);
    const steadyComponents = componentScores(steady);
    s.check(hotComponents.riskDisciplineScore === 0, "breached run scores 0 on risk discipline");
    s.check(steadyComponents.returnScore < hotComponents.returnScore, "return component still rewards raw return (as one factor)");

    s.section("Visibility and qualification gates");
    const entries = buildLeaderboardEntries(
        [
            input({ attemptId: "att_public", userId: "user_public1", visibility: "PUBLIC" }),
            input({ attemptId: "att_private", userId: "user_private", visibility: "PRIVATE" }),
            input({ attemptId: "att_community", userId: "user_communi", visibility: "COMMUNITY" }),
            input({ attemptId: "att_fewtrades", userId: "user_fewtrade", tradeCount: 2 }),
            input({ attemptId: "att_cancelled", userId: "user_cancelle", status: "CANCELLED" }),
        ],
        policy
    );
    const ids = entries.map((e) => e.attemptId);
    s.check(ids.includes("att_public") && ids.includes("att_community"), "PUBLIC and COMMUNITY included");
    s.check(!ids.includes("att_private"), "PRIVATE profile excluded entirely");
    s.check(!ids.includes("att_fewtrades"), "below minTrades excluded");
    s.check(!ids.includes("att_cancelled"), "status outside includeStatuses excluded");

    s.section("Privacy of labels");
    s.check(!entries.some((e) => e.displayLabel.includes("user_public1")), "no raw uid in display labels");
    s.check(displayLabelFor("user_1234567890").startsWith("Trader "), "label format is anonymized");

    s.section("Determinism & tie-breaking");
    const tieA = input({ attemptId: "att_a", userId: "user_zzzzzz" });
    const tieB = input({ attemptId: "att_b", userId: "user_yyyyyy", maxDrawdownPct: 1.9 });
    const order1 = buildLeaderboardEntries([tieA, tieB], policy).map((e) => e.attemptId);
    const order2 = buildLeaderboardEntries([tieB, tieA], policy).map((e) => e.attemptId);
    s.check(JSON.stringify(order1) === JSON.stringify(order2), "input order does not affect ranking");
    s.check(order1[0] === "att_b", "tie broken by lower drawdown");
    s.check(scoreEntry(tieA, policy) === scoreEntry({ ...tieA }, policy), "scoring is pure/deterministic");

    const many = Array.from({ length: 10 }, (_, i) => input({ attemptId: `att_${i}`, userId: `user_${i}`, totalReturnPct: 5 + i }));
    const ranked = buildLeaderboardEntries(many, policy);
    let descending = true;
    for (let i = 1; i < ranked.length; i++) {
        if (ranked[i].score > ranked[i - 1].score) descending = false;
    }
    s.check(descending, "final list is sorted by score descending");

    s.section("Snapshot shape");
    const snapshot = buildLeaderboardSnapshot({ periodKey: "2026-10", visibility: "PUBLIC", entries: ranked, policy, now: Date.now() });
    s.check(snapshot.snapshotId === "lb_2026-10", "snapshot id derived from period");
    s.check(snapshot.disclaimer.includes("does not predict"), "snapshot carries the no-prediction disclaimer");
    s.check(snapshot.policy.minTrades === policy.minTrades, "policy travels with the snapshot");

    return s.finish();
}
