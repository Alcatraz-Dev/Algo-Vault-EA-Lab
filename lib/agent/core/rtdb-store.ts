// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — RTDB Store (run metadata + memory)
//
// RTDB-ONLY: this subsystem never touches Firestore. Writes go through a REF
// wrapper that deep-converts undefined → null (same pattern as
// `lib/agents/database.ts`, which MUST NOT be removed) so optional fields in
// run records never crash RTDB writes.
//
// Every record passes through `sanitizeForPersistence` (policies/redaction.ts)
// before it is written: forbidden key names (private_key, password, cookie…)
// are dropped entirely and every string is redacted. Secrets never reach RTDB
// from this subsystem.
//
// Paths (agent-owned, do not collide with existing trees):
//   agentRuns/{uid}/{runId}            — per-run record + status
//   agentRuns/{uid}/{runId}/events     — append-only operational log (capped)
//   agentRuns/{uid}/{runId}/diff       — final diff snapshot (redacted, capped)
//   agentMemory/{uid}/{memoryId}       — durable engineering memory
//   agentProjectProfile                — shared, admin-maintained knowledge
// ─────────────────────────────────────────────────────────────────────────────

import { adminDatabase } from "@/lib/firebase-admin";
import { sanitizeForPersistence } from "../policies/redaction";
import type { AgentEvent, AgentMemoryEntry, AgentRunRecord } from "../core/types";

const REF = (path: string) => {
    const ref = adminDatabase.ref(path);
    const proxy = Object.create(ref) as typeof ref;
    proxy.set = (value: unknown) => ref.set(sanitizeForPersistence(deepClean(value)));
    proxy.update = (value: unknown) =>
        ref.update(sanitizeForPersistence(deepClean(value)) as Record<string, unknown>);
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

// ── Limits on persisted data (RTDB node sizes stay bounded) ──────────────────

const MAX_EVENTS_PER_RUN = 250;
const MAX_DIFF_CHARS = 120_000;

function cap(text: string | null | undefined, max: number): string | null {
    if (typeof text !== "string" || text === "") return null;
    return text.length > max ? text.slice(0, max) : text;
}

// ── Run records ──────────────────────────────────────────────────────────────

export async function createAgentRun(uid: string, record: AgentRunRecord): Promise<void> {
    await REF(`agentRuns/${uid}/${record.runId}`).set(record);
}

export async function updateAgentRun(uid: string, runId: string, patch: Partial<AgentRunRecord>): Promise<void> {
    await REF(`agentRuns/${uid}/${runId}`).update({ ...patch, updatedAt: Date.now() });
}

export async function getAgentRun(uid: string, runId: string): Promise<AgentRunRecord | null> {
    const snap = await REF(`agentRuns/${uid}/${runId}`).get();
    return (snap.val() || null) as AgentRunRecord | null;
}

export async function listAgentRuns(uid: string, maxResults = 25): Promise<AgentRunRecord[]> {
    const snap = await REF(`agentRuns/${uid}`).get();
    const data = (snap.val() || {}) as Record<string, AgentRunRecord>;
    return Object.values(data)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .slice(0, maxResults);
}

/** Append one operational event (bounded). No-op failures never break a run. */
export async function appendAgentRunEvent(uid: string, runId: string, event: AgentEvent): Promise<void> {
    try {
        const eventRef = adminDatabase.ref(`agentRuns/${uid}/${runId}/events`);
        const snap = await eventRef.get();
        const existing = (snap.val() || {}) as Record<string, AgentEvent>;
        const count = Object.keys(existing).length;
        if (count >= MAX_EVENTS_PER_RUN) {
            // Drop the oldest event to keep the log bounded.
            const oldestKey = Object.entries(existing).sort((a, b) => (a[1].seq ?? 0) - (b[1].seq ?? 0))[0]?.[0];
            if (oldestKey) await eventRef.child(oldestKey).remove();
        }
        await eventRef.child(String(event.seq)).set(sanitizeForPersistence(deepClean(event)));
    } catch {
        // Event persistence is best-effort; the run continues.
    }
}

/** Persist the final diff snapshot (redacted + capped) for later review. */
export async function saveAgentRunDiff(uid: string, runId: string, diffText: string): Promise<void> {
    await REF(`agentRuns/${uid}/${runId}/diff`).set({
        text: cap(diffText, MAX_DIFF_CHARS) ?? "",
        truncated: diffText.length > MAX_DIFF_CHARS,
        savedAt: Date.now(),
    });
}

export async function getAgentRunDiff(uid: string, runId: string): Promise<string | null> {
    const snap = await REF(`agentRuns/${uid}/${runId}/diff`).get();
    const val = snap.val() as { text?: string } | null;
    return val?.text ?? null;
}

// ── Memory ───────────────────────────────────────────────────────────────────

export async function saveMemoryEntry(uid: string, entry: AgentMemoryEntry): Promise<void> {
    await REF(`agentMemory/${uid}/${entry.id}`).set(entry);
}

export async function getMemoryEntry(uid: string, id: string): Promise<AgentMemoryEntry | null> {
    const snap = await REF(`agentMemory/${uid}/${id}`).get();
    return (snap.val() || null) as AgentMemoryEntry | null;
}

export async function listMemoryEntries(uid: string): Promise<AgentMemoryEntry[]> {
    const snap = await REF(`agentMemory/${uid}`).get();
    const data = (snap.val() || {}) as Record<string, AgentMemoryEntry>;
    return Object.values(data).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function deleteMemoryEntry(uid: string, id: string): Promise<void> {
    await REF(`agentMemory/${uid}/${id}`).remove();
}

/** Increment the retrieval-hit counter for an entry (fire and forget). */
export async function bumpMemoryHits(uid: string, id: string): Promise<void> {
    try {
        const ref = adminDatabase.ref(`agentMemory/${uid}/${id}/hits`);
        const snap = await ref.get();
        const current = typeof snap.val() === "number" ? snap.val() : 0;
        await ref.set(current + 1);
    } catch {
        // best effort
    }
}

// ── Shared project profile ───────────────────────────────────────────────────

export async function saveProjectProfile(profile: unknown): Promise<void> {
    await REF("agentProjectProfile").set(profile);
}

export async function getProjectProfile(): Promise<unknown | null> {
    const snap = await REF("agentProjectProfile").get();
    return snap.val() || null;
}

export { cap as capPersistedText };
