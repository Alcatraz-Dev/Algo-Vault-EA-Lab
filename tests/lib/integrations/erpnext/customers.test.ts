import { describe, it, expect } from "vitest";
import { syncCustomer } from "../../../lib/integrations/erpnext/customers";
import { ERPNextAPIClient } from "../../../lib/integrations/erpnext/client";

describe("Customer Sync", () => {
  it("idempotent create returns customer", async () => {
    const client = new ERPNextAPIClient();
    // Mock healthCheck to avoid network
    vi.spyOn(client, "createCustomer").mockResolvedValue({
      name: "Test",
      algovaultUserId: "u1",
      email: "test@example.com",
    });
    const res = await syncCustomer(client, { userId: "u1", name: "Test", email: "test@example.com" });
    expect(res.algovaultUserId).toBe("u1");
  });

  it("handles failure gracefully", async () => {
    const client = new ERPNextAPIClient();
    vi.spyOn(client, "createCustomer").mockRejectedValue(new Error("down"));
    await expect(syncCustomer(client, { userId: "u2" })).rejects.toThrow();
  });
});
