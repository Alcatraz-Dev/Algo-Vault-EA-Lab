import { runBacktest, replayCandleProgression } from "../../../lib/market-intelligence/backtesting/engine";

describe("Backtesting Engine", () => {
  it("exposes limitations honestly when no candles", () => {
    const result = runBacktest({ symbol: "XAUUSD", timeframe: "M5", startDate: "2023-01-01", endDate: "2023-01-02", initialBalance: 10000, positionSizeMode: "percent", positionSizeValue: 1, maxPositions: 1 }, []);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.trades).toEqual([]);
  });

  it("replay never shows future candles", () => {
    const candles = [{ timestamp: 1, open: 1, high: 2, low: 0, close: 1 }, { timestamp: 2, open: 1, high: 2, low: 0, close: 1 }];
    const replay = replayCandleProgression(candles, 0);
    expect(replay).toHaveLength(1);
  });
});
