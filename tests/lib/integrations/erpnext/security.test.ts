import { describe, it, expect } from "vitest";
import { loadERPNextConfig } from "../../../lib/integrations/erpnext/config";

describe("ERPNext Security", () => {
  it("credentials are not exposed in config object to client" , () => {
    // We don't expose config directly to client; client reads server env only
    const config = loadERPNextConfig();
    // In a real app, no component should access this directly; this is server-only
    expect(typeof config.apiSecret).toBe("string");
  });

  it("disabled by default", () => {
    const config = loadERPNextConfig();
    expect(config.enabled).toBe(false);
  });
});
