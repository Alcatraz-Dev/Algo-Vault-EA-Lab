import { SmartMoneyEngine } from "../../../lib/market-intelligence/smart-money/engine";

describe("Smart Money Engine", () => {
  const engine = new SmartMoneyEngine({ mode: "historical" });

  it("returns empty when insufficient candles", () => {
    const res = engine.run([{ timestamp: 1, open: 1, high: 2, low: 0, close: 1 }] as any, "M5");
    expect(res.limitations.length).toBeGreaterThan(0);
  });

  it("detects structure events with real candles", () => {
    const candles = Array.from({ length: 25 }, (_, i) => ({
      timestamp: i * 1000,
      open: 100 + i,
      high: 105 + i,
      low: 98 + i,
      close: 101 + i,
    }));
    const res = engine.run(candles as any, "M5");
    expect(typeof res.structureState).toBe("object");
    expect(res.structureState.trend !== undefined).toBe(true);
  });

  it("does not invent fake FVG without gap", () => {
    // Flat candles with no gap
    const candles = Array.from({ length: 30 }, (_, i) => ({
      timestamp: i,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
    }));
    const res = engine.run(candles as any, "M5");
    expect(res.fvg.length).toBe(0);
  });

  it("distinguishes mode explicitly", () => {
    const engineLive = new SmartMoneyEngine({ mode: "live" });
    expect(engineLive["mode"]).toBe("live");
  });
});
