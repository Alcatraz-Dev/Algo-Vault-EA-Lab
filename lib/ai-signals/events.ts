import { AISignal, SignalEvent, SignalTier } from "./types";
import { adminDatabase } from "@/lib/firebase-admin";

/**
 * Signal event recorder. Every state change is recorded as an append-only
 * event under `signalEvents/{signalId}/{eventId}` — historical states are
 * never overwritten. Also maintains the `signalsByDate/` time index.
 */

export function toDateKey(timestamp: number): string {
    return new Date(timestamp).toISOString().slice(0, 10);
}

export function buildEventId(signalId: string, eventType: string, timestamp: number): string {
    return `${eventType.toLowerCase()}_${timestamp}`;
}

export async function recordSignalEvent(
    signal: Pick<AISignal, "id">,
    eventType: SignalEvent["eventType"],
    price?: number,
    metadata?: Record<string, unknown>
): Promise<SignalEvent> {
    const timestamp = Date.now();
    const event: SignalEvent = {
        eventId: buildEventId(signal.id, eventType, timestamp),
        signalId: signal.id,
        eventType,
        price,
        timestamp,
        metadata,
    };

    await adminDatabase.ref(`signalEvents/${signal.id}/${event.eventId}`).set(event);

    return event;
}

/**
 * Re-adds the signal to the `signalsByDate/{YYYY-MM-DD}` index (idempotent).
 */
export async function indexSignalByDate(signal: AISignal): Promise<void> {
    const dateKey = toDateKey(Number(signal.createdAt || Date.now()));
    await adminDatabase
        .ref(`signalsByDate/${dateKey}/${signal.id}`)
        .set({
            id: signal.id,
            symbol: signal.symbol,
            timeframe: signal.timeframe,
            direction: signal.direction,
            tier: signal.tier || "FREE",
            createdAt: Number(signal.createdAt || Date.now()),
        });
}

export type SignalIndexEntry = {
    id: string;
    symbol: string;
    timeframe: string;
    direction: string;
    tier: SignalTier;
    createdAt: number;
};

export async function getSignalIdsByDate(dateKey: string): Promise<SignalIndexEntry[]> {
    const snap = await adminDatabase.ref(`signalsByDate/${dateKey}`).get();
    const entries: SignalIndexEntry[] = [];
    if (snap.exists()) {
        snap.forEach((child) => {
            const v = child.val();
            if (v && v.id) entries.push(v as SignalIndexEntry);
        });
    }
    return entries;
}