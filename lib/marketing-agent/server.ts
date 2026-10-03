/**
 * Marketing Agent — server barrel.
 *
 * Everything here is server-only: RTDB access, spawned processes (Hypit CLI,
 * browser runtime) and connectors. Import this only from API routes, cron
 * handlers and workflow executors — never from client components.
 */

export * from "./index";
export {
  createJob,
  runJob,
  resumeJob,
  cancelJob,
  decideApproval,
  runtimeStatus,
  tickSchedules,
  type AgentRuntime,
  type RunOutcome,
  type CreateJobInput,
} from "./agent";
export {
  listAgentJobs,
  getAgentJob,
  updateAgentJob,
  savePlan,
  getPlan,
  saveCapture,
  getCapture,
  latestCaptureFor,
  listVersions,
  getVersion,
  saveVersion,
  listRecipes,
  getRecipe,
  saveRecipe,
  createPublishingJob,
  getPublishingJob,
  listPublishingJobs,
  rtdbPublishingStore,
  saveSchedule,
  listSchedules,
  getSchedule,
  deleteSchedule,
  listSocialAccounts,
  upsertSocialAccount,
  getSocialAccount,
  listPerformance,
  listLearning,
  saveLearning,
  recordClaimReview,
  recordToolInvocation,
  audit,
  claimAgentJob,
  countJobsSince,
} from "./storage";
export { registerCreativeProviders } from "./creative-providers";
export {
  registerSocialPublishers,
  listSocialPublishers,
  getSocialPublisher,
} from "./publishing/providers";
export {
  executePublishingJob,
  retryPublishingJob,
  cancelPublishingJob,
  queueDueJobs,
  type PublishingStore,
} from "./publishing/engine";
export { runBrowserCapture, captureHealth, reuseDecision } from "./browser/engine";
export { listCaptureProviders, selectCaptureProvider, getCaptureProvider } from "./browser/providers";
export { resolveCreativeProvider, getCreativeProvider, listCreativeProviders, registerCreativeProvider, type MarketingCreativeProvider } from "./provider";
export { EXPECTED_HYPIIIT_VERSION } from "./provider-constants";
