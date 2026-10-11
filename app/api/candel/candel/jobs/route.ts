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

// PATCH /api/candel/candel/jobs/[candelId] — pause or resume a scheduled job
//
// Pausing keeps the job (and its run history) and only stops the schedule being
// eligible to fire, which is what a user wants when a job is misbehaving —
// cancelling would lose the record they are looking at.
export async function PATCH(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const jobId = searchParams.get("jobId");
    if (!candelId || !jobId) {
      return NextResponse.json({ success: false, error: "candelId and jobId required" }, { status: 400 });
    }

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { enabled } = body as { enabled?: boolean };
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ success: false, error: "enabled must be a boolean" }, { status: 400 });
    }

    const jobs = await getCandelJobs(candelId, token.uid);
    const existing = jobs.find((job) => job.id === jobId);
    if (!existing) {
      return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
    }

    // Only scheduling changes. `status` keeps reporting the last real outcome:
    // the JobStatus enum has no "paused", and tagging a paused job `cancelled`
    // reads as "this job is gone" when it is only asleep. The UI pairs the
    // unchanged status with a `paused` badge off `enabled`.
    const job: CandelJob = {
      ...existing,
      enabled,
      // A pause keeps the stored slot, so the schedule survives the round trip
      // instead of being wiped (the earlier version zeroed it, which left a
      // resumed job permanently unscheduled). Resuming a slot that already
      // passed makes the job due now rather than silently skipping it.
      nextRunAt:
        enabled && existing.nextRunAt <= Date.now() ? Date.now() : existing.nextRunAt,
      updatedAt: Date.now(),
    };

    await saveCandelJob(job);
    return NextResponse.json({ success: true, job });
  } catch (error) {
    console.error("[candel/jobs PATCH]", error);
    return NextResponse.json({ success: false, error: "Failed to update job" }, { status: 500 });
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
    if (!candelId || !jobId) {
      return NextResponse.json({ success: false, error: "candelId and jobId required" }, { status: 400 });
    }

    await requireCandelOwner(candelId, token.uid);

    await deleteCandelJob(jobId, candelId, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/jobs DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to cancel job" }, { status: 500 });
  }
}
