import { describe, it, expect } from "vitest";
import { getSyncState, recordEvent, updateEventStatus } from "../../../lib/integrations/erpnext/sync";
import { createEventPayload } from "../../../lib/integrations/erpnext/events";

describe("ERPNext Sync", () => {
  it("records and updates event status", () => {
    const event = createEventPayload("customer.created", "customer", "u1");
    recordEvent(event);
    const state = getSyncState();
    expect(state.pendingEvents).toBeGreaterThanOrEqual(0);
    updateEventStatus(event.eventId, "synced", 1);
    const evt = state.events.find((e) => e.eventId === event.eventId);
    expect(evt?.status).toBe("synced");
  });

  it("persists retry state", () => {
    const event = createEventPayload("order.paid", "order", "o1");
    recordEvent(event);
    updateEventStatus(event.eventId, "failed", 1, "timeout");
    const state = getSyncState();
    expect(state.failedEvents).toBeGreaterThanOrEqual(1);
  });
});
