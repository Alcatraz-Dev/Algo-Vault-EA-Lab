/**
 * AlgoVault Growth & Monetization Engine — shared enums and constants.
 *
 * Pure module: no I/O, no firebase imports. Safe to import from tests,
 * validators and any environment.
 */

// ─── Monetization ────────────────────────────────────────────────────────────

/** Logical ad placements. Custom, non-intrusive, integrated into AlgoVault UI. */
export const PLACEMENT_TYPES = [
    "HOME_NATIVE",
    "MARKETPLACE_NATIVE",
    "MARKETPLACE_SPONSORED",
    "BLOG_NATIVE",
    "SIGNALS_NATIVE",
    "DASHBOARD_NATIVE",
    "SIDEBAR",
    "FOOTER",
] as const;

export type PlacementType = (typeof PLACEMENT_TYPES)[number];

export const PLACEMENT_LABELS: Record<PlacementType, string> = {
    HOME_NATIVE: "Home (native)",
    MARKETPLACE_NATIVE: "Marketplace (native)",
    MARKETPLACE_SPONSORED: "Marketplace (sponsored)",
    BLOG_NATIVE: "Blog (native)",
    SIGNALS_NATIVE: "Signals (native)",
    DASHBOARD_NATIVE: "Dashboard (native)",
    SIDEBAR: "Sidebar",
    FOOTER: "Footer",
};

/** Monetization sub-types recorded into monetizationRevenue. */
export const REVENUE_TYPES = ["AD", "SPONSORED", "AFFILIATE", "SUBSCRIPTION", "MARKETPLACE"] as const;
export type RevenueType = (typeof REVENUE_TYPES)[number];

export const REVENUE_LABELS: Record<RevenueType, string> = {
    AD: "Ad revenue",
    SPONSORED: "Sponsored revenue",
    AFFILIATE: "Affiliate revenue",
    SUBSCRIPTION: "Subscription revenue",
    MARKETPLACE: "Marketplace revenue",
};

export const AD_TYPES = ["NATIVE", "BANNER", "SPONSORED_CARD"] as const;
export type AdType = (typeof AD_TYPES)[number];

/** How premium users are treated for a placement. */
export const PREMIUM_AD_MODES = ["SHOW", "REDUCED", "HIDE"] as const;
export type PremiumAdMode = (typeof PREMIUM_AD_MODES)[number];

/** Frequency cap granularity. */
export const FREQUENCY_CAP_TYPES = ["PER_SESSION", "PER_DAY"] as const;
export type FrequencyCapType = (typeof FREQUENCY_CAP_TYPES)[number];

export type FrequencyCap = {
    type: FrequencyCapType;
    limit: number;
};

// ─── Campaigns ───────────────────────────────────────────────────────────────

export const CAMPAIGN_OBJECTIVES = [
    "AWARENESS",
    "TRAFFIC",
    "REGISTRATION",
    "SUBSCRIPTION",
    "MARKETPLACE_SALES",
    "AFFILIATE_REVENUE",
    "RETENTION",
] as const;

export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

export const CAMPAIGN_OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
    AWARENESS: "Awareness",
    TRAFFIC: "Traffic",
    REGISTRATION: "Registrations",
    SUBSCRIPTION: "Subscriptions",
    MARKETPLACE_SALES: "Marketplace sales",
    AFFILIATE_REVENUE: "Affiliate revenue",
    RETENTION: "Retention",
};

export const CAMPAIGN_STATUSES = [
    "DRAFT",
    "ACTIVE",
    "PAUSED",
    "COMPLETED",
    "ARCHIVED",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// ─── AI Marketing tasks ──────────────────────────────────────────────────────

export const MARKETING_TASK_STATES = [
    "DRAFT",
    "GENERATING",
    "READY_FOR_REVIEW",
    "APPROVED",
    "SCHEDULED",
    "PUBLISHED",
    "FAILED",
    "REJECTED",
] as const;

export type MarketingTaskState = (typeof MARKETING_TASK_STATES)[number];

export const MARKETING_TASK_STATE_LABELS: Record<MarketingTaskState, string> = {
    DRAFT: "Draft",
    GENERATING: "Generating",
    READY_FOR_REVIEW: "Ready for review",
    APPROVED: "Approved",
    SCHEDULED: "Scheduled",
    PUBLISHED: "Published",
    FAILED: "Failed",
    REJECTED: "Rejected",
};

export const CONTENT_TYPES = [
    "X_POST",
    "LINKEDIN_POST",
    "INSTAGRAM_CAPTION",
    "SHORT_VIDEO_SCRIPT",
    "YOUTUBE_SCRIPT",
    "BLOG_POST",
    "SEO_ARTICLE",
    "EMAIL_CAMPAIGN",
    "DISCORD_ANNOUNCEMENT",
    "EDUCATIONAL_CONTENT",
    "PRODUCT_ANNOUNCEMENT",
    "FEATURE_ANNOUNCEMENT",
    "MARKETPLACE_PROMOTION",
    "AFFILIATE_CONTENT",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
    X_POST: "X post",
    LINKEDIN_POST: "LinkedIn post",
    INSTAGRAM_CAPTION: "Instagram caption",
    SHORT_VIDEO_SCRIPT: "Short-form video script",
    YOUTUBE_SCRIPT: "YouTube script",
    BLOG_POST: "Blog post",
    SEO_ARTICLE: "SEO article",
    EMAIL_CAMPAIGN: "Email campaign",
    DISCORD_ANNOUNCEMENT: "Discord announcement",
    EDUCATIONAL_CONTENT: "Educational content",
    PRODUCT_ANNOUNCEMENT: "Product announcement",
    FEATURE_ANNOUNCEMENT: "Feature announcement",
    MARKETPLACE_PROMOTION: "Marketplace promotion",
    AFFILIATE_CONTENT: "Affiliate content",
};

// ─── Social channels ─────────────────────────────────────────────────────────

export const CHANNEL_TYPES = [
    "X",
    "INSTAGRAM",
    "FACEBOOK",
    "LINKEDIN",
    "YOUTUBE",
    "TIKTOK",
    "DISCORD",
    "EMAIL",
    "BLOG",
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CHANNEL_LABELS: Record<ChannelType, string> = {
    X: "X (Twitter)",
    INSTAGRAM: "Instagram",
    FACEBOOK: "Facebook",
    LINKEDIN: "LinkedIn",
    YOUTUBE: "YouTube",
    TIKTOK: "TikTok",
    DISCORD: "Discord",
    EMAIL: "Email",
    BLOG: "Blog",
};

/** Configuration state of a channel adapter from the frontend's perspective. */
export const CHANNEL_CONFIG_STATES = [
    "NOT_CONFIGURED",
    "CONFIGURED",
    "ERROR",
    "DISABLED",
] as const;

export type ChannelConfigState = (typeof CHANNEL_CONFIG_STATES)[number];

export const CHANNEL_CONFIG_STATE_LABELS: Record<ChannelConfigState, string> = {
    NOT_CONFIGURED: "Not configured",
    CONFIGURED: "Configured",
    ERROR: "Configuration error",
    DISABLED: "Disabled",
};

// ─── Affiliates ──────────────────────────────────────────────────────────────

export const AFFILIATE_CATEGORIES = [
    "TRADING_TOOL",
    "VPS",
    "BROKER",
    "DATA",
    "AI_TOOL",
    "EDUCATION",
    "SOFTWARE",
    "API",
    "OTHER",
] as const;

export type AffiliateCategory = (typeof AFFILIATE_CATEGORIES)[number];

export const AFFILIATE_CATEGORY_LABELS: Record<AffiliateCategory, string> = {
    TRADING_TOOL: "Trading tool",
    VPS: "VPS",
    BROKER: "Broker",
    DATA: "Data",
    AI_TOOL: "AI tool",
    EDUCATION: "Education",
    SOFTWARE: "Software",
    API: "API",
    OTHER: "Other",
};

export const COMMISSION_MODELS = [
    "PERCENTAGE",
    "FIXED",
    "CPA",
    "CPL",
    "REVENUE_SHARE",
] as const;

export type CommissionModel = (typeof COMMISSION_MODELS)[number];

export const COMMISSION_MODEL_LABELS: Record<CommissionModel, string> = {
    PERCENTAGE: "Percentage",
    FIXED: "Fixed",
    CPA: "CPA",
    CPL: "CPL",
    REVENUE_SHARE: "Revenue share",
};

// ─── Workflow nodes ──────────────────────────────────────────────────────────

export const MARKETING_WORKFLOW_ACTIONS = [
    "TRIGGER_MARKETING",
    "AI_RESEARCH",
    "AI_CONTENT",
    "AI_SEO",
    "AI_SOCIAL",
    "AI_COMPLIANCE",
    "AI_APPROVAL",
    "SOCIAL_PUBLISH",
    "EMAIL_SEND",
    "DISCORD_SEND",
    "BLOG_PUBLISH",
    "TRACK_CAMPAIGN",
    "ANALYZE_CAMPAIGN",
    "OPTIMIZE_CAMPAIGN",
    "GENERATE_REPORT",
] as const;

export type MarketingWorkflowAction = (typeof MARKETING_WORKFLOW_ACTIONS)[number];

// ─── Reports ─────────────────────────────────────────────────────────────────

export const REPORT_INTERVALS = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type ReportInterval = (typeof REPORT_INTERVALS)[number];

// ─── Audit ───────────────────────────────────────────────────────────────────

export const GROWTH_AUDIT_ACTIONS = [
    "campaign_created",
    "campaign_updated",
    "campaign_status_changed",
    "content_generated",
    "content_approved",
    "content_rejected",
    "content_published",
    "content_scheduled",
    "task_state_changed",
    "affiliate_created",
    "affiliate_updated",
    "affiliate_deleted",
    "affiliate_conversion_recorded",
    "placement_created",
    "placement_updated",
    "placement_deleted",
    "ad_created",
    "ad_updated",
    "ad_deleted",
    "sponsor_created",
    "sponsor_updated",
    "sponsor_deleted",
    "channel_connected",
    "channel_disconnected",
    "channel_updated",
    "automation_enabled",
    "automation_disabled",
    "optimization_applied",
    "recommendation_approved",
    "recommendation_rejected",
    "report_generated",
    "experiment_created",
    "experiment_updated",
    "revenue_recorded",
    "publish_blocked",
] as const;

export type GrowthAuditAction = (typeof GROWTH_AUDIT_ACTIONS)[number];

// ─── Optimization recommendations ────────────────────────────────────────────

export const RECOMMENDATION_STATUSES = [
    "PENDING",
    "APPROVED",
    "REJECTED",
    "APPLIED",
] as const;

export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const RECOMMENDATION_MODES = [
    "RECOMMENDATION_ONLY",
    "AUTO_OPTIMIZE",
] as const;

export type RecommendationMode = (typeof RECOMMENDATION_MODES)[number];

export const RECOMMENDATION_KINDS = [
    "CONTENT_TOPIC",
    "POSTING_TIME",
    "CHANNEL",
    "FORMAT",
    "CAMPAIGN_CHANGE",
    "AFFILIATE_PLACEMENT",
    "MONETIZATION_PLACEMENT",
] as const;

export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

// ─── Experiments ─────────────────────────────────────────────────────────────

export const EXPERIMENT_STATUSES = ["DRAFT", "RUNNING", "COMPLETED", "ARCHIVED"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

// ─── Places / sources ────────────────────────────────────────────────────────

export const GROWTH_SOURCES = [
    "MANUAL",
    "AI_WORKFLOW",
    "SCHEDULED_JOB",
    "IMPORT",
    "API",
] as const;

export type GrowthSource = (typeof GROWTH_SOURCES)[number];

/** Attribution medium for campaign/affiliate tracking. */
export const ATTRIBUTION_MEDIUMS = [
    "organic",
    "paid",
    "social",
    "email",
    "referral",
    "affiliate",
    "banner",
    "sponsored",
    "direct",
] as const;

export type AttributionMedium = (typeof ATTRIBUTION_MEDIUMS)[number];

// Realtime DB collection names (single source of truth).
export const GROWTH_COLLECTIONS = {
    campaigns: "growthCampaigns",
    content: "growthContent",
    channels: "growthChannels",
    experiments: "growthExperiments",
    events: "growthEvents",
    metrics: "growthMetrics",
    reports: "growthReports",
    placements: "monetizationPlacements",
    ads: "monetizationAds",
    sponsors: "monetizationSponsors",
    revenue: "monetizationRevenue",
    settings: "monetizationSettings",
    affiliatePrograms: "affiliatePrograms",
    affiliateOffers: "affiliate_offers",
    affiliateClicks: "affiliate_clicks",
    affiliateConversions: "affiliateConversions",
    affiliateRevenue: "affiliateRevenue",
    tasks: "aiMarketingTasks",
    runs: "aiMarketingRuns",
    approvals: "aiMarketingApprovals",
    auditLogs: "growthAuditLogs",
    jobs: "growthJobs",
    recommendations: "growthRecommendations",
    opportunities: "growthOpportunities",
    growthApprovals: "growthApprovals",
    loopExecutions: "growthLoopExecutions",
    fatigueSignals: "growthFatigueSignals",
    feedback: "growthFeedback",
    policies: "growthPolicies",
} as const;

/** Default cooldown (ms) between detecting the same dedup-keyed opportunity. */
export const DEFAULT_OPPORTUNITY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Default expiration (ms) for an opportunity that never advances. */
export const DEFAULT_OPPORTUNITY_EXPIRATION_MS = 14 * 24 * 60 * 60 * 1000;
/** Minimum impressions before a fatigue signal is considered meaningful. */
export const FATIGUE_MIN_IMPRESSIONS = 20;
/** CTR threshold below which content is considered fatigued. */
export const FATIGUE_CTR_THRESHOLD = 0.01;
/** Minimum sample size (impressions) before an experiment may declare a winner. */
export const EXPERIMENT_MIN_SAMPLE_SIZE = 50;
/** Minimum relative uplift (percent) for an experiment to declare a winner. */
export const EXPERIMENT_MIN_UPLIFT_PCT = 5;

export const RISK_DISCLOSURE_TEXT =
    "Risk disclosure: Trading CFDs, forex, and other leveraged instruments carries a high level of risk and may not be suitable for all investors. Past performance is not indicative of future results. Never risk more than you can afford to lose. This content is for informational purposes only and does not constitute financial advice.";

export const RECOMMENDATION_REVIEW_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days