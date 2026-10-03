/**
 * Marketing Agent API — shared runtime helpers.
 *
 * Every route:
 *  - is admin-gated through the existing `requireGrowthAdmin` (§15),
 *  - runs in the Node.js runtime (spawns the Hypit CLI / browser),
 *  - never exposes secrets or tokens in a response (§88).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";
import { getAgentJob, listAgentJobs, listSocialAccounts, listSchedules, listPublishingJobs, audit } from "@/lib/marketing-agent/storage";
import { DEFAULT_AGENT_SETTINGS } from "@/lib/marketing-agent/modes";
import type { MarketingAgentSettings } from "@/lib/marketing-agent/types";
import type { MarketingAgentMode } from "@/lib/marketing-agent/collections";
import { loadSettingsFromRtdb, saveSettingsToRtdb } from "@/lib/marketing-agent/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function requireAdmin(req: NextRequest) {
  return requireGrowthAdmin(req);
}

export function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export function jsonOk<T extends Record<string, unknown>>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

/** Load admin settings; fall back to the safe defaults (§89). */
export async function loadSettings(): Promise<MarketingAgentSettings> {
  return loadSettingsFromRtdb();
}

export async function saveSettings(settings: MarketingAgentSettings, updatedBy: string): Promise<void> {
  await saveSettingsToRtdb(settings, updatedBy);
}

export function resolveMode(input: unknown, fallback: MarketingAgentMode): MarketingAgentMode {
  const value = typeof input === "string" ? input.toUpperCase() : "";
  if (value === "MANUAL" || value === "ASSISTED" || value === "AUTONOMOUS") return value;
  return fallback;
}

/**
 * Run work after the response is sent so long productions never occupy a
 * serverless request (§79, §83). Falls back to fire-and-forget when the
 * `after` helper is unavailable in this Next.js build.
 */
export function afterResponse(fn: () => Promise<unknown>): void {
  type AfterFn = (cb: () => Promise<unknown> | unknown) => void;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("next/server") as { after?: AfterFn };
    if (typeof mod.after === "function") {
      mod.after(fn);
      return;
    }
  } catch {
    /* fall through */
  }
  void fn().catch(() => undefined);
}

/** Common job payload for the UI (§43): state + live timeline + artifacts. */
export function jobView(job: Awaited<ReturnType<typeof getAgentJob>>) {
  if (!job) return null;
  return {
    id: job.id,
    jobKey: job.jobKey,
    prompt: job.prompt,
    mode: job.mode,
    state: job.state,
    cursor: job.cursor,
    tasks: job.tasks,
    artifacts: job.artifacts,
    estimatedUnits: job.estimatedUnits,
    consumedUnits: job.consumedUnits,
    approval: job.approval ?? null,
    blockedReason: job.blockedReason ?? null,
    error: job.error ?? null,
    errorCode: job.errorCode ?? null,
    planId: job.planId ?? null,
    campaignId: job.campaignId ?? null,
    creativeId: job.creativeId ?? null,
    recipeId: job.recipeId ?? null,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    durationMs: job.durationMs ?? null,
    retryCount: job.retryCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function loadJobOr404(id: string) {
  const job = await getAgentJob(id);
  return job;
}

export async function auditRoute(actor: string, action: string, detail: Record<string, unknown>) {
  await audit({ actor, action, targetType: "marketingAgentApi", targetId: "", detail });
}

export { listAgentJobs, listSocialAccounts, listSchedules, listPublishingJobs };
