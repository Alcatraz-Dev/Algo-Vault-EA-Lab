/**
 * Marketing Content Factory — domain types.
 *
 * These are the records persisted to RTDB (`marketingCampaigns`,
 * `marketingCreatives`, `marketingJobs`, `marketingAssets`,
 * `marketingVariants`, `marketingAnalytics`). They mirror the growth engine's
 * record conventions (createdAt/updatedAt/createdBy) so the admin UI and the
 * existing helpers (`deepClean`, `createRecord`, `updateRecord`) work as-is.
 *
 * Pure module: no I/O.
 */
import { MarketingCreativeState, MarketingPipelineStage, MarketingTemplateId } from "./collections";

export type MarketingObjective =
    | "AWARENESS"
    | "TRAFFIC"
    | "REGISTRATION"
    | "SUBSCRIPTION"
    | "MARKETPLACE_SALES"
    | "EDUCATION"
    | "RETENTION";

export type MarketingCampaign = {
    id?: string;
    name: string;
    objective: MarketingObjective;
    audience?: string;
    status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
    channels?: string[];
    startAt?: number;
    endAt?: number;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
};

/** Per-stage snapshot of one pipeline stage's output (stored on the creative). */
export type MarketingStageSnapshot = {
    stage: MarketingPipelineStage;
    agentId: string;
    status: "success" | "failed" | "skipped";
    at: number;
    durationMs: number;
    aiEnhanced?: boolean;
    provider?: string;
    summary?: string;
    warnings?: string[];
    /** Small, trimmed output for the record. Big payloads are referenced by id. */
    output?: Record<string, unknown>;
    retries?: number;
    error?: string;
};

export type MarketingCreative = {
    id?: string;
    campaignId?: string;
    title: string;
    topic: string;
    templateId: MarketingTemplateId;
    feature: string;
    audience: string;
    angle: string;
    tone: string;
    language: string;
    objective: MarketingObjective;
    demoContent: boolean;
    channels: string[];
    state: MarketingCreativeState;
    stages: Record<MarketingPipelineStage, MarketingStageSnapshot>;
    /** Stages the admin explicitly re-ran (per-stage regeneration). */
    regeneratedStages?: MarketingPipelineStage[];
    /** Deterministic asset list chosen for this creative. */
    assetIds?: string[];
    scriptId?: string;
    compliance: {
        passed: boolean;
        blocked?: boolean;
        flags: { rule: string; label: string; severity: string }[];
        riskDisclosureRequired: boolean;
        riskDisclosurePresent: boolean;
        demoLabelPresent: boolean;
        checkedAt?: number;
    };
    rejectReason?: string;
    reviewNotes?: string;
    publish?: { channel: string; externalId?: string; publishedAt: number; url?: string }[];
    publishAttempts?: { channel: string; at: number; ok: boolean; status?: string; error?: string }[];
    runId?: string;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
};

export type MarketingJob = {
    id?: string;
    jobKey: string;
    type: string;
    status: "RUNNING" | "COMPLETED" | "FAILED";
    payload?: Record<string, unknown>;
    result?: JobHandlerResult;
    error?: string;
    startedAt: number;
    finishedAt?: number;
    createdAt: number;
    createdBy: string;
};

export type JobHandlerResult = {
    summary: string;
    counts?: Record<string, number>;
    [key: string]: unknown;
};

/** Persistent record for a staged asset (image/video/audio/overlay). */
export type MarketingAssetRecord = {
    id?: string;
    creativeId?: string;
    kind: "image" | "video" | "audio" | "overlay" | "chart";
    url: string;
    localPath?: string;
    source: string;
    width?: number;
    height?: number;
    durationSec?: number;
    sizeBytes?: number;
    mime?: string;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
};

export type MarketingVariant = {
    id?: string;
    creativeId: string;
    stage: string;
    kind: "hook" | "cta" | "caption" | "copy" | "script";
    index: number;
    text: string;
    seed: string;
    aiEnhanced?: boolean;
    provider?: string;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
};

export type MarketingAnalyticsEvent = {
    id?: string;
    creativeId?: string;
    campaignId?: string;
    eventType: "impression" | "click" | "conversion" | "view" | "download" | "publish" | "fail";
    channel?: string;
    value?: number;
    meta?: Record<string, unknown>;
    createdAt: number;
    createdBy: string;
};

/** Transition map for the creative state machine. */
export const MARKETING_CREATIVE_TRANSITIONS: Record<MarketingCreativeState, MarketingCreativeState[]> = {
    DRAFT: ["GENERATING", "REJECTED"],
    GENERATING: ["READY_FOR_REVIEW", "FAILED"],
    READY_FOR_REVIEW: ["APPROVED", "GENERATING", "REJECTED", "FAILED"],
    APPROVED: ["PUBLISHED", "READY_FOR_REVIEW", "REJECTED"],
    PUBLISHED: ["READY_FOR_REVIEW", "REJECTED"],
    FAILED: ["GENERATING", "READY_FOR_REVIEW", "REJECTED"],
    REJECTED: ["DRAFT", "GENERATING"],
};

export function canTransitionCreative(from: MarketingCreativeState, to: MarketingCreativeState): { ok: boolean; reason?: string } {
    if (from === to) return { ok: true };
    if (MARKETING_CREATIVE_TRANSITIONS[from]?.includes(to)) return { ok: true };
    return { ok: false, reason: `Cannot transition creative from ${from} to ${to}.` };
}