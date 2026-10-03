// Admin read helpers over the Performance Arena RTDB tree (read-only).
// Kept separate from store.ts so the admin surface never shares write paths.

import { adminDatabase } from "@/lib/firebase-admin";
import { ARENA_ROOT, rtdbKey } from "./store";
import type { ChallengeEvent, ChallengeResult } from "./types";

export { listAllAttempts } from "./store";

export async function listResultsAll(limit = 300): Promise<ChallengeResult[]> {
    const snap = await adminDatabase.ref(`${ARENA_ROOT}/results`).get();
    const val = snap.val() as Record<string, Record<string, ChallengeResult>> | null;
    if (!val) return [];
    const all: ChallengeResult[] = [];
    for (const perUser of Object.values(val)) all.push(...Object.values(perUser));
    return all.sort((a, b) => b.settledAt - a.settledAt).slice(0, limit);
}

export async function listEventsForAttempt(uid: string, attemptId: string, limit = 100): Promise<ChallengeEvent[]> {
    const snap = await adminDatabase
        .ref(`${ARENA_ROOT}/events/${uid}/${rtdbKey(attemptId)}`)
        .limitToLast(limit)
        .get();
    const val = snap.val() as Record<string, ChallengeEvent> | null;
    if (!val) return [];
    return Object.values(val).sort((a, b) => b.timestamp - a.timestamp);
}
