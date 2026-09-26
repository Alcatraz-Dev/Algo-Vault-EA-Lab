import { ERPNextAPIClient } from "./client";
import type { CreateCustomerInput, UpdateCustomerInput, ERPNextCustomer } from "./types";
import { createEventPayload } from "./events";
import { recordEvent, updateEventStatus } from "./sync";

export async function syncCustomer(
  client: ERPNextAPIClient,
  input: CreateCustomerInput | UpdateCustomerInput,
  tenant?: string
): Promise<ERPNextCustomer> {
  const isUpdate = "email" in input && !("userId" in input && Object.prototype.hasOwnProperty.call(input, "userId") && !(Object.prototype.hasOwnProperty.call(input, "email")));
  // Simple heuristic: if userId present and we treat as create/update based on caller
  const event = createEventPayload(
    isUpdate ? "customer.updated" : "customer.created",
    "customer",
    (input as CreateCustomerInput).userId,
    { ...input }
  );
  recordEvent(event, tenant);

  try {
    const result = isUpdate
      ? await client.updateCustomer(input as UpdateCustomerInput)
      : await client.createCustomer(input as CreateCustomerInput);
    updateEventStatus(event.eventId, "synced", 1, undefined, tenant);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateEventStatus(event.eventId, "failed", 1, msg, tenant);
    throw e;
  }
}
