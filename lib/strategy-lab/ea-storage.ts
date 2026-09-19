import { adminDatabase } from "@/lib/firebase-admin";
import { GeneratedEA } from "./ea/types";

// ─────────────────────────────────────────────────────────────────────────────
// Persistent storage for generated EAs.
//
// State lives under  strategyLab/{uid}/generatedEAs/{eaId}  in Firebase RTDB,
// following the same per-user object-map convention as lib/strategy-lab/storage.ts.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = "strategyLab";

function basePath(uid: string): string {
    return `${ROOT}/${uid}/generatedEAs`;
}

function pushId(uid: string): string {
    return adminDatabase.ref(basePath(uid)).push().key!;
}

export async function saveGeneratedEA(uid: string, ea: GeneratedEA): Promise<string> {
    const id = ea.eaId || pushId(uid);
    const record = { ...ea, eaId: id };
    await adminDatabase.ref(`${basePath(uid)}/${id}`).set(record);
    return id;
}

export async function getGeneratedEA(uid: string, eaId: string): Promise<GeneratedEA | null> {
    const snap = await adminDatabase.ref(`${basePath(uid)}/${eaId}`).get();
    if (!snap.exists()) return null;
    const val = snap.val() as GeneratedEA;
    return { ...val, eaId };
}

export async function listGeneratedEAs(uid: string, limit = 50): Promise<GeneratedEA[]> {
    const snap = await adminDatabase.ref(basePath(uid)).limitToLast(limit).get();
    if (!snap.exists()) return [];
    const all = Object.entries(snap.val() as Record<string, GeneratedEA>).map(([eaId, val]) => ({
        ...val,
        eaId,
    }));
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
}

export async function updateGeneratedEA(uid: string, eaId: string, patch: Partial<GeneratedEA>): Promise<void> {
    await adminDatabase.ref(`${basePath(uid)}/${eaId}`).update({ ...patch, updatedAt: Date.now() });
}

export async function deleteGeneratedEA(uid: string, eaId: string): Promise<void> {
    await adminDatabase.ref(`${basePath(uid)}/${eaId}`).remove();
}

/** Redacts the MQL5 source for list responses (keep payloads small). */
export function toEAView(ea: GeneratedEA, includeCode: boolean): Record<string, unknown> {
    const { code, ...rest } = ea;
    return {
        ...rest,
        codeAvailable: !!code,
        ...(includeCode && code ? { code } : {}),
    };
}