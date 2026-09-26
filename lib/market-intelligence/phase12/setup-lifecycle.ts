/**
 * Phase 12 — Setup Lifecycle (deterministic; AI cannot confirm alone)
 */
export type SetupState = "idle" | "forming" | "confirmed" | "invalidated" | "expired" | "insufficient_data";

export interface SetupLifecycle {
  setupId: string;
  symbol: string;
  timeframe: string;
  createdAt: string;
  updatedAt: string;
  state: SetupState;
  conditions: string[];
  marketContext?: string;
  smartMoneyContext?: string;
  mtfContext?: string;
  invalidationCondition?: string;
  source: string; // deterministic engine source
}

export function transitionSetup(
  current: SetupLifecycle,
  hasConfirmation: boolean,
  hasInvalidation: boolean,
  sufficientData: boolean
): SetupLifecycle {
  if (!sufficientData) return { ...current, state: "insufficient_data", updatedAt: new Date().toISOString() };
  if (hasInvalidation) return { ...current, state: "invalidated", updatedAt: new Date().toISOString() };
  if (current.state === "forming" && hasConfirmation) return { ...current, state: "confirmed", updatedAt: new Date().toISOString() };
  if (current.state === "idle" && sufficientData) return { ...current, state: "forming", updatedAt: new Date().toISOString() };
  return current;
}
