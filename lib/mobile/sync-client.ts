/**
 * Phase 11 — cross-device sync transport (client side).
 *
 * Local-first, because a trader changes their chart on the train and expects it
 * to still be there at home:
 *
 *   1. Every write lands in local storage immediately and the UI updates.
 *   2. If the network is up, it is pushed and the server stamps a revision.
 *   3. If the network is down, it stays queued — never dropped.
 *   4. On reconnect, the queued write is rebased: the server's record is merged
 *      with the local one using `lib/mobile/sync.ts`, and only the merge result
 *      is pushed. This is what stops a reconnect from clobbering whatever another
 *      device did while this one was away.
 *
 * Nothing in this file re-interprets domain state. It moves envelopes.
 *
 * Client-side module.
 */

import {
    emptyWorkspaceState,
    DEFAULT_USER_PREFERENCES,
    type SyncEnvelope,
    type UserPreferences,
    type WorkspaceState,
} from "./contracts";
import { describeDevice } from "./device";
import {
    compareEnvelopes,
    mergePreferenceEnvelopes,
    mergeWorkspaceEnvelopes,
    pendingWriteAfterMerge,
    type QueuedWrite,
} from "./sync";

const WORKSPACE_CACHE_KEY = "av_sync_workspace_v1";
const WORKSPACE_QUEUE_KEY = "av_sync_workspace_queue_v1";
const PREFERENCES_CACHE_KEY = "av_sync_preferences_v1";
const PREFERENCES_QUEUE_KEY = "av_sync_preferences_queue_v1";
/**
 * The last envelope the SERVER confirmed. This is the common ancestor used for
 * three-way merges: without it a device that changed one field would silently
 * revert every other field another device changed.
 */
const WORKSPACE_ANCESTOR_KEY = "av_sync_workspace_ancestor_v1";

export type SyncStatus = "idle" | "syncing" | "offline" | "error" | "conflict";

export interface SyncResult<T> {
    envelope: SyncEnvelope<T>;
    status: SyncStatus;
    /** Field-level conflicts observed during the last merge. */
    conflicts: Array<{ key: string; outcome: string; reason: string }>;
    /** True when this is the first time this device has ever synced. */
    firstSync: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local persistence
// ─────────────────────────────────────────────────────────────────────────────

function readJson<T>(key: string): T | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

function writeJson(key: string, value: unknown): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Quota exceeded or storage disabled. The in-memory envelope still drives
        // this session; only durability across reloads is lost.
    }
}

function localEnvelope<T>(data: T, revision = 0): SyncEnvelope<T> {
    const device = describeDevice();
    return {
        revision,
        updatedAt: Date.now(),
        updatedByDevice: device.deviceId,
        updatedByPlatform: device.platform,
        data,
    };
}

export function readCachedWorkspace(): SyncEnvelope<WorkspaceState> {
    return (
        readJson<SyncEnvelope<WorkspaceState>>(WORKSPACE_CACHE_KEY) ??
        localEnvelope<WorkspaceState>(emptyWorkspaceState())
    );
}

export function readCachedPreferences(): SyncEnvelope<UserPreferences> {
    return (
        readJson<SyncEnvelope<UserPreferences>>(PREFERENCES_CACHE_KEY) ??
        localEnvelope<UserPreferences>({ ...DEFAULT_USER_PREFERENCES })
    );
}

export function readQueuedWorkspace(): QueuedWrite<WorkspaceState> | null {
    return readJson<QueuedWrite<WorkspaceState>>(WORKSPACE_QUEUE_KEY);
}

/** The last record this device and the server agreed on. */
export function readWorkspaceAncestor(): SyncEnvelope<WorkspaceState> | null {
    return readJson<SyncEnvelope<WorkspaceState>>(WORKSPACE_ANCESTOR_KEY);
}

export function readQueuedPreferences(): QueuedWrite<UserPreferences> | null {
    return readJson<QueuedWrite<UserPreferences>>(PREFERENCES_QUEUE_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────────

/** Injectable for tests and for surfaces that already hold a token. */
export type AuthTokenProvider = () => Promise<string | null>;

let cachedToken: string | null = null;

export function setSyncToken(token: string | null): void {
    cachedToken = token;
}

async function authToken(): Promise<string | null> {
    if (cachedToken) return cachedToken;
    return null;
}

async function request<T>(
    path: string,
    init: RequestInit,
    token: string | null,
): Promise<{ ok: boolean; status: number; body: T | null }> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...((init.headers as Record<string, string>) ?? {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(path, { ...init, headers });
    let body: T | null = null;
    try {
        body = (await response.json()) as T;
    } catch {
        body = null;
    }
    return { ok: response.ok, status: response.status, body };
}

/**
 * Pull the server record and fold it into the local one.
 *
 * Order matters: the LOCAL write is always merged *into* the REMOTE record, so a
 * pending offline edit survives the pull. This is the rebase.
 */
export async function syncWorkspace(
    provider: AuthTokenProvider = authToken,
): Promise<SyncResult<WorkspaceState>> {
    const device = describeDevice();
    const token = await provider();
    const local = readCachedWorkspace();
    const queued = readQueuedWorkspace();

    if (!token) {
        return { envelope: queued?.envelope ?? local, status: "idle", conflicts: [], firstSync: false };
    }

    const pull = await request<{ workspace?: SyncEnvelope<WorkspaceState> }>(
        "/api/mobile/workspace",
        { method: "GET", cache: "no-store" },
        token,
    );

    const remote = pull.ok ? (pull.body?.workspace ?? null) : null;

    // No server record and nothing queued: first ever sync. Seed the server with
    // the local state so a second device inherits it rather than defaults.
    if (!remote) {
        if (!pull.ok) {
            writeJson(WORKSPACE_QUEUE_KEY, queued ?? { id: `${device.deviceId}:${local.updatedAt}`, envelope: local, queuedAt: Date.now(), attempts: 0 });
            return { envelope: local, status: "offline", conflicts: [], firstSync: false };
        }
        return pushWorkspace(local, local.revision, provider);
    }

    if (queued && compareEnvelopes(queued.envelope, local) > 0) {
        // Rebase: merge the queued offline write with the freshly pulled record,
        // using the last server-confirmed envelope as the common ancestor.
        const merged = mergeWorkspaceEnvelopes(queued.envelope, remote, { base: readWorkspaceAncestor() ?? undefined });
        writeJson(WORKSPACE_CACHE_KEY, merged.envelope);
        const result = await pushWorkspace(merged.envelope, remote.revision, provider);
        return {
            ...result,
            conflicts: merged.conflicts.map((c) => ({ key: c.key, outcome: c.outcome, reason: c.reason })),
        };
    }

    if (compareEnvelopes(remote, local) > 0) {
        writeJson(WORKSPACE_CACHE_KEY, remote);
        writeJson(WORKSPACE_ANCESTOR_KEY, remote);
        return {
            envelope: remote,
            status: "idle",
            conflicts: [],
            firstSync: remote.revision <= 1,
        };
    }

    return { envelope: local, status: "idle", conflicts: [], firstSync: false };
}

async function pushWorkspace(
    envelope: SyncEnvelope<WorkspaceState>,
    baseRevision: number,
    provider: AuthTokenProvider,
): Promise<SyncResult<WorkspaceState>> {
    const token = await provider();
    if (!token) return { envelope, status: "idle", conflicts: [], firstSync: false };

    const device = describeDevice();
    const response = await request<{ workspace?: SyncEnvelope<WorkspaceState>; error?: string; retry?: boolean }>(
        "/api/mobile/workspace",
        { method: "PUT", body: JSON.stringify({ data: envelope.data, device, baseRevision }) },
        token,
    );

    if (response.ok && response.body?.workspace) {
        writeJson(WORKSPACE_CACHE_KEY, response.body.workspace);
        writeJson(WORKSPACE_ANCESTOR_KEY, response.body.workspace);
        writeJson(WORKSPACE_QUEUE_KEY, null);
        return {
            envelope: response.body.workspace,
            status: "idle",
            conflicts: [],
            firstSync: response.body.workspace.revision <= 1,
        };
    }

    if (response.status === 409 && response.body?.workspace) {
        // The server moved under us. Merge once with the common ancestor, then
        // push the merge. If that also 409s the next tick retries; we never loop.
        const remote = response.body.workspace;
        const merged = mergeWorkspaceEnvelopes(envelope, remote, { base: readWorkspaceAncestor() ?? undefined });
        writeJson(WORKSPACE_CACHE_KEY, merged.envelope);
        return {
            envelope: merged.envelope,
            status: "conflict",
            conflicts: merged.conflicts.map((c) => ({ key: c.key, outcome: c.outcome, reason: c.reason })),
            firstSync: false,
        };
    }

    // Network or server error: keep the write queued rather than losing it.
    writeJson(
        WORKSPACE_QUEUE_KEY,
        queuedOrNew(device.deviceId, envelope, readQueuedWorkspace()),
    );
    return { envelope, status: "offline", conflicts: [], firstSync: false };
}

function queuedOrNew<T>(
    deviceId: string,
    envelope: SyncEnvelope<T>,
    existing: QueuedWrite<T> | null,
): QueuedWrite<T> {
    return {
        id: `${deviceId}:${envelope.updatedAt}`,
        envelope,
        queuedAt: Date.now(),
        attempts: (existing?.attempts ?? 0) + 1,
    };
}

/** Persist a local workspace edit. Returns the cached envelope for optimistic UI. */
export function stageWorkspace(data: WorkspaceState): SyncEnvelope<WorkspaceState> {
    const device = describeDevice();
    const previous = readCachedWorkspace();
    const envelope: SyncEnvelope<WorkspaceState> = {
        revision: previous.revision,
        updatedAt: Date.now(),
        updatedByDevice: device.deviceId,
        updatedByPlatform: device.platform,
        data,
    };
    writeJson(WORKSPACE_CACHE_KEY, envelope);
    writeJson(WORKSPACE_QUEUE_KEY, queuedOrNew(device.deviceId, envelope, readQueuedWorkspace()));
    return envelope;
}

export async function syncPreferences(
    provider: AuthTokenProvider = authToken,
): Promise<SyncResult<UserPreferences>> {
    const token = await provider();
    const local = readCachedPreferences();
    if (!token) return { envelope: local, status: "idle", conflicts: [], firstSync: false };

    const pull = await request<{ preferences?: SyncEnvelope<UserPreferences> }>(
        "/api/mobile/preferences",
        { method: "GET", cache: "no-store" },
        token,
    );
    const remote = pull.ok ? (pull.body?.preferences ?? null) : null;
    if (!remote) {
        return { envelope: local, status: pull.ok ? "idle" : "offline", conflicts: [], firstSync: false };
    }

    const queued = readQueuedPreferences();
    const localForMerge = queued && compareEnvelopes(queued.envelope, local) > 0 ? queued.envelope : local;

    if (compareEnvelopes(localForMerge, remote) === 0) {
        return { envelope: remote, status: "idle", conflicts: [], firstSync: false };
    }

    const merged = mergePreferenceEnvelopes(localForMerge, remote);
    writeJson(PREFERENCES_CACHE_KEY, merged.envelope);

    const device = describeDevice();
    const response = await request<{ preferences?: SyncEnvelope<UserPreferences> }>(
        "/api/mobile/preferences",
        { method: "PUT", body: JSON.stringify({ data: merged.envelope.data, device, baseRevision: remote.revision }) },
        token,
    );
    if (response.ok && response.body?.preferences) {
        writeJson(PREFERENCES_CACHE_KEY, response.body.preferences);
        writeJson(PREFERENCES_QUEUE_KEY, null);
        return {
            envelope: response.body.preferences,
            status: "idle",
            conflicts: merged.conflicts.map((c) => ({ key: c.key, outcome: c.outcome, reason: c.reason })),
            firstSync: false,
        };
    }

    writeJson(PREFERENCES_QUEUE_KEY, queuedOrNew(device.deviceId, merged.envelope, queued));
    return { envelope: merged.envelope, status: "offline", conflicts: [], firstSync: false };
}

export function stagePreferences(data: UserPreferences): SyncEnvelope<UserPreferences> {
    const device = describeDevice();
    const previous = readCachedPreferences();
    const envelope: SyncEnvelope<UserPreferences> = {
        revision: previous.revision,
        updatedAt: Date.now(),
        updatedByDevice: device.deviceId,
        updatedByPlatform: device.platform,
        data,
    };
    writeJson(PREFERENCES_CACHE_KEY, envelope);
    writeJson(PREFERENCES_QUEUE_KEY, queuedOrNew(device.deviceId, envelope, readQueuedPreferences()));
    return envelope;
}

/** Is there anything still owed to the server? Drives the "waiting to sync" chip. */
export function hasPendingWrites(): boolean {
    return Boolean(readQueuedWorkspace() || readQueuedPreferences());
}

export { pendingWriteAfterMerge };
