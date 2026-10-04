// Feature flags (defaults & cascades), strategy compatibility, profile tests.

import { createSuite } from "./harness";
import {
    isArenaEnabled,
    isCatalogEnabled,
    isPaidChallengesEnabled,
    isLeaderboardsEnabled,
    isPlatformRewardsEnabled,
    isCashRewardsEnabled,
    arenaFlagSnapshot,
    ARENA_FLAG_ENV,
} from "../flags";
import { assessStrategyCompatibility } from "../compatibility";
import { buildTraderProfile } from "../profile";
import { validateChallengePolicy, validateDefinition, defaultChallengeDefinitions, defaultRewardPolicies } from "../policies";
import { makePolicy, makeAttempt, NOW } from "./fixtures";

function withEnv(key: string, value: string | undefined, fn: () => void) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    try {
        fn();
    } finally {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
    }
}

export async function runFlagsCompatTests(): Promise<boolean> {
    const s = createSuite("flags-compatibility-profile");

    s.section("Flag defaults (spec-mandated)");
    withEnv(ARENA_FLAG_ENV.arena, undefined, () => s.check(isArenaEnabled() === true, "performanceArenaEnabled = true"));
    withEnv(ARENA_FLAG_ENV.catalog, undefined, () => s.check(isCatalogEnabled() === true, "challengeCatalogEnabled = true"));
    withEnv(ARENA_FLAG_ENV.paidChallenges, undefined, () => s.check(isPaidChallengesEnabled() === false, "paidChallengesEnabled = false"));
    withEnv(ARENA_FLAG_ENV.leaderboards, undefined, () => s.check(isLeaderboardsEnabled() === true, "leaderboardsEnabled = true"));
    withEnv(ARENA_FLAG_ENV.platformRewards, undefined, () => s.check(isPlatformRewardsEnabled() === true, "platformRewardsEnabled = true"));
    withEnv(ARENA_FLAG_ENV.cashRewards, undefined, () => s.check(isCashRewardsEnabled() === false, "cashRewardsEnabled = false (HARD DEFAULT)"));

    s.section("Env overrides");
    withEnv(ARENA_FLAG_ENV.paidChallenges, "true", () => s.check(isPaidChallengesEnabled() === false, "paid remains closed without Stripe billing verification"));
    withEnv(ARENA_FLAG_ENV.paidChallenges, "true", () => {
        withEnv("ARENA_STRIPE_BILLING_VERIFIED", undefined, () => s.check(isPaidChallengesEnabled() === false, "paid remains closed without Stripe billing verification"));
        withEnv("ARENA_STRIPE_BILLING_VERIFIED", "true", () => s.check(isPaidChallengesEnabled() === true, "paid flag opens only after explicit Stripe/webhook verification"));
    });
    withEnv(ARENA_FLAG_ENV.cashRewards, "true", () => s.check(isCashRewardsEnabled() === false, "cash remains structurally disabled even if env is accidentally set true"));

    s.section("Cascade: disabling the arena disables its surfaces");
    withEnv(ARENA_FLAG_ENV.arena, "false", () => {
        s.check(isArenaEnabled() === false, "arena disabled");
        s.check(isCatalogEnabled() === false, "catalog cascades off");
        s.check(isLeaderboardsEnabled() === false, "leaderboards cascade off");
        s.check(isPlatformRewardsEnabled() === false, "platform rewards cascade off");
    });

    const snapshot = arenaFlagSnapshot();
    s.check(
        snapshot.performanceArenaEnabled &&
            snapshot.challengeCatalogEnabled &&
            !snapshot.paidChallengesEnabled &&
            snapshot.leaderboardsEnabled &&
            snapshot.platformRewardsEnabled &&
            !snapshot.cashRewardsEnabled,
        "snapshot matches spec defaults"
    );

    s.section("Policy validation (challenge creation is validated server-side)");
    const definitions = defaultChallengeDefinitions(NOW);
    s.check(definitions.length >= 4, "shipped tiers");
    s.check(definitions.every((d) => validateDefinition(d).valid), "every shipped definition is valid");
    s.check(definitions.filter((d) => d.access.model === "paid").every((d) => !d.enabled && d.status === "DRAFT" && d.access.priceCents === undefined), "shipped paid products stay unpublished until price is configured");
    s.check(!validateDefinition({ ...definitions.find((d) => d.access.model === "paid")!, enabled: true, status: "AVAILABLE" }).valid, "paid challenge cannot be published without an explicit configured price");
    const configuredPaid = { ...definitions.find((d) => d.access.model === "paid")!, access: { model: "paid" as const, priceCents: 2500, currency: "usd" }, enabled: true, status: "AVAILABLE" as const };
    s.check(validateDefinition(configuredPaid).valid, "admin-configured paid price permits publication");
    s.check(new Set(definitions.map((d) => d.key)).size === definitions.length, "definition keys unique");
    s.check(definitions.every((d) => d.rewardPolicyId === "arena-standard-rewards"), "definitions reference a reward policy");

    const base = makePolicy();
    s.check(validateChallengePolicy(base).valid, "default policy passes validation");
    const badDaily = validateChallengePolicy({ ...base, dailyLossLimitPct: 10 });
    s.check(!badDaily.valid && badDaily.errors.some((e) => e.includes("dailyLossLimitPct")), "daily loss ≥ drawdown rejected");
    const badDays = validateChallengePolicy({ ...base, minTradingDays: 40, maxTradingDays: 10 });
    s.check(!badDays.valid, "max trading days below min rejected");
    const badTarget = validateChallengePolicy({ ...base, profitTargetPct: -1 });
    s.check(!badTarget.valid, "negative target rejected");
    const badStart = validateChallengePolicy({ ...base, startingBalanceCents: 0 });
    s.check(!badStart.valid, "zero starting balance rejected");
    s.check(!validateDefinition({ ...definitions[0], key: "BAD KEY" }).valid, "invalid key rejected");

    s.check(defaultRewardPolicies(NOW).every((p) => p.grants.every((g) => g.type !== "CASH")), "shipped reward policies contain no cash");

    s.section("Strategy ↔ challenge compatibility");
    const policy = makePolicy(); // target 10, DD 8, daily 4, maxDailyTrades 20
    const good = assessStrategyCompatibility({
        strategy: { strategyName: "Solid", backtestReturnPct: 18, maxDrawdownPct: 4, worstDayLossPct: -1.5, tradeCount: 40, avgTradesPerDay: 2, bestDaySharePct: 30 },
        policy,
    });
    s.check(good.verdict === "compatible", "well-fitted strategy → compatible");

    const tooRisky = assessStrategyCompatibility({
        strategy: { strategyName: "Wild", backtestReturnPct: 40, maxDrawdownPct: 12, worstDayLossPct: -1, tradeCount: 40, avgTradesPerDay: 2 },
        policy,
    });
    s.check(tooRisky.verdict === "incompatible", "DD above challenge limit → incompatible");
    s.check(tooRisky.findings.find((f) => f.key === "drawdown")?.verdict === "fail", "drawdown finding explains why");

    const tight = assessStrategyCompatibility({
        strategy: { strategyName: "Tight", backtestReturnPct: 12, maxDrawdownPct: 6.5, worstDayLossPct: -1, tradeCount: 30, avgTradesPerDay: 2 },
        policy,
    });
    s.check(tight.verdict === "cautions", "DD at 81% of the limit → cautions");

    const badDay = assessStrategyCompatibility({
        strategy: { strategyName: "Volatile", backtestReturnPct: 15, maxDrawdownPct: 5, worstDayLossPct: -5, tradeCount: 30, avgTradesPerDay: 2 },
        policy,
    });
    s.check(badDay.verdict === "incompatible", "worst day above daily loss limit → incompatible");

    const tooFast = assessStrategyCompatibility({
        strategy: { strategyName: "HFT", backtestReturnPct: 15, maxDrawdownPct: 3, worstDayLossPct: -0.5, tradeCount: 400, avgTradesPerDay: 35 },
        policy,
    });
    s.check(tooFast.verdict === "incompatible", "trade frequency above daily cap → incompatible");

    const thin = assessStrategyCompatibility({
        strategy: { strategyName: "Newbie", backtestReturnPct: 5, maxDrawdownPct: 1, worstDayLossPct: -0.2, tradeCount: 2, avgTradesPerDay: 0.2 },
        policy,
    });
    s.check(thin.verdict === "insufficient_data", "tiny sample → insufficient_data");

    const strictPolicy = makePolicy({ consistency: { required: true, maxSingleDayPnlSharePct: 40, minTradesForConsistency: 10 } });
    const skewed = assessStrategyCompatibility({
        strategy: { strategyName: "One-hit", backtestReturnPct: 15, maxDrawdownPct: 3, worstDayLossPct: -1, tradeCount: 30, avgTradesPerDay: 1, bestDaySharePct: 85 },
        policy: strictPolicy,
    });
    s.check(skewed.verdict === "incompatible" && skewed.findings.some((f) => f.key === "consistency" && f.verdict === "fail"), "consistency rule enforced when configured");

    s.check(good.disclaimer.toLowerCase().includes("do not guarantee"), "compatibility always carries the no-guarantee disclaimer");
    s.check(good.challengeRulesSummary.includes("Max DD"), "summary of challenge rules included");

    s.section("Trader profile aggregation");
    const passAttempt = makeAttempt({ id: "att_p", definitionKey: "pro-100k", status: "PASSED", startedAt: NOW - 10 * 86_400_000, settledAt: NOW - 2 * 86_400_000 });
    const failAttempt = makeAttempt({ id: "att_f", definitionKey: "pro-100k", status: "FAILED", startedAt: NOW - 5 * 86_400_000, settledAt: NOW - 86_400_000 });
    const cancelAttempt = makeAttempt({ id: "att_c", definitionKey: "starter-10k", status: "CANCELLED", startedAt: NOW - 3 * 86_400_000, settledAt: NOW - 86_400_000 });

    const profile = buildTraderProfile({
        userId: "user_profile1",
        history: [
            { attempt: passAttempt, result: { totalReturnPct: 10.4, maxDrawdownPct: 3.2, tradeCount: 22, consistencyPassed: true } as never, markets: ["forex", "metals"] },
            { attempt: failAttempt, result: { totalReturnPct: -4, maxDrawdownPct: 8, tradeCount: 14, consistencyPassed: false } as never, markets: ["forex"] },
            { attempt: cancelAttempt, result: null, markets: [] },
        ],
        avPoints: 5_000,
        badges: ["verified-trader"],
        visibility: "COMMUNITY",
        now: NOW,
    });
    s.check(profile.attempted === 3, "attempts counted");
    s.check(profile.completed === 2, "completed = settled (not cancelled)");
    s.check(profile.passed === 1 && profile.failed === 1 && profile.cancelled === 1, "status buckets");
    s.check(profile.bestReturnPct === 10.4, "best return from results");
    s.check(Math.abs(profile.avgDrawdownPct - 5.6) < 0.01, "average drawdown across settled runs");
    s.check(profile.avPoints === 5_000 && profile.badges.includes("verified-trader"), "wallet data surfaced");
    s.check(profile.markets.includes("forex") && profile.markets.includes("metals"), "markets aggregated");
    s.check(profile.disclaimer.includes("Simulated"), "profile carries the disclaimer");
    s.check(profile.displayLabel.startsWith("Trader "), "profile label anonymized");
    s.check(profile.history.length === 3, "history includes all attempts");
    const starts = profile.history.map((h) => h.startedAt);
    s.check(starts.every((t, i) => i === 0 || starts[i - 1] >= t), "history sorted newest first");
    s.check(profile.history[0].attemptId === "att_c", "most recent attempt listed first");

    const empty = buildTraderProfile({ userId: "user_new", history: [], avPoints: 0, badges: [], visibility: "PRIVATE", now: NOW });
    s.check(empty.attempted === 0 && empty.bestReturnPct === 0, "empty profile is honest (zeros, no fake history)");

    return s.finish();
}
