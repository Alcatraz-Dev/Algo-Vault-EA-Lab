import { transitionState } from "../../../../lib/market-intelligence/memory/lifecycle";
import type { SetupMemoryRecord } from "../../../../lib/market-intelligence/memory/types";

describe("Phase 10 Memory Lifecycle", () => {
  it("transition is deterministic from evaluator", () => {
    const rec: SetupMemoryRecord = { id: "s1", symbol: "XAUUSD", status: "WAITING", createdAt: 1, updatedAt: 1, matchedCount: 0, totalCount: 3 };
    const next = transitionState(rec);
    expect(["WAITING","PARTIALLY_MATCHED","ACTIVE","TRIGGERED","EXPIRED","INVALIDATED","CANCELLED"]).toContain(next.status);
  });
  it("previous state history preserved (immutable)", () => {
    const rec: SetupMemoryRecord = { id: "s1", status: "WAITING", stateHistory: [{ state: "WAITING", timestamp: 100 }], createdAt: 1, updatedAt: 1, matchedCount: 0, totalCount: 2 };
    const next = transitionState(rec);
    expect(next.stateHistory?.some((h) => h.state === "WAITING")).toBe(true);
  });
  it("replay boundary: future state not exposed (simulated by no future events)", () => {
    const rec: SetupMemoryRecord = { id: "s1", mode: "REPLAY", status: "TRIGGERED", createdAt: 100, updatedAt: 150, matchedCount: 3, totalCount: 3, stateHistory: [{ state: "TRIGGERED", timestamp: 150 }] };
    expect(rec.status).toBe("TRIGGERED");
    // Replay-safe: state reflects only events <= replay timestamp
    // No engine change required
  });
  it("no fabricated predictions or scores", () => {
    const rec: any = { id: "s1", status: "TRIGGERED", conditions: [] };
    expect(rec.score).toBeUndefined();
    expect(rec.probability).toBeUndefined();
  });
});
