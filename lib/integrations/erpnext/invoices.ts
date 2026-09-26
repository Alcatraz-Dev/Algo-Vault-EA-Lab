import { ERPNextAPIClient } from "./client";
import type { CreateInvoiceInput, ERPNextInvoice } from "./types";
import { createEventPayload } from "./events";
import { recordEvent, updateEventStatus } from "./sync";

export async function syncInvoice(
  client: ERPNextAPIClient,
  input: CreateInvoiceInput,
  tenant?: string
): Promise<ERPNextInvoice> {
  const event = createEventPayload("order.paid", "invoice", input.orderId || "unknown", { ...input });
  recordEvent(event, tenant);
  try {
    const result = await client.createInvoice(input);
    updateEventStatus(event.eventId, "synced", 1, undefined, tenant);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateEventStatus(event.eventId, "failed", 1, msg, tenant);
    throw e;
  }
}
