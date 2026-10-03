// ═══════════════════════════════════════════════════════════════════════════
// CRITICAL INVARIANT: no user (and no client-controlled input) can cause a
// cash reward to be issued while CASH_REWARDS_ENABLED is false — the default.
//
// These tests exercise the ONLY server-side gate (flags.ts + payout.ts) and
// prove that: (a) the flag defaults to false, (b) every cash request is
// rejected with CASH_REWARDS_DISABLED regardless of payload, (c) even with
// the flag flipped on, no payout is possible because no provider exists,
// (d) eligibility reports cash as DISABLED, and (e) the payout flow has no
// completed path in this codebase.
// ═══════════════════════════════════════════════════════════════════════════

import { createSuite } from "./harness";
import { isCashRewardsEnabled, arenaFlagSnapshot, ARENA_FLAG_ENV } from "../flags";
import { requestCashReward, listPayoutProviders, draftPayoutRequest } from "../payout";
import { evaluateRewardEligibility, evaluateJurisdiction, buildPayoutEligibility } from "../eligibility";

function restoreEnv(key: string, previous: string | undefined) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
}

export async function runCashInvariantTests(): Promise<boolean> {
    const s = createSuite("cash-invariant");
    const savedCash = process.env[ARENA_FLAG_ENV.cashRewards];
    delete process.env[ARENA_FLAG_ENV.cashRewards];

    s.section("Flag defaults to OFF");
    s.check(isCashRewardsEnabled() === false, "CASH_REWARDS_ENABLED unset → false (fail-closed default)");
    s.check(arenaFlagSnapshot().cashRewardsEnabled === false, "snapshot reports cash disabled");

    for (const value of ["false", "0", "off", "no", "disabled", "", "maybe"]) {
        process.env[ARENA_FLAG_ENV.cashRewards] = value;
        s.check(isCashRewardsEnabled() === false, `value "${value}" → false`);
    }

    s.section("Every cash request is rejected while the flag is off");
    delete process.env[ARENA_FLAG_ENV.cashRewards];
    const variants = [
        { userId: "user_1", attemptId: "att_1", amountCents: 10_000, currency: "USD" },
        { userId: "user_1", attemptId: "att_1", amountCents: 999_999_999 },
        { userId: "user_1", attemptId: "att_1", amountCents: -500 }, // malformed still gated first
        { userId: "user_1", attemptId: "att_1", amountCents: Number.NaN },
        { userId: "user_1", attemptId: "att_1", amountCents: 1, providerId: "stripe" },
    ];
    for (const variant of variants) {
        const outcome = await requestCashReward(variant);
        s.check(!outcome.ok && outcome.code === "CASH_REWARDS_DISABLED", `amount=${String(variant.amountCents)} → CASH_REWARDS_DISABLED`);
    }

    s.section("No payout provider exists in this deployment");
    s.check(listPayoutProviders().length === 0, "provider registry is empty (architecture only)");
    process.env[ARENA_FLAG_ENV.cashRewards] = "true"; // simulate a flipped flag
    const withFlag = await requestCashReward({ userId: "user_1", attemptId: "att_1", amountCents: 10_000 });
    s.check(!withFlag.ok && withFlag.code === "NO_PAYOUT_PROVIDER", "even with the flag ON → NO_PAYOUT_PROVIDER (no payout path)");
    const withProviderId = await requestCashReward({ userId: "user_1", attemptId: "att_1", amountCents: 10_000, providerId: "made-up" });
    s.check(!withProviderId.ok && withProviderId.code === "NO_PAYOUT_PROVIDER", "unknown provider id still rejected");
    restoreEnv(ARENA_FLAG_ENV.cashRewards, savedCash);

    s.section("Eligibility layer reports cash as unavailable");
    delete process.env[ARENA_FLAG_ENV.cashRewards];
    const eligibility = evaluateRewardEligibility({ country: "US", program: "pro-100k", rewardType: "CASH" });
    s.check(eligibility.eligibilityStatus === "DISABLED", "cash eligibility = DISABLED");
    s.check(eligibility.reason.includes("not available"), "reason explains cash is unavailable");
    s.check(eligibility.requiredVerification.length === 0, "no verification flow offered today");

    const platform = evaluateRewardEligibility({ country: "US", program: "pro-100k", rewardType: "PLATFORM_POINTS" });
    s.check(platform.eligibilityStatus === "AVAILABLE", "platform rewards available under normal rules");

    s.section("Jurisdiction layer is conservative by default");
    const noCountry = evaluateJurisdiction({ country: null });
    s.check(!noCountry.eligible, "no country → not eligible");
    const noConfig = evaluateJurisdiction({ country: "DE" });
    s.check(!noConfig.eligible && noConfig.reason.includes("compliance review"), "no configured jurisdiction → not eligible");
    const configured = evaluateJurisdiction({ country: "DE", configuredEligibleCountries: ["DE"] });
    s.check(configured.eligible, "explicitly configured country passes jurisdiction (still needs the rest)");

    s.section("Full payout eligibility assembly blocks everything while cash is off");
    const payout = buildPayoutEligibility({
        userId: "user_1",
        program: "pro-100k",
        country: "DE",
        configuredEligibleCountries: ["DE"],
        kyc: "verified",
        tax: "cleared",
        fraudReview: "cleared",
        approval: "approved",
    });
    s.check(payout.blockers.includes("cash_rewards_disabled"), "cash_rewards_disabled blocks even a fully-verified payout");
    s.check(payout.eligible === false, "payout not eligible while the flag is off");

    const notVerified = buildPayoutEligibility({
        userId: "user_1",
        program: "pro-100k",
        country: "US",
        kyc: "not_submitted",
        tax: "not_collected",
        fraudReview: "not_required",
        approval: "pending",
    });
    s.check(notVerified.blockers.length >= 4, "future flow still requires KYC + tax + fraud + approval");

    s.section("Draft request helper rejects by construction");
    const draft = draftPayoutRequest({ requestId: "pr_1", userId: "user_1", attemptId: "att_1", amountCents: 100, currency: "USD", now: Date.now() });
    s.check(draft.status === "rejected" && draft.rejectionReason?.includes("disabled") === true, "drafted payout requests carry a rejection");

    restoreEnv(ARENA_FLAG_ENV.cashRewards, savedCash);
    return s.finish();
}
