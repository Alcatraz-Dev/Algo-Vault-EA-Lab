/**
 * Workflow Automation — RTDB persistence.
 *
 * All reads/writes go through the admin SDK. The `REF` wrapper deep-converts
 * `undefined → null` (Firebase RTDB rejects `undefined` in set/update — same
 * boundary guard as `lib/agents/database.ts`).
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { PATHS } from "./schema";
import {
    MarketplaceItem,
    NodeExecutionRecord,
    WorkflowAutomation,
    WorkflowBuildDraft,
    WorkflowRun,
} from "./types";

const REF = (path: string) => {
    const ref = adminDatabase.ref(path);
    const proxy = Object.create(ref) as typeof ref;
    proxy.set = (value: unknown) => ref.set(deepClean(value));
    proxy.update = (value: unknown) => ref.update(deepClean(value) as Record<string, unknown>);
    return proxy;
};

function deepClean<T>(value: T): T {
    if (value === undefined) return null as unknown as T;
    if (Array.isArray(value)) return value.map((v) => deepClean(v)) as unknown as T;
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            out[key] = deepClean(val);
        }
        return out as T;
    }
    return value;
}

// ─── Workflows ───────────────────────────────────────────────────────────────

export async function getWorkflow(uid: string, workflowId: string): Promise<WorkflowAutomation | null> {
    const snap = await REF(PATHS.workflow(uid, workflowId)).get();
    if (snap.exists()) return snap.val() as WorkflowAutomation;

    // Cross-user / Admin fallback search
    const allSnap = await REF("workflowAutomation").get();
    const byUser = (allSnap.val() || {}) as Record<string, Record<string, WorkflowAutomation>>;
    for (const u of Object.keys(byUser)) {
        if (byUser[u] && byUser[u][workflowId]) {
            return byUser[u][workflowId];
        }
    }
    return null;
}

export async function deleteWorkflow(uid: string, workflowId: string): Promise<void> {
    const wf = await getWorkflow(uid, workflowId);
    const targetUid = wf?.userId || uid;
    await REF(PATHS.workflow(targetUid, workflowId)).set(null);
}

export async function saveWorkflow(wf: WorkflowAutomation): Promise<void> {
    await REF(PATHS.workflow(wf.userId, wf.id)).set({
        ...wf,
        updatedAt: Date.now(),
    });
}

export async function listWorkflows(uid: string): Promise<WorkflowAutomation[]> {
    const snap = await REF(PATHS.workflows(uid)).get();
    const data = (snap.val() || {}) as Record<string, WorkflowAutomation>;
    return Object.values(data).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Admin: workflows across every user. */
export async function listAllWorkflows(): Promise<WorkflowAutomation[]> {
    const snap = await REF("workflowAutomation").get();
    const byUser = (snap.val() || {}) as Record<string, Record<string, WorkflowAutomation>>;
    const out: WorkflowAutomation[] = [];
    for (const user of Object.values(byUser)) {
        if (user && typeof user === "object") {
            out.push(...Object.values(user));
        }
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// ─── Version snapshots ───────────────────────────────────────────────────────

export async function snapshotVersion(wf: WorkflowAutomation): Promise<void> {
    await REF(PATHS.version(wf.userId, wf.id, wf.version)).set({
        ...wf,
        versionHistory: undefined,
    });
}

export async function getVersion(uid: string, workflowId: string, version: number): Promise<WorkflowAutomation | null> {
    const snap = await REF(PATHS.version(uid, workflowId, version)).get();
    return (snap.val() || null) as WorkflowAutomation | null;
}

export async function listVersions(uid: string, workflowId: string): Promise<WorkflowAutomation[]> {
    const snap = await REF(PATHS.versions(uid, workflowId)).get();
    const data = (snap.val() || {}) as Record<string, WorkflowAutomation>;
    return Object.values(data).sort((a, b) => b.version - a.version);
}

// ─── Runs ────────────────────────────────────────────────────────────────────

export async function createRun(run: WorkflowRun): Promise<void> {
    await REF(PATHS.run(run.userId, run.id)).set(run);
}

export async function updateRun(uid: string, runId: string, updates: Partial<WorkflowRun>): Promise<void> {
    await REF(PATHS.run(uid, runId)).update(updates);
}

export async function getRun(uid: string, runId: string): Promise<WorkflowRun | null> {
    const snap = await REF(PATHS.run(uid, runId)).get();
    return (snap.val() || null) as WorkflowRun | null;
}

export async function listRuns(uid: string, limit = 50): Promise<WorkflowRun[]> {
    const snap = await REF(PATHS.runs(uid)).limitToLast(limit).get();
    const data = (snap.val() || {}) as Record<string, WorkflowRun>;
    return Object.values(data).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

/** Admin: runs across every user (top N by recency). */
export async function listAllRuns(limit = 200): Promise<WorkflowRun[]> {
    const snap = await REF("workflowAutomationRuns").limitToLast(limit).get();
    const byUser = (snap.val() || {}) as Record<string, Record<string, WorkflowRun>>;
    const out: WorkflowRun[] = [];
    for (const user of Object.values(byUser)) {
        out.push(...Object.values(user));
    }
    return out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, limit);
}

// ─── Node traces ─────────────────────────────────────────────────────────────

export async function saveNodeRecord(record: NodeExecutionRecord): Promise<void> {
    await REF(PATHS.runNode(record.runId, record.nodeId)).set(record);
}

export async function getRunNodeTraces(runId: string): Promise<NodeExecutionRecord[]> {
    const snap = await REF(PATHS.runNodes(runId)).get();
    const data = (snap.val() || {}) as Record<string, NodeExecutionRecord>;
    return Object.values(data).sort((a, b) => a.startedAt - b.startedAt);
}

/** Idempotent resume: return completed node records for a run that already wrote them. */
export async function getCompletedNodesForRun(runId: string): Promise<NodeExecutionRecord[]> {
    const traces = await getRunNodeTraces(runId);
    return traces.filter((t) => t.status === "success" || t.status === "failed" || t.status === "cancelled");
}

// ─── Artifacts (signals / requests / reports) ────────────────────────────────

export async function saveSignal(uid: string, signalId: string, signal: Record<string, unknown>): Promise<void> {
    await REF(PATHS.signal(uid, signalId)).set(signal);
}

export async function saveOrderRequest(uid: string, requestId: string, request: Record<string, unknown>): Promise<void> {
    await REF(PATHS.request(uid, requestId)).set(request);
}

export async function saveReport(uid: string, reportId: string, report: Record<string, unknown>): Promise<void> {
    await REF(PATHS.report(uid, reportId)).set(report);
}

export async function listUserSignals(uid: string): Promise<Record<string, unknown>[]> {
    const snap = await REF(PATHS.signals(uid)).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    return Object.values(data) as Record<string, unknown>[];
}

// ─── Variables (storage node) ────────────────────────────────────────────────

export async function readVariable(uid: string, name: string): Promise<unknown | null> {
    const snap = await REF(`${PATHS.variables(uid)}/${name}`).get();
    return snap.val() ?? null;
}

export async function writeVariable(uid: string, name: string, value: unknown): Promise<void> {
    await REF(`${PATHS.variables(uid)}/${name}`).set(value);
}

// ─── AI drafts ───────────────────────────────────────────────────────────────

export async function saveDraft(uid: string, draft: WorkflowBuildDraft): Promise<void> {
    await REF(PATHS.draft(uid, draft.id)).set(draft);
}

export async function getDraft(uid: string, draftId: string): Promise<WorkflowBuildDraft | null> {
    const snap = await REF(PATHS.draft(uid, draftId)).get();
    return (snap.val() || null) as WorkflowBuildDraft | null;
}

export async function listDrafts(uid: string): Promise<WorkflowBuildDraft[]> {
    const snap = await REF(PATHS.drafts(uid)).get();
    const data = (snap.val() || {}) as Record<string, WorkflowBuildDraft>;
    return Object.values(data).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ─── Marketplace ─────────────────────────────────────────────────────────────

export async function listMarketplaceItems(): Promise<MarketplaceItem[]> {
    const snap = await REF(PATHS.marketplace()).get();
    const data = (snap.val() || {}) as Record<string, MarketplaceItem>;
    return Object.values(data).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getMarketplaceItem(itemId: string): Promise<MarketplaceItem | null> {
    const snap = await REF(PATHS.marketplaceItem(itemId)).get();
    return (snap.val() || null) as MarketplaceItem | null;
}

export async function upsertMarketplaceItem(item: MarketplaceItem): Promise<void> {
    await REF(PATHS.marketplaceItem(item.id)).set({ ...item, updatedAt: Date.now() });
}

export async function incrementMarketplaceInstalls(itemId: string): Promise<void> {
    const item = await getMarketplaceItem(itemId);
    if (!item) return;
    await upsertMarketplaceItem({ ...item, installs: (item.installs || 0) + 1 });
}

export async function deleteMarketplaceItem(itemId: string): Promise<void> {
    await REF(PATHS.marketplaceItem(itemId)).remove();
}

// ─── Settings / kill switch ──────────────────────────────────────────────────

export interface WorkflowGlobalSettings {
    killSwitchEnabled: boolean;
    killSwitchReason?: string;
    defaultMaxRunsPerDay: number;
    defaultMaxConcurrency: number;
    aiBuilderEnabled: boolean;
}

export const DEFAULT_GLOBAL_SETTINGS: WorkflowGlobalSettings = {
    killSwitchEnabled: false,
    defaultMaxRunsPerDay: 500,
    defaultMaxConcurrency: 8,
    aiBuilderEnabled: true,
};

export async function getGlobalSettings(): Promise<WorkflowGlobalSettings> {
    const snap = await REF(PATHS.settings("global")).get();
    const val = (snap.val() || {}) as Partial<WorkflowGlobalSettings>;
    return { ...DEFAULT_GLOBAL_SETTINGS, ...val };
}

export async function setGlobalSettings(settings: WorkflowGlobalSettings): Promise<void> {
    await REF(PATHS.settings("global")).set(settings);
}

// ─── Schedule bookkeeping ────────────────────────────────────────────────────

export interface ScheduleState {
    uid: string;
    workflowId: string;
    cron: string;
    nextRunAt: number;
    lastRunAt: number | null;
    status: "scheduled" | "idle";
}

export async function upsertSchedule(state: ScheduleState): Promise<void> {
    await REF(PATHS.schedule(state.uid, state.workflowId)).set(state);
}

export async function enqueueScheduleEntry(entry: ScheduleState): Promise<void> {
    const bucket = Math.floor(entry.nextRunAt / 300_000) * 300_000;
    await REF(`${PATHS.scheduleQueueBucket(String(bucket))}/${queueKeyFor(entry)}`).set(entry);
}

function queueKeyFor(entry: ScheduleState): string {
    return `${entry.uid}:${entry.workflowId}`;
}

export async function clearSchedule(uid: string, workflowId: string): Promise<void> {
    await REF(PATHS.schedule(uid, workflowId)).remove();
}

export async function listDueSchedules(): Promise<ScheduleState[]> {
    const now = Date.now();
    const snap = await REF("workflowAutomationSchedules").get();
    const byUser = (snap.val() || {}) as Record<string, Record<string, ScheduleState>>;
    const out: ScheduleState[] = [];
    for (const user of Object.values(byUser)) {
        for (const s of Object.values(user)) {
            if (s?.status === "scheduled" && s.nextRunAt > 0 && s.nextRunAt <= now) out.push(s);
        }
    }
    return out.sort((a, b) => a.nextRunAt - b.nextRunAt);
}

export async function readQueueBucket(bucketStart: number): Promise<ScheduleState[]> {
    const snap = await REF(PATHS.scheduleQueueBucket(String(bucketStart))).get();
    return Object.values((snap.val() || {}) as Record<string, ScheduleState>);
}

export async function removeQueueEntry(entry: ScheduleState): Promise<void> {
    await REF(`${PATHS.scheduleQueueBucket(String(bucketOf(entry.nextRunAt)))}/${queueKeyFor(entry)}`).remove();
}

function bucketOf(timestampMs: number): number {
    return Math.floor(timestampMs / 300_000) * 300_000;
}

// ─── Usage counters ──────────────────────────────────────────────────────────

export async function countRunsToday(uid: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const runs = await listRuns(uid, 1000);
    return runs.filter((r) => (r.startedAt || 0) >= startOfDay.getTime()).length;
}

export async function countWorkflows(uid: string): Promise<{ total: number; active: number }> {
    const all = await listWorkflows(uid);
    return { total: all.length, active: all.filter((w) => w.status === "active").length };
}
// Re-exports from related modules (for route convenience)
export { scheduleForWorkflow, unscheduleWorkflow } from "./scheduler";
export { executeWorkflow, cancelRun } from "./engine";
