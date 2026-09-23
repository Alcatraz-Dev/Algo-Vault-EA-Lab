/**
 * Growth Engine — opportunity qualification and decision.
 *
 * Enforces the server-side policy mode (ASSISTED / APPROVAL / AUTONOMOUS),
 * evidence quality, compliance and existing state. Never fabricates a
 * decision: when evidence is missing the result is REVIEW, never APPROVE.
 */

import { GrowthOpportunity } from "../opportunities/types";
import {
    GrowthPolicy,
    DEFAULT_GROWTH_POLICY,
    isAutonomousMode,
    isApprovalMode,
    isAssistedMode,
    resolvePolicy,
} from "../policies/types";

export type Decision = "APPROVE" | "REJECT" | "REVIEW" | "HOLD" | "QUEUE";

export type QualificationResult = {
    decision: Decision;
    reason: string;
    qualified: boolean;
    requiresApproval: boolean;
    safeToAutoRun?: boolean;
    /** Set when the decision should surface in the approval queue. */
    queueForApproval?: boolean;
};

/**
 * Qualify an opportunity against the active policy.
 *
 * The function is deterministic and pure: given the same opportunity + policy
 * it always returns the same result, which makes the loop idempotent and
 * auditable.
 */
export function qualifyOpportunity(
    opportunity: GrowthOpportunity,
    policy: GrowthPolicy = DEFAULT_GROWTH_POLICY,
    existingResults?: { id: string; result: string }[]
): QualificationResult {
    // Basic validity: must have evidence
    if (!opportunity.evidence || opportunity.evidence.length === 0) {
        return { decision: "REJECT", reason: "No evidence", qualified: false, requiresApproval: false };
    }

    // Blocked/completed/rejected state
    if (["COMPLETED", "REJECTED", "FAILED", "EXPIRED"].includes(opportunity.status)) {
        return { decision: "REJECT", reason: `Opportunity already in terminal state: ${opportunity.status}`, qualified: false, requiresApproval: false };
    }

    // Cooldown / expiration already enforced by the loop before calling us;
    // if we still see a cooldown-blocked opportunity, hold it.
    if (opportunity.cooldownUntil && opportunity.cooldownUntil > Date.now()) {
        return { decision: "HOLD", reason: "Opportunity is in cooldown.", qualified: false, requiresApproval: false };
    }
    if (opportunity.expiresAt && opportunity.expiresAt < Date.now()) {
        return { decision: "REJECT", reason: "Opportunity has expired.", qualified: false, requiresApproval: false };
    }

    // Confidence unavailable — never approve autonomously.
    if (opportunity.confidence === null) {
        return {
            decision: "REVIEW",
            reason: "Insufficient evidence (confidence unavailable). Requires review.",
            qualified: false,
            requiresApproval: true,
            safeToAutoRun: false,
            queueForApproval: true,
        };
    }

    // Impact unknown with no evidence
    if (opportunity.impact === "UNKNOWN" && opportunity.confidence < 0.3) {
        return {
            decision: "REVIEW",
            reason: "Unknown impact with low confidence.",
            qualified: false,
            requiresApproval: true,
            safeToAutoRun: false,
            queueForApproval: true,
        };
    }

    // Policy-based approval requirements
    const needsApproval = policy.requireApprovalForCampaigns && opportunity.type === "AFFILIATE_OPPORTUNITY";
    const minConfidence = isAutonomousMode(policy) ? (policy.minConfidenceAutonomous ?? 0.7) : 0.3;

    // AUTONOMOUS: high confidence + safe impact + no campaign gate → approve
    if (isAutonomousMode(policy) && opportunity.confidence >= minConfidence && opportunity.impact !== "UNKNOWN" && !needsApproval) {
        return {
            decision: "APPROVE",
            reason: `Autonomous approval: confidence ${opportunity.confidence} >= ${minConfidence}, policy mode AUTONOMOUS.`,
            qualified: true,
            requiresApproval: false,
            safeToAutoRun: true,
        };
    }

    // APPROVAL mode: every qualified opportunity must go through the queue.
    if (isApprovalMode(policy) || needsApproval) {
        if (opportunity.confidence < minConfidence) {
            return {
                decision: "REVIEW",
                reason: `Confidence ${opportunity.confidence} below policy minimum ${minConfidence}.`,
                qualified: false,
                requiresApproval: true,
                safeToAutoRun: false,
                queueForApproval: true,
            };
        }
        return {
            decision: "QUEUE",
            reason: "Policy mode APPROVAL — qualified, queued for approval.",
            qualified: true,
            requiresApproval: true,
            safeToAutoRun: false,
            queueForApproval: true,
        };
    }

    // ASSISTED mode: recommend but never act.
    if (isAssistedMode(policy)) {
        if (opportunity.confidence < 0.3) {
            return {
                decision: "REVIEW",
                reason: "Low confidence (< 0.3). Requires review.",
                qualified: false,
                requiresApproval: true,
                safeToAutoRun: false,
                queueForApproval: true,
            };
        }
        return {
            decision: "HOLD",
            reason: "ASSISTED mode — recommendation only; awaiting human decision.",
            qualified: true,
            requiresApproval: true,
            safeToAutoRun: false,
            queueForApproval: true,
        };
    }

    // Fallback: low confidence requires review.
    if (opportunity.confidence < 0.3) {
        return {
            decision: "REVIEW",
            reason: "Low confidence (< 0.3). Requires review.",
            qualified: false,
            requiresApproval: true,
            safeToAutoRun: false,
            queueForApproval: true,
        };
    }

    return {
        decision: "QUEUE",
        reason: "Qualified for loop execution.",
        qualified: true,
        requiresApproval: policy.mode === "APPROVAL",
        safeToAutoRun: isAutonomousMode(policy) && opportunity.confidence >= 0.5,
    };
}

export { resolvePolicy, DEFAULT_GROWTH_POLICY };