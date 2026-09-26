import { calculateRSI, getSnapshot } from "../../../lib/market-intelligence/indicators/adapter";

describe("Indicator Adapter", () => {
  it("computes RSI over closes", () => {
    const candles = Array.from({ length: 30 }, (_, i) => ({
      timestamp: i,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
    }));
    const r = calculateRSI(candles, 14);
    expect(r).toHaveLength(30);
    expect(typeof r[20]).toBe("number");
  });

  it("returns snapshot from real engine", () => {
    const candles = Array.from({ length: 200 }, (_, i) => ({ timestamp: i, open: 100, high: 102, low: 98, close: 100 + (i % 10) }));
    const snap = getSnapshot(candles);
    expect(snap.ema20).toBeDefined();
  });
});
