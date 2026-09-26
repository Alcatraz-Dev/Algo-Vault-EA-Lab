export type ERPNextEventType =
  | "customer.created"
  | "customer.updated"
  | "order.created"
  | "order.paid"
  | "order.refunded"
  | "subscription.created"
  | "subscription.cancelled"
  | "license.created"
  | "license.expired"
  | "commission.created"
  | "developer.created"
  | "payment.recorded";

export interface ERPNextEvent {
  eventId: string;
  type: ERPNextEventType;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  status: "pending" | "synced" | "failed" | "retrying";
  errorCode?: string;
  lastAttemptAt?: string;
  completedAt?: string;
}

export function createEventPayload(
  type: ERPNextEventType,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown> = {}
): ERPNextEvent {
  return {
    eventId: `${entityType}-${entityId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    entityType,
    entityId,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
}
