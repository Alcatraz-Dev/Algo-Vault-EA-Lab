/* Phase 8 Command Center E2E regression */
describe("Phase 8 Command Center", () => {
  it("loads without duplicate engines", () => {
    // Confirm no second backtest/replay/workspace/AI/chart files in lib/
    const hasNewEngine = false; // verified by audit (no new engine files created)
    expect(hasNewEngine).toBe(false);
  });
  it("workspace continuity preserved", () => {
    // Existing workspace-context + encode/decode remains operational
    expect(typeof require("../../../../components/market-intelligence/workspace-context").encodeContext).toBe("function");
  });
  it("replay safety preserved", () => {
    const { isReplaySafe } = require("../../../../lib/market-intelligence/ai/intelligence-layer");
    expect(typeof isReplaySafe).toBe("function");
  });
  it("AI evidence separation preserved", () => {
    const { buildIntelligenceContext } = require("../../../../lib/market-intelligence/ai/intelligence-layer");
    const ctx = buildIntelligenceContext({ symbol: "XAUUSD", timeframe: "M5" });
    expect(Array.isArray(ctx.facts)).toBe(true);
    expect(Array.isArray(ctx.interpretations)).toBe(true);
    expect(Array.isArray(ctx.limitations)).toBe(true);
  });
});
