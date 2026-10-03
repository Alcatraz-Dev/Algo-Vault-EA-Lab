/**
 * Marketing Agent — start a run from a natural-language instruction (§1, §2).
 *
 * The response returns immediately with the created job; production continues
 * after the response is sent so long renders never block a request (§79).
 */

import { NextRequest } from "next/server";
import { afterResponse, jsonError, jsonOk, loadSettings, requireAdmin, resolveMode } from "../_runtime";
import { createJob, resumeJob, type AgentRuntime } from "@/lib/marketing-agent/agent";
import { getAgentJob, getPlan, getRecipe } from "@/lib/marketing-agent/storage";
import { jobView } from "../_runtime";
import { containsInjectionAttempt } from "@/lib/marketing-agent/permissions";
import { DEFAULT_AGENT_SETTINGS } from "@/lib/marketing-agent/modes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKSPACE = process.env.MARKETING_AGENT_WORKSPACE || "/tmp/marketing-agent";
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    mode?: string;
    campaignId?: string;
    creativeId?: string;
    recipeId?: string;
    parentJobId?: string;
    run?: boolean;
  };

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return jsonError("A marketing instruction is required.", 422);
  if (containsInjectionAttempt(prompt)) {
    return jsonError("The instruction contains a blocked pattern and was not executed.", 422);
  }

  const settings = await loadSettings();
  const mode = resolveMode(body.mode, settings.mode);

  const created = await createJob({
    prompt,
    mode,
    actor: admin.uid,
    settings,
    ...(body.campaignId ? { campaignId: body.campaignId } : {}),
    ...(body.creativeId ? { creativeId: body.creativeId } : {}),
    ...(body.recipeId ? { recipeId: body.recipeId } : {}),
    ...(body.parentJobId ? { parentJobId: body.parentJobId } : {}),
  });

  if (!created.ok || !created.job?.id) return jsonError(created.error ?? "Could not create the run.", 400);

  const jobId = created.job.id;

  if (body.run !== false) {
    const runtimeCtx: AgentRuntime = {
      actor: admin.uid,
      mode,
      settings: settings ?? DEFAULT_AGENT_SETTINGS,
      workspaceDir: WORKSPACE,
      baseUrl: BASE_URL,
      onProgress: undefined,
    };
    afterResponse(async () => {
      try {
        await resumeJob(jobId, runtimeCtx);
      } catch {
        // Failures are persisted onto the job record by the runner itself.
      }
    });
  }

  const job = await getAgentJob(jobId);
  return jsonOk({ job: jobView(job), estimatedUnits: job?.estimatedUnits ?? 0 }, 201);
}

/** GET returns the plan + recipe for a run so the UI can render the brief. */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) return jsonError("jobId is required.", 422);

  const job = await getAgentJob(jobId);
  if (!job) return jsonError("Run not found.", 404);

  const plan = job.planId ? await getPlan(job.planId) : null;
  const recipe = job.recipeId ? await getRecipe(job.recipeId) : null;
  return jsonOk({ job: jobView(job), plan, recipe });
}
