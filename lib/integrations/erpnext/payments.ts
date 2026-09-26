import { ERPNextAPIClient } from "./client";
import type { RecordPaymentInput, ERPNextPayment } from "./types";
import { createEventPayload } from "./events";
import { recordEvent, updateEventStatus } from "./sync";

export async function syncPayment(
  client: ERPNextAPIClient,
  input: RecordPaymentInput,
  tenant?: string
): Promise<ERPNextPayment> {
  const event = createEventPayload("payment.recorded", "payment", input.stripePaymentIntentId || input.orderId || "unknown", { ...input });
  recordEvent(event, tenant);
  try {
    const result = await client.recordPayment(input);
    updateEventStatus(event.eventId, "synced", 1, undefined, tenant);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateEventStatus(event.eventId, "failed", 1, msg, tenant);
    throw e;
  }
}
