import { normalizeCandle, validateCandleSeries } from "../../../lib/market-intelligence/engine";

describe("Market Data Engine", () => {
  it("normalizes a candle", () => {
    const c = normalizeCandle({ timestamp: 1, open: 100, high: 105, low: 95, close: 102 }, "XAUUSD", "M5");
    expect(c.timestamp).toBe(1);
    expect(c.symbol).toBe("XAUUSD");
  });

  it("flags invalid timestamp order", () => {
    const issues = validateCandleSeries([
      { timestamp: 2, open: 1, high: 2, low: 0, close: 1 },
      { timestamp: 1, open: 1, high: 2, low: 0, close: 1 },
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });
});
