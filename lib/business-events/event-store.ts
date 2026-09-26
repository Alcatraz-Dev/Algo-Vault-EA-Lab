import { adminDatabase } from "@/lib/firebase-admin";
import { ServerValue } from "firebase-admin/database";
import type { BusinessEvent } from "./types";

export async function persistEvent(event: BusinessEvent): Promise<void> {
  await adminDatabase.ref(`businessEvents/${event.eventId}`).set({
    eventType: event.eventType,
    version: event.version,
    occurredAt: event.occurredAt,
    entityType: event.entity.type,
    entityId: event.entity.id,
    correlationId: event.correlationId ?? null,
    idempotencyKey: event.idempotencyKey,
    status: "pending",
    payload: event.payload,
  });
}

export async function getEvent(eventId: string): Promise<BusinessEvent | null> {
  const snap = await adminDatabase.ref(`businessEvents/${eventId}`).get();
  if (!snap.exists()) return null;
  const v = snap.val();
  return {
    eventId,
    eventType: v.eventType,
    version: v.version ?? 1,
    occurredAt: v.occurredAt,
    entity: { type: v.entityType, id: v.entityId },
    correlationId: v.correlationId ?? undefined,
    idempotencyKey: v.idempotencyKey,
    payload: v.payload,
  } as BusinessEvent;
}

export async function updateEventStatus(eventId: string, status: "pending" | "processing" | "processed" | "failed" | "dead-letter"): Promise<void> {
  await adminDatabase.ref(`businessEvents/${eventId}/status`).set(status);
  await adminDatabase.ref(`businessEvents/${eventId}/attempts`).set(ServerValue.increment(1));
}
