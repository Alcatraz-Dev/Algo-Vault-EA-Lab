import { ERPNextAPIClient } from "./client";
import type { CreateOrderInput, ERPNextOrder } from "./types";
import { createEventPayload } from "./events";
import { recordEvent, updateEventStatus } from "./sync";

export async function syncOrder(
  client: ERPNextAPIClient,
  input: CreateOrderInput,
  tenant?: string
): Promise<ERPNextOrder> {
  const event = createEventPayload("order.created", "order", input.orderId, { ...input });
  recordEvent(event, tenant);

  try {
    const result = await client.createOrder(input);
    updateEventStatus(event.eventId, "synced", 1, undefined, tenant);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateEventStatus(event.eventId, "failed", 1, msg, tenant);
    throw e;
  }
}

export async function syncOrderPaid(
  client: ERPNextAPIClient,
  input: CreateOrderInput,
  tenant?: string
): Promise<ERPNextOrder> {
  // For "paid", we treat as order update (re-create or record) with status paid
  const event = createEventPayload("order.paid", "order", input.orderId, { ...input, status: "paid" });
  recordEvent(event, tenant);
  try {
    const result = await client.createOrder({ ...input, paymentStatus: "paid" });
    updateEventStatus(event.eventId, "synced", 1, undefined, tenant);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateEventStatus(event.eventId, "failed", 1, msg, tenant);
    throw e;
  }
}
