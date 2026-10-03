/** Marketing Agent — single run: progress, resume, cancel, approval (§4, §40, §43). */

import { NextRequest } from "next/server";
import { jsonError, jsonOk, jobView, loadSettings, requireAdmin, resolveMode } from "../../_runtime";
import { cancelJob, decideApproval, resumeJob, type AgentRuntime } from "@/lib/marketing-agent/agent";
import { getAgentJob, getPlan, getRecipe, listVersions, listPublishingJobs, listSchedules } from "@/lib/marketing-agent/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKSPACE = process.env.MARKETING_AGENT_WORKSPACE || "/tmp/marketing-agent";
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(_req);
  if (!admin) return jsonError("Admin required", 403);

  const { id } = await params;
  const job = await getAgentJob(id);
  if (!job) return jsonError("Run not found.", 404);

  const plan = job.planId ? await getPlan(job.planId) : null;
  const versions = job.creativeId ? await listVersions(job.creativeId) : [];
  const publishing = await listPublishingJobs({ ...(job.campaignId ? { campaignId: job.campaignId } : {}) });
  const schedules = job.creativeId ? (await listSchedules()).filter((s) => s.jobId === job.id) : [];

  return jsonOk({
    job: jobView(job),
    plan,
    recipe: job.recipeId ? await getRecipe(job.recipeId) : null,
    versions,
    publishing,
    schedules,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string; mode?: string };
  const action = String(body.action ?? "");

  const job = await getAgentJob(id);
  if (!job) return jsonError("Run not found.", 404);

  const settings = await loadSettings();

  switch (action) {
    case "approve":
    case "reject": {
      const result = await decideApproval({
        jobId: id,
        decision: action === "approve" ? "APPROVED" : "REJECTED",
        actor: admin.uid,
        ...(body.reason ? { reason: body.reason } : {}),
      });
      if (!result.ok) return jsonError(result.reason, 409);
      if (action === "approve") {
        const runtimeCtx: AgentRuntime = {
          actor: admin.uid,
          mode: job.mode,
          settings,
          workspaceDir: WORKSPACE,
          baseUrl: BASE_URL,
        };
        // Continue the run after the response so the UI is not blocked.
        const { afterResponse } = await import("../../_runtime");
        afterResponse(async () => {
          try {
            await resumeJob(id, runtimeCtx);
          } catch {
            /* persisted on the job record */
          }
        });
      }
      const refreshed = await getAgentJob(id);
      return jsonOk({ job: jobView(refreshed), reason: result.reason });
    }

    case "resume": {
      const runtimeCtx: AgentRuntime = {
        actor: admin.uid,
        mode: resolveMode(body.mode, job.mode),
        settings,
        workspaceDir: WORKSPACE,
        baseUrl: BASE_URL,
      };
      const { afterResponse } = await import("../../_runtime");
      let outcome: { ok: boolean; reason?: string } = { ok: true };
      afterResponse(async () => {
        try {
          outcome = await resumeJob(id, runtimeCtx);
        } catch {
          /* persisted on the job record */
        }
      });
      const refreshed = await getAgentJob(id);
      return jsonOk({ job: jobView(refreshed), resumed: true, note: outcome.reason });
    }

    case "cancel": {
      const result = await cancelJob(id, admin.uid);
      if (!result.ok) return jsonError(result.reason, 409);
      const refreshed = await getAgentJob(id);
      return jsonOk({ job: jobView(refreshed), reason: result.reason });
    }

    default:
      return jsonError(`Unknown action "${action}".`, 422);
  }
}
