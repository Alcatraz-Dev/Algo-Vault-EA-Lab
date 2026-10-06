/**
 * AlgoVault — Cross-Asset persistence (Phase 16 §42, §43, §49).
 *
 * ── Server-only ────────────────────────────────────────────────────────────
 * Firebase RTDB ONLY (no Firestore — §49). Every write goes through a boundary
 * sanitizer because Firebase rejects nested `undefined` (same rule as the
 * agents layer). Reads are bounded and scoped:
 *
 *   marketGraph/{scope}/latest              — the latest immutable snapshot
 *   marketGraphMeta/{scope}                 — observability counters (§54)
 *   crossAssetSignals/{scope}               — capped signal history (live)
 *   marketRegimes/{scope}/latest            — latest regime axis states
 *   userRelationships/{uid}/{pair}          — user-declared links (§4, §50)
 *   relationshipMemory/{uid}/{pair}         — recurring-relationship memory (§42)
 *
 * `scope` is `global` for shared market state (read-only for users) and
 * `user:{uid}` for private state. User nodes are owner-only — see
 * `database.rules.json` (§50, security tests assert it).
 */

import { adminDatabase } from "@/lib/firebase-admin";
import type {
    CrossAssetSignal,
    MarketGraphSnapshot,
    MarketRegimeState,
    RegimeAxis,
    RelationshipMemoryRecord,
    UserDefinedRelationship,
} from "./types";

/** Signals kept per scope — bounded so the node can never grow unbounded. */
export const MAX_STORED_SIGNALS = 200;
/** Memory samples kept per pair. */
export const MAX_MEMORY_SAMPLES = 20;
/** Snapshot history entries kept per scope (hourly buckets). */
export const MAX_SNAPSHOT_HISTORY = 48;

/* ── boundary sanitizer (Firebase rejects undefined) ──────────────────────── */

function deepClean<T>(value: T): T {
    if (value === null || value === undefined) return null as unknown as T;
    if (Array.isArray(value)) return value.map((v) => deepClean(v)) as unknown as T;
    if (typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (v === undefined) continue;
            out[k] = deepClean(v);
        }
        return out as unknown as T;
    }
    return value;
}

/** Scopes become RTDB path segments — keep them strictly sanitised. */
function sanitizeScope(scope: string): string {
    return String(scope || "global").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64);
}

async function readObject(path: string): Promise<Record<string, unknown>> {
    try {
        const snap = await adminDatabase.ref(path).get();
        return snap.exists() && typeof snap.val() === "object" ? (snap.val() as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

async function writeObject(path: string, value: unknown): Promise<void> {
    await adminDatabase.ref(path).set(deepClean(value) as never);
}

/* ── Snapshots (§43) ──────────────────────────────────────────────────────── */

export async function loadLatestSnapshot(scope: string): Promise<MarketGraphSnapshot | null> {
    const raw = await readObject(`marketGraph/${scope}/latest`);
    if (!raw || !raw.snapshotId) return null;
    return raw as unknown as MarketGraphSnapshot;
}

/**
 * Persist the latest snapshot plus an hourly history bucket.
 * The snapshot is immutable: it is written once and never mutated in place.
 */
export async function saveSnapshot(snapshot: MarketGraphSnapshot): Promise<void> {
    const scope = sanitizeScope(snapshot.scope);
    const bucket = `h${Math.floor(snapshot.createdAt / 3_600_000)}`;
    await writeObject(`marketGraph/${scope}/latest`, snapshot);
    await adminDatabase.ref(`marketGraph/${scope}/history/${bucket}`).set(deepClean(snapshot) as never);

    // Bound history: remove buckets beyond the retention window.
    const historyRef = adminDatabase.ref(`marketGraph/${scope}/history`);
    const hist = await historyRef.get();
    if (hist.exists()) {
        const keys = Object.keys(hist.val() as Record<string, unknown>).sort();
        const excess = keys.slice(0, Math.max(0, keys.length - MAX_SNAPSHOT_HISTORY));
        for (const key of excess) await adminDatabase.ref(`marketGraph/${scope}/history/${key}`).remove();
    }
}

/* ── Regime states (for transitions) ──────────────────────────────────────── */

export interface StoredRegime {
    states: Partial<Record<RegimeAxis, MarketRegimeState>>;
    calculatedAt: number;
}

export async function loadPreviousRegime(scope: string): Promise<StoredRegime | null> {
    const raw = await readObject(`marketRegimes/${scope}/latest`);
    if (!raw || !raw.states) return null;
    return {
        states: raw.states as Partial<Record<RegimeAxis, MarketRegimeState>>,
        calculatedAt: Number(raw.calculatedAt ?? 0),
    };
}

export async function saveRegime(scope: string, regime: StoredRegime): Promise<void> {
    await writeObject(`marketRegimes/${scope}/latest`, regime);
}

/* ── Signals (§18) ────────────────────────────────────────────────────────── */

export async function loadSignals(scope: string): Promise<CrossAssetSignal[]> {
    const raw = await readObject(`crossAssetSignals/${scope}`);
    const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    return (list as CrossAssetSignal[])
        .filter((s) => s && typeof s.id === "string")
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_STORED_SIGNALS);
}

export async function saveSignals(scope: string, signals: CrossAssetSignal[]): Promise<void> {
    const bounded = signals.slice(0, MAX_STORED_SIGNALS);
    await writeObject(`crossAssetSignals/${scope}`, bounded);
}

/* ── Observability (§54) ──────────────────────────────────────────────────── */

export async function recordGraphMetrics(
    scope: string,
    metrics: {
        computeMs: number;
        nodeCount: number;
        edgeCount: number;
        relationshipFailures: number;
        staleRelationships: number;
        dataQuality: string;
        at: number;
    }
): Promise<void> {
    try {
        const ref = adminDatabase.ref(`marketGraphMeta/${scope}`);
        const snap = await ref.get();
        const current = (snap.val() as Record<string, unknown> | null) ?? {};
        const runs = Number(current.runs ?? 0) + 1;
        const failures = Number(current.relationshipFailures ?? 0) + metrics.relationshipFailures;
        const stale = Number(current.staleRelationships ?? 0) + metrics.staleRelationships;
        await ref.set(
            deepClean({
                runs,
                lastRunAt: metrics.at,
                lastComputeMs: metrics.computeMs,
                lastNodeCount: metrics.nodeCount,
                lastEdgeCount: metrics.edgeCount,
                relationshipFailures: failures,
                staleRelationships: stale,
                lastDataQuality: metrics.dataQuality,
                // Rolling mean of compute latency, bounded history.
                avgComputeMs:
                    Math.round(
                        ((Number(current.avgComputeMs ?? 0) * Math.max(0, runs - 1) + metrics.computeMs) /
                            runs) *
                            100
                    ) / 100,
            }) as never
        );
    } catch {
        // Observability must never break the intelligence path.
    }
}

/* ── User-defined relationships (§4, §50) ─────────────────────────────────── */

function pairSlot(a: string, b: string): string {
    const x = a.toUpperCase();
    const y = b.toUpperCase();
    return x <= y ? `${x}~${y}` : `${y}~${x}`;
}

export async function loadUserRelationships(userId: string): Promise<UserDefinedRelationship[]> {
    const raw = await readObject(`userRelationships/${userId}`);
    return Object.values(raw ?? {}) as UserDefinedRelationship[];
}

export async function saveUserRelationship(rel: UserDefinedRelationship): Promise<UserDefinedRelationship> {
    await writeObject(
        `userRelationships/${rel.userId}/${pairSlot(rel.sourceSymbol, rel.targetSymbol)}`,
        rel
    );
    return rel;
}

export async function deleteUserRelationship(userId: string, a: string, b: string): Promise<boolean> {
    const path = `userRelationships/${userId}/${pairSlot(a, b)}`;
    const snap = await adminDatabase.ref(path).get();
    if (!snap.exists()) return false;
    await adminDatabase.ref(path).remove();
    return true;
}

/* ── Relationship memory (§42) ────────────────────────────────────────────── */

export async function loadRelationshipMemory(userId: string): Promise<RelationshipMemoryRecord[]> {
    const raw = await readObject(`relationshipMemory/${userId}`);
    return Object.values(raw ?? {}) as RelationshipMemoryRecord[];
}

/**
 * Append a sample to a pair's memory, capping the sample list. Idempotent per
 * `at` timestamp — recomputing the same window never duplicates history.
 */
export async function upsertRelationshipMemory(
    userId: string,
    record: RelationshipMemoryRecord
): Promise<RelationshipMemoryRecord> {
    const path = `relationshipMemory/${userId}/${record.pairKey.replace(/\|/g, "~")}`;
    const existingRaw = await readObject(path);
    const existing = (existingRaw as unknown as RelationshipMemoryRecord | null) ?? null;
    const samples = [...(existing?.samples ?? []), ...record.samples]
        .filter((s, i, arr) => arr.findIndex((x) => x.at === s.at) === i)
        .sort((x, y) => x.at - y.at)
        .slice(-MAX_MEMORY_SAMPLES);

    const merged: RelationshipMemoryRecord = {
        ...(existing ?? record),
        ...record,
        samples,
        updatedAt: record.updatedAt,
    };
    await writeObject(path, merged);
    return merged;
}
