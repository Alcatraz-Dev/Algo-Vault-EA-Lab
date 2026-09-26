/** Lifecycle wrapper around existing setup-evaluator. Deterministic, no prediction. */
import type { SetupMemoryRecord } from "./types";
import { evaluateSetup } from "../monitoring/setup-evaluator";

export function transitionState(current: SetupMemoryRecord, events?: any[]): SetupMemoryRecord {
  // Only apply deterministic transition from evaluator output; never invent state
  const evaluated = evaluateSetup(current.id, current.conditions?.map((c) => ({ type: c.type, matched: !!c.matched, id: c.evidence })) || [], events);
  const nextStatus = evaluated.state as SetupMemoryRecord["status"];
  const history = [...(current.stateHistory || [])];
  if (nextStatus !== current.status) {
    history.push({ state: nextStatus, timestamp: Date.now(), evidence: evaluated.evidence?.join(",") || "deterministic" });
  }
  return { ...current, status: nextStatus, matchedCount: evaluated.matchedCount, totalCount: evaluated.totalCount, updatedAt: Date.now(), stateHistory: history, evidenceIds: evaluated.evidence || current.evidenceIds };
}
