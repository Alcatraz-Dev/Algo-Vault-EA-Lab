import { buildIntelligenceContext, isReplaySafe } from "../../../../lib/market-intelligence/ai/intelligence-layer";

describe("Phase 7.5 Replay Leakage (Intelligence Context)", () => {
  it("same replay context produced regardless of future data presence", () => {
    const workspace = { symbol: "XAUUSD", timeframe: "M5", replayPosition: 10, selectedTimestamp: 1719000000000 };
    // Build with minimal future data and with more future data; both must be replay-safe
    const ctx1 = buildIntelligenceContext(workspace, undefined, undefined, undefined, { position: 10, timestamp: 1719000000000 }, undefined);
    const ctx2 = buildIntelligenceContext(workspace, undefined, undefined, { totalTrades: 99 }, { position: 10, timestamp: 1719000000000 }, undefined);
    expect(isReplaySafe(ctx1)).toBe(true);
    expect(isReplaySafe(ctx2)).toBe(true);
    // Replay context must include replayState
    expect(ctx1.replayState).toBeDefined();
    expect(ctx2.replayState).toBeDefined();
    expect(ctx1.replayState?.position).toBe(10);
  });
  it("future trade must not appear in replay context via backtest data", () => {
    const workspace = { replayPosition: 5, selectedTimestamp: 1719000000000 };
    // Even with backtest containing future trades, replayState binds context
    const ctx = buildIntelligenceContext(workspace, undefined, undefined, { totalTrades: 999 }, { position: 5, timestamp: 1719000000000 }, undefined);
    expect(isReplaySafe(ctx)).toBe(true);
  });
});
