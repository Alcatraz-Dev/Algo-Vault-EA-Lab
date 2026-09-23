/**
 * Workflow Automation — schedule driver.
 *
 * Scheduling survives restarts because all state lives in RTDB
 * (workflowAutomationSchedules + a bucketed due-queue). A Vercel cron hits
 * `/api/workflows/scheduler/tick` every minute; `runDueScheduledWorkflows`
 * claims due schedules transactionally (safe against overlapping ticks),
 * executes them, and re-enqueues the next occurrence.
 *
 * Rescheduling cadence:
 *   1. activate  → scheduleForWorkflow() computes nextRunAt + enqueues bucket
 *   2. tick      → claim due → run → compute next → enqueue
 *   3. pause/archive → unscheduleWorkflow() removes state + queue
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { PATHS, scheduleBucketFor } from "./schema";
import { nextRunAt } from "./cron";
import { executeWorkflow } from "./engine";
import {
    clearSchedule,
    getWorkflow,
    listDueSchedules,
    removeQueueEntry,
    ScheduleState,
    upsertSchedule,
} from "./database";
import { resolveEntitlement, collectUsage, runsBudgetExhausted, isKillSwitchOn } from "./limits";

export interface SchedulePlan {
    ok: boolean;
    error?: string;
    nextRunAt?: number;
}

/** Computes the next run from the workflow's schedule config. */
export function planNextRun(cron: string, fromMs: number): number | null {
    return nextRunAt(cron, fromMs);
}

/**
 * Registers/updates a schedule for a workflow with an enabled cron schedule.
 * Writes the state row + enqueues the first due bucket.
 */
export async function scheduleForWorkflow(uid: string, workflowId: string, cron: string, fromMs = Date.now()): Promise<SchedulePlan> {
    const next = planNextRun(cron, fromMs);
    if (next === null) return { ok: false, error: "Cron produced no future run within a year — check the expression." };
    const state: ScheduleState = {
        uid,
        workflowId,
        cron,
        nextRunAt: next,
        lastRunAt: null,
        status: "scheduled",
    };
    await upsertSchedule(state);
    await enqueue(uid, workflowId, next);
    return { ok: true, nextRunAt: next };
}

/** Reads schedule state for a workflow. */
export async function getScheduleState(uid: string, workflowId: string): Promise<ScheduleState | null> {
    const snap = await adminDatabase.ref(PATHS.schedule(uid, workflowId)).get();
    return (snap.val() || null) as ScheduleState | null;
}

async function enqueue(uid: string, workflowId: string, nextRunAtMs: number): Promise<void> {
    const bucket = scheduleBucketFor(nextRunAtMs);
    const key = `${uid}:${workflowId}`;
    await adminDatabase.ref(`${PATHS.scheduleQueueBucket(String(bucket))}/${key}`).set({
        uid,
        workflowId,
        cron: "",
        nextRunAt: nextRunAtMs,
        lastRunAt: null,
        status: "scheduled",
    });
}

async function dequeue(uid: string, workflowId: string, bucket: number): Promise<void> {
    const key = `${uid}:${workflowId}`;
    await adminDatabase.ref(`${PATHS.scheduleQueueBucket(String(bucket))}/${key}`).remove();
}

/**
 * Atomically claims a due schedule so two overlapping tick invocations never
 * run the same workflow twice. Returns the claimed state or null.
 */
/**
 * Atomically claims a due schedule so two overlapping tick invocations never
 * run the same workflow twice. Returns the claimed state or null.
 *
 * Firebase semantics: the update function runs first with the local value
 * (null when not cached) and is re-run by the server with the real value when
 * they differ. Return undefined ABORTS the transaction before the reach the
 * server, so we never abort — we return the current value as a no-op. The
 * `transitioned` flag records whether THIS callback actually moved the entry
 * from scheduled → idle; a losing worker observes idle and no-ops, so its
 * `transitioned` stays false and it can never treat the idle entry as its own
 * claim.
 */
async function claimDue(uid: string, workflowId: string, dueBefore: number): Promise<ScheduleState | null> {
    const ref = adminDatabase.ref(PATHS.schedule(uid, workflowId));
    let transitioned = false;
    const tx = await ref.transaction((current) => {
        const state = (current ?? null) as ScheduleState | null;
        if (!state || state.status !== "scheduled") return current; // no-op, never abort
        if (!(state.nextRunAt > 0) || state.nextRunAt > dueBefore) return current;
        transitioned = true;
        return { ...state, status: "idle" };
    });
    if (!tx.committed || !transitioned) return null;
    const data = tx.snapshot.val() as ScheduleState | null;
    return data && data.status === "idle" ? data : null;
}

export interface TickSummary {
    matched: number;
    claimed: number;
    ran: number;
    skipped: string[];
    errors: string[];
}

/**
 * Tick entry point — invoked by the cron route. Scans schedule state for due
 * workflows, claims + runs them, then reschedules from the cron expression.
 */
export async function runDueScheduledWorkflows(now = Date.now(), maxRuns = 10): Promise<TickSummary> {
    const summary: TickSummary = { matched: 0, claimed: 0, ran: 0, skipped: [], errors: [] };
    if (await isKillSwitchOn()) {
        summary.skipped.push("kill-switch");
        return summary;
    }

    const due = await listDueSchedules();
    summary.matched = due.length;
    for (const entry of due.slice(0, maxRuns)) {
        const claimed = await claimDue(entry.uid, entry.workflowId, now);
        if (!claimed) {
            summary.skipped.push(`${entry.uid}/${entry.workflowId}:claim-failed`);
            continue;
        }
        summary.claimed += 1;

        const workflow = await getWorkflow(entry.uid, entry.workflowId);
        if (!workflow || workflow.status !== "active" || !workflow.schedule?.enabled) {
            await clearSchedule(entry.uid, entry.workflowId);
            summary.skipped.push(`${entry.uid}/${entry.workflowId}:not-active`);
            continue;
        }

        const ent = await resolveEntitlement(entry.uid, false);
        if (!ent.allowed || !ent.limits.schedulesEnabled) {
            await reschedule(entry, summary);
            summary.skipped.push(`${entry.uid}/${entry.workflowId}:plan-restricted`);
            continue;
        }
        const usage = await collectUsage(ent);
        if (runsBudgetExhausted(ent, usage)) {
            await reschedule(entry, summary);
            summary.skipped.push(`${entry.uid}/${entry.workflowId}:run-budget`);
            continue;
        }

        try {
            await dequeue(entry.uid, entry.workflowId, scheduleBucketFor(entry.nextRunAt));
            const outcome = await executeWorkflow({
                uid: entry.uid,
                isAdmin: false,
                workflow,
                trigger: "schedule",
                triggerDetail: `cron:${workflow.schedule.cron}`,
                permitted: {
                    analysis: true,
                    signal: ent.limits.executionEnabled,
                    execution: ent.limits.executionEnabled,
                },
            });
            void outcome;
            summary.ran += 1;
        } catch (err) {
            summary.errors.push(`${entry.uid}/${entry.workflowId}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            await reschedule(entry, summary);
        }
    }
    return summary;
}

/** Reschedules a claimed entry for its next occurrence (or clears it). */
async function reschedule(entry: ScheduleState, summary: TickSummary): Promise<void> {
    const workflow = await getWorkflow(entry.uid, entry.workflowId).catch(() => null);
    if (workflow?.schedule?.enabled && workflow.status === "active" && workflow.schedule.cron) {
        const next = planNextRun(workflow.schedule.cron, Date.now());
        if (next === null) {
            await clearSchedule(entry.uid, entry.workflowId);
            return;
        }
        const state: ScheduleState = {
            uid: entry.uid,
            workflowId: entry.workflowId,
            cron: workflow.schedule.cron,
            nextRunAt: next,
            lastRunAt: Date.now(),
            status: "scheduled",
        };
        await upsertSchedule(state);
        await enqueue(entry.uid, entry.workflowId, next);
    } else {
        await clearSchedule(entry.uid, entry.workflowId);
    }
}

/** Removes all schedule state for a workflow (pause / disable / archive). */
export async function unscheduleWorkflow(uid: string, workflowId: string): Promise<void> {
    const state = await getScheduleState(uid, workflowId);
    if (state) await dequeue(uid, workflowId, scheduleBucketFor(state.nextRunAt));
    await clearSchedule(uid, workflowId);
}