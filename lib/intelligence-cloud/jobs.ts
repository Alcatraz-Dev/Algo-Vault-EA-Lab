/**
 * Intelligence Cloud — Asynchronous Job Lifecycle (Phase 13)
 *
 * Research and backtests are long-running. The previous implementation
 * returned a synthetic `{ status: "queued", progress: 0 }` object that was never
 * persisted and could never advance — a client polling it would wait forever
 * while the platform reported a job that did not exist.
 *
 * This module makes jobs real:
 *  - every state transition is an RTDB transaction, so it is durable and
 *    observable across serverless instances;
 *  - `progress` is only ever written by code that observed real work
 *    (`advanceJob`), never estimated from elapsed time;
 *  - transitions are validated against the state machine, so a late worker
 *    cannot resurrect a CANCELLED job;
 *  - concurrency is bounded per tenant so one tenant cannot monopolise compute.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { CLOUD_ROOT } from "./api-keys";
import type { JobStatus, ResearchJobRequest, ResearchJobStatus } from "./contracts";
import { errors, IntelligenceError } from "./errors";
import { sanitizeSegment, type TenantPlan } from "./tenancy";
import { planFor } from "./entitlements";

const TERMINAL: ReadonlySet<JobStatus> = new Set<JobStatus>(["COMPLETED", "FAILED", "CANCELLED"]);

export function isTerminal(status: JobStatus): boolean {
    return TERMINAL.has(status);
}

/** Legal transitions. Anything else is rejected, not silently coerced. */
const ALLOWED_TRANSITIONS: Record<JobStatus, ReadonlySet<JobStatus>> = {
    QUEUED: new Set<JobStatus>(["RUNNING", "CANCELLED", "FAILED"]),
    RUNNING: new Set<JobStatus>(["PAUSED", "COMPLETED", "FAILED", "CANCELLED"]),
    PAUSED: new Set<JobStatus>(["RUNNING", "CANCELLED", "FAILED"]),
    COMPLETED: new Set<JobStatus>(),
    FAILED: new Set<JobStatus>(),
    CANCELLED: new Set<JobStatus>(),
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
    return ALLOWED_TRANSITIONS[from].has(to);
}

export interface StoredJob extends ResearchJobStatus {
    /** Caller identity, for audit. */
    userId?: string;
    /** Populated once the job completes. */
    resultRef?: string;
    costUnits?: number;
}

/**
 * Enqueue a research job.
 *
 * Refuses to exceed the plan's concurrent-job ceiling, so a single tenant
 * cannot flood the research runners.
 */
export async function enqueueResearchJob(input: {
    tenantId: string;
    userId: string;
    request: ResearchJobRequest;
    plan?: TenantPlan;
}): Promise<StoredJob> {
    const { tenantId, request } = input;

    const running = await countActiveJobs(tenantId);
    const plan = planFor(input.plan);
    const ceiling = plan?.maxConcurrentResearchJobs ?? 1;
    if (running >= ceiling) {
        throw new IntelligenceError(
            "RESEARCH_RUNNING",
            `This organisation already has ${running} of ${ceiling} permitted research jobs running.`,
            { details: [{ field: "jobs", issue: `concurrent limit ${ceiling} reached` }] }
        );
    }

    const now = Date.now();
    const jobId = `job_${tenantId}_${now}_${Math.random().toString(36).slice(2, 10)}`;

    const job: StoredJob = {
        jobId,
        tenantId: sanitizeSegment(tenantId),
        type: request.type,
        symbol: request.symbol,
        timeframe: request.timeframe,
        status: "QUEUED",
        createdAt: now,
        userId: input.userId,
        // No `progress` and no `startedAt` yet — those are written by the runner
        // when it actually observes work.
    };

    await adminDatabase.ref(`${CLOUD_ROOT}/jobs/${sanitizeSegment(tenantId)}/${jobId}`).set(job);
    return job;
}

export async function getJob(tenantId: string, jobId: string): Promise<StoredJob | null> {
    const snap = await adminDatabase
        .ref(`${CLOUD_ROOT}/jobs/${sanitizeSegment(tenantId)}/${sanitizeSegment(jobId)}`)
        .get();
    return snap.exists() ? (snap.val() as StoredJob) : null;
}

async function countActiveJobs(tenantId: string): Promise<number> {
    const snap = await adminDatabase.ref(`${CLOUD_ROOT}/jobs/${sanitizeSegment(tenantId)}`).get();
    let count = 0;
    snap.forEach((child) => {
        const job = child.val() as StoredJob;
        if (job && !isTerminal(job.status)) count += 1;
    });
    return count;
}

/**
 * Move a job to a new state, atomically and only when the transition is legal.
 *
 * Uses an RTDB transaction so a concurrent cancel cannot be overwritten by a
 * worker that still believes it owns the job.
 */
export async function transitionJob(
    tenantId: string,
    jobId: string,
    to: JobStatus,
    patch: Partial<Pick<StoredJob, "progress" | "stage" | "error" | "resultRef" | "startedAt" | "completedAt" | "engineVersions">> = {}
): Promise<StoredJob> {
    const ref = adminDatabase.ref(`${CLOUD_ROOT}/jobs/${sanitizeSegment(tenantId)}/${sanitizeSegment(jobId)}`);
    let rejected: string | null = null;

    const result = await ref.transaction((current: StoredJob | null) => {
        if (!current) {
            rejected = "not_found";
            return current;
        }
        if (current.status === to) return current; // idempotent no-op
        if (!canTransition(current.status, to)) {
            rejected = `${current.status}->${to}`;
            return current; // abort
        }
        const now = Date.now();
        const next: StoredJob = {
            ...current,
            ...patch,
            status: to,
            ...(to === "RUNNING" ? { startedAt: patch.startedAt ?? current.startedAt ?? now } : {}),
            ...(isTerminal(to) ? { completedAt: patch.completedAt ?? now } : {}),
        };
        if (isTerminal(to)) {
            next.progress = to === "COMPLETED" ? 100 : current.progress;
        }
        return next;
    });

    const current = result.snapshot?.val() as StoredJob | null;
    if (rejected === "not_found") throw errors.notFound("Research job not found.");
    if (rejected) {
        throw errors.invalidRequest(`Illegal job transition: ${rejected}.`, [
            { field: "status", issue: rejected },
        ]);
    }
    return current as StoredJob;
}

/**
 * Record *observed* progress.
 *
 * The caller must pass a value it derived from work it actually performed.
 * Monotonicity is enforced so an out-of-order or retried update cannot make a
 * job appear to move backwards.
 */
export async function advanceJob(
    tenantId: string,
    jobId: string,
    progress: number,
    stage?: string
): Promise<StoredJob> {
    const clamped = Math.max(0, Math.min(99, Math.round(progress)));
    const ref = adminDatabase.ref(`${CLOUD_ROOT}/jobs/${sanitizeSegment(tenantId)}/${sanitizeSegment(jobId)}`);
    let rejected: string | null = null;

    const result = await ref.transaction((current: StoredJob | null) => {
        if (!current || isTerminal(current.status)) {
            rejected = "not_runnable";
            return current;
        }
        return {
            ...current,
            status: "RUNNING" as JobStatus,
            startedAt: current.startedAt ?? Date.now(),
            progress: Math.max(current.progress ?? 0, clamped),
            ...(stage ? { stage } : {}),
        };
    });

    if (rejected) throw errors.invalidRequest("Job is not in a runnable state.", [{ field: "job", issue: rejected }]);
    return result.snapshot?.val() as StoredJob;
}

export async function cancelJob(tenantId: string, jobId: string): Promise<StoredJob> {
    return transitionJob(tenantId, jobId, "CANCELLED");
}

/** List a tenant's jobs, newest first. */
export async function listJobs(tenantId: string, limit = 25): Promise<StoredJob[]> {
    const snap = await adminDatabase
        .ref(`${CLOUD_ROOT}/jobs/${sanitizeSegment(tenantId)}`)
        .orderByChild("createdAt")
        .limitToLast(limit)
        .get();
    const out: StoredJob[] = [];
    snap.forEach((child) => {
        out.push(child.val() as StoredJob);
    });
    return out.sort((a, b) => b.createdAt - a.createdAt);
}
