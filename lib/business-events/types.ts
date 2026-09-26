export const BUSINESS_EVENT_VERSION = 1;

export type BusinessEventEntityType =
  | "customer"
  | "product"
  | "order"
  | "payment"
  | "invoice"
  | "license"
  | "subscription"
  | "commission";

export type BusinessEventType =
  | "customer.created"
  | "customer.updated"
  | "product.created"
  | "product.updated"
  | "order.created"
  | "order.paid"
  | "order.cancelled"
  | "order.refunded"
  | "payment.created"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded"
  | "invoice.created"
  | "invoice.paid"
  | "invoice.voided"
  | "license.created"
  | "license.activated"
  | "license.expired"
  | "license.revoked"
  | "subscription.created"
  | "subscription.updated"
  | "subscription.cancelled"
  | "commission.created"
  | "commission.updated";

export interface BusinessEventActor {
  type: "user" | "system" | "admin";
  id?: string;
}

export interface BusinessEventEntity {
  type: BusinessEventEntityType;
  id: string;
}

export interface BusinessEvent<T = unknown> {
  eventId: string;
  eventType: BusinessEventType;
  version: number;
  occurredAt: string;
  actor?: BusinessEventActor;
  entity: BusinessEventEntity;
  correlationId?: string;
  idempotencyKey: string;
  payload: T;
}
