import { describe, it, expect } from "vitest";
import { buildStableExternalId, buildExternalIds, mapEntityReference } from "../../../../lib/integrations/erpnext/mapper";
import { loadERPNextConfig, isERPNextConfigured } from "../../../../lib/integrations/erpnext/config";

describe("ERPNext Phase 10 Mapping", () => {
  it("builds stable external IDs", () => {
    expect(buildStableExternalId("ALGOVAULT-ORDER", "ord_123")).toBe("ALGOVAULT-ORDER-ord_123");
  });
  it("maps entity references deterministically", () => {
    expect(mapEntityReference("customer", "c1").algovaultUserId).toBe("ALGOVAULT-CUSTOMER-c1");
  });
  it("idempotency keys use stable IDs", () => {
    const id = buildStableExternalId("ALGOVAULT-ORDER", "abc-123");
    expect(id).toContain("ALGOVAULT-ORDER");
  });
  it("config safe by default", () => {
    const c = loadERPNextConfig();
    expect(c.enabled).toBe(false);
    expect(isERPNextConfigured(c)).toBe(false);
  });
});
