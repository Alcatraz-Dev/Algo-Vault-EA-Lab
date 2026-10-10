import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getCandelJobs, saveCandelJob, deleteCandelJob } from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelJob } from "@/lib/candel/types";

// GET /api/candel/candel/jobs/[candelId] — list scheduled jobs
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const jobs = await getCandelJobs(candelId, token.uid);
    return NextResponse.json({ success: true, jobs });
  } catch (error) {
    console.error("[candel/jobs GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load jobs" }, { status: 500 });
  }
}

// POST /api/candel/candel/jobs/[candelId] — create a scheduled job
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { name, cron, action, enabled, payload } = body;

    if (!name || !cron || !action) {
      return NextResponse.json({ success: false, error: "name, cron, action required" }, { status: 400 });
    }

    const job: CandelJob = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      kind: "cron",
      spec: cron,
      enabled: enabled ?? true,
      lastRunAt: undefined,
      nextRunAt: Date.now() + 60000,
      status: "queued",
      error: undefined,
      auditRef: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveCandelJob(job);
    return NextResponse.json({ success: true, job }, { status: 201 });
  } catch (error) {
    console.error("[candel/jobs POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create job" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/jobs/[candelId] — cancel a job
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const jobId = searchParams.get("jobId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    await deleteCandelJob(jobId || "", candelId, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/jobs DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to cancel job" }, { status: 500 });
  }
}
