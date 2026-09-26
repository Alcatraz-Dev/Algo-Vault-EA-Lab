import { loadWorkspaceContext, saveWorkspaceContext, encodeContext, decodeContext } from "../../../../components/market-intelligence/workspace-context";

describe("Phase 7.5 Workspace Continuity", () => {
  it("preserves context across save/load cycle", () => {
    saveWorkspaceContext({ symbol: "XAUUSD", timeframe: "M5", backtestId: "BT-01" });
    const loaded = loadWorkspaceContext();
    expect(loaded.symbol).toBe("XAUUSD");
    expect(loaded.timeframe).toBe("M5");
  });
  it("invalid URL falls back safely", () => {
    const decoded = decodeContext("bad-url-string");
    expect(decoded).toEqual({});
  });
});
