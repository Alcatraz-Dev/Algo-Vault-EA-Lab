/** Marketing Agent — list runs (§43 command center). */

import { NextRequest } from "next/server";
import { jsonOk, jobView, listAgentJobs, requireAdmin } from "../_runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const url = new URL(req.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") || 50));
  const jobs = await listAgentJobs(limit);
  return jsonOk({ jobs: jobs.map((j) => jobView(j)) });
}

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: { "Content-Type": "application/json" } });
}
