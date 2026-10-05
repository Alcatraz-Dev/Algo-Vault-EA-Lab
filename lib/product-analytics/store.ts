/**
 * Product Analytics — server-side persistence.
 *
 * TWO RULES govern this file:
 *
 * 1. NEVER throw into a product workflow. Analytics must not be able to break a
 *    chart, a backtest, or a trade. Every write is wrapped and failures are
 *    logged, not propagated.
 *
 * 2. NEVER block a request. `trackEvent()` appends to an in-memory buffer and
 *    returns synchronously. A background flush writes batches to the Realtime
 *    Database. This is the "growth infrastructure must never slow the trading
 *    platform" requirement, enforced structurally rather than by convention.
 *
 * The buffer is flushed by:
 *  - `flushProductEvents()` when the buffer reaches BATCH_SIZE,
 *  - `flushProductEvents()` at the end of each request (fire-and-forget),
 *  - a scheduled job as a backstop for a serverless instance that dies before
 *    its buffer fills.
 */

import { adminDatabase, deepClean, writeEventIdempotent } from "@/lib/growth/database";
import { createProductEvent, type NewProductEvent, type ProductEvent } from "./events";
import { safeProps } from "./privacy";

/** Realtime Database collection for product events. */
export const PRODUCT_EVENTS_COLLECTION = "productEvents";

/** Per-user activation/rollup document. */
export const PRODUCT_USER_STATS_COLLECTION = "productUserStats";

/** Flushing keeps individual writes under Realtime Database's 60KB node limit. */
const BATCH_SIZE = 25;

/** Hard cap so a runaway loop cannot exhaust memory. Oldest events are dropped. */
const MAX_BUFFER = 500;

type Buffer = ProductEvent[];

let buffer: Buffer = [];

/**
 * Record a product event. Synchronous, non-throwing, and off the critical path.
 *
 * Returns the sanitized event so callers can log/assert on it in tests.
 */
export function trackEvent(input: NewProductEvent): ProductEvent {
    let event: ProductEvent;
    try {
        event = createProductEvent({ ...input, props: safeProps(input.props) });
    } catch (err) {
        // An unknown event type is a programming error, but it must not break
        // the product. Log it loudly in development and move on.
        console.error("[product-analytics] rejected event", err);
        return null as unknown as ProductEvent;
    }

    buffer.push(event);
    if (buffer.length > MAX_BUFFER) {
        buffer = buffer.slice(buffer.length - MAX_BUFFER);
    }
    if (buffer.length >= BATCH_SIZE) {
        // Fire and forget: the request continues without awaiting the write.
        void flushProductEvents();
    }
    return event;
}

/** Fire-and-forget flush for the end of a request. */
export function scheduleFlush(): void {
    if (buffer.length === 0) return;
    void flushProductEvents();
}

/**
 * Write the buffered events. Safe to call concurrently — a module-level
 * in-flight flag means overlapping calls do not double-write.
 */
let flushing = false;

export async function flushProductEvents(): Promise<{ written: number; dropped: number }> {
    if (flushing || buffer.length === 0) return { written: 0, dropped: 0 };
    flushing = true;
    const batch = buffer;
    buffer = [];

    let written = 0;
    let dropped = 0;
    try {
        const rollups = new Map<string, { type: string; count: number; lastAt: number }>();
        // Anonymous visitors grouped by day, so the funnel's VISITOR stage has a
        // real denominator instead of being inferred from signups.
        const anonByDay = new Map<string, Set<string>>();
        for (const event of batch) {
            try {
                const outcome = await writeEventIdempotent(
                    event.clientEventId,
                    PRODUCT_EVENTS_COLLECTION,
                    event as unknown as Record<string, unknown>
                );
                if (outcome.written) {
                    written++;
                    if (event.uid) {
                        const key = `${event.uid}:${event.type}`;
                        const current = rollups.get(key) ?? { type: event.type, count: 0, lastAt: 0 };
                        current.count += 1;
                        current.lastAt = Math.max(current.lastAt, event.occurredAt);
                        rollups.set(key, current);
                    } else if (event.anonId) {
                        const set = anonByDay.get(event.day) ?? new Set<string>();
                        set.add(event.anonId);
                        anonByDay.set(event.day, set);
                    }
                } else {
                    // Duplicate clientEventId — correctly deduplicated.
                    dropped++;
                }
            } catch (err) {
                dropped++;
                console.error("[product-analytics] event write failed", err);
            }
        }
        await Promise.all([
            ...[...rollups.entries()].map(([key, value]) => updateUserRollup(key, value)),
            ...[...anonByDay.entries()].map(([day, ids]) => writeAnonDayIndex(day, ids)),
        ]);
    } catch (err) {
        console.error("[product-analytics] flush failed", err);
    } finally {
        flushing = false;
    }
    return { written, dropped };
}

async function updateUserRollup(key: string, value: { type: string; count: number; lastAt: number }): Promise<void> {
    const [uid, type] = key.split(":");
    if (!uid || !type) return;
    try {
        const ref = adminDatabase.ref(`${PRODUCT_USER_STATS_COLLECTION}/${uid}/types/${type}`);
        await ref.set(
            deepClean({
                count: value.count,
                lastAt: value.lastAt,
                updatedAt: Date.now(),
            })
        );
    } catch (err) {
        console.error("[product-analytics] rollup failed", err);
    }
}

/**
 * Merge this flush's anonymous ids into the day's index. `merge()` rather than
 * `set()` so concurrent flushes from different instances accumulate instead of
 * clobbering each other.
 */
async function writeAnonDayIndex(day: string, ids: Set<string>): Promise<void> {
    if (ids.size === 0) return;
    try {
        const updates: Record<string, unknown> = {};
        for (const id of ids) updates[id] = true;
        await adminDatabase.ref(`${PRODUCT_EVENTS_COLLECTION}/_byDay/${day}`).update(updates);
    } catch (err) {
        console.error("[product-analytics] anon day index failed", err);
    }
}

/** Buffered event count. Used by tests and the /api/analytics/health route. */
export function pendingEventCount(): number {
    return buffer.length;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** All event types a user has ever performed, with counts. */
export async function getUserEventTypes(uid: string): Promise<{ type: string; count: number; lastAt: number }[]> {
    try {
        const snap = await adminDatabase.ref(`${PRODUCT_USER_STATS_COLLECTION}/${uid}/types`).get();
        const data = (snap.val() ?? {}) as Record<string, { count: number; lastAt: number }>;
        return Object.entries(data).map(([type, v]) => ({ type, count: v?.count ?? 0, lastAt: v?.lastAt ?? 0 }));
    } catch (err) {
        console.error("[product-analytics] getUserEventTypes failed", err);
        return [];
    }
}

/**
 * The user's most recent meaningful event timestamp, or null.
 * Used for retention, health, and churn detection.
 */
export async function getLastMeaningfulEventAt(uid: string): Promise<number | null> {
    const types = await getUserEventTypes(uid);
    if (types.length === 0) return null;
    return Math.max(...types.map((t) => t.lastAt));
}

/** Read raw events for a user, most recent first. Admin/diagnostic use only. */
export async function getUserEvents(uid: string, limit = 100): Promise<ProductEvent[]> {
    try {
        const snap = await adminDatabase
            .ref(PRODUCT_EVENTS_COLLECTION)
            .orderByChild("uid")
            .equalTo(uid)
            .limitToLast(limit)
            .get();
        const data = (snap.val() ?? {}) as Record<string, ProductEvent>;
        return Object.values(data)
            .filter((e) => e.id && !e.id.startsWith("_"))
            .sort((a, b) => b.occurredAt - a.occurredAt);
    } catch (err) {
        console.error("[product-analytics] getUserEvents failed", err);
        return [];
    }
}

/** Distinct anonymous visitors recorded on a day. Real count, never estimated. */
export async function getVisitorCountForDay(day: string): Promise<number> {
    try {
        const snap = await adminDatabase.ref(`${PRODUCT_EVENTS_COLLECTION}/_byDay/${day}`).get();
        const data = (snap.val() ?? {}) as Record<string, unknown>;
        return Object.keys(data).length;
    } catch (err) {
        console.error("[product-analytics] getVisitorCountForDay failed", err);
        return 0;
    }
}
