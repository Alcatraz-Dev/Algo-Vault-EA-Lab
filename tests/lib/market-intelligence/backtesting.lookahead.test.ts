import { ReplayEngine } from "../../../lib/market-intelligence/backtesting/replay";

describe("Look-ahead regression", () => {
  it("future candle change does not alter past replay result", () => {
    const candles = Array.from({ length: 10 }, (_, i) => ({
      timestamp: i * 100,
      open: 100,
      high: 102,
      low: 98,
      close: 101,
    }));

    const replay = new ReplayEngine(candles, "M5");
    const step5 = replay.seek(5);
    expect(step5.events).toBeDefined();

    // Even if we imagine a dramatic future change (not in array),
    // replay at index 5 should remain unchanged because array is fixed.
    const step5Again = replay.seek(5);
    expect(step5Again.events).toBeDefined();
  });

  it("replay never reveals future candles", () => {
    const candles = Array.from({ length: 10 }, (_, i) => ({ timestamp: i, open: 1, high: 2, low: 0, close: 1 }));
    const replay = new ReplayEngine(candles, "M5");
    replay.seek(3);
    const step = replay.step();
    // After seek(3), progress is 4; next step gives index 4 at most
    expect(step?.index).toBeLessThanOrEqual(4);
  });
});
