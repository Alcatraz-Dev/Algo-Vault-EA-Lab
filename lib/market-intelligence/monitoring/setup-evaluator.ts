/** Deterministic setup evaluation from existing events. No prediction. */
import type { SetupState, SetupCondition } from "./types";
export function evaluateSetup(id: string, conditions: SetupCondition[], events?: any[]): SetupState {
  const matched = conditions.filter((c) => c.matched).length;
  const state = matched === conditions.length ? "TRIGGERED" : matched > 0 ? "PARTIALLY_MATCHED" : "WAITING";
  return { id, symbol: undefined, timeframe: undefined, state, conditions, matchedCount: matched, totalCount: conditions.length, evidence: events?.map((e) => e.eventId || String(e.timestamp)) || [], created: Date.now(), updated: Date.now() };
}
