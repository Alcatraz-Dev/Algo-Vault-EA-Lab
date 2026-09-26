import { describe, it, expect } from "vitest";
import { createEvent } from "../../../lib/business-events/events";
import { dispatcher } from "../../../lib/business-events/dispatcher";
import { ERPNextAdapter } from "../../../lib/business-events/adapters/erpnext";

describe("Business Events", () => {
  it("creates event with version and idempotency key", () => {
    const evt = createEvent("order.paid", "order", "o-1", { amount: 49 });
    expect(evt.version).toBe(1);
    expect(evt.eventType).toBe("order.paid");
    expect(evt.idempotencyKey).toContain("order-o-1");
  });

  it("ERPNext adapter skips when disabled", async () => {
    const adapter = new ERPNextAdapter();
    const evt = createEvent("customer.created", "customer", "c-1", {});
    const res = await adapter.handle(evt);
    expect(res.success).toBe(true);
  });
});
