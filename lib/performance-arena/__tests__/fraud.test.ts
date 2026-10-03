// Fraud / abuse detection tests (privacy-conscious heuristics).

import { createSuite } from "./harness";
import {
    detectDuplicateChallengeAbuse,
    detectRewardDuplication,
    detectImpossibleExecution,
    detectExcessiveApiActivity,
    detectSuspiciousTradingPattern,
    runFraudDetections,
    flagIdFor,
    type FraudDetectionContext,
} from "../fraud";
import { NOW, DAY, makeAttempt, makeOpenTrade } from "./fixtures";

function ctx(overrides: Partial<FraudDetectionContext> = {}): FraudDetectionContext {
    return {
        userId: "user_fraud",
        attempt: makeAttempt(),
        now: NOW,
        recentAttempts: [],
        nextFlagId: () => "ff_x",
        ...overrides,
    };
}

export async function runFraudTests(): Promise<boolean> {
    const s = createSuite("fraud");

    s.section("Duplicate / reset abuse");
    const single = detectDuplicateChallengeAbuse(
        ctx({ recentAttempts: [{ id: "att_1", definitionId: "pro-100k", status: "FAILED", createdAt: NOW - 60_000 }] })
    );
    s.check(single.length === 0, "one recent attempt → no flag");

    const two = detectDuplicateChallengeAbuse(
        ctx({
            recentAttempts: [
                { id: "att_1", definitionId: "pro-100k", status: "FAILED", createdAt: NOW - 60_000 },
                { id: "att_2", definitionId: "pro-100k", status: "FAILED", createdAt: NOW - 30_000 },
            ],
        })
    );
    s.check(two.length === 1 && two[0].type === "DUPLICATE_ACTIVE_CHALLENGE" && two[0].severity === "low", "2 restarts in 24h → low duplicate flag");

    const three = detectDuplicateChallengeAbuse(
        ctx({
            recentAttempts: [
                { id: "att_1", definitionId: "pro-100k", status: "FAILED", createdAt: NOW - 60_000 },
                { id: "att_2", definitionId: "pro-100k", status: "FAILED", createdAt: NOW - 30_000 },
                { id: "att_3", definitionId: "pro-100k", status: "CANCELLED", createdAt: NOW - 10_000 },
            ],
        })
    );
    s.check(three.length === 1 && three[0].type === "CHALLENGE_RESET_ABUSE" && three[0].severity === "medium", "3 restarts → reset abuse (medium)");

    const oldOnly = detectDuplicateChallengeAbuse(
        ctx({ recentAttempts: [{ id: "att_old", definitionId: "pro-100k", status: "FAILED", createdAt: NOW - 2 * DAY }] })
    );
    s.check(oldOnly.length === 0, "old attempts outside the 24h window ignored");

    s.section("Reward duplication tripwire");
    const dupe = detectRewardDuplication(ctx(), ["rw_1", "rw_2", "rw_1"]);
    s.check(dupe.length === 1 && dupe[0].type === "REWARD_DUPLICATION" && dupe[0].severity === "high", "duplicate reward ids flagged high");
    s.check(detectRewardDuplication(ctx(), ["rw_1", "rw_2"]).length === 0, "unique reward ids → no flag");

    s.section("Impossible execution");
    const impossible = detectImpossibleExecution({
        ctx: ctx(),
        quotePriceMicros: 1_100_000,
        fillPriceMicros: 1_130_000, // ~2.7% away
        symbol: "EURUSD",
    });
    s.check(impossible.length === 1 && impossible[0].type === "IMPOSSIBLE_EXECUTION" && impossible[0].severity === "high", "fill far from quote → high flag");
    const normal = detectImpossibleExecution({
        ctx: ctx(),
        quotePriceMicros: 1_100_000,
        fillPriceMicros: 1_100_500, // 0.045% — normal rounding/spread
        symbol: "EURUSD",
    });
    s.check(normal.length === 0, "fill at the quote → no flag");

    s.section("Excessive API activity");
    s.check(detectExcessiveApiActivity(ctx({ apiCallsThisMinute: 60 })).length === 0, "60 calls/min → fine");
    const rate = detectExcessiveApiActivity(ctx({ apiCallsThisMinute: 150 }));
    s.check(rate.length === 1 && rate[0].type === "EXCESSIVE_API_ACTIVITY", "150 calls/min → flagged");
    s.check(detectExcessiveApiActivity(ctx({ apiCallsThisMinute: 500 }))[0].severity === "high", "500 calls/min → high severity");

    s.section("Suspicious uniform trading pattern");
    const uniform = Array.from({ length: 12 }, (_, i) =>
        makeOpenTrade({
            tradeId: `t${i}`,
            status: "closed",
            entryAt: NOW - 12 * 60_000,
            closedAt: NOW - 11 * 60_000,
            realizedPnLCents: 1_000,
            exitPriceMicros: 1_100_100,
            exitQuoteAt: NOW - 11 * 60_000,
            exitReason: "manual",
        })
    );
    const uniformFlags = detectSuspiciousTradingPattern({ ctx: ctx(), trades: uniform });
    s.check(uniformFlags.length === 1 && uniformFlags[0].type === "SUSPICIOUS_TRADING_PATTERN", "identical duration+size cadence flagged");

    const varied = Array.from({ length: 12 }, (_, i) =>
        makeOpenTrade({
            tradeId: `v${i}`,
            status: "closed",
            entryAt: NOW - (i + 1) * 97_000,
            closedAt: NOW - (i + 1) * 31_000,
            sizeCentiLots: 10 + i * 7,
            realizedPnLCents: 1_000 + i,
            exitPriceMicros: 1_100_100,
            exitQuoteAt: NOW - (i + 1) * 31_000,
            exitReason: "manual",
        })
    );
    s.check(detectSuspiciousTradingPattern({ ctx: ctx(), trades: varied }).length === 0, "varied behaviour → no flag");
    s.check(detectSuspiciousTradingPattern({ ctx: ctx(), trades: Array.from({ length: 5 }, (_, i) => makeOpenTrade({ tradeId: `s${i}` })) }).length === 0, "small samples skipped");

    s.section("Aggregate runner & id hygiene");
    const combined = runFraudDetections({
        ctx: ctx({ apiCallsThisMinute: 200, recentAttempts: [
            { id: "att_1", definitionId: "pro-100k", status: "FAILED", createdAt: NOW - 1000 },
            { id: "att_2", definitionId: "pro-100k", status: "FAILED", createdAt: NOW - 2000 },
            { id: "att_3", definitionId: "pro-100k", status: "FAILED", createdAt: NOW - 3000 },
            { id: "att_4", definitionId: "pro-100k", status: "FAILED", createdAt: NOW - 4000 },
        ] }),
        trades: uniform,
    });
    s.check(combined.length >= 3, "multiple detectors can fire together");
    s.check(new Set(combined.map((f) => f.flagId)).size === combined.length, "flag ids unique within one run");

    const idA = flagIdFor({ userId: "u1", type: "REWARD_FARMING", attemptId: "att_1", dedupeKey: "k" });
    const idB = flagIdFor({ userId: "u1", type: "REWARD_FARMING", attemptId: "att_1", dedupeKey: "k" });
    s.check(idA === idB, "flag ids are deterministic (write-once semantics)");
    s.check(!/[.#$[\]/]/.test(idA), "flag id is an RTDB-safe key");

    s.section("Flags never alter performance data");
    s.check(combined.every((f) => !("balanceCents" in f) && !("realizedPnLCents" in f)), "flag objects carry no accounting fields");

    return s.finish();
}
