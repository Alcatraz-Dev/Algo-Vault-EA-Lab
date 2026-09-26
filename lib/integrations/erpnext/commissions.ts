import { ERPNextAPIClient } from "./client";
import type { CreateCommissionInput, ERPNextCommission } from "./types";
import { createEventPayload } from "./events";
import { recordEvent, updateEventStatus } from "./sync";

export async function syncCommission(
  client: ERPNextAPIClient,
  input: CreateCommissionInput,
  tenant?: string
): Promise<ERPNextCommission> {
  const event = createEventPayload("commission.created", "commission", input.commissionId || `com-${Date.now()}`, { ...input });
  recordEvent(event, tenant);
  try {
    const result = await client.createCommission(input);
    updateEventStatus(event.eventId, "synced", 1, undefined, tenant);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateEventStatus(event.eventId, "failed", 1, msg, tenant);
    throw e;
  }
}
