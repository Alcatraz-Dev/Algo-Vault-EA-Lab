/**
 * AlgoVault Growth & Monetization Engine — shared types.
 *
 * Every Realtime Database record in the Growth domain follows the common
 * envelope: createdAt, updatedAt, createdBy, status (+ optional
 * organizationId, campaignId, workflowId, source, metadata).
 */
import {
    AffiliateCategory,
    CampaignObjective,
    CampaignStatus,
    ChannelConfigState,
    ChannelType,
    CommissionModel,
    ContentType,
    FrequencyCap,
    GrowthAuditAction,
    GrowthSource,
    MarketingTaskState,
    MarketingWorkflowAction,
    PlacementType,
    PremiumAdMode,
    RecommendationKind,
    RecommendationMode,
    RecommendationStatus,
    ReportInterval,
    RevenueType,
    ExperimentStatus,
} from "./constants";

// ─── Common envelope ─────────────────────────────────────────────────────────

export type GrowthRecord = {
    id?: string;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
    status: string;
    organizationId?: string;
    campaignId?: string;
    workflowId?: string;
    source?: GrowthSource | string;
    metadata?: Record<string, unknown>;
};

// ─── Campaigns ─────────────────────────────────────────────────────────

export type GrowthCampaign = GrowthRecord & {
    name: string;
    objective?: CampaignObjective;
    channels?: ChannelType[];
    title?: string;
    budget?: number;
    spendCap?: number;
    startDate?: number;
    endDate?: number;
    targetingRules?: TargetingRules;
    status?: CampaignStatus;
};

// ─── Monetization ────────────────────────────────────────────────────────────

export type TargetingRules = {
    countries?: string[];
    excludeCountries?: string[];
    devices?: string[];
    excludeDevices?: string[];
    /** Premium user handling for this placement (overrides settings). */
    premium?: { mode: PremiumAdMode; /** For REDUCED: ratio of sessions that still see ads (0..1). */ reductionRatio?: number };
    /** Only show to logged-out visitors. */
    loggedOutOnly?: boolean;
};

export type MonetizationPlacement = GrowthRecord & {
    key: PlacementType;
    name: string;
    description?: string;
    /** Show an ad at most every N page loads (server-side throttle). */
    frequencyCap?: FrequencyCap;
    priority: number;
    targetingRules?: TargetingRules;
    active: boolean;
    startAt?: number;
    endAt?: number;
    maxAds?: number;
};

export type MonetizationAd = GrowthRecord & {
    placementKey?: PlacementType;
    placementIds?: string[];
    title: string;
    body?: string;
    imageUrl?: string;
    ctaLabel?: string;
    targetUrl: string;
    type: "NATIVE" | "BANNER" | "SPONSORED_CARD";
    advertiser?: string;
    disclosure?: string;
    /** Estimated revenue per 1000 impressions — used ONLY as a labelled estimate. */
    eCPM?: number;
    currency?: string;
    priority?: number;
    active: boolean;
    startAt?: number;
    endAt?: number;
    targetingRules?: TargetingRules;
    impressions?: number;
    clicks?: number;
};

export type MonetizationSponsor = GrowthRecord & {
    name: string;
    description?: string;
    logoUrl?: string;
    websiteUrl: string;
    placements?: PlacementType[];
    startAt?: number;
    endAt?: number;
    /** Contracted payout (recorded as revenue when activated). */
    contractedAmount?: number;
    currency?: string;
    active: boolean;
};

export type RevenueEntry = GrowthRecord & {
    type: RevenueType;
    /** "AD" | "SPONSORED" | "AFFILIATE" */
    amount: number;
    currency: string;
    recordedAt: number;
    /** For AFFILIATE: the conversion id etc. */
    sourceId?: string;
    placementKey?: PlacementType;
    offerId?: string;
    campaignId?: string;
    /** True when derived from configured estimates (eCPM) — never mislabelled as real. */
    estimated?: boolean;
};

export type MonetizationSettings = {
    enabled: boolean;
    /** Premium handling default. */
    premiumMode: PremiumAdMode;
    premiumReductionRatio?: number;
    /** Global daily impression cap for anonymous visitors. */
    globalDailyCap?: number;
    /** Currency used for revenue display. */
    currency?: string;
    updatedAt?: number;
    updatedBy?: string;
};

// ─── Affiliates ──────────────────────────────────────────────────────────────

export type AffiliateOffer = GrowthRecord & {
    name: string;
    provider?: string;
    category: AffiliateCategory;
    description?: string;
    /** Public landing page. */
    url: string;
    /** Tracked destination with the partner tags. */
    trackingUrl?: string;
    commissionModel: CommissionModel;
    commissionAmount: number;
    currency?: string;
    disclosure: string;
    /** Where the offer is surfaced. */
    placement?: PlacementType;
    campaignId?: string;
    /** Relevance tags used by AI to select offers (never commission-first). */
    relevanceTags?: string[];
    /** Instructions the AI must follow when recommending this offer. */
    recommendationRules?: string;
    active: boolean;
    featured?: boolean;
    clicks?: number;
    conversions?: number;
};

export type AffiliateClick = {
    id?: string;
    offerId: string;
    campaignId?: string;
    placementKey?: PlacementType;
    uid?: string | null;
    anonymous: boolean;
    clientEventId?: string;
    source?: string;
    medium?: string;
    content?: string;
    userAgent?: string;
    referer?: string;
    country?: string;
    device?: string;
    createdAt: number;
};

export type AffiliateConversion = GrowthRecord & {
    offerId: string;
    clickId?: string;
    uid?: string | null;
    type: "SIGNUP" | "CONVERSION" | "COMMISSION";
    amount?: number;
    currency?: string;
    commission?: number;
    orderId?: string;
    campaignId?: string;
    attributedAt: number;
};

export type AffiliateProgram = GrowthRecord & {
    name: string;
    description?: string;
    terms?: string;
    active: boolean;
};

// ─── Campaigns ───────────────────────────────────────────────────────────────

export type CampaignAudience = {
    countries?: string[];
    channels?: ChannelType[];
    userSegments?: string[];
    excludeCountries?: string[];
};

export type CampaignContentStrategy = {
    topics?: string[];
    tone?: string;
    language?: string;
    contentTypes?: ContentType[];
    cadence?: string;
};

export type Campaign = GrowthRecord & {
    name: string;
    objective: CampaignObjective;
    budget?: number;
    currency?: string;
    startAt?: number;
    endAt?: number;
    channels: ChannelType[];
    audience?: CampaignAudience;
    contentStrategy?: CampaignContentStrategy;
    affiliateOffers?: string[];
    monetizationPlacements?: PlacementType[];
    ownerName?: string;
};

// ─── AI Marketing tasks ──────────────────────────────────────────────────────

export type AIContentBlock = {
    format: "text" | "markdown";
    value: string;
    /** e.g. hashtags, thread parts — optional structured fragments. */
    fragments?: string[];
};

export type MarketingTask = GrowthRecord & {
    type: ContentType;
    title: string;
    topic: string;
    objective?: string;
    audience?: string;
    channels: ChannelType[];
    tone?: string;
    language?: string;
    campaignId?: string;
    state: MarketingTaskState;
    approvalRequired: boolean;
    generatedContent?: Record<string, AIContentBlock>;
    /** Compliance review result. */
    compliance?: {
        passed: boolean;
        flags?: string[];
        riskDisclosureRequired: boolean;
        riskDisclosurePresent: boolean;
        reviewedBy?: string;
        reviewedAt?: number;
    };
    /** Publish details filled when a channel actually accepts the content. */
    publish?: {
        channel: ChannelType;
        externalId?: string;
        publishedAt: number;
        url?: string;
    }[];
    publishAttempts?: {
        channel: ChannelType;
        at: number;
        ok: boolean;
        status?: "NOT_CONFIGURED" | "SUCCESS" | "FAILED" | "BLOCKED";
        error?: string;
    }[];
    scheduledAt?: number;
    rejectReason?: string;
    optimizationRecommendationId?: string;
    runId?: string;
    /** Notes for the reviewer (AI-generated) explaining sources/claims. */
    reviewNotes?: string;
};

export type MarketingRun = GrowthRecord & {
    taskId?: string;
    campaignId?: string;
    workflowId?: string;
    stage: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED";
    stepsCompleted?: string[];
    error?: string;
    startedAt?: number;
    finishedAt?: number;
    /** True when a compliance block stopped the run before actions. */
    blockedByCompliance?: boolean;
};

export type MarketingApproval = GrowthRecord & {
    taskId: string;
    decision: "APPROVED" | "REJECTED";
    approvedBy: string;
    comment?: string;
    decidedAt: number;
};

// ─── Channels ────────────────────────────────────────────────────────────────

export type ChannelConfig = GrowthRecord & {
    type: ChannelType;
    name: string;
    /** Frontend-safe state — never store/expose secrets here. */
    state: ChannelConfigState;
    /** Verified configuration summary (no secrets). */
    summary?: Record<string, string>;
    capabilities: ("generate" | "schedule" | "publish" | "delete" | "analytics")[];
    lastError?: string;
    checkedAt?: number;
    settings?: Record<string, unknown>;
};

// ─── Experiments ─────────────────────────────────────────────────────────────

export type Experiment = GrowthRecord & {
    name: string;
    description?: string;
    hypothesis?: string;
    variantA?: Record<string, unknown>;
    variantB?: Record<string, unknown>;
    variants?: Array<{ id: string; label: string; settings?: Record<string, unknown> }>;
    metric?: string;
    startAt?: number;
    endAt?: number;
    state: ExperimentStatus;
    results?: {
        impressionsA?: number;
        impressionsB?: number;
        conversionsA?: number;
        conversionsB?: number;
        winner?: "A" | "B" | "INCONCLUSIVE";
    };
};

// ─── Events / Metrics ────────────────────────────────────────────────────────

export type GrowthEvent = {
    id?: string;
    type: string;
    placementKey?: PlacementType;
    offerId?: string;
    campaignId?: string;
    channel?: ChannelType;
    uid?: string | null;
    anonymous?: boolean;
    clientEventId?: string;
    value?: number;
    currency?: string;
    country?: string;
    device?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
    createdAt: number;
};

export type GrowthMetric = GrowthRecord & {
    period: string; // "2026-09-22" | "2026-W38" | "2026-09"
    interval: ReportInterval;
    metrics: Record<string, number>;
};

export type GrowthReport = GrowthRecord & {
    title: string;
    interval: ReportInterval;
    periodStart: number;
    periodEnd: number;
    sections: ReportSection[];
    recommendations?: string[];
    generatedBy?: string;
};

export type ReportSection = {
    key: string;
    title: string;
    metrics: { label: string; value: string; delta?: number; tone?: "up" | "down" | "neutral" }[];
    narrative?: string;
    items?: { label: string; value: string }[];
};

// ─── Recommendations ─────────────────────────────────────────────────────────

export type OptimizationRecommendation = GrowthRecord & {
    kind: RecommendationKind;
    title: string;
    description: string;
    rationale?: string;
    status: RecommendationStatus;
    mode: RecommendationMode;
    /** Never critical financial / account / security settings. */
    safeToAutoApply: boolean;
    suggestedChanges?: Record<string, unknown>;
    appliedAt?: number;
    appliedBy?: string;
    data: { periodStart: number; periodEnd: number; sampleSize: number };
    expiresAt?: number;
};

// ─── Jobs ────────────────────────────────────────────────────────────────────

export type GrowthJob = {
    id?: string;
    type: string;
    status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
    /** Idempotency: the same jobKey never runs twice. */
    jobKey: string;
    payload?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: string;
    startedAt?: number;
    finishedAt?: number;
    createdAt: number;
    createdBy?: string;
};

export type AuditLog = {
    id?: string;
    actor: string;
    action: GrowthAuditAction | string;
    targetType?: string;
    targetId?: string;
    detail?: Record<string, unknown>;
    createdAt: number;
};

// ─── Workflow coupling ───────────────────────────────────────────────────────

/** Schema for one marketing workflow node (input/output contract). */
export type WorkflowNodeSchema = {
    action: MarketingWorkflowAction;
    agentId: string;
    label: string;
    description: string;
    input: Record<string, string>;
    output: Record<string, string>;
    /** Nodes that only act on safe, non-critical configuration. */
    requiresAuthorization: boolean;
};

export type AgentOutputMetadata = Record<string, unknown>;

// Helper: state transitions valid for aiMarketingTasks.
export const MARKETING_TASK_TRANSITIONS: Record<
    MarketingTaskState,
    MarketingTaskState[]
> = {
    DRAFT: ["GENERATING", "FAILED", "REJECTED"],
    GENERATING: ["READY_FOR_REVIEW", "FAILED"],
    READY_FOR_REVIEW: ["APPROVED", "REJECTED", "FAILED"],
    APPROVED: ["SCHEDULED", "PUBLISHED", "REJECTED", "FAILED"],
    SCHEDULED: ["PUBLISHED", "FAILED"],
    PUBLISHED: [],
    FAILED: ["DRAFT", "GENERATING", "REJECTED"],
    REJECTED: ["DRAFT", "FAILED"],
};