import type { BusinessEvent, BusinessEventType, BusinessEventEntityType } from "./types";
import { BUSINESS_EVENT_VERSION } from "./types";

function generateEventId(type: string, entityId: string): string {
  return `evt-${entityId}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEvent<T>(
  eventType: BusinessEventType,
  entityType: BusinessEventEntityType,
  entityId: string,
  payload: T,
  correlationId?: string,
  actor?: { type: "user" | "system" | "admin"; id?: string }
): BusinessEvent<T> {
  return {
    eventId: generateEventId(eventType, entityId),
    eventType,
    version: BUSINESS_EVENT_VERSION,
    occurredAt: new Date().toISOString(),
    actor: actor ? { type: actor.type, id: actor.id } : undefined,
    entity: { type: entityType, id: entityId },
    correlationId,
    idempotencyKey: `${entityType}-${entityId}-${eventType}-${payload ? JSON.stringify(payload).slice(0, 200) : ""}`,
    payload,
  };
}
