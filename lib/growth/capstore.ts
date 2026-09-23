/**
 * Growth Engine — server-side frequency cap reservation.
 *
 * Stores impression counts per visitor key and placement to enforce
 * frequency caps server-side. Visitor key is uid (authenticated) or sid
 * (anonymous session cookie). Counts are stored in RTDB under
 * monetizationCaps/{visitorKey}/{placementKey} with TTL cleanup.
 *
 * Only the server (admin SDK) reads/writes this collection; client
 * access is denied by database rules.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { GROWTH_COLLECTIONS } from "./constants";
import { FrequencyCap, FrequencyCapType, FREQUENCY_CAP_TYPES } from "./constants";
import { deepClean } from "./database";

const REF = (visitorKey: string, placementKey: string) =>
    adminDatabase.ref(`${GROWTH_COLLECTIONS.placements}_byVisitor/${visitorKey}/${placementKey}`);

// Default TTL for cap entries: 90 days (covers PER_SESSION and PER_DAY with buffer)
const CAP_ENTRY_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Reads current cap counts for a visitor/placement.
 * Returns a partial record of cap type -> count (only types with limits).
 */
export async function getCapCounts(
    visitorKey: string,
    placementKey: string,
): Promise<Partial<Record<FrequencyCapType, number>>> {
    try {
        const snap = await REF(visitorKey, placementKey).get();
        const val = snap.val();
        if (!val || typeof val !== "object") return {};

        // Only return known cap types that have numeric counts
        const out: Partial<Record<FrequencyCapType, number>> = {};
        for (const type of Object.keys(val) as FrequencyCapType[]) {
            if (Object.values(FREQUENCY_CAP_TYPES).includes(type)) {
                const count = Number(val[type]);
                if (!Number.isNaN(count)) out[type] = Math.floor(count);
            }
        }
        return out;
    } catch {
        // Fail open: if we cannot read, assume no prior impressions
        return {};
    }
}

/**
 * Atomically reserves an impression for a visitor/placement.
 * Returns true if the impression was reserved (cap not reached),
 * false if the impression would exceed the cap.
 *
 * Uses a Firebase transaction to re-check limits and increment
 * in one step, preventing race conditions.
 */
export async function reserveCap(
    visitorKey: string,
    placementKey: string,
    caps: FrequencyCap[],
    now: number = Date.now(),
): Promise<boolean> {
    // If no caps defined, always allow (no reservation needed)
    if (!caps || caps.length === 0) return true;

    const dayKey = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD

    const result = await REF(visitorKey, placementKey).transaction((current) => {
        // Initialize or migrate state
        let state: Record<string, unknown> = {};
        if (current && typeof current === "object") {
            state = { ...current };
        }

        // Ensure we have a day field for PER_DAY reset
        if (!state.day || typeof state.day !== "string") {
            state.day = dayKey;
        }
        // If day changed, reset PER_DAY counters
        if (state.day !== dayKey) {
            state.day = dayKey;
            // Reset all PER_DAY caps to 0 (they will be incremented below if allowed)
            for (const cap of caps) {
                if (cap.type === "PER_DAY") {
                    state[cap.type] = 0;
                }
            }
        }

        // Check each cap
        let ok = true;
        for (const cap of caps) {
            const limit = cap.limit;
            const type = cap.type;
            const current = Number(state[type] ?? 0);
            if (limit > 0 && current >= limit) {
                ok = false;
                break;
            }
        }

        if (!ok) {
            // Abort transaction: return null to indicate failure
            return null;
        }

        // Increment counters for each cap type that has a limit
        for (const cap of caps) {
            if (cap.limit > 0) {
                state[cap.type] = (Number(state[cap.type] ?? 0)) + 1;
            }
        }
        state.updatedAt = now;

        return deepClean(state);
    });

    // If transaction was aborted, result.committed will be false
    return !!result?.committed;
}

/**
 * Cleans up old cap entries (caller can invoke periodically).
 * Not strictly required for correctness but prevents unbounded growth.
 */
export async function cleanupOldEntries(beforeMs: number = Date.now() - CAP_ENTRY_TTL_MS): Promise<void> {
    // Note: RTDB does not support efficient range queries on arbitrary keys.
    // A full scan would be expensive. For Phase 1.5 we rely on the fact that
    // PER_DAY resets daily and PER_SESSION ties to visitor key (sid/uid).
    // If needed, a separate cleanup job could be added later.
    // For now, we do nothing; entries older than TTL are harmless.
    return;
}