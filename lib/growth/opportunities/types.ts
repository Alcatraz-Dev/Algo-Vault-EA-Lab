/**
 * Growth Engine — opportunity types (Phase 3 core).
 *
 * Adds persistence/dedup/cooldown/expiration fields to GrowthOpportunity and
 * declares the per-stage execution records, compliance verdicts and approval
 * queue operations consumed by the loop runner.
 */

import { GrowthRecord } from "../types";

export const OPPORTUNITY_TYPES = [
    "CONTENT_GAP",
    "CONTENT_REFRESH",
    "CHANNEL_EXPANSION",
    "CONVERSION_IMPROVEMENT",
    "AFFILIATE_OPPORTUNITY",
    "MARKETPLACE_PROMOTION",
    "SEO_OPPORTUNITY",
    "MONETIZATION_OPPORTUNITY",
    "FATIGUE",
    "EXPERIMENT",
] as const;

export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export type OpportunityEvidence = {
    metric: string;
    value: number | string;
    period?: string;
    source: string;
};

/** Deterministic key used to dedupe opportunities across scans. */
export type OpportunityDedupKey = {
    type: OpportunityType;
    fingerprint: string;
};

/** Stage-level execution record persisted alongside a loop execution. */
export type StageRecord = {
    stage: string;
    agentId?: string;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED" | "BLOCKED";
    startedAt: number;
    finishedAt?: number;
    durationMs?: number;
    output?: Record<string, unknown>;
    error?: string;
    /** Compliance verdict attached to the stage, when applicable. */
    compliance?: {
        passed: boolean;
        blocked?: boolean;
        flags?: { rule: string; label: string; severity: string }[];
    };
};

/** Compliance verdict enforced by the loop before any action node runs. */
export type ComplianceVerdict = {
    passed: boolean;
    blocked: boolean;
    flags: { rule: string; label: string; severity: "high" | "medium" | "low" }[];
    requiresRiskDisclosure: boolean;
    riskDisclosurePresent: boolean;
    tradingContext: boolean;
    reviewedAt: number;
    reviewedBy: string;
};

/** Approval queue operations supported by the growth loop. */
export type ApprovalOperation =
    | { op: "SUBMIT"; opportunityId: string; submittedBy: string; submittedAt: number; reason?: string }
    | { op: "APPROVE"; opportunityId: string; decidedBy: string; decidedAt: number; comment?: string }
    | { op: "REJECT"; opportunityId: string; decidedBy: string; decidedAt: number; reason: string }
    | { op: "ESCALATE"; opportunityId: string; escalatedBy: string; escalatedAt: number; reason: string };

export type ApprovalQueueEntry = GrowthRecord & {
    opportunityId: string;
    decision: "PENDING" | "APPROVED" | "REJECTED" | "ESCALATED";
    submittedBy: string;
    submittedAt: number;
    decidedBy?: string;
    decidedAt?: number;
    comment?: string;
    reason?: string;
    /** Human-readable summary shown in the approvals UI. */
    summary: string;
};

export type GrowthOpportunity = GrowthRecord & {
    type: OpportunityType;
    source: string;
    title: string;
    description: string;
    evidence: OpportunityEvidence[];
    confidence: number | null; // 0..1; null if insufficient evidence
    impact: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
    status:
        | "DETECTED"
        | "QUALIFIED"
        | "QUEUED"
        | "APPROVAL_REQUIRED"
        | "RUNNING"
        | "COMPLETED"
        | "REJECTED"
        | "EXPIRED"
        | "FAILED";
    recommendedAction: string;
    workflowId?: string;
    executionId?: string;
    // ── Phase 3 persistence / lifecycle fields ──────────────────────────────
    /** Deterministic dedup fingerprint (type + hash of stable identifiers). */
    dedupKey?: string;
    /** Timestamps when this opportunity was detected before (for cooldown). */
    detectedAtHistory?: number[];
    /** Cooldown until the same dedup key may be re-detected (ms). */
    cooldownUntil?: number;
    /** Hard expiration timestamp; opportunity auto-expires if not advanced. */
    expiresAt?: number;
    /** Approval queue record id when this opportunity is awaiting a decision. */
    approvalId?: string;
    /** Compliance verdict attached when the opportunity reached review. */
    compliance?: ComplianceVerdict;
    /** Per-stage execution records for the last loop run. */
    stageRecords?: StageRecord[];
    /** Optional feedback summary linking outcomes back into future detection. */
    feedbackSummary?: string;
};