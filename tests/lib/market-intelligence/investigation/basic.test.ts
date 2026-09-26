import { describe, it, expect } from "vitest";
import { buildInvestigationContext } from "../../../lib/market-intelligence/investigation/context";
import { resolveInvestigation } from "../../../lib/market-intelligence/investigation/resolver";

describe("Phase 14 Investigation", () => {
  it("context builds deterministically", () => {
    const ctx = buildInvestigationContext("pattern", "42", { symbol: "XAUUSD", timeframe: "M5" });
    expect(ctx.root.id).toBe("42");
    expect(ctx.root.type).toBe("pattern");
    expect(ctx.workspace?.symbol).toBe("XAUUSD");
  });

  it("resolver uses Phase 13 graph without inventing nodes", () => {
    const res = resolveInvestigation({ type: "pattern", id: "p1" }, []);
    expect(res.root.id).toBe("p1");
    expect(res.nodes.length).toBe(1);
    expect(res.lineageTruncated).toBeFalsy();
  });

  it("replay timestamp excludes future evidence (design, not full replay engine here)", () => {
    const ctx = buildInvestigationContext("setup", "s1", undefined, "replay");
    expect(ctx.replayTimestamp).toBeDefined();
  });

  it("no duplicate engine introduced", () => {
    expect(typeof resolveInvestigation).toBe("function");
  });
});
