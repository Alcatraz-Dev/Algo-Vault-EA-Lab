import { validateContext, decodeContext } from "../../../../components/market-intelligence/workspace-context";

describe("Phase 7.5 Workspace Context Security", () => {
  it("rejects malicious payloads and secret fields", () => {
    const malicious = { symbol: "XAUUSD", bad: "<script>alert('x')</script>", secretKey: "sk_live_secret", unknownKey: true } as any;
    const v = validateContext(malicious);
    expect((v as any).bad).toBeUndefined();
    expect((v as any).secretKey).toBeUndefined();
    expect((v as any).unknownKey).toBeUndefined();
  });
  it("decodeContext ignores invalid JSON", () => {
    expect(decodeContext("not-json!!!")).toEqual({});
  });
  it("encode/decode is deterministic", () => {
    const ctx = { symbol: "XAUUSD", timeframe: "M5" };
    const encoded = require("../../../../components/market-intelligence/workspace-context").encodeContext(ctx);
    const decoded = require("../../../../components/market-intelligence/workspace-context").decodeContext(encoded);
    expect(decoded.symbol).toBe("XAUUSD");
  });
});
