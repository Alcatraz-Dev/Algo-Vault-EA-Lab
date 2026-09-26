import { describe, it, expect } from "vitest";
import { ERPNextNotEnabledError, ERPNextSyncError } from "../../../lib/integrations/erpnext/errors";

describe("ERPNext Errors", () => {
  it("creates sync error with code", () => {
    const err = new ERPNextSyncError("fail", "customer", "id-1");
    expect(err.message).toBe("fail");
    expect(err.code).toBe("ERP_SYNC_ERROR");
    expect(err.entityType).toBe("customer");
  });

  it("not enabled error", () => {
    const err = new ERPNextNotEnabledError();
    expect(err.code).toBe("ERP_NOT_ENABLED");
  });
});
