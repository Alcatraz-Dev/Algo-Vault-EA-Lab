import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadERPNextConfig, isERPNextConfigured } from "../../lib/integrations/erpnext/config";

describe("ERPNext Config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to disabled", () => {
    delete process.env.ERPNEXT_ENABLED;
    const config = loadERPNextConfig();
    expect(config.enabled).toBe(false);
  });

  it("enables when set to true", () => {
    process.env.ERPNEXT_ENABLED = "true";
    process.env.ERPNEXT_BASE_URL = "https://erp.example.com";
    process.env.ERPNEXT_API_KEY = "k";
    process.env.ERPNEXT_API_SECRET = "s";
    const config = loadERPNextConfig();
    expect(isERPNextConfigured(config)).toBe(true);
  });

  it("requires all fields", () => {
    process.env.ERPNEXT_ENABLED = "true";
    process.env.ERPNEXT_BASE_URL = "";
    const config = loadERPNextConfig();
    expect(isERPNextConfigured(config)).toBe(false);
  });
});
