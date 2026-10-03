/**
 * Marketing Agent — RTDB persistence (§44, §45, §61, §62).
 *
 * Reuses the growth engine's helpers (`deepClean`, `createRecord`,
 * `updateRecord`, `listCollection`, `claimJobKey`, `writeGrowthAudit`) so the
 * agent's records follow the exact same conventions as the rest of the
 * platform. RTDB remains the only database; Firestore is never introduced.
 *
 * Server-only module.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import {
  claimJobKey,
  createRecord,
  deepClean,
  deleteRecord,
  genId,
  getRecord,
  listCollection,
  updateRecord,
  writeGrowthAudit,
} from "@/lib/growth/database";
import { MARKETING_AGENT_COLLECTIONS as C } from "./collections";
import type {
  BrowserCapture,
  CampaignPlan,
  CreativeRecipe,
  CreativeVersion,
  LearningObservation,
  MarketingAgentJob,
  MarketingSchedule,
  PerformanceSnapshot,
  PublishingJob,
  SocialAccount,
} from "./types";
import type { PublishingStore } from "./publishing/engine";

type WithId<T> = T & { id: string };

// ─── Job key / claim helpers ────────────────────────────────────────────────

/** Idempotent start: only the first caller creates the run (§79). */
export async function claimAgentJob(jobKey: string, ttlMs = 60 * 60 * 1000): Promise<boolean> {
  return claimJobKey(`agent:${jobKey}`, ttlMs);
}

export async function claimForDailyJob(jobKey: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  return claimJobKey(`agentdaily:${jobKey}:${day}`, 20 * 60 * 60 * 1000);
}

// ─── Agent jobs ─────────────────────────────────────────────────────────────

export async function createAgentJob(job: Omit<MarketingAgentJob, "id" | "createdAt" | "updatedAt">): Promise<WithId<MarketingAgentJob>> {
  const now = Date.now();
  const rec = { ...job, createdAt: now, updatedAt: now } as MarketingAgentJob;
  const created = await createRecord<MarketingAgentJob>(C.jobs, rec as Partial<MarketingAgentJob>, job.createdBy);
  await writeGrowthAudit({
    actor: job.createdBy,
    action: "marketing_agent_job_created",
    targetType: "marketingAgentJob",
    targetId: created.id,
    detail: { jobKey: job.jobKey, mode: job.mode, prompt: job.prompt.slice(0, 200) },
  });
  return created as WithId<MarketingAgentJob>;
}

export async function getAgentJob(id: string): Promise<WithId<MarketingAgentJob> | null> {
  return (await getRecord<MarketingAgentJob>(C.jobs, id)) as WithId<MarketingAgentJob> | null;
}

export async function updateAgentJob(id: string, patch: Partial<MarketingAgentJob>, actor: string): Promise<void> {
  await updateRecord<MarketingAgentJob>(C.jobs, id, patch as MarketingAgentJob, actor);
}

export async function listAgentJobs(limit = 50): Promise<WithId<MarketingAgentJob>[]> {
  return (await listCollection<MarketingAgentJob>(C.jobs, { orderByChild: "createdAt", limit })) as WithId<MarketingAgentJob>[];
}

/** Count jobs created today (cost control, §46). */
export async function countJobsSince(since: number): Promise<{ total: number; running: number; units: number }> {
  const jobs = await listCollection<MarketingAgentJob>(C.jobs, { orderByChild: "createdAt", limit: 500 });
  const scoped = jobs.filter((j) => (j.createdAt ?? 0) >= since);
  return {
    total: scoped.length,
    running: scoped.filter((j) => j.state === "RUNNING").length,
    units: scoped.reduce((sum, j) => sum + (j.consumedUnits || 0), 0),
  };
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export async function savePlan(plan: CampaignPlan): Promise<string> {
  if (plan.id) {
    await updateRecord<CampaignPlan>(C.plans, plan.id, plan, plan.createdBy);
    return plan.id;
  }
  const created = await createRecord<CampaignPlan>(C.plans, plan as Partial<CampaignPlan>, plan.createdBy);
  return created.id;
}

export async function getPlan(id: string): Promise<WithId<CampaignPlan> | null> {
  return (await getRecord<CampaignPlan>(C.plans, id)) as WithId<CampaignPlan> | null;
}

// ─── Browser captures ───────────────────────────────────────────────────────

export async function saveCapture(capture: BrowserCapture): Promise<string> {
  if (capture.id) {
    await updateRecord<BrowserCapture>(C.browserCaptures, capture.id, capture, capture.createdBy);
    return capture.id;
  }
  const created = await createRecord<BrowserCapture>(C.browserCaptures, capture as Partial<BrowserCapture>, capture.createdBy);
  await writeGrowthAudit({
    actor: capture.createdBy,
    action: "marketing_browser_capture",
    targetType: "marketingBrowserCapture",
    targetId: created.id,
    detail: { productId: capture.productId, route: capture.route, frames: capture.frames.length, provider: capture.provider },
  });
  return created.id;
}

export async function getCapture(id: string): Promise<WithId<BrowserCapture> | null> {
  return (await getRecord<BrowserCapture>(C.browserCaptures, id)) as WithId<BrowserCapture> | null;
}

export async function latestCaptureFor(productId: string): Promise<WithId<BrowserCapture> | null> {
  const all = await listCollection<BrowserCapture>(C.browserCaptures, { orderByChild: "createdAt", limit: 100 });
  const scoped = all.filter((c) => c.productId === productId && c.state === "CAPTURED");
  return (scoped.sort((a, b) => (b.capturedAt ?? b.createdAt) - (a.capturedAt ?? a.createdAt))[0] as WithId<BrowserCapture>) ?? null;
}

/** Mark captures stale when their fingerprint no longer matches (§70). */
export async function markStaleCaptures(productId: string, currentFingerprint: string, reason: string): Promise<number> {
  const all = await listCollection<BrowserCapture>(C.browserCaptures, { orderByChild: "createdAt", limit: 100 });
  let count = 0;
  for (const c of all) {
    if (c.productId !== productId || c.state !== "CAPTURED") continue;
    if (c.fingerprint === currentFingerprint) continue;
    await updateRecord<BrowserCapture>(C.browserCaptures, c.id, { state: "STALE", staleReason: reason, updatedAt: Date.now() } as BrowserCapture, "system");
    count += 1;
  }
  return count;
}

// ─── Creative versions (lineage, §22/§45) ──────────────────────────────────

export async function saveVersion(version: CreativeVersion): Promise<string> {
  if (version.id) {
    await updateRecord<CreativeVersion>(C.creativeVersions, version.id, version, version.createdBy);
    return version.id;
  }
  const created = await createRecord<CreativeVersion>(C.creativeVersions, version as Partial<CreativeVersion>, version.createdBy);
  return created.id;
}

export async function getVersion(id: string): Promise<WithId<CreativeVersion> | null> {
  return (await getRecord<CreativeVersion>(C.creativeVersions, id)) as WithId<CreativeVersion> | null;
}

export async function listVersions(creativeId: string): Promise<WithId<CreativeVersion>[]> {
  const all = await listCollection<CreativeVersion>(C.creativeVersions, { orderByChild: "createdAt", limit: 300 });
  return all.filter((v) => v.creativeId === creativeId).sort((a, b) => a.version - b.version);
}

export async function nextVersionNumber(creativeId: string): Promise<number> {
  const versions = await listVersions(creativeId);
  return versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

// ─── Recipes (§71) ──────────────────────────────────────────────────────────

export async function saveRecipe(recipe: CreativeRecipe): Promise<string> {
  if (recipe.id) {
    await updateRecord<CreativeRecipe>(C.recipes, recipe.id, recipe, recipe.createdBy);
    return recipe.id;
  }
  const created = await createRecord<CreativeRecipe>(C.recipes, recipe as Partial<CreativeRecipe>, recipe.createdBy);
  return created.id;
}

export async function listRecipes(limit = 50): Promise<WithId<CreativeRecipe>[]> {
  return (await listCollection<CreativeRecipe>(C.recipes, { orderByChild: "createdAt", limit })) as WithId<CreativeRecipe>[];
}

export async function getRecipe(id: string): Promise<WithId<CreativeRecipe> | null> {
  return (await getRecord<CreativeRecipe>(C.recipes, id)) as WithId<CreativeRecipe> | null;
}

// ─── Publishing jobs (§28) ──────────────────────────────────────────────────

export async function createPublishingJob(job: Omit<PublishingJob, "id" | "createdAt" | "updatedAt">): Promise<WithId<PublishingJob>> {
  const now = Date.now();
  const created = await createRecord<PublishingJob>(C.publishingJobs, { ...job, createdAt: now, updatedAt: now } as Partial<PublishingJob>, job.createdBy);
  return created as WithId<PublishingJob>;
}

export async function getPublishingJob(id: string): Promise<WithId<PublishingJob> | null> {
  return (await getRecord<PublishingJob>(C.publishingJobs, id)) as WithId<PublishingJob> | null;
}

export async function listPublishingJobs(filter?: { campaignId?: string; creativeId?: string; state?: string }, limit = 200): Promise<WithId<PublishingJob>[]> {
  const all = await listCollection<PublishingJob>(C.publishingJobs, { orderByChild: "createdAt", limit });
  return all.filter((j) => {
    if (filter?.campaignId && j.campaignId !== filter.campaignId) return false;
    if (filter?.creativeId && j.creativeId !== filter.creativeId) return false;
    if (filter?.state && j.state !== filter.state) return false;
    return true;
  });
}

/** RTDB-backed PublishingStore (injected into the publishing engine). */
export function rtdbPublishingStore(): PublishingStore {
  return {
    async get(id: string) {
      return getPublishingJob(id);
    },
    async update(id: string, patch: Partial<PublishingJob>) {
      await updateRecord<PublishingJob>(C.publishingJobs, id, patch as PublishingJob, "agent:publishing");
    },
    async audit(entry) {
      await writeGrowthAudit({
        actor: "agent:publishing",
        action: entry.action,
        targetType: "marketingPublishingJob",
        targetId: entry.jobId,
        detail: entry.detail,
      });
    },
    async claimPublish(key: string) {
      return claimJobKey(`pub:${key}`, 24 * 60 * 60 * 1000);
    },
  };
}

// ─── Schedules (§26) ────────────────────────────────────────────────────────

export async function saveSchedule(schedule: MarketingSchedule): Promise<string> {
  if (schedule.id) {
    await updateRecord<MarketingSchedule>(C.schedules, schedule.id, schedule, schedule.createdBy);
    return schedule.id;
  }
  const created = await createRecord<MarketingSchedule>(C.schedules, schedule as Partial<MarketingSchedule>, schedule.createdBy);
  await writeGrowthAudit({
    actor: schedule.createdBy,
    action: "marketing_schedule_created",
    targetType: "marketingSchedule",
    targetId: created.id,
    detail: { platform: schedule.platform, scheduledFor: schedule.scheduledFor, timezone: schedule.timezone, recurrence: schedule.recurrence.kind },
  });
  return created.id;
}

export async function listSchedules(state?: string, limit = 200): Promise<WithId<MarketingSchedule>[]> {
  const all = await listCollection<MarketingSchedule>(C.schedules, { orderByChild: "createdAt", limit });
  return state ? all.filter((s) => s.state === state) : all;
}

export async function getSchedule(id: string): Promise<WithId<MarketingSchedule> | null> {
  return (await getRecord<MarketingSchedule>(C.schedules, id)) as WithId<MarketingSchedule> | null;
}

export async function deleteSchedule(id: string): Promise<void> {
  await deleteRecord(C.schedules, id);
}

// ─── Social accounts (§30/§32) ─────────────────────────────────────────────

export async function upsertSocialAccount(account: Omit<SocialAccount, "updatedAt">): Promise<string> {
  if (account.id) {
    await updateRecord<SocialAccount>(C.socialAccounts, account.id, { ...account, updatedAt: Date.now() } as SocialAccount, account.createdBy);
    return account.id;
  }
  const created = await createRecord<SocialAccount>(C.socialAccounts, { ...account, updatedAt: Date.now() } as Partial<SocialAccount>, account.createdBy);
  return created.id;
}

export async function listSocialAccounts(): Promise<WithId<SocialAccount>[]> {
  return (await listCollection<SocialAccount>(C.socialAccounts, { orderByChild: "updatedAt", limit: 100 })) as WithId<SocialAccount>[];
}

export async function getSocialAccount(id: string): Promise<WithId<SocialAccount> | null> {
  return (await getRecord<SocialAccount>(C.socialAccounts, id)) as WithId<SocialAccount> | null;
}

// ─── Performance & learning (§36/§37) ──────────────────────────────────────

export async function savePerformance(snapshot: PerformanceSnapshot): Promise<string> {
  if (snapshot.id) {
    await updateRecord<PerformanceSnapshot>(C.performance, snapshot.id, snapshot, snapshot.createdBy);
    return snapshot.id;
  }
  const created = await createRecord<PerformanceSnapshot>(C.performance, snapshot as Partial<PerformanceSnapshot>, snapshot.createdBy);
  return created.id;
}

export async function listPerformance(creativeId: string, limit = 200): Promise<WithId<PerformanceSnapshot>[]> {
  const all = await listCollection<PerformanceSnapshot>(C.performance, { orderByChild: "collectedAt", limit });
  return all.filter((p) => p.creativeId === creativeId);
}

export async function saveLearning(observation: LearningObservation): Promise<string> {
  if (observation.id) {
    await updateRecord<LearningObservation>(C.learning, observation.id, observation, observation.createdBy);
    return observation.id;
  }
  const created = await createRecord<LearningObservation>(C.learning, observation as Partial<LearningObservation>, observation.createdBy);
  await writeGrowthAudit({
    actor: observation.createdBy,
    action: "marketing_learning_recorded",
    targetType: "marketingLearning",
    targetId: created.id,
    detail: { creativeId: observation.creativeId, metric: observation.metric, direction: observation.direction, confidence: observation.confidence },
  });
  return created.id;
}

export async function listLearning(creativeId?: string, limit = 200): Promise<WithId<LearningObservation>[]> {
  const all = await listCollection<LearningObservation>(C.learning, { orderByChild: "createdAt", limit });
  return creativeId ? all.filter((l) => l.creativeId === creativeId) : all;
}

// ─── Claims (§51) ───────────────────────────────────────────────────────────

export async function recordClaimReview(input: {
  creativeId: string;
  jobId?: string;
  statement: string;
  decision: "APPROVED" | "REJECTED";
  decidedBy: string;
  reason?: string;
}): Promise<string> {
  const created = await createRecord<{ statement: string; decision: string; reason?: string; createdAt: number; createdBy: string }>(
    C.claims,
    {
      statement: input.statement,
      decision: input.decision,
      reason: input.reason,
      createdAt: Date.now(),
      createdBy: input.decidedBy,
    },
    input.decidedBy
  );
  await writeGrowthAudit({
    actor: input.decidedBy,
    action: "marketing_claim_reviewed",
    targetType: "marketingClaim",
    targetId: (created as { id?: string }).id ?? "",
    detail: { creativeId: input.creativeId, decision: input.decision },
  });
  return (created as { id?: string }).id ?? "";
}

// ─── Generic audit (§62) ────────────────────────────────────────────────────

export async function audit(entry: {
  actor: string;
  action: string;
  targetType: string;
  targetId?: string;
  detail?: Record<string, unknown>;
  externalPlatform?: string;
  externalId?: string;
}): Promise<void> {
  await writeGrowthAudit({
    actor: entry.actor,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? "",
    detail: {
      ...(entry.detail ?? {}),
      ...(entry.externalPlatform ? { externalPlatform: entry.externalPlatform } : {}),
      ...(entry.externalId ? { externalId: entry.externalId } : {}),
    },
  });
}

/** Audit entry for a tool invocation (§48). Secrets are never logged (§88). */
export async function recordToolInvocation(entry: {
  tool: string;
  actor: string;
  jobId?: string;
  mode: string;
  ok: boolean;
  startedAt: number;
  finishedAt?: number;
  errorCode?: string;
  summary?: string;
  externalPlatform?: string;
  externalId?: string;
}): Promise<void> {
  await audit({
    actor: entry.actor,
    action: `tool:${entry.tool}`,
    targetType: "marketingAgentJob",
    targetId: entry.jobId ?? "",
    detail: {
      mode: entry.mode,
      ok: entry.ok,
      durationMs: (entry.finishedAt ?? Date.now()) - entry.startedAt,
      ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
      ...(entry.summary ? { summary: entry.summary.slice(0, 300) } : {}),
    },
    ...(entry.externalPlatform ? { externalPlatform: entry.externalPlatform } : {}),
    ...(entry.externalId ? { externalId: entry.externalId } : {}),
  });
}

export { adminDatabase, deepClean, genId, listCollection, updateRecord, createRecord, deleteRecord, getRecord, claimJobKey };
