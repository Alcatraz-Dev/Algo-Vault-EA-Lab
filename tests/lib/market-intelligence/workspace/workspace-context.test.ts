import { encodeContext, decodeContext, validateContext, isValidSymbol, isValidTimeframe } from "../../../../components/market-intelligence/workspace-context";

describe("workspace-context Phase 7.3", () => {
  it("serializes and parses safe context", () => {
    const ctx = { symbol: "XAUUSD", timeframe: "M5", backtestId: "BT-001", selectedTradeId: "T42" };
    const s = encodeContext(ctx);
    const parsed = decodeContext(s);
    expect(parsed.symbol).toBe("XAUUSD");
    expect(parsed.timeframe).toBe("M5");
    expect(parsed.backtestId).toBe("BT-001");
  });
  it("falls back safely on invalid input", () => {
    expect(decodeContext("not-json")).toEqual({});
    expect(decodeContext("{}")).toEqual({});
  });
  it("validates symbols and timeframes", () => {
    expect(isValidSymbol("XAUUSD")).toBe(true);
    expect(isValidSymbol("INVALID!!!")).toBe(false);
    expect(isValidTimeframe("M5")).toBe(true);
    expect(isValidTimeframe("M99")).toBe(false);
  });
  it("drops unsupported keys during validation", () => {
    const raw = { symbol: "XAUUSD", badKey: "secret", timeframe: "M5" } as any;
    const v = validateContext(raw);
    expect((v as any).badKey).toBeUndefined();
  });
  it("does not encode secrets or large objects", () => {
    const s = encodeContext({ symbol: "XAUUSD", selectedTimestamp: 1719000000000 });
    expect(s).not.toContain("secret");
    expect(typeof s).toBe("string");
  });
});
