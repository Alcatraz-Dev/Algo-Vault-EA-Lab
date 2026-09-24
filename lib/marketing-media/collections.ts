/**
 * Marketing Content Factory — RTDB collection names + factory-wide constants.
 *
 * Pure module: no I/O, no firebase imports. Safe to import from tests,
 * validators and the workflow registry. Every collection used by the factory
 * must be declared here so `database.rules.json` and this file can never
 * drift apart (single source of truth).
 */

export const MARKETING_COLLECTIONS = {
    campaigns: "marketingCampaigns",
    creatives: "marketingCreatives",
    jobs: "marketingJobs",
    assets: "marketingAssets",
    variants: "marketingVariants",
    analytics: "marketingAnalytics",
} as const;

export type MarketingCollectionName = (typeof MARKETING_COLLECTIONS)[keyof typeof MARKETING_COLLECTIONS];

// ─── Creative lifecycle ──────────────────────────────────────────────────────

/** Human-facing lifecycle of a marketing creative (pipeline state machine). */
export const MARKETING_CREATIVE_STATES = [
    "DRAFT",            // created, nothing generated yet
    "GENERATING",       // pipeline is running (concept → … → compliance)
    "READY_FOR_REVIEW", // all stages completed, pending admin review
    "APPROVED",         // admin approved for distribution
    "PUBLISHED",        // distributed through ≥1 channel adapter
    "FAILED",           // a stage failed (retry/resume allowed)
    "REJECTED",         // admin rejected
] as const;

export type MarketingCreativeState = (typeof MARKETING_CREATIVE_STATES)[number];

export const MARKETING_CREATIVE_STATE_LABELS: Record<MarketingCreativeState, string> = {
    DRAFT: "Draft",
    GENERATING: "Generating",
    READY_FOR_REVIEW: "Ready for review",
    APPROVED: "Approved",
    PUBLISHED: "Published",
    FAILED: "Failed",
    REJECTED: "Rejected",
};

/**
 * Pipeline stages (sequential). Stage id === the agent id that produces it,
 * so the workflow engine and the per-stage regeneration share one vocabulary.
 */
export const MARKETING_PIPELINE_STAGES = [
    "concept",
    "research",
    "script",
    "copy",
    "template",
    "variation",
    "seo",
    "captions",
    "visuals",
    "market_visuals",
    "voiceover",
    "compose",
    "thumbnail",
    "compliance",
] as const;

export type MarketingPipelineStage = (typeof MARKETING_PIPELINE_STAGES)[number];

export const MARKETING_PIPELINE_STAGE_LABELS: Record<MarketingPipelineStage, string> = {
    concept: "Concept",
    research: "Research",
    script: "Script",
    copy: "Copy",
    template: "Template content",
    variation: "Variations",
    seo: "SEO metadata",
    captions: "Captions",
    visuals: "Visual assets",
    market_visuals: "Market visuals",
    voiceover: "Voiceover",
    compose: "Video composition",
    thumbnail: "Thumbnail",
    compliance: "Compliance review",
};

export const MARKETING_PIPELINE_ORDER: MarketingPipelineStage[] = [...MARKETING_PIPELINE_STAGES];

/** Stage blocks — the compliance stage is authoritative; nothing is
 *  distributed before it passes. */
export const MARKETING_ACTIONABLE_STAGES: MarketingPipelineStage[] = ["compose", "thumbnail", "compliance"];

// ─── Data-driven content templates (10 types) ───────────────────────────────
// These are the template ids used by the Template Agent and the workflow
// `marketing.creative` node.

export const MARKETING_TEMPLATE_IDS = [
    "HOOK_EDU",
    "FEATURE_SPOTLIGHT",
    "HOW_IT_WORKS",
    "USE_CASE",
    "MYTH_VS_FACT",
    "COMPARISON",
    "LIFECYCLE",
    "MARKET_CONTEXT",
    "RISK_FIRST",
    "CTA_DRIVE",
] as const;

export type MarketingTemplateId = (typeof MARKETING_TEMPLATE_IDS)[number];

// ─── Cost / rate-limit controls ──────────────────────────────────────────────
// Kept in one place so the variation engine and API routes enforce the same
// budgets. All values are conservative by design.

export const MARKETING_DEFAULTS = {
    /** Default number of variants generated per creative. */
    defaultVariantCount: 3,
    /** Hard cap: never generate more than this per request. */
    maxVariantCount: 8,
    /** Max tokens a single variation may consume from the AI gateway. */
    maxVariationTokens: 400,
    /** Max tokens for an AI-narrated stage (secondary pass, never required). */
    maxNarrationTokens: 600,
    /** Longest script a single creative may hold (seconds). */
    maxScriptDurationSec: 120,
    /** Soft monthly cap on hosted compositions per account (dedupe safety). */
    maxDailyCompositions: 24,
    /** Job claim TTL for pipeline runs. */
    pipelineJobTtlMs: 10 * 60 * 1000,
    /** Collision-safe bucket for daily job dedup. */
    dailyJobTtlMs: 6 * 60 * 60 * 1000,
} as const;

/** Required marker on demo/illustrative content — never omitted. */
export const DEMO_LABEL_TEXT = "Demo — illustrative example. Not real trading performance.";

export const MARKETING_TEMPLATE_LABELS: Record<string, string> = {
  HOOK_EDU: "Hook + Education",
  FEATURE_SPOTLIGHT: "Feature Spotlight",
  HOW_IT_WORKS: "How It Works",
  USE_CASE: "Use Case",
  MYTH_VS_FACT: "Myth vs Fact",
  COMPARISON: "Comparison",
  LIFECYCLE: "Lifecycle",
  MARKET_CONTEXT: "Market Context",
  RISK_FIRST: "Risk First",
  CTA_DRIVE: "CTA Drive",
};

/** Standard AlgoVault trading risk disclosure (shared with the growth engine). */
export { RISK_DISCLOSURE_TEXT } from "../growth/constants";