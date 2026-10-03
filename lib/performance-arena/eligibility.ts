// ─────────────────────────────────────────────────────────────────────────────
// Performance Arena — eligibility & jurisdiction layer (future-ready).
//
// TODAY:
//   • platform rewards → AVAILABLE under normal product rules
//   • cash rewards     → always DISABLED (CASH_REWARDS_ENABLED=false)
//
// FUTURE (architecture only): jurisdiction + KYC + tax + fraud review + manual
// approval gate a PayoutRequest before any provider adapter runs. No legal
// conclusions are ever produced here — statuses are policy-driven, and the
// default policy says "unavailable".
// ─────────────────────────────────────────────────────────────────────────────

import { isCashRewardsEnabled, isPlatformRewardsEnabled } from "./flags";
import type { PayoutEligibility, RewardEligibility, RewardType } from "./types";

export const ELIGIBILITY_POLICY_VERSION = "arena-eligibility-v1";

export interface EligibilityInput {
    country: string | null;
    region?: string | null;
    program: string;
    rewardType: RewardType;
    /** Product-rule gate (e.g. challenge passed). */
    productRuleSatisfied?: boolean;
    productRuleReason?: string;
}

/**
 * Compute eligibility for a reward type. Cash rewards are hard-disabled
 * regardless of any caller-supplied flag — only the server env can change it.
 */
export function evaluateRewardEligibility(input: EligibilityInput): RewardEligibility {
    const { country, region = null, program, rewardType } = input;

    if (rewardType === "CASH") {
        if (!isCashRewardsEnabled()) {
            return {
                country,
                region,
                program,
                rewardType,
                eligibilityStatus: "DISABLED",
                reason:
                    "Cash rewards are not available. AlgoVault Performance Arena rewards are platform rewards only (points, credits, badges, Pro days).",
                requiredVerification: [],
                policyVersion: ELIGIBILITY_POLICY_VERSION,
            };
        }
        // Even with the flag on (future controlled deployment), cash still
        // requires the full verification chain before it can be claimed.
        return {
            country,
            region,
            program,
            rewardType,
            eligibilityStatus: "REQUIRES_VERIFICATION",
            reason: "Cash rewards require jurisdiction, identity, tax and compliance review before any claim.",
            requiredVerification: ["jurisdiction_check", "identity_kyc", "tax_status", "fraud_review", "manual_approval"],
            policyVersion: ELIGIBILITY_POLICY_VERSION,
        };
    }

    if (!isPlatformRewardsEnabled()) {
        return {
            country,
            region,
            program,
            rewardType,
            eligibilityStatus: "DISABLED",
            reason: "Platform rewards are temporarily disabled by configuration.",
            requiredVerification: [],
            policyVersion: ELIGIBILITY_POLICY_VERSION,
        };
    }

    if (input.productRuleSatisfied === false) {
        return {
            country,
            region,
            program,
            rewardType,
            eligibilityStatus: "UNAVAILABLE",
            reason: input.productRuleReason ?? "Challenge requirements not met.",
            requiredVerification: [],
            policyVersion: ELIGIBILITY_POLICY_VERSION,
        };
    }

    return {
        country,
        region,
        program,
        rewardType,
        eligibilityStatus: "AVAILABLE",
        reason: "Platform rewards follow normal AlgoVault product rules and have no cash value.",
        requiredVerification: [],
        policyVersion: ELIGIBILITY_POLICY_VERSION,
    };
}

/**
 * Future jurisdiction gate — intentionally conservative: without an
 * explicitly configured allow-list (from compliance review), NO jurisdiction
 * is eligible for cash. Never tell a user their country is cash-eligible
 * unless a reviewed policy says so.
 */
export function evaluateJurisdiction(params: {
    country: string | null;
    /** Compliance-configured allow-list — empty by default. */
    configuredEligibleCountries?: readonly string[];
}): { country: string | null; eligible: boolean; reason: string; policyVersion: string } {
    const { country, configuredEligibleCountries = [] } = params;
    if (!country) {
        return {
            country: null,
            eligible: false,
            reason: "Country not confirmed — jurisdiction check cannot run.",
            policyVersion: ELIGIBILITY_POLICY_VERSION,
        };
    }
    if (configuredEligibleCountries.length === 0) {
        return {
            country,
            eligible: false,
            reason: "No jurisdiction is configured for cash rewards pending compliance review.",
            policyVersion: ELIGIBILITY_POLICY_VERSION,
        };
    }
    const eligible = configuredEligibleCountries.includes(country.toUpperCase());
    return {
        country,
        eligible,
        reason: eligible
            ? "Country is present in the reviewed configuration (compliance approval still required)."
            : "Country is not in the reviewed configuration.",
        policyVersion: ELIGIBILITY_POLICY_VERSION,
    };
}

/** Full future payout eligibility assembly (all blockers must clear). */
export function buildPayoutEligibility(params: {
    userId: string;
    program: string;
    country: string | null;
    configuredEligibleCountries?: readonly string[];
    kyc: PayoutEligibility["kyc"];
    tax: PayoutEligibility["tax"];
    fraudReview: PayoutEligibility["fraudReview"];
    approval: PayoutEligibility["approval"];
}): PayoutEligibility {
    const jurisdiction = evaluateJurisdiction({
        country: params.country,
        configuredEligibleCountries: params.configuredEligibleCountries,
    });

    const blockers: string[] = [];
    if (!isCashRewardsEnabled()) blockers.push("cash_rewards_disabled");
    if (!jurisdiction.eligible) blockers.push("jurisdiction_not_eligible");
    if (params.kyc !== "verified") blockers.push("kyc_not_verified");
    if (params.tax !== "cleared") blockers.push("tax_not_cleared");
    if (params.fraudReview !== "cleared") blockers.push("fraud_review_not_cleared");
    if (params.approval !== "approved") blockers.push("payout_not_approved");

    return {
        userId: params.userId,
        program: params.program,
        jurisdiction,
        kyc: params.kyc,
        tax: params.tax,
        fraudReview: params.fraudReview,
        approval: params.approval,
        eligible: blockers.length === 0,
        blockers,
    };
}
