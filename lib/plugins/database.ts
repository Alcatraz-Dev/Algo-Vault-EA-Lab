import { adminDatabase } from "@/lib/firebase-admin";
import {
    PluginExecutionRecord,
    PluginInstallation,
    PluginConfig,
    PluginRecord,
    PluginRuntimeState,
    PluginRating,
    PluginLicenseRecord,
    ExtensionInstallation,
} from "./types";

/**
 * Server-side data access layer for the plugin ecosystem.
 * All mutations that touch plugin data go through this module so the
 * security boundaries stay in one place (no arbitrary client writes).
 */

export type PluginReview = {
    id: string;
    pluginId: string;
    userId: string;
    userName: string;
    rating: number;
    comment: string;
    status: "pending" | "published" | "rejected";
    createdAt: number;
};

const emptyDistribution = (): PluginRating["distribution"] => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

// ─── Catalog ────────────────────────────────────────────────────────────────

export async function getPluginRecord(id: string): Promise<PluginRecord | null> {
    const snap = await adminDatabase.ref(`plugins/${id}`).get();
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    return { ...(val as PluginRecord), id };
}

export async function getExtensionRecord(id: string): Promise<PluginRecord | null> {
    const snap = await adminDatabase.ref(`plugins/${id}`).get();
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    const rec = val as PluginRecord;
    if (rec.type !== "extension") return null;
    return { ...rec, id };
}

export async function listPublishedRecords(kind: "plugin" | "extension"): Promise<PluginRecord[]> {
    const snap = await adminDatabase.ref("plugins").get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    const out: PluginRecord[] = [];
    for (const [id, raw] of Object.entries(data)) {
        if (!raw || typeof raw !== "object") continue;
        const rec = raw as PluginRecord;
        if (rec.status !== "published") continue;
        if (rec.type !== kind) continue;
        out.push({ ...rec, id });
    }
    return out.sort((a, b) => (b.lastUpdated || b.createdAt || 0) - (a.lastUpdated || a.createdAt || 0));
}

export async function listAllRecords(): Promise<PluginRecord[]> {
    const snap = await adminDatabase.ref("plugins").get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    const out: PluginRecord[] = [];
    for (const [id, raw] of Object.entries(data)) {
        if (!raw || typeof raw !== "object") continue;
        out.push({ ...(raw as PluginRecord), id });
    }
    return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Removes a catalog record and every user-scoped piece of state that depends
 * on it (installations, configs, runtime state, executions, logs, alert
 * state/counters, notifications and extensions inherit the same shape).
 * Licenses are deliberately left intact so order/payment history stays valid.
 */
export async function deletePluginCatalogRecord(pluginId: string): Promise<void> {
    await adminDatabase.ref(`plugins/${pluginId}`).remove();
    await adminDatabase.ref(`pluginReviews/${pluginId}`).remove();

    const cleanUser = async (userId: string) => {
        const ops: Promise<unknown>[] = [
            adminDatabase.ref(`pluginInstallations/${userId}/${pluginId}`).remove(),
            adminDatabase.ref(`pluginConfigs/${userId}/${pluginId}`).remove(),
            adminDatabase.ref(`pluginRuntimeState/${userId}/${pluginId}`).remove(),
            adminDatabase.ref(`pluginRuntimeStateIndex/${userId}/${pluginId}`).remove(),
            adminDatabase.ref(`pluginExecutions/${userId}/${pluginId}`).remove(),
            adminDatabase.ref(`pluginLogs/${userId}/${pluginId}`).remove(),
            adminDatabase.ref(`pluginAlertState/${userId}/${pluginId}`).remove(),
            adminDatabase.ref(`pluginAlertCounts/${userId}/${pluginId}`).remove(),
            adminDatabase.ref(`pluginNotifications/${userId}/${pluginId}`).remove(),
            adminDatabase.ref(`extensionInstallations/${userId}/${pluginId}`).remove(),
        ];
        await Promise.all(ops);
    };

    // Discover affected users from both installation indexes (covers plugins + extensions).
    const users = new Set<string>();
    for (const index of ["pluginInstallations", "extensionInstallations"] as const) {
        const snap = await adminDatabase.ref(index).get();
        snap.forEach((userSnap) => {
            const value = userSnap.val() as Record<string, unknown> | null;
            if (value && typeof value === "object" && pluginId in value) users.add(userSnap.key as string);
        });
    }
    await Promise.all([...users].map(cleanUser));
}

// ─── Installations ──────────────────────────────────────────────────────────

export async function getInstallation(userId: string, pluginId: string): Promise<PluginInstallation | null> {
    const snap = await adminDatabase.ref(`pluginInstallations/${userId}/${pluginId}`).get();
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    return { ...(val as PluginInstallation), pluginId, userId };
}

export async function listInstallations(userId: string): Promise<PluginInstallation[]> {
    const snap = await adminDatabase.ref(`pluginInstallations/${userId}`).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    const out: PluginInstallation[] = [];
    for (const [pluginId, raw] of Object.entries(data)) {
        if (!raw || typeof raw !== "object") continue;
        out.push({ ...(raw as PluginInstallation), pluginId, userId });
    }
    return out.sort((a, b) => (Number(b.installedAt || 0)) - (Number(a.installedAt || 0)));
}

export async function setInstallation(userId: string, installation: PluginInstallation): Promise<void> {
    await adminDatabase.ref(`pluginInstallations/${userId}/${installation.pluginId}`).set({
        ...installation,
        updatedAt: Date.now(),
    });
}

export async function updateInstallation(userId: string, pluginId: string, patch: Partial<PluginInstallation>): Promise<void> {
    await adminDatabase.ref(`pluginInstallations/${userId}/${pluginId}`).update({
        ...patch,
        updatedAt: Date.now(),
    });
}

export async function removeInstallation(userId: string, pluginId: string): Promise<void> {
    await adminDatabase.ref(`pluginInstallations/${userId}/${pluginId}`).remove();
}

// ─── Configs ────────────────────────────────────────────────────────────────

export async function getPluginConfig(userId: string, pluginId: string): Promise<PluginConfig | null> {
    const snap = await adminDatabase.ref(`pluginConfigs/${userId}/${pluginId}`).get();
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    return { ...(val as PluginConfig), pluginId, userId };
}

export async function setPluginConfig(userId: string, config: PluginConfig): Promise<void> {
    await adminDatabase.ref(`pluginConfigs/${userId}/${config.pluginId}`).set({
        ...config,
        updatedAt: Date.now(),
    });
}

export async function removePluginConfig(userId: string, pluginId: string): Promise<void> {
    await adminDatabase.ref(`pluginConfigs/${userId}/${pluginId}`).remove();
}

// ─── Runtime state ──────────────────────────────────────────────────────────

export async function getRuntimeState(userId: string, pluginId: string): Promise<PluginRuntimeState | null> {
    const snap = await adminDatabase.ref(`pluginRuntimeState/${userId}/${pluginId}`).get();
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    return { ...(val as PluginRuntimeState), userId, pluginId };
}

export async function setRuntimeState(state: PluginRuntimeState): Promise<void> {
    await adminDatabase.ref(`pluginRuntimeState/${state.userId}/${state.pluginId}`).set({
        ...state,
        updatedAt: Date.now(),
    });
    await adminDatabase.ref(`pluginRuntimeStateIndex/${state.userId}/${state.pluginId}`).set(true);
}

export async function listRuntimeStates(userId: string): Promise<PluginRuntimeState[]> {
    const snap = await adminDatabase.ref(`pluginRuntimeState/${userId}`).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    const out: PluginRuntimeState[] = [];
    for (const [pluginId, raw] of Object.entries(data)) {
        if (!raw || typeof raw !== "object") continue;
        out.push({ ...(raw as PluginRuntimeState), pluginId, userId });
    }
    return out;
}

/**
 * Lists all runtime states across users (used by the scheduler tick).
 * Mirrors the user_bots scan + index pattern used elsewhere in the app.
 */
export async function listAllRuntimeStates(): Promise<PluginRuntimeState[]> {
    const snap = await adminDatabase.ref("pluginRuntimeState").get();
    const data = (snap.val() || {}) as Record<string, Record<string, unknown>>;
    const out: PluginRuntimeState[] = [];
    for (const [userId, pluginMap] of Object.entries(data)) {
        if (!pluginMap || typeof pluginMap !== "object") continue;
        for (const [pluginId, raw] of Object.entries(pluginMap)) {
            if (!raw || typeof raw !== "object") continue;
            out.push({ ...(raw as PluginRuntimeState), userId, pluginId });
        }
    }
    return out;
}

// ─── Executions & logs ──────────────────────────────────────────────────────

export async function recordExecution(userId: string, exec: PluginExecutionRecord): Promise<void> {
    await adminDatabase.ref(`pluginExecutions/${userId}/${exec.pluginId}/${exec.id}`).set(exec);
}

export async function listExecutions(userId: string, pluginId: string, limit = 30): Promise<PluginExecutionRecord[]> {
    const snap = await adminDatabase.ref(`pluginExecutions/${userId}/${pluginId}`).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    return Object.entries(data)
        .map(([id, raw]) => ({ id, ...(raw as Omit<PluginExecutionRecord, "id">) }))
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
        .slice(0, limit);
}

export async function writePluginLog(userId: string, pluginId: string, entry: { level: string; message: string; meta?: Record<string, unknown> }): Promise<void> {
    await adminDatabase.ref(`pluginLogs/${userId}/${pluginId}`).push({
        level: entry.level,
        message: entry.message,
        meta: entry.meta || {},
        createdAt: Date.now(),
    });
}

// ─── Events (internal bus) ──────────────────────────────────────────────────

export async function pushBusEvent(userId: string, event: { type: string; sourcePlugin: string; payload: Record<string, unknown> }): Promise<void> {
    await adminDatabase.ref(`pluginEvents/${userId}`).push({
        ...event,
        timestamp: Date.now(),
    });
}

export async function listBusEvents(userId: string, limit = 50): Promise<Record<string, unknown>[]> {
    const snap = await adminDatabase.ref(`pluginEvents/${userId}`).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    return Object.entries(data)
        .map(([id, raw]) => ({ id, ...(raw as Record<string, unknown>) }) as Record<string, unknown>)
        .filter((v) => v && typeof v === "object")
        .sort((a, b) => Number((b as Record<string, unknown>).timestamp || 0) - Number((a as Record<string, unknown>).timestamp || 0))
        .slice(0, limit);
}

// ─── Reviews & ratings ──────────────────────────────────────────────────────

export async function addPluginReview(review: Omit<PluginReview, "id" | "createdAt">): Promise<PluginReview> {
    const ref = adminDatabase.ref(`pluginReviews/${review.pluginId}`).push();
    const rec: PluginReview = { ...review, id: ref.key || "", createdAt: Date.now() };
    await ref.set({ ...rec, id: undefined });
    await recalculatePluginRating(review.pluginId);
    return rec;
}

export async function listPluginReviews(pluginId: string): Promise<PluginReview[]> {
    const snap = await adminDatabase.ref(`pluginReviews/${pluginId}`).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    return Object.entries(data)
        .map(([id, raw]) => ({ id, ...(raw as Omit<PluginReview, "id">) }))
        .filter((r) => r.status === "published")
        .sort((a, b) => b.createdAt - a.createdAt);
}

export async function recalculatePluginRating(pluginId: string): Promise<PluginRating> {
    const snap = await adminDatabase.ref(`pluginReviews/${pluginId}`).get();
    const data = (snap.val() || {}) as Record<string, { rating?: number; status?: string }>;
    const distribution = emptyDistribution();
    let count = 0;
    let total = 0;
    for (const raw of Object.values(data)) {
        if (!raw || raw.status !== "published") continue;
        const rating = Number(raw.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) continue;
        count += 1;
        total += rating;
        distribution[rating as 1 | 2 | 3 | 4 | 5] += 1;
    }
    const rating: PluginRating = { average: count > 0 ? Math.round((total / count) * 10) / 10 : 0, count, distribution, updatedAt: Date.now() };
    await adminDatabase.ref(`plugins/${pluginId}/rating`).set(rating);
    return rating;
}

// ─── Licenses (paid plugins) ────────────────────────────────────────────────

export async function getPluginLicense(userId: string, pluginId: string): Promise<PluginLicenseRecord | null> {
    const snap = await adminDatabase.ref(`pluginLicenses/${userId}/${pluginId}`).get();
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    return { ...(val as PluginLicenseRecord), userId, pluginId };
}

export async function setPluginLicense(license: PluginLicenseRecord): Promise<void> {
    await adminDatabase.ref(`pluginLicenses/${license.userId}/${license.pluginId}`).set(license);
}

export async function listPluginLicenses(userId: string): Promise<PluginLicenseRecord[]> {
    const snap = await adminDatabase.ref(`pluginLicenses/${userId}`).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    return Object.entries(data)
        .map(([pluginId, raw]) => ({ ...(raw as Omit<PluginLicenseRecord, "pluginId">), pluginId }))
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

// ─── Extension installs ─────────────────────────────────────────────────────

export async function setExtensionInstallation(userId: string, install: ExtensionInstallation): Promise<void> {
    await adminDatabase.ref(`extensionInstallations/${userId}/${install.extensionId}`).set({ ...install, updatedAt: Date.now() });
}

export async function getExtensionInstallation(userId: string, extensionId: string): Promise<ExtensionInstallation | null> {
    const snap = await adminDatabase.ref(`extensionInstallations/${userId}/${extensionId}`).get();
    const val = snap.val();
    if (!val || typeof val !== "object") return null;
    return { ...(val as ExtensionInstallation), userId, extensionId };
}

export async function listExtensionInstallations(userId: string): Promise<ExtensionInstallation[]> {
    const snap = await adminDatabase.ref(`extensionInstallations/${userId}`).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    return Object.entries(data)
        .map(([extensionId, raw]) => ({ ...(raw as Omit<ExtensionInstallation, "extensionId">), extensionId }))
        .sort((a, b) => (b.installedAt || 0) - (a.installedAt || 0));
}

export async function removeExtensionInstallation(userId: string, extensionId: string): Promise<void> {
    await adminDatabase.ref(`extensionInstallations/${userId}/${extensionId}`).remove();
}

// ─── Counters ───────────────────────────────────────────────────────────────

export async function incrementCatalogCounter(pluginId: string, field: "installs" | "activeUsers", delta: number): Promise<void> {
    const ref = adminDatabase.ref(`plugins/${pluginId}/${field}`);
    const current = (await ref.get()).val() as number | null;
    const next = Math.max(0, (Number(current) || 0) + delta);
    await ref.set(next);
    await adminDatabase.ref(`plugins/${pluginId}/lastUpdated`).set(Date.now());
}

// ─── Drafts & generation jobs ───────────────────────────────────────────────

/**
 * Recursively strips `undefined` values from an object. Firebase Realtime
 * Database rejects `undefined` anywhere in the value tree, so any optional
 * field that resolves to undefined (e.g. pricing.intervalMonths on a free
 * plugin) must be removed before writing.
 */
function stripUndefined(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripUndefined);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (v === undefined) continue;
            out[k] = stripUndefined(v);
        }
        return out;
    }
    return value;
}

export async function saveDraft(draft: { id: string; [key: string]: unknown }): Promise<void> {
    await adminDatabase.ref(`pluginDrafts/${draft.id}`).set(stripUndefined(draft));
}

export async function getDraft(id: string): Promise<Record<string, unknown> | null> {
    const snap = await adminDatabase.ref(`pluginDrafts/${id}`).get();
    const val = snap.val();
    return val && typeof val === "object" ? (val as Record<string, unknown>) : null;
}

export async function listDrafts(): Promise<Record<string, unknown>[]> {
    const snap = await adminDatabase.ref("pluginDrafts").get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    return Object.entries(data)
        .map(([id, raw]) => ({ id, ...(raw as Record<string, unknown>) }) as { id: string; createdAt?: unknown } & Record<string, unknown>)
        .sort((a, b) => (Number(b.createdAt || 0)) - (Number(a.createdAt || 0)));
}

export async function saveGenerationJob(job: { id: string; [key: string]: unknown }): Promise<void> {
    await adminDatabase.ref(`pluginGenerationJobs/${job.id}`).set(job);
}

export async function listGenerationJobs(): Promise<Record<string, unknown>[]> {
    const snap = await adminDatabase.ref("pluginGenerationJobs").get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    return Object.entries(data)
        .map(([id, raw]) => ({ id, ...(raw as Record<string, unknown>) }) as { id: string; createdAt?: unknown } & Record<string, unknown>)
        .sort((a, b) => (Number(b.createdAt || 0)) - (Number(a.createdAt || 0)));
}

// ─── Audit logs ─────────────────────────────────────────────────────────────

export async function writeAuditLog(entry: { action: string; actor: string; pluginId?: string; detail?: Record<string, unknown> }): Promise<void> {
    await adminDatabase.ref("pluginAuditLogs").push({
        action: entry.action,
        actor: entry.actor,
        pluginId: entry.pluginId || "",
        detail: entry.detail || {},
        createdAt: Date.now(),
    });
}