import { buildIntelligenceContext, isReplaySafe } from "../../../../lib/market-intelligence/ai/intelligence-layer";

describe("Phase 7.4 Intelligence Layer", () => {
  it("builds context with facts/interpretations/limitations", () => {
    const ctx = buildIntelligenceContext({ symbol: "XAUUSD", timeframe: "M5" }, { trend: "bullish" });
    expect(ctx.facts.length).toBeGreaterThan(0);
    expect(ctx.interpretations.length).toBeGreaterThanOrEqual(0);
    expect(ctx.limitations?.length ?? 0).toBeGreaterThan(0);
  });
  it("replay mode excludes future data (replay safe)", () => {
    const ctx = buildIntelligenceContext({ replayPosition: 100, selectedTimestamp: 1719000000000 }, undefined, undefined, undefined, { position: 100 });
    expect(isReplaySafe(ctx)).toBe(true);
    expect(ctx.replayState?.position).toBe(100);
  });
  it("missing values remain null/— not zero", () => {
    const ctx = buildIntelligenceContext({ symbol: "GBPUSD" }, undefined, undefined, { totalTrades: undefined }, undefined);
    expect(ctx.facts.some((f) => f.value.includes("GBPUSD"))).toBe(true);
    // backtestSummary with undefined trades should not fabricate zero
    expect(ctx.backtestSummary?.trades).toBeUndefined();
  });
});
