// Rewards engine tests — idempotent planning, wallet application/revocation,
// AV Points spending, AI credit consumption, and the CASH-never-planned rule.

import { createSuite } from "./harness";
import {
    planRewards,
    applyRewardToWallet,
    revokeRewardFromWallet,
    planPointsSpend,
    consumeAiCredits,
    emptyWallet,
    rewardIdFor,
    spendRewardId,
    rtdbSlug,
} from "../rewards";
import { findSpendItem, POINTS_SPEND_CATALOG } from "../policies";
import { NOW, standardRewardPolicy } from "./fixtures";
import type { RewardPolicy } from "../types";

export async function runRewardsTests(): Promise<boolean> {
    const s = createSuite("rewards");
    const policy = standardRewardPolicy();

    s.section("Planning a PASS");
    const plan = planRewards({
        userId: "user_abc",
        trigger: "CHALLENGE_PASSED",
        policy,
        sourceType: "CHALLENGE_RESULT",
        sourceId: "att_1",
        now: NOW,
    });
    s.check(!plan.disabled && plan.entries.length === 5, `pass grants 5 rewards (got ${plan.entries.length})`);
    s.check(plan.entries.some((e) => e.rewardType === "PLATFORM_POINTS" && e.amount === 5_000), "5,000 AV Points");
    s.check(plan.entries.some((e) => e.rewardType === "PRO_DAYS" && e.amount === 14), "14 Pro days");
    s.check(plan.entries.some((e) => e.rewardType === "AI_CREDITS" && e.amount === 2_000), "2,000 AI credits");
    s.check(plan.entries.some((e) => e.rewardType === "RESEARCH_CREDITS" && e.amount === 10), "10 research runs");
    s.check(plan.entries.some((e) => e.rewardType === "BADGE" && e.metadata?.badgeId === "verified-trader"), "Verified Trader badge");
    s.check(plan.entries.every((e) => e.status === "GRANTED" && e.grantedAt === NOW), "entries granted at planning time");
    s.check(plan.entries.every((e) => e.rewardType !== "CASH"), "NO cash entries — ever");

    s.section("Idempotency: deterministic reward ids");
    const plan2 = planRewards({
        userId: "user_abc",
        trigger: "CHALLENGE_PASSED",
        policy,
        sourceType: "CHALLENGE_RESULT",
        sourceId: "att_1",
        now: NOW,
    });
    const ids1 = plan.entries.map((e) => e.rewardId).sort();
    const ids2 = plan2.entries.map((e) => e.rewardId).sort();
    s.check(JSON.stringify(ids1) === JSON.stringify(ids2), "replaying the same settlement yields identical ids (set-if-absent ⇒ single grant)");
    const planOther = planRewards({
        userId: "user_abc",
        trigger: "CHALLENGE_PASSED",
        policy,
        sourceType: "CHALLENGE_RESULT",
        sourceId: "att_2",
        now: NOW,
    });
    const overlap = planOther.entries.filter((e) => ids1.includes(e.rewardId));
    s.check(overlap.length === 0, "different attempts produce different ids");
    s.check(new Set(ids1).size === ids1.length, "no duplicate ids within one plan");

    s.section("Cash grants are never planned, even in policy");
    const cashPolicy: RewardPolicy = {
        ...policy,
        grants: [
            ...policy.grants,
            { when: "CHALLENGE_PASSED", type: "CASH", amount: 100_00, unit: "USD" },
        ],
    };
    const cashPlan = planRewards({
        userId: "user_abc",
        trigger: "CHALLENGE_PASSED",
        policy: cashPolicy,
        sourceType: "CHALLENGE_RESULT",
        sourceId: "att_1",
        now: NOW,
    });
    s.check(!cashPlan.entries.some((e) => e.rewardType === "CASH"), "CASH grant in policy is filtered out");

    s.section("Disabled platform rewards flag ⇒ nothing planned");
    const previous = process.env.ARENA_PLATFORM_REWARDS_ENABLED;
    process.env.ARENA_PLATFORM_REWARDS_ENABLED = "false";
    const disabledPlan = planRewards({
        userId: "user_abc",
        trigger: "CHALLENGE_PASSED",
        policy,
        sourceType: "CHALLENGE_RESULT",
        sourceId: "att_1",
        now: NOW,
    });
    if (previous === undefined) delete process.env.ARENA_PLATFORM_REWARDS_ENABLED;
    else process.env.ARENA_PLATFORM_REWARDS_ENABLED = previous;
    s.check(disabledPlan.disabled && disabledPlan.entries.length === 0, "flag off → no rewards planned");
    const restoredPlan = planRewards({
        userId: "user_abc",
        trigger: "CHALLENGE_PASSED",
        policy,
        sourceType: "CHALLENGE_RESULT",
        sourceId: "att_1",
        now: NOW,
    });
    s.check(restoredPlan.entries.length === 5, "flag restored → planning works again");

    s.section("Consistency grants are conditional");
    const noConsistency = planRewards({
        userId: "user_abc",
        trigger: "CONSISTENCY_ACHIEVED",
        policy,
        sourceType: "CONSISTENCY",
        sourceId: "att_1",
        now: NOW,
        consistencyAchieved: false,
    });
    s.check(noConsistency.entries.length === 0, "no consistency reward without the achievement");
    const withConsistency = planRewards({
        userId: "user_abc",
        trigger: "CONSISTENCY_ACHIEVED",
        policy,
        sourceType: "CONSISTENCY",
        sourceId: "att_1",
        now: NOW,
        consistencyAchieved: true,
    });
    s.check(withConsistency.entries.length === 2, "consistency achievement grants points + badge");

    s.section("Wallet application & revocation");
    let wallet = emptyWallet("user_abc", NOW);
    const points = plan.entries.find((e) => e.rewardType === "PLATFORM_POINTS")!;
    const badge = plan.entries.find((e) => e.rewardType === "BADGE")!;
    const ai = plan.entries.find((e) => e.rewardType === "AI_CREDITS")!;
    wallet = applyRewardToWallet(wallet, points, NOW);
    wallet = applyRewardToWallet(wallet, badge, NOW);
    wallet = applyRewardToWallet(wallet, ai, NOW);
    s.check(wallet.avPoints === 5_000, "points credited");
    s.check(wallet.aiCredits === 2_000, "AI credits credited");
    s.check(wallet.badges.includes("verified-trader"), "badge added once");
    wallet = applyRewardToWallet(wallet, badge, NOW);
    s.check(wallet.badges.filter((b) => b === "verified-trader").length === 1, "badge re-apply is idempotent");

    wallet = revokeRewardFromWallet(wallet, points, NOW);
    s.check(wallet.avPoints === 0, "revocation removes the granted amount");
    wallet = revokeRewardFromWallet(wallet, points, NOW);
    s.check(wallet.avPoints === 0, "double revocation cannot go negative");
    wallet = revokeRewardFromWallet(wallet, badge, NOW);
    s.check(!wallet.badges.includes("verified-trader"), "badge removed on revoke");

    s.section("AV Points spending");
    const rich = { ...emptyWallet("user_abc", NOW), avPoints: 5_000 };
    const item = findSpendItem("ai-credits-500")!;
    const insufficient = planPointsSpend({
        wallet: { ...rich, avPoints: 10 },
        itemId: item.id,
        costPoints: item.costPoints,
        grants: item.grants,
        now: NOW,
        requestSourceId: "req_1",
    });
    s.check(!insufficient.ok && insufficient.entries.length === 0, "insufficient points rejected without side effects");

    const spend = planPointsSpend({
        wallet: rich,
        itemId: item.id,
        costPoints: item.costPoints,
        grants: item.grants,
        now: NOW,
        requestSourceId: "req_1",
    });
    s.check(spend.ok && spend.wallet.avPoints === 4_000, "points debited");
    s.check(spend.wallet.aiCredits === 500, "AI credits credited");
    s.check(spend.entries.length === 2, "debit + credit ledger entries");
    s.check(spend.entries[0].amount === -item.costPoints, "debit entry is negative");

    const spendAgain = planPointsSpend({
        wallet: rich,
        itemId: item.id,
        costPoints: item.costPoints,
        grants: item.grants,
        now: NOW,
        requestSourceId: "req_1",
    });
    s.check(
        JSON.stringify(spendAgain.entries.map((e) => e.rewardId)) === JSON.stringify(spend.entries.map((e) => e.rewardId)),
        "same request id → same ledger ids (retry cannot double-spend)"
    );
    const spendOther = planPointsSpend({
        wallet: rich,
        itemId: item.id,
        costPoints: item.costPoints,
        grants: item.grants,
        now: NOW,
        requestSourceId: "req_2",
    });
    s.check(spendOther.entries[0].rewardId !== spend.entries[0].rewardId, "different request → different ledger ids");

    s.check(POINTS_SPEND_CATALOG.every((i) => i.costPoints > 0 && i.grants.length > 0), "catalog items are complete");

    s.section("AI credit consumption");
    const walletFull = { ...emptyWallet("user_abc", NOW), aiCredits: 2 };
    const ok = consumeAiCredits(walletFull, 1, NOW);
    s.check(ok.ok && ok.wallet.aiCredits === 1, "credits consumed when balance covers");
    const notEnough = consumeAiCredits({ ...walletFull, aiCredits: 0 }, 1, NOW);
    s.check(!notEnough.ok && notEnough.wallet.aiCredits === 0, "insufficient balance → no consumption");

    s.section("Key hygiene");
    s.check(!/[.#$[\]/]/.test(rtdbSlug("a.b/c$d#e")), "RTDB-safe slug strips forbidden characters");
    const rid = rewardIdFor({ userId: "user abc", sourceType: "CHALLENGE_RESULT", sourceId: "att/1", rewardType: "CASH", index: 0 });
    s.check(!/[.#$[\]/]/.test(rid), "reward id is a safe RTDB key");
    s.check(spendRewardId({ userId: "u", sourceId: "req", itemId: "i" }) === spendRewardId({ userId: "u", sourceId: "req", itemId: "i" }), "spend ids deterministic");

    return s.finish();
}
