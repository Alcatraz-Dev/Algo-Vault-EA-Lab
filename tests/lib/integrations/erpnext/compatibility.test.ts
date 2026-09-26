import { describe, it, expect, vi } from "vitest";
import { ERPNextAPIClient } from "../../../lib/integrations/erpnext/client";

describe("ERPNext Compatibility / Errors", () => {
  it("handles unreachable ERPNext (timeout/network)", async () => {
    const client = new ERPNextAPIClient();
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("timeout"));
    const res = await client.healthCheck();
    expect(res.reachable).toBe(false);
  });

  it("handles permission/403-like response", async () => {
    const client = new ERPNextAPIClient();
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 403, text: async () => "Forbidden" } as Response);
    await expect(client.createCustomer({ userId: "x" })).rejects.toThrow();
  });

  it("handles validation error (400)", async () => {
    const client = new ERPNextAPIClient();
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 400, text: async () => "Validation error" } as Response);
    await expect(client.createOrder({ orderId: "o", userId: "u", amount: 0, paymentStatus: "pending" })).rejects.toThrow();
  });
});
