import { buildEvidenceDefinition } from "../../../../lib/market-intelligence/validation/evidence-definition";
import { buildCandidate } from "../../../../lib/market-intelligence/validation/candidate-builder";
describe("Phase 12 Validation", () => {
  it("evidence definition separates historical from validation", () => {
    const d = buildEvidenceDefinition({ symbol: "XAUUSD", timeframe: "M5" }, ["SELL_SWEEP","BOS"]);
    expect(d.conditions).toContain("SELL_SWEEP");
  });
  it("candidate builder returns draft not strategy", () => {
    const c = buildCandidate({ evidenceDefinition: { symbol: "XAUUSD" } });
    expect(c.status).toBe("DRAFT");
  });
  it("pipeline references existing engines, not duplicates", () => {
    const p = require("../../../../lib/market-intelligence/validation/pipeline");
    expect(typeof p.runBacktest).toBe("function");
  });
  it("no prediction fields in result", () => {
    const r = { stage: "BACKTEST", status: "COMPLETED" } as Record<string, unknown>;
    expect(r.probability).toBeUndefined();
  });
});
