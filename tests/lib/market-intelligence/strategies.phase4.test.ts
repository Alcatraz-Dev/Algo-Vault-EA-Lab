import { validateStrategy } from "../../../lib/market-intelligence/strategies/validator";
import { compileStrategy } from "../../../lib/market-intelligence/strategies/adapter";

describe("Strategy Phase 4", () => {
  it("validates a basic graph", () => {
    const def = {
      id: "t1", name: "Test", version: 1, nodes: [
        { id: "n1", type: "entry.long", label: "Buy", enabled: true, config: {} },
        { id: "n2", type: "exit.close", label: "Close", enabled: true, config: {} },
      ], edges: [{ id: "e1", source: "n1", target: "n2" }],
    };
    const v = validateStrategy(def as any);
    expect(v.valid).toBe(true);
  });

  it("detects missing entry", () => {
    const def = {
      id: "t2", name: "NoEntry", version: 1, nodes: [
        { id: "n1", type: "exit.close", label: "Close", enabled: true, config: {} },
      ], edges: [],
    };
    const v = validateStrategy(def as any);
    expect(v.missingEntry).toBe(true);
  });

  it("compiles to executable", () => {
    const def = { id: "t3", name: "C", version: 1, nodes: [{ id: "n1", type: "smart_money.bos", label: "BOS", config: {} }], edges: [] };
    const c = compileStrategy(def as any);
    expect(c.definition).toBeDefined();
  });
});
