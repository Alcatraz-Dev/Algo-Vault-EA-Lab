/**
 * Marketing Agent — RTDB collection names, task vocabulary and factory-wide
 * constants.
 *
 * Pure module: no I/O, no firebase imports. Safe to import from tests,
 * validators and the workflow registry.
 *
 * Reuse rules (see docs/marketing-agent/architecture.md §1):
 *  - Campaigns, creatives, assets, text variants, analytics and leaf jobs are
 *    owned by the existing Marketing Content Factory
 *    (`lib/marketing-media/collections.ts`). This module NEVER redeclares them.
 *  - Only genuinely new entities live here: the resumable agent task graph,
 *    plans, browser captures, versions/lineage, publishing jobs, schedules,
 *    social accounts, performance snapshots, learning observations, claims and
 *    reusable creative recipes.
 */

export const MARKETING_AGENT_COLLECTIONS = {
  jobs: "marketingAgentJobs",
  plans: "marketingPlans",
  browserCaptures: "marketingBrowserCaptures",
  creativeVersions: "marketingCreativeVersions",
  publishingJobs: "marketingPublishingJobs",
  schedules: "marketingSchedules",
  socialAccounts: "marketingSocialAccounts",
  performance: "marketingPerformance",
  learning: "marketingLearning",
  claims: "marketingClaims",
  recipes: "marketingCreativeRecipes",
} as const;

export type MarketingAgentCollectionName =
  (typeof MARKETING_AGENT_COLLECTIONS)[keyof typeof MARKETING_AGENT_COLLECTIONS];

// ─── Agent modes ─────────────────────────────────────────────────────────────

/**
 * MANUAL     — the agent prepares everything; a human publishes.
 * ASSISTED   — the agent prepares everything; a human approves; the system
 *              schedules/publishes.
 * AUTONOMOUS — the agent may generate/schedule/publish inside admin-configured
 *              rules (compliance, approved claims, platform permissions,
 *              budget and campaign boundaries still apply).
 */
export const MARKETING_AGENT_MODES = ["MANUAL", "ASSISTED", "AUTONOMOUS"] as const;
export type MarketingAgentMode = (typeof MARKETING_AGENT_MODES)[number];

export const MARKETING_AGENT_MODE_LABELS: Record<MarketingAgentMode, string> = {
  MANUAL: "Manual",
  ASSISTED: "Assisted",
  AUTONOMOUS: "Autonomous",
};

/** Approval policy for a campaign (§40). */
export const MARKETING_APPROVAL_POLICIES = [
  "ALWAYS_REQUIRED",
  "REQUIRED_FOR_TRADING_CLAIMS",
  "REQUIRED_FOR_NEW_CAMPAIGN",
  "AUTO_APPROVE_TEMPLATE",
  "AUTO_APPROVE_ALL",
] as const;
export type MarketingApprovalPolicy = (typeof MARKETING_APPROVAL_POLICIES)[number];

export const MARKETING_APPROVAL_POLICY_LABELS: Record<MarketingApprovalPolicy, string> = {
  ALWAYS_REQUIRED: "Always require approval",
  REQUIRED_FOR_TRADING_CLAIMS: "Require approval for trading claims",
  REQUIRED_FOR_NEW_CAMPAIGN: "Require approval for new campaigns",
  AUTO_APPROVE_TEMPLATE: "Auto-approve approved template + approved claims",
  AUTO_APPROVE_ALL: "Auto-approve everything",
};

// ─── Task graph (§4) ─────────────────────────────────────────────────────────

/**
 * The canonical Marketing Agent task graph. Order is meaningful: it is both
 * the execution order and the UI progress timeline (§43).
 *
 * Tasks are added to a run conditionally (a run without a browser demo never
 * receives `capture_product`), but ids are stable so a resumed run always
 * knows where it stopped.
 */
export const MARKETING_AGENT_TASKS = [
  "understand_request",
  "identify_product",
  "identify_audience",
  "identify_platforms",
  "determine_duration",
  "verify_product_facts",
  "build_capture_plan",
  "build_creative_brief",
  "write_script",
  "write_shot_list",
  "capture_product",
  "generate_assets",
  "compose_video",
  "add_audio",
  "add_captions",
  "add_motion",
  "apply_branding",
  "apply_disclaimer",
  "render_platforms",
  "run_qa",
  "generate_publishing_assets",
  "request_approval",
  "schedule",
  "publish",
  "verify_publication",
  "collect_performance",
  "generate_learning",
] as const;

export type MarketingAgentTaskId = (typeof MARKETING_AGENT_TASKS)[number];

export const MARKETING_AGENT_TASK_LABELS: Record<MarketingAgentTaskId, string> = {
  understand_request: "Understanding request",
  identify_product: "Identifying product",
  identify_audience: "Identifying audience",
  identify_platforms: "Identifying platforms",
  determine_duration: "Determining duration",
  verify_product_facts: "Verifying product facts",
  build_capture_plan: "Preparing browser demo",
  build_creative_brief: "Building creative brief",
  write_script: "Writing script",
  write_shot_list: "Building shot list",
  capture_product: "Capturing product",
  generate_assets: "Generating assets",
  compose_video: "Building video",
  add_audio: "Adding voice & audio",
  add_captions: "Adding captions",
  add_motion: "Adding motion graphics",
  apply_branding: "Applying brand identity",
  apply_disclaimer: "Applying disclaimer",
  render_platforms: "Rendering platform versions",
  run_qa: "Running QA",
  generate_publishing_assets: "Preparing publication",
  request_approval: "Requesting approval",
  schedule: "Scheduling",
  publish: "Publishing",
  verify_publication: "Verifying publication",
  collect_performance: "Collecting performance",
  generate_learning: "Generating learning",
};

export const MARKETING_AGENT_TASK_STATES = [
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "SKIPPED",
  "BLOCKED",
] as const;
export type MarketingAgentTaskState = (typeof MARKETING_AGENT_TASK_STATES)[number];

/** Job/run lifecycle. */
export const MARKETING_AGENT_JOB_STATES = [
  "CREATED",
  "RUNNING",
  "PAUSED",
  "AWAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type MarketingAgentJobState = (typeof MARKETING_AGENT_JOB_STATES)[number];

export const MARKETING_AGENT_JOB_STATE_LABELS: Record<MarketingAgentJobState, string> = {
  CREATED: "Created",
  RUNNING: "Running",
  PAUSED: "Paused",
  AWAITING_APPROVAL: "Awaiting approval",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

// ─── Publishing state machine (§28) ──────────────────────────────────────────

export const PUBLISHING_STATES = [
  "DRAFT",
  "READY",
  "SCHEDULED",
  "QUEUED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "RETRYING",
  "CANCELLED",
  "EXPIRED",
  "PUBLISH_VERIFICATION_REQUIRED",
  "NOT_SUPPORTED",
] as const;
export type PublishingState = (typeof PUBLISHING_STATES)[number];

export const PUBLISHING_STATE_LABELS: Record<PublishingState, string> = {
  DRAFT: "Draft",
  READY: "Ready",
  SCHEDULED: "Scheduled",
  QUEUED: "Queued",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  FAILED: "Failed",
  RETRYING: "Retrying",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  PUBLISH_VERIFICATION_REQUIRED: "Verification required",
  NOT_SUPPORTED: "Not supported",
};

/** Only these transitions are legal (§28).
 *
 * Notes on the non-obvious entries:
 *  - READY/SCHEDULED/QUEUED → PUBLISH_VERIFICATION_REQUIRED: an idempotency
 *    key already published an identical post, so the job must be verified
 *    against the platform rather than submitted again (§29).
 *  - … → NOT_SUPPORTED: the connector declared the operation unsupported
 *    (§64) — the job parks in a terminal state instead of pretending.
 */
export const PUBLISHING_TRANSITIONS: Record<PublishingState, PublishingState[]> = {
  DRAFT: ["READY", "CANCELLED"],
  READY: ["SCHEDULED", "QUEUED", "CANCELLED", "FAILED", "PUBLISH_VERIFICATION_REQUIRED", "NOT_SUPPORTED"],
  SCHEDULED: ["QUEUED", "CANCELLED", "EXPIRED", "FAILED", "PUBLISH_VERIFICATION_REQUIRED", "NOT_SUPPORTED"],
  QUEUED: ["PUBLISHING", "CANCELLED", "FAILED", "RETRYING", "PUBLISH_VERIFICATION_REQUIRED", "NOT_SUPPORTED"],
  PUBLISHING: ["PUBLISHED", "FAILED", "RETRYING", "PUBLISH_VERIFICATION_REQUIRED", "NOT_SUPPORTED"],
  PUBLISHED: ["PUBLISH_VERIFICATION_REQUIRED"],
  RETRYING: ["QUEUED", "PUBLISHING", "FAILED", "CANCELLED"],
  FAILED: ["RETRYING", "QUEUED", "CANCELLED"],
  CANCELLED: [],
  EXPIRED: ["CANCELLED"],
  PUBLISH_VERIFICATION_REQUIRED: ["PUBLISHED", "FAILED", "RETRYING"],
  NOT_SUPPORTED: [],
};

/** Terminal-ish states a job may never leave. */
export const PUBLISHING_TERMINAL_STATES: PublishingState[] = ["CANCELLED", "EXPIRED", "NOT_SUPPORTED"];

// ─── Social account connection state (§30) ───────────────────────────────────

export const SOCIAL_ACCOUNT_STATES = [
  "CONNECTED",
  "EXPIRING",
  "RECONNECT_REQUIRED",
  "DISCONNECTED",
  "ERROR",
] as const;
export type SocialAccountState = (typeof SOCIAL_ACCOUNT_STATES)[number];

export const SOCIAL_ACCOUNT_STATE_LABELS: Record<SocialAccountState, string> = {
  CONNECTED: "Connected",
  EXPIRING: "Expiring",
  RECONNECT_REQUIRED: "Reconnect required",
  DISCONNECTED: "Disconnected",
  ERROR: "Error",
};

// ─── Browser capture ─────────────────────────────────────────────────────────

export const BROWSER_CAPTURE_STATES = [
  "PLANNED",
  "RUNNING",
  "CAPTURED",
  "STALE",
  "FAILED",
  "CANCELLED",
] as const;
export type BrowserCaptureState = (typeof BROWSER_CAPTURE_STATES)[number];

export const BROWSER_CAPTURE_STATE_LABELS: Record<BrowserCaptureState, string> = {
  PLANNED: "Planned",
  RUNNING: "Capturing",
  CAPTURED: "Captured",
  STALE: "Stale",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/** A capture is marked STALE after this long unless its fingerprint changes. */
export const BROWSER_CAPTURE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Data classification (§50) ───────────────────────────────────────────────

export const PRODUCT_DATA_CLASSIFICATIONS = [
  "VERIFIED",
  "UNVERIFIED",
  "SENSITIVE",
  "PRIVATE",
  "MARKETING_SAFE",
] as const;
export type ProductDataClassification = (typeof PRODUCT_DATA_CLASSIFICATIONS)[number];

// ─── Tool permissions (§48) ──────────────────────────────────────────────────

export const MARKETING_AGENT_TOOLS = [
  "marketing.searchProduct",
  "marketing.openProductPage",
  "marketing.captureBrowser",
  "marketing.generateScript",
  "marketing.generateAssets",
  "marketing.createHypitProject",
  "marketing.renderCreative",
  "marketing.generateVariants",
  "marketing.runQualityCheck",
  "marketing.preparePublication",
  "marketing.schedule",
  "marketing.publish",
  "marketing.verifyPublication",
  "marketing.getAnalytics",
  "marketing.generateInsights",
] as const;
export type MarketingAgentToolId = (typeof MARKETING_AGENT_TOOLS)[number];

/**
 * Which agent modes may invoke each tool. Every tool is authenticated, timed
 * out and audited regardless of this table (§47/§48).
 */
export const MARKETING_AGENT_TOOL_MODES: Record<MarketingAgentToolId, MarketingAgentMode[]> = {
  "marketing.searchProduct": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.openProductPage": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.captureBrowser": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.generateScript": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.generateAssets": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.createHypitProject": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.renderCreative": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.generateVariants": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.runQualityCheck": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.preparePublication": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.schedule": ["ASSISTED", "AUTONOMOUS"],
  "marketing.publish": ["AUTONOMOUS"],
  "marketing.verifyPublication": ["ASSISTED", "AUTONOMOUS"],
  "marketing.getAnalytics": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
  "marketing.generateInsights": ["MANUAL", "ASSISTED", "AUTONOMOUS"],
};

// ─── Defaults / limits (§46) ─────────────────────────────────────────────────

export const MARKETING_AGENT_DEFAULTS = {
  /** Max number of renders a single request may plan (videos × variants × languages × platforms). */
  maxProductionUnits: 48,
  /** Max hook/CTA variants per creative. */
  maxVariants: 10,
  /** Max agent jobs per UTC day per workspace. */
  maxDailyJobs: 40,
  /** Max concurrent production jobs. */
  maxConcurrentJobs: 3,
  /** Max retries for any external operation. */
  maxRetries: 4,
  /** Base backoff for exponential retry (ms). */
  retryBaseMs: 1500,
  /** Hard timeout for a single tool invocation (ms). */
  toolTimeoutMs: 60_000,
  /** Longest single production task (ms) before it is considered hung. */
  taskTimeoutMs: 15 * 60 * 1000,
  /** Browser capture plan step budget. */
  maxCaptureSteps: 24,
  /** Minimum seconds between two publishes to the same platform account. */
  publishMinIntervalMs: 45_000,
} as const;

// ─── Supported languages (§21) ───────────────────────────────────────────────

export const MARKETING_LANGUAGES = ["en", "fr", "ar"] as const;
export type MarketingLanguage = (typeof MARKETING_LANGUAGES)[number];

export const MARKETING_LANGUAGE_LABELS: Record<MarketingLanguage, string> = {
  en: "English",
  fr: "French",
  ar: "Arabic",
};

// ─── Platforms / aspect ratios (§19) ────────────────────────────────────────

export const MARKETING_PLATFORMS = [
  "TIKTOK",
  "INSTAGRAM_REELS",
  "INSTAGRAM_STORIES",
  "INSTAGRAM_FEED",
  "YOUTUBE_SHORTS",
  "YOUTUBE",
  "FACEBOOK",
  "LINKEDIN",
  "X",
] as const;
export type MarketingPlatform = (typeof MARKETING_PLATFORMS)[number];

export const MARKETING_PLATFORM_LABELS: Record<MarketingPlatform, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM_REELS: "Instagram Reels",
  INSTAGRAM_STORIES: "Instagram Stories",
  INSTAGRAM_FEED: "Instagram Feed",
  YOUTUBE_SHORTS: "YouTube Shorts",
  YOUTUBE: "YouTube",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  X: "X",
};

export type MarketingAspectRatio = "9:16" | "1:1" | "4:5" | "16:9";

/** Canonical aspect ratio per platform. Recomposition (never stretch/crop). */
export const PLATFORM_ASPECT_RATIOS: Record<MarketingPlatform, MarketingAspectRatio> = {
  TIKTOK: "9:16",
  INSTAGRAM_REELS: "9:16",
  INSTAGRAM_STORIES: "9:16",
  INSTAGRAM_FEED: "4:5",
  YOUTUBE_SHORTS: "9:16",
  YOUTUBE: "16:9",
  FACEBOOK: "16:9",
  LINKEDIN: "16:9",
  X: "16:9",
};

// ─── Feature flag names (§90) ────────────────────────────────────────────────

export const MARKETING_AGENT_FLAGS = [
  "marketingAgentEnabled",
  "marketingAgentAutonomousEnabled",
  "marketingAgentBrowserCaptureEnabled",
  "marketingAgentHypitEnabled",
  "marketingAgentPublishingEnabled",
] as const;
export type MarketingAgentFlag = (typeof MARKETING_AGENT_FLAGS)[number];

export const MARKETING_AGENT_FLAG_LABELS: Record<MarketingAgentFlag, string> = {
  marketingAgentEnabled: "Marketing Agent enabled",
  marketingAgentAutonomousEnabled: "Autonomous mode enabled",
  marketingAgentBrowserCaptureEnabled: "Browser capture enabled",
  marketingAgentHypitEnabled: "Hypit production enabled",
  marketingAgentPublishingEnabled: "Publishing enabled",
};
