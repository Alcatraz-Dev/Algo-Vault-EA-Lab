/** Marketing Agent — publishing jobs: list, retry, cancel (§28, §29). */

import { NextRequest } from "next/server";
import { jsonError, jsonOk, loadSettings, requireAdmin } from "../_runtime";
import { listPublishingJobs, rtdbPublishingStore } from "@/lib/marketing-agent/storage";
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

  const settings = await loadSettings();
  const store = rtdbPublishingStore();

  switch (body.action) {
    case "retry": {
      const result = await retryPublishingJob(store, body.jobId, {
        approvalGranted: true,
        accountConnected: true,
        publishingEnabled: settings.flags.marketingAgentPublishingEnabled === true,
        qaPassed: true,
      });
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
