/** Marketing Agent — publishing jobs: list, retry, cancel (§28, §29). */

import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAdmin } from "../_runtime";
import { getPublishingJob, listPublishingJobs, rtdbPublishingStore } from "@/lib/marketing-agent/storage";
import { productionPublishContextDeps, resolvePublishContext } from "@/lib/marketing-agent/publishing/guards";
import { cancelPublishingJob, retryPublishingJob } from "@/lib/marketing-agent/publishing/engine";
import { PUBLISHING_STATE_HELP } from "@/lib/marketing-agent/publishing/state-machine";
import { capabilityMatrix } from "@/lib/marketing-agent/publishing/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? undefined;
  const campaignId = url.searchParams.get("campaignId") ?? undefined;

  const jobs = await listPublishingJobs({
    ...(state ? { state } : {}),
    ...(campaignId ? { campaignId } : {}),
  });

  return jsonOk({
    jobs,
    capabilities: capabilityMatrix(),
    transitions: PUBLISHING_STATE_HELP,
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const body = (await req.json().catch(() => ({}))) as { action?: string; jobId?: string };
  if (!body.jobId) return jsonError("jobId is required.", 422);

  const store = rtdbPublishingStore();

  switch (body.action) {
    case "retry": {
      // Manual retries get the same live guards as scheduled ones (kill switch, approval, account, QA).
      const job = await getPublishingJob(body.jobId);
      if (!job) return jsonError("Publishing job not found.", 404);
      const context = await resolvePublishContext(job, await productionPublishContextDeps());
      const result = await retryPublishingJob(store, body.jobId, context);
      return jsonOk({ result });
    }
    case "cancel": {
      const result = await cancelPublishingJob(store, body.jobId);
      return jsonOk({ result });
    }
    default:
      return jsonError(`Unknown action "${body.action}".`, 422);
  }
}
