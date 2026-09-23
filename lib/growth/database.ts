/**
 * Growth Engine — Realtime Database access layer.
 *
 * All growth-domain reads/writes go through these helpers so that:
 *  - writes always deep-clean `undefined` → `null` (RTDB rejects undefined),
 *  - ids and timestamps are consistent,
 *  - audit hooks stay centralized.
 */
import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "./constants";
import { AuditLog, GrowthRecord } from "./types";

export { adminDatabase };

const REF = (path: string) => {
    const ref = adminDatabase.ref(path);
    const proxy = Object.create(ref) as typeof ref;
    proxy.set = (value: unknown) => ref.set(deepClean(value));
    proxy.update = (value: unknown) => ref.update(deepClean(value) as Record<string, unknown>);
    return proxy;
};

export function deepClean<T>(value: T): T {
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

export function genId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Generic collection helpers ──────────────────────────────────────────────

export async function listCollection<T extends Record<string, unknown>>(
    collection: string,
    options?: { orderByChild?: string; limit?: number }
): Promise<(T & { id: string })[]> {
    let query = REF(collection) as ReturnType<typeof adminDatabase.ref>;
    if (options?.orderByChild) {
        query = query.orderByChild(options.orderByChild) as typeof query;
    }
    if (options?.limit) {
        query = query.limitToLast(options.limit) as typeof query;
    }
    const snap = await query.get();
    const data = (snap.val() || {}) as Record<string, T>;
    return Object.entries(data)
        .filter(([id]) => !id.startsWith("_")) // skip internal indexes
        .map(([id, value]) => ({ ...(value as T), id }));
}

export async function getRecord<T>(collection: string, id: string): Promise<(T & { id: string }) | null> {
    const snap = await REF(`${collection}/${id}`).get();
    if (!snap.exists()) return null;
    return { ...(snap.val() as T), id };
}

export async function createRecord<T extends Record<string, unknown>>(
    collection: string,
    data: Partial<T> & Partial<GrowthRecord>,
    createdBy: string
): Promise<T & GrowthRecord & { id: string }> {
    const now = Date.now();
    const ref = REF(collection).push();
    const id = ref.key as string;
    const record = {
        ...data,
        status: data.status ?? "DRAFT",
        createdAt: data.createdAt ?? now,
        updatedAt: now,
        createdBy,
    } as T & GrowthRecord & { id: string };
    await ref.set(record);
    return record;
}

export async function updateRecord<T extends Record<string, unknown>>(
    collection: string,
    id: string,
    updates: T,
    updatedBy: string
): Promise<void> {
    await REF(`${collection}/${id}`).update({
        ...(updates as Record<string, unknown>),
        updatedAt: Date.now(),
        updatedBy,
    });
}

export async function deleteRecord(collection: string, id: string): Promise<void> {
    await REF(`${collection}/${id}`).remove();
}

/** Atomic counter increment (used for clicks/impressions counters). */
export async function incrementCounter(path: string, amount = 1): Promise<number> {
    let updated = 0;
    await REF(path).transaction((current) => {
        const value = Number(current || 0) + amount;
        updated = value;
        return value;
    });
    return updated;
}

/**
 * Idempotent event write: if an event with the same clientEventId already
 * exists, it is NOT written again. Returns true when written, false on dup.
 */
export async function writeEventIdempotent(
    clientEventIdRaw: string | undefined,
    collection: string,
    data: Record<string, unknown>
): Promise<{ written: boolean; id?: string }> {
    const clientEventId = clientEventIdRaw ? clientEventIdRaw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) : undefined;
    if (clientEventId) {
        const existing = await REF(`${collection}/_byClientEvent/${clientEventId}`).get();
        if (existing.exists()) {
            return { written: false, id: existing.val()?.id };
        }
    }
    const ref = REF(collection).push();
    const id = ref.key as string;
    await ref.set({ ...deepClean(data), id });
    if (clientEventId) {
        await REF(`${collection}/_byClientEvent/${clientEventId}`).set({ id, writtenAt: Date.now() });
    }
    return { written: true, id };
}

/**
 * Claim a job key atomically: only the first caller wins. Returns true for the
 * winner — this is the core of duplicate-run prevention.
 */
export async function claimJobKey(jobKey: string, ttlMs = 10 * 60 * 1000): Promise<boolean> {
    const path = `${GROWTH_COLLECTIONS.jobs}/_claims/${jobKey}`;
    let claimed = false;
    await REF(path).transaction((current) => {
        const now = Date.now();
        const value = current as { claimedAt?: number } | null;
        if (value && value.claimedAt && now - value.claimedAt < ttlMs) {
            return value; // still held → not ours
        }
        claimed = true;
        return { claimedAt: now };
    });
    return claimed;
}

// ─── Audit logging ───────────────────────────────────────────────────────────

/**
 * Central audit trail for growth/monetization actions. Never throws: audit
 * failures must not break the primary operation.
 */
export async function writeGrowthAudit(log: Omit<AuditLog, "id" | "createdAt">): Promise<void> {
    try {
        const ref = REF(GROWTH_COLLECTIONS.auditLogs).push();
        await ref.set({
            ...deepClean(log),
            id: ref.key,
            createdAt: Date.now(),
        });
    } catch (err) {
        console.error("[growth:audit]", err);
    }
}

export async function listGrowthAudit(limit = 200): Promise<AuditLog[]> {
    const snap = await REF(GROWTH_COLLECTIONS.auditLogs).orderByChild("createdAt").limitToLast(limit).get();
    const data = (snap.val() || {}) as Record<string, AuditLog>;
    return Object.values(data).sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Realtime helpers (client SDK on the browser side) ───────────────────────

export const collections = GROWTH_COLLECTIONS;