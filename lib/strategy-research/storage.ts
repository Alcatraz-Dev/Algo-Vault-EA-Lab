// ─────────────────────────────────────────────────────────────────────────────
// Research persistence — Firebase RTDB, following the Strategy Lab storage
// convention (per-user maps keyed by generated ids, epoch-ms timestamps).
//
// Paths (owner/admin only per database.rules.json):
//   strategyResearch/{uid}/missions/{missionId}
//   strategyResearch/{uid}/candidates/{missionId}/{candidateId}
//   strategyResearch/{uid}/events/{missionId}/{eventId}
//   strategyResearch/{uid}/knowledge/{missionId}          (MissionKnowledge)
//   strategyResearch/{uid}/memory/{missionId}/{recordId}
// ─────────────────────────────────────────────────────────────────────────────

import { adminDatabase } from "@/lib/firebase-admin";
import {
    CompiledCandidate,
    MissionStage,
    MissionStageState,
    MissionStatus,
    ResearchCandidate,
    ResearchEvent,
    ResearchMission,
    StrategyHypothesis,
} from "./types";
import type { KnowledgeEdge } from "@/lib/market-intelligence/knowledge/types";
import type { SetupMemoryRecord } from "@/lib/market-intelligence/memory/types";

const ROOT = "strategyResearch";

const missionsRef = (uid: string) => `${ROOT}/${uid}/missions`;
const missionRef = (uid: string, missionId: string) => `${missionsRef(uid)}/${missionId}`;
const candidatesRef = (uid: string, missionId: string) => `${ROOT}/${uid}/candidates/${missionId}`;
const candidateRef = (uid: string, missionId: string, candidateId: string) =>
    `${candidatesRef(uid, missionId)}/${candidateId}`;
const eventsRef = (uid: string, missionId: string) => `${ROOT}/${uid}/events/${missionId}`;
const knowledgeRef = (uid: string, missionId: string) => `${ROOT}/${uid}/knowledge/${missionId}`;
const memoryRef = (uid: string, missionId: string) => `${ROOT}/${uid}/memory/${missionId}`;

export function newResearchId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Missions ─────────────────────────────────────────────────────────────────

export async function saveMission(mission: ResearchMission): Promise<void> {
    await adminDatabase.ref(missionRef(mission.uid, mission.id)).set(mission);
}

export async function getMission(uid: string, missionId: string): Promise<ResearchMission | null> {
    const snap = await adminDatabase.ref(missionRef(uid, missionId)).get();
    return snap.exists() ? (snap.val() as ResearchMission) : null;
}

export async function listMissions(uid: string, limit = 30): Promise<ResearchMission[]> {
    const snap = await adminDatabase.ref(missionsRef(uid)).limitToLast(limit).get();
    if (!snap.exists()) return [];
    return Object.values(snap.val() as Record<string, ResearchMission>).sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
    );
}

export async function deleteMissionData(uid: string, missionId: string): Promise<void> {
    await adminDatabase.ref(`${ROOT}/${uid}/candidates/${missionId}`).remove();
    await adminDatabase.ref(`${ROOT}/${uid}/events/${missionId}`).remove();
    await adminDatabase.ref(`${ROOT}/${uid}/knowledge/${missionId}`).remove();
    await adminDatabase.ref(`${ROOT}/${uid}/memory/${missionId}`).remove();
    await adminDatabase.ref(missionRef(uid, missionId)).remove();
}

export function sanitizeMissionForClient(mission: ResearchMission): ResearchMission {
    // Server-owned lease state must never leak to or be set by the client.
    return { ...mission, lease: null };
}

// ── Duplicate-active guard + idempotent creation ─────────────────────────────

export interface ActiveMissionFingerprint {
    key: string;
    missionId: string;
}

/** Deterministic fingerprint of a spec so duplicate active missions are refused. */
export function missionFingerprint(uid: string, spec: unknown): string {
    return Buffer.from(`${uid}:${stableStringify(spec)}`).toString("base64url").slice(0, 48);
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
    }
    return JSON.stringify(value ?? null);
}

export async function findActiveMissionByFingerprint(
    uid: string,
    fingerprint: string
): Promise<ResearchMission | null> {
    const missions = await listMissions(uid, 100);
    return missions.find((m) => isActiveStatus(m.status) && (m as ResearchMission & { fingerprint?: string }).fingerprint === fingerprint) ?? null;
}

export function isActiveStatus(status: MissionStatus): boolean {
    return status === "running" || status === "paused" || status === "draft";
}

// ── Durable work lease (prevents duplicate research jobs) ────────────────────

/**
 * Claims the mission for one work unit via an RTDB transaction. Only one
 * caller can hold the lease; concurrent `advance` calls are no-ops.
 */
export async function claimMissionLease(
    uid: string,
    missionId: string,
    workerId: string,
    ttlMs = 5 * 60 * 1000
): Promise<boolean> {
    const ref = adminDatabase.ref(`${missionRef(uid, missionId)}/lease`);
    let claimed = false;
    await ref.transaction((current) => {
        const lease = (current ?? null) as { lockedBy: string; lockedAt: number } | null;
        const fresh = !lease || Date.now() - (lease.lockedAt ?? 0) > ttlMs || lease.lockedBy === workerId;
        if (!fresh) {
            claimed = false;
            return; // abort
        }
        claimed = true;
        return { lockedBy: workerId, lockedAt: Date.now() };
    });
    return claimed;
}

export async function releaseMissionLease(uid: string, missionId: string, workerId: string): Promise<void> {
    const ref = adminDatabase.ref(`${missionRef(uid, missionId)}/lease`);
    await ref.transaction((current) => {
        const lease = (current ?? null) as { lockedBy: string; lockedAt: number } | null;
        if (lease && lease.lockedBy === workerId) return null;
        return; // abort — not ours
    });
}

// ── Stage state ──────────────────────────────────────────────────────────────

export async function updateMission(
    uid: string,
    missionId: string,
    patch: Partial<ResearchMission>
): Promise<void> {
    await adminDatabase.ref(missionRef(uid, missionId)).update({ ...patch, updatedAt: Date.now() });
}

export function stageStatesAfter(
    stages: MissionStageState[],
    stage: MissionStage,
    status: MissionStageState["status"],
    extra?: Partial<MissionStageState>
): MissionStageState[] {
    return stages.map((s) =>
        s.stage === stage
            ? {
                  ...s,
                  status,
                  attempts: status === "running" ? s.attempts + 1 : s.attempts,
                  ...(extra ?? {}),
                  ...(status === "running" ? { startedAt: Date.now() } : {}),
                  ...(status === "completed" || status === "failed" ? { completedAt: Date.now() } : {}),
              }
            : s
    );
}

// ── Candidates ───────────────────────────────────────────────────────────────

export async function saveCandidate(candidate: ResearchCandidate): Promise<void> {
    const withStamp = { ...candidate, updatedAt: Date.now() };
    await adminDatabase.ref(candidateRef(candidate.uid, candidate.missionId, candidate.id)).set(withStamp);
}

export async function getCandidate(
    uid: string,
    missionId: string,
    candidateId: string
): Promise<ResearchCandidate | null> {
    const snap = await adminDatabase.ref(candidateRef(uid, missionId, candidateId)).get();
    return snap.exists() ? (snap.val() as ResearchCandidate) : null;
}

export async function listCandidates(uid: string, missionId: string): Promise<ResearchCandidate[]> {
    const snap = await adminDatabase.ref(candidatesRef(uid, missionId)).get();
    if (!snap.exists()) return [];
    return Object.values(snap.val() as Record<string, ResearchCandidate>).sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
    );
}

export async function saveCompiledCandidate(
    uid: string,
    missionId: string,
    compiled: CompiledCandidate
): Promise<void> {
    await adminDatabase.ref(`${ROOT}/${uid}/compiled/${missionId}/${compiled.hypothesisId}`).set(compiled);
}

// ── Events ───────────────────────────────────────────────────────────────────

export async function logEvent(
    uid: string,
    missionId: string,
    stage: MissionStage,
    level: ResearchEvent["level"],
    message: string,
    data?: Record<string, string | number | boolean | null>,
    code?: ResearchEvent["code"]
): Promise<void> {
    const event: ResearchEvent = {
        id: newResearchId("evt"),
        missionId,
        stage,
        level,
        message: message.slice(0, 500),
        ...(code ? { code } : {}),
        ...(data ? { data } : {}),
        at: Date.now(),
    };
    await adminDatabase.ref(`${eventsRef(uid, missionId)}/${event.id}`).set(event);
}

export async function listEvents(uid: string, missionId: string, limit = 200): Promise<ResearchEvent[]> {
    const snap = await adminDatabase.ref(eventsRef(uid, missionId)).limitToLast(limit).get();
    if (!snap.exists()) return [];
    return Object.values(snap.val() as Record<string, ResearchEvent>).sort((a, b) => a.at - b.at);
}

// ── Knowledge edges ──────────────────────────────────────────────────────────

export async function saveKnowledgeEdges(
    uid: string,
    missionId: string,
    edges: KnowledgeEdge[]
): Promise<void> {
    if (edges.length === 0) return;
    const update: Record<string, KnowledgeEdge> = {};
    for (const edge of edges) update[edge.id] = edge;
    await adminDatabase.ref(`${knowledgeRef(uid, missionId)}/edges`).update(update);
    await adminDatabase.ref(knowledgeRef(uid, missionId)).update({ missionId, updatedAt: Date.now() });
}

export async function listKnowledgeEdges(uid: string, missionId: string): Promise<KnowledgeEdge[]> {
    const snap = await adminDatabase.ref(`${knowledgeRef(uid, missionId)}/edges`).get();
    if (!snap.exists()) return [];
    return Object.values(snap.val() as Record<string, KnowledgeEdge>);
}

// ── Setup Memory records (existing Phase-10 shape, mode RESEARCH) ────────────

export async function saveResearchMemoryRecord(
    uid: string,
    missionId: string,
    record: SetupMemoryRecord
): Promise<void> {
    await adminDatabase.ref(`${memoryRef(uid, missionId)}/${record.id}`).set(record);
    await adminDatabase.ref(`monitoring/setups/${uid}/${record.id}`).set(record);
}

export async function listResearchMemoryRecords(
    uid: string,
    missionId: string
): Promise<SetupMemoryRecord[]> {
    const snap = await adminDatabase.ref(memoryRef(uid, missionId)).get();
    if (!snap.exists()) return [];
    return Object.values(snap.val() as Record<string, SetupMemoryRecord>);
}

// ── Hypotheses (stored as part of candidates; kept here for lineage) ─────────

export async function saveHypothesis(
    uid: string,
    missionId: string,
    hypothesis: StrategyHypothesis
): Promise<void> {
    await adminDatabase
        .ref(`${ROOT}/${uid}/hypotheses/${missionId}/${hypothesis.id}`)
        .set(hypothesis);
}

export async function listHypotheses(uid: string, missionId: string): Promise<StrategyHypothesis[]> {
    const snap = await adminDatabase.ref(`${ROOT}/${uid}/hypotheses/${missionId}`).get();
    if (!snap.exists()) return [];
    return Object.values(snap.val() as Record<string, StrategyHypothesis>).sort(
        (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
    );
}

/** Campaign-wide mission list for admin diagnostics (bounded). */
export async function listAllMissions(limit = 200): Promise<ResearchMission[]> {
    const snap = await adminDatabase.ref(ROOT).limitToLast(limit).get();
    if (!snap.exists()) return [];
    const missions: ResearchMission[] = [];
    const byUser = snap.val() as Record<string, { missions?: Record<string, ResearchMission> }>;
    for (const [uid, bucket] of Object.entries(byUser)) {
        if (!bucket?.missions) continue;
        for (const mission of Object.values(bucket.missions)) {
            missions.push({ ...mission, uid: mission.uid || uid });
        }
    }
    return missions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
}
