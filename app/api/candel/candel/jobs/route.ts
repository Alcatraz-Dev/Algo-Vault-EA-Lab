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

    const job: CandelJob = {
      ...existing,
      enabled,
      // A paused job is not queued: the status must not promise a run that the
      // scheduler will skip. Resuming returns it to the queue.
      status: enabled ? (existing.status === "running" ? "running" : "queued") : "cancelled",
      nextRunAt: enabled ? existing.nextRunAt : 0,
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
