/**
 * Marketing Agent — domain types.
 *
 * Pure module: no I/O. Records mirror the growth/marketing-factory
 * conventions (createdAt/updatedAt/createdBy) so `deepClean`, `createRecord`
 * and `updateRecord` from `lib/growth/database` work as-is.
 *
 * Nothing in this file may describe an outcome that has not happened: a
 * `PublishingJob` only reaches PUBLISHED after `platformConfirmed === true`,
 * a `CreativeVersion` only carries a `renderUrl` after the render was
 * validated, and a `BrowserCapture` only reports frames it actually wrote.
 */

import type {
  BrowserCaptureState,
  MarketingAgentJobState,
  MarketingAgentMode,
  MarketingAgentTaskId,
  MarketingAgentTaskState,
  MarketingApprovalPolicy,
  MarketingLanguage,
  MarketingPlatform,
  MarketingAspectRatio,
  ProductDataClassification,
  PublishingState,
  SocialAccountState,
} from "./collections";

// ─── Intent (§2) ─────────────────────────────────────────────────────────────

export type MarketingCommand =
  | "CREATE"
  | "REMIX"
  | "REWRITE"
  | "TRANSLATE"
  | "SHORTEN"
  | "EXTEND"
  | "VARIANT"
  | "REPURPOSE"
  | "SCHEDULE"
  | "PUBLISH"
  | "PAUSE"
  | "RESUME"
  | "ANALYZE"
  | "REFRESH"
  | "CLONE_STRUCTURE"
  | "CREATE_CAMPAIGN";

export type ParsedIntent = {
  /** Verbatim user instruction — never mutated. */
  prompt: string;
  command: MarketingCommand;
  /** Product/feature keys resolved against the product knowledge base. */
  products: string[];
  platforms: MarketingPlatform[];
  languages: MarketingLanguage[];
  durationSec: number | null;
  aspectRatio: MarketingAspectRatio | null;
  tone: string | null;
  style: string | null;
  objective: string | null;
  audience: string | null;
  /** True when the user asked to show/demonstrate the real product UI. */
  wantsBrowserDemo: boolean;
  wantsVoiceover: boolean | null;
  variantCount: number;
  /** True when the user asked to schedule or publish. */
  wantsSchedule: boolean;
  wantsPublish: boolean;
  scheduleHint: string | null;
  /** Reference to a previous creative/campaign ("last week's AI Signals video"). */
  referencePrompt: string | null;
  /** Remix operations requested on an existing creative project. */
  remix: {
    keepCapture: boolean;
    changeHook: boolean;
    changeCta: boolean;
    tone?: string;
    language?: MarketingLanguage;
    platforms?: MarketingPlatform[];
    count?: number;
  } | null;
  /** Freeform notes the planner should treat as constraints. */
  constraints: string[];
  /** Terms that must pass claim validation before they may be used. */
  claimsRequested: string[];
  /** True when the deterministic parse could not resolve the request. */
  needsAiClarification: boolean;
  /** Confidence 0..1 of the deterministic parse. */
  confidence: number;
};

// ─── Product knowledge (§10, §50) ────────────────────────────────────────────

export type ProductFeature = {
  key: string;
  name: string;
  /** Approved one-line description. Nothing outside this may be claimed. */
  summary: string;
  /** Routes the browser demo agent may open. Never invented at runtime. */
  routes: string[];
  /** Marketing-safe bullet points, already approved. */
  approvedClaims: string[];
  benefits: string[];
  audience: string[];
  landingPath: string | null;
  /** True when the feature is public-facing (may appear in marketing). */
  publicFacing: boolean;
  /** Pro-gated features require a Pro-eligible campaign. */
  proGated: boolean;
  /** Features that show real trading outcomes need manual approval. */
  tradingSensitive: boolean;
  keywords: string[];
};

export type ProductFact = {
  id: string;
  productId: string;
  statement: string;
  classification: ProductDataClassification;
  source: string;
  updatedAt: number;
};

// ─── Campaign plan (§4, §25) ─────────────────────────────────────────────────

export type CampaignPlanTask = {
  id: MarketingAgentTaskId;
  label: string;
  dependsOn: MarketingAgentTaskId[];
  status: MarketingAgentTaskState;
  startedAt?: number;
  finishedAt?: number;
  attempts: number;
  error?: string;
  /** Short human-readable result shown in the live timeline (§43). */
  summary?: string;
  /** Artifacts produced by this task (ids/keys, not blobs). */
  artifactKeys?: string[];
};

export type CampaignPlan = {
  id?: string;
  jobId: string;
  campaignId?: string;
  title: string;
  objective: string;
  audience: string;
  products: string[];
  platforms: MarketingPlatform[];
  languages: MarketingLanguage[];
  durationSec: number;
  aspectRatios: MarketingAspectRatio[];
  tone: string;
  style: string;
  toneDirection: string | null;
  templateId: string;
  /** Ordered, resumable task graph (§4). */
  tasks: CampaignPlanTask[];
  /** Directories of the graph for fast resume. */
  taskIndex: Record<string, number>;
  /** Which tasks were intentionally not applicable to this request. */
  skipped: MarketingAgentTaskId[];
  requiresBrowserCapture: boolean;
  requiresApproval: boolean;
  approvalPolicy: MarketingApprovalPolicy;
  estimatedUnits: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

// ─── Browser capture (§6–§8, §69–§70) ────────────────────────────────────────

export type CaptureHighlightKind =
  | "cursor"
  | "zoom"
  | "spotlight"
  | "bounding_box"
  | "animated_arrow"
  | "callout"
  | "click_ripple"
  | "section_highlight"
  | "blur"
  | "dim"
  | "animated_path"
  | "text_annotation";

export type CaptureStep = {
  order: number;
  action: "open" | "navigate" | "click" | "scroll" | "select" | "search" | "switch_tab" | "wait" | "capture";
  /** CSS selector or route. Never a free-form script. */
  target?: string;
  value?: string;
  /** Application state to wait for (bounded). */
  waitFor?: string;
  durationMs: number;
  highlights?: { kind: CaptureHighlightKind; target?: string; label?: string }[];
  /** Regions to blur in post — never captured in the clear. */
  mask?: { selector: string; reason: string }[];
  /** Capture artifact key produced by this step. */
  captures?: "screenshot" | "video_segment" | "region" | "none";
  notes?: string;
};

export type BrowserCapturePlan = {
  id?: string;
  targetPage: string;
  route: string;
  objective: string;
  steps: CaptureStep[];
  requiredState: string[];
  elementsToHighlight: string[];
  sectionsToCapture: string[];
  sensitiveRegions: { selector: string; reason: string }[];
  timing: { stepDelayMs: number; settleMs: number; totalBudgetMs: number };
  fallback: string;
  /** Fingerprint of the product route + selectors; used for staleness (§70). */
  fingerprint: string;
  version: number;
};

export type BrowserCaptureFrame = {
  key: string;
  kind: "screenshot" | "video_segment" | "region";
  url: string;
  localPath?: string;
  stepOrder: number;
  width?: number;
  height?: number;
  durationMs?: number;
  sizeBytes?: number;
  /** True when masking/sanitization ran over this frame. */
  sanitized: boolean;
  capturedAt: number;
};

export type BrowserCapture = {
  id?: string;
  jobId?: string;
  campaignId?: string;
  productId: string;
  route: string;
  plan: BrowserCapturePlan;
  state: BrowserCaptureState;
  provider: string;
  frames: BrowserCaptureFrame[];
  /** Ordered interaction log (§6) — replayable, no secrets. */
  interactionLog: { at: number; action: string; target?: string; ok: boolean; note?: string }[];
  fingerprint: string;
  capturedAt?: number;
  staleReason?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

// ─── Creative memory & versioning (§22, §24, §45) ────────────────────────────

export type CreativeVersionKind =
  | "PARENT"
  | "HOOK"
  | "CTA"
  | "OPENING"
  | "VOICE"
  | "CAPTION"
  | "VISUAL"
  | "DURATION"
  | "LANGUAGE"
  | "PLATFORM"
  | "BROWSER_CAPTURE"
  | "COMPOSITION";

export type CreativeVersion = {
  id?: string;
  creativeId: string;
  parentVersionId?: string;
  /** Root of the lineage — never lost (§22). */
  rootVersionId: string;
  kind: CreativeVersionKind;
  version: number;
  label: string;
  language: MarketingLanguage;
  platform?: MarketingPlatform;
  aspectRatio?: MarketingAspectRatio;
  durationSec: number;
  /** Hypit composition reference (project + build id). */
  compositionId?: string;
  renderUrl?: string;
  renderState: "NONE" | "RENDERING" | "RENDERED" | "FAILED";
  renderError?: string;
  thumbnailUrl?: string;
  captionFileUrl?: string;
  scriptId?: string;
  browserCaptureId?: string;
  qa?: { passed: boolean; failedGates: string[]; checkedAt: number };
  createdAt: number;
  createdBy: string;
};

// ─── Creative recipe (§71) ───────────────────────────────────────────────────

export type CreativeRecipe = {
  id?: string;
  creativeId: string;
  name: string;
  objective: string;
  audience: string;
  products: string[];
  prompt: string;
  scriptTemplate: string;
  shotListTemplate: string;
  browserCapturePlanId?: string;
  assetKeys: string[];
  compositionTemplateId?: string;
  style: string;
  durationSec: number;
  platforms: MarketingPlatform[];
  languages: MarketingLanguage[];
  cta: string;
  disclaimer: string;
  variantKinds: string[];
  useCount: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

// ─── Copy / publishing package (§20, §34) ────────────────────────────────────

export type UtmParameters = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term?: string;
};

export type PlatformCopy = {
  platform: MarketingPlatform;
  title: string;
  caption: string;
  description: string;
  cta: string;
  hashtags: string[];
  firstComment?: string;
  thumbnailUrl?: string;
  destinationUrl: string;
  utm: UtmParameters;
  /** Reason a field could not be produced (e.g. NOT_SUPPORTED). */
  unsupported?: string[];
};

export type PublishingPackage = {
  id?: string;
  jobId: string;
  creativeId: string;
  versionId: string;
  platform: MarketingPlatform;
  language: MarketingLanguage;
  copy: PlatformCopy;
  mediaUrl: string;
  mediaMime: string;
  durationSec: number;
  createdAt: number;
  createdBy: string;
};

// ─── Social accounts (§30, §32) ──────────────────────────────────────────────

export type SocialAccount = {
  id?: string;
  platform: MarketingPlatform | string;
  accountId: string;
  accountName: string;
  state: SocialAccountState;
  /** Free-form permission scopes returned by the platform. Never secrets. */
  permissions: string[];
  /** Human-readable token state. The token itself never leaves the server. */
  tokenState: "NONE" | "VALID" | "EXPIRING" | "EXPIRED" | "REVOKED";
  tokenExpiresAt?: number;
  lastHealthCheckAt?: number;
  lastHealthError?: string;
  lastPublishedAt?: number;
  lastPublishError?: string;
  connectedAt?: number;
  createdBy: string;
  updatedAt: number;
};

// ─── Scheduling (§26) ────────────────────────────────────────────────────────

export type ScheduleRecurrence =
  | { kind: "NONE" }
  | { kind: "DAILY"; intervalDays: number }
  | { kind: "WEEKLY"; daysOfWeek: number[]; intervalWeeks: number }
  | { kind: "MONTHLY"; dayOfMonth: number };

export type MarketingSchedule = {
  id?: string;
  jobId?: string;
  campaignId?: string;
  publishingJobId: string;
  platform: MarketingPlatform;
  accountId?: string;
  /** IANA zone, e.g. "Europe/Paris". */
  timezone: string;
  /** Planned instant (epoch ms) in the schedule's timezone. */
  scheduledFor: number;
  recurrence: ScheduleRecurrence;
  /** Window bounds for campaign schedules (§26). */
  windowStart?: number;
  windowEnd?: number;
  state: "ACTIVE" | "PAUSED" | "CANCELLED" | "COMPLETED";
  nextRunAt?: number;
  runCount: number;
  lastRunAt?: number;
  lastRunResult?: string;
  pausedAt?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

// ─── Publishing job (§28–§31) ────────────────────────────────────────────────

export type PublishingJob = {
  id?: string;
  jobId?: string;
  campaignId?: string;
  creativeId: string;
  versionId: string;
  platform: MarketingPlatform;
  accountId?: string;
  state: PublishingState;
  /** Server-generated; identical retries reuse it (§29). */
  idempotencyKey: string;
  mediaUrl: string;
  copy: { title: string; caption: string; description?: string; hashtags?: string[]; firstComment?: string };
  destinationUrl: string;
  utm: UtmParameters;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt?: number;
  /** Set only when the platform API confirmed publication (§28, §31). */
  platformConfirmed: boolean;
  externalId?: string;
  externalUrl?: string;
  publishedAt?: number;
  verifiedAt?: number;
  verification?: {
    ok: boolean;
    method: string;
    detail?: string;
    checkedAt: number;
  };
  /** Last error, classified (§56). */
  lastError?: { code: string; kind: "TRANSIENT" | "PERMANENT" | "AUTH" | "RATE_LIMIT" | "VALIDATION"; message: string };
  capabilitiesUsed?: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

// ─── Analytics & learning (§36, §37) ─────────────────────────────────────────

export type PerformanceSnapshot = {
  id?: string;
  creativeId: string;
  versionId?: string;
  platform: MarketingPlatform;
  externalId?: string;
  periodStart: number;
  periodEnd: number;
  /** Only metrics the platform actually returned. Never invented. */
  metrics: Record<string, number>;
  source: string;
  sampleSize: number;
  collectedAt: number;
  createdBy: string;
};

export type LearningObservation = {
  id?: string;
  campaignId?: string;
  creativeId: string;
  observation: string;
  metric: string;
  /** Directional comparison, never a causal claim (§37). */
  direction: "HIGHER" | "LOWER" | "FLAT";
  sampleSize: number;
  periodStart: number;
  periodEnd: number;
  platform: MarketingPlatform;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  applied: boolean;
  appliedToCreativeId?: string;
  createdAt: number;
  createdBy: string;
};

// ─── Claims (§51) ────────────────────────────────────────────────────────────

export type ClaimCheckResult = {
  passed: boolean;
  blocked: boolean;
  flags: { rule: string; label: string; severity: "low" | "medium" | "high"; excerpt: string }[];
  /** Rewritten, factual phrasing proposed for blocked text. */
  suggestions: string[];
  checkedAt: number;
};

// ─── QA (§53) ────────────────────────────────────────────────────────────────

export type QaGateId =
  | "TECHNICAL"
  | "VISUAL"
  | "BRAND"
  | "CLAIM"
  | "PLATFORM"
  | "AUDIO"
  | "CAPTION"
  | "PRIVACY";

export type QaGateResult = {
  gate: QaGateId;
  status: "PASSED" | "FAILED" | "SKIPPED";
  checks: { name: string; ok: boolean; detail?: string }[];
  checkedAt: number;
};

export type QaReport = {
  gates: QaGateResult[];
  passed: boolean;
  failedGates: QaGateId[];
  checkedAt: number;
};

// ─── Job (§4, §43, §79) ──────────────────────────────────────────────────────

export type MarketingAgentArtifact = {
  key: string;
  kind:
    | "prompt"
    | "intent"
    | "plan"
    | "product_facts"
    | "capture_plan"
    | "capture"
    | "brief"
    | "script"
    | "shot_list"
    | "motion_plan"
    | "voice"
    | "captions"
    | "composition"
    | "render"
    | "thumbnail"
    | "qa"
    | "copy"
    | "package"
    | "schedule"
    | "publish_result"
    | "performance"
    | "learning"
    | "recipe";
  /** Pointer into a collection or an external URL — never raw blobs. */
  ref?: string;
  url?: string;
  label: string;
  taskId: MarketingAgentTaskId;
  createdAt: number;
};

export type MarketingAgentJob = {
  id?: string;
  /** Stable key so a retried cron/API call never starts a second run (§79). */
  jobKey: string;
  prompt: string;
  mode: MarketingAgentMode;
  state: MarketingAgentJobState;
  planId?: string;
  campaignId?: string;
  creativeId?: string;
  recipeId?: string;
  parentJobId?: string;
  /** Live progress for the UI (§43). */
  tasks: CampaignPlanTask[];
  artifacts: MarketingAgentArtifact[];
  /** Current cursor — resume continues from the first non-done task. */
  cursor: number;
  estimatedUnits: number;
  consumedUnits: number;
  blockedReason?: string;
  approval?: {
    required: boolean;
    decidedAt?: number;
    decidedBy?: string;
    decision?: "APPROVED" | "REJECTED";
    reason?: string;
  };
  error?: string;
  errorCode?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  retryCount: number;
  userId: string;
  provider?: string;
  stage?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};

// ─── Settings / health (§84, §89) ────────────────────────────────────────────

export type MarketingAgentSettings = {
  enabled: boolean;
  mode: MarketingAgentMode;
  flags: Record<string, boolean>;
  approvalPolicy: MarketingApprovalPolicy;
  allowedPlatforms: MarketingPlatform[];
  allowedLanguages: MarketingLanguage[];
  maxDailyJobs: number;
  maxProductionUnits: number;
  maxVariants: number;
  maxRenderDurationSec: number;
  costLimitUnitsPerDay: number;
  claimPolicy: "STRICT" | "STANDARD";
  defaultDisclaimer: string;
  defaultTimezone: string;
  updatedAt: number;
  updatedBy: string;
};

export type SubsystemHealth = {
  id: string;
  label: string;
  state: "CONNECTED" | "READY" | "DEGRADED" | "NOT_CONFIGURED" | "DISABLED" | "ERROR";
  detail?: string;
  checkedAt: number;
};

export type MarketingAgentCapabilities = {
  settings: MarketingAgentSettings;
  health: SubsystemHealth[];
  tools: { id: string; enabled: boolean; modes: string[] }[];
  platforms: {
    platform: MarketingPlatform;
    canPublishVideo: boolean;
    canSchedule: boolean;
    canUploadThumbnail: boolean;
    canAddDescription: boolean;
    canAddHashtags: boolean;
    canRetrieveMetrics: boolean;
    state: string;
    reason?: string;
  }[];
  languages: MarketingLanguage[];
};
