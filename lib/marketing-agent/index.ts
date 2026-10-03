/**
 * Marketing Agent — public barrel (pure modules only).
 *
 * This file must stay free of server-only imports (`node:child_process`,
 * `node:fs`, Firebase admin) so client components can consume the constants,
 * types and pure helpers. Server entry points import from `./server` or from
 * the concrete modules directly.
 */

export * from "./collections";
export * from "./types";
export { parseIntent, parseIntentWithAi } from "./intent";
export {
  PRODUCT_FEATURES,
  resolveProducts,
  getFeature,
  listMarketableFeatures,
  selectFeaturesForFreeformPrompt,
  getProductFacts,
  classifyProductStatement,
  resolveCtaDestination,
  resolveDemoRoute,
  requiresTradingDisclaimer,
  featureDirection,
} from "./product-knowledge";
export { runClaimValidation, repairBlockedClaims, approvedClaimsFor, defaultDisclaimer, FACTUAL_LANGUAGE_BANK } from "./claims";
export { buildPlan, selectTasks, topologicalOrder, readyTasks, resumeCursor } from "./planner";
export { estimateProduction, checkDailyBudget, backoffDelayMs, shouldRetry, type ProductionEstimate, type BudgetCheck } from "./cost";
export { runQa, runPublishingQa, type QaInput } from "./qa";
export { buildUtm, applyUtm, readUtm, hasRequiredUtm } from "./utm";
export { authorizeTool, isAllowedProductRoute, containsInjectionAttempt, MARKETING_TOOL_SCHEMAS } from "./permissions";
export {
  DEFAULT_AGENT_SETTINGS,
  evaluateApproval,
  canSchedule,
  canPublish,
  autonomousGuardrails,
  isKnownMode,
  modeLabel,
} from "./modes";
export {
  parseScheduleHint,
  nextOccurrence,
  isScheduleDue,
  advanceSchedule,
  isValidTimeZone,
  utcToWall,
  zonedToUtc,
  weekdayIndex,
  DEFAULT_PUBLISH_HOUR,
} from "./scheduling";
export { buildCapturePlan, validateCapturePlan, fingerprintFor, DEFAULT_SENSITIVE_SELECTORS } from "./browser/plan";
export { describeMasks, sanitizeText, containsForbiddenContent, sessionKindFor, frameIsPublishable } from "./browser/sanitize";
export { canTransition, transition, isTerminal, isPublishingActive, canManualRetry, canCancel, queuePreconditions, PUBLISHING_STATE_HELP } from "./publishing/state-machine";
export { getCapability, listCapabilities, capabilityMatrix, captionLimit } from "./publishing/capabilities";
export type { PublishingCapability, SocialPublisher, ConnectorResult, CreatePostInput } from "./publishing/types";
export { directCreative, effectsForBeat, HIGHLIGHT_EFFECTS, type DirectorBrief, type DirectorDecision } from "./production/director";
export { generateScript, refineScript, type ShotListEntry } from "./production/script";
export { buildComposition, recompose, localize, captionPlacement } from "./production/composition";
export { generatePlatformCopy, buildPublishingPackage } from "./production/copy";
export { buildVariantSpecs, deriveVersionLineage, interpretRemix, VARIANT_KINDS, type VariantKind, type VariantSpec, type RemixOperation } from "./production/variants";
export { extractRecipe, rebindRecipe } from "./production/recipe";
export {
  compareSnapshots,
  generateObservations,
  detectFatigue,
  aggregateMetrics,
  coverageOf,
  recordPerformance,
  INTERPRETABLE_METRICS,
} from "./analytics";
export {
  EXPECTED_HYPIIIT_VERSION,
  isVersionCompatible,
  HYPIIIT_PROVIDER_ID,
  FFMPEG_PROVIDER_ID,
} from "./provider-constants";
export { renderSvml, renderSvrun, recompositionNotes, canvasFor, esc } from "./hypit/svml";
