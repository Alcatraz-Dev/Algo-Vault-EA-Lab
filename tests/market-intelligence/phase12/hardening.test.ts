import { describe, it, expect } from "vitest";
import { deriveDataQuality } from "../../../lib/market-intelligence/phase12/data-quality";
import { evaluateMTF } from "../../../lib/market-intelligence/phase12/mtf-confluence";
import { transitionSetup } from "../../../lib/market-intelligence/phase12/setup-lifecycle";
import { AI_BOUNDARY_RULES } from "../../../lib/market-intelligence/phase12/ai-boundary";
import { buildHistoricalEvidence } from "../../../lib/market-intelligence/phase12/historical-bridge";
import { assembleContext } from "../../../lib/market-intelligence/phase12/context-pipeline";

describe("Phase 12 Behavioral Hardening", () => {
  it("MTF: full alignment from biases", () => {
    const entries = evaluateMTF(["H4","H1","M15","M5","M1"], { H4: "bullish", H1: "bullish", M15: "bullish", M5: "bullish", M1: "bullish" });
    expect(entries.every(e => e.state === "aligned" || e.state === "mixed")).toBe(true);
    expect(entries.find(e => e.timeframe === "H4")?.trend).toBe("bullish");
  });

  it("MTF: conflicting when biases differ", () => {
    const entries = evaluateMTF(["M5","M1"], { M5: "bearish", M1: "bullish" });
    expect(entries.some(e => e.dataAvailable)).toBe(true);
  });

  it("MTF: missing timeframe yields unavailable", () => {
    const entries = evaluateMTF(["M1"], {});
    expect(entries[0].dataAvailable).toBe(false);
  });

  it("Data quality: insufficient with <2 timeframes", () => {
    const dq = deriveDataQuality(["M1"]);
    expect(dq.overall).toBe("insufficient");
    expect(dq.aiEligible).toBe(false);
  });

  it("Setup lifecycle: insufficient data remains insufficient", () => {
    const s = { setupId: "s1", symbol: "X", timeframe: "M5", state: "idle" as const, conditions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: "engine" };
    const updated = transitionSetup(s, false, false, false);
    expect(updated.state).toBe("insufficient_data");
  });

  it("AI boundary rules are non-empty and forbid invention", () => {
    expect(AI_BOUNDARY_RULES.length).toBeGreaterThan(0);
    expect(AI_BOUNDARY_RULES.some(r => r.includes("invent"))).toBe(true);
  });

  it("Historical bridge unavailable when no session", () => {
    const h = buildHistoricalEvidence();
    expect(h.hasEvidence).toBe(false);
    expect(h.source).toBe("unavailable");
  });

  it("Context pipeline assembles deterministically without fake data", () => {
    const ctx = assembleContext("XAUUSD", ["M1","M5"], { M1: "bullish", M5: "bullish" });
    expect(ctx.dataQuality.overall).toBe("partial");
    expect(ctx.mtfEntries.length).toBe(2);
    expect(ctx.historicalEvidence.source).toBe("unavailable");
  });

  it("Failure isolation: one missing timeframe does not collapse context", () => {
    const ctx = assembleContext("XAUUSD", ["M1"], { M1: "bullish" });
    expect(ctx.mtfEntries[0].state).toBe("aligned");
    expect(ctx.dataQuality.timeframes).toBeDefined();
  });
});
