import { buildEdgeId, buildEdge } from "../../../../lib/market-intelligence/knowledge/relationship-builder";
import { validateGraph } from "../../../../lib/market-intelligence/knowledge/validation";
import { resolveLineage } from "../../../../lib/market-intelligence/knowledge/resolver";
describe("Phase 13 Knowledge Graph", () => {
  it("deterministic edge IDs", () => {
    const e1 = buildEdge({type:"pattern",id:"p1"}, "VALIDATED_BY", {type:"backtest",id:"b1"});
    const e2 = buildEdge({type:"pattern",id:"p1"}, "VALIDATED_BY", {type:"backtest",id:"b1"});
    expect(e1.id).toBe(e2.id);
  });
  it("duplicate prevention via same id", () => {
    const e = buildEdge({type:"pattern",id:"p1"}, "OBSERVED_IN", {type:"setup",id:"s1"});
    expect(validateGraph([e]).duplicateEdges.length).toBe(0);
  });
  it("lineage resolves chain", () => {
    const edges = [
      buildEdge({type:"pattern",id:"p1"},"VALIDATED_BY",{type:"backtest",id:"bt1"}),
      buildEdge({type:"backtest",id:"bt1"},"HAS_OOS_RESULT",{type:"oos",id:"oos1"}),
    ];
    const res = resolveLineage({type:"pattern",id:"p1"}, edges, 4);
    expect(res.nodes.length).toBeGreaterThanOrEqual(1);
  });
  it("no fake nodes generated", () => {
    const res = resolveLineage({type:"pattern",id:"p-missing"}, [], 4);
    expect(res.nodes[0].id).toBe("p-missing");
  });
});
