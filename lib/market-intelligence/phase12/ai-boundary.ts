/**
 * Phase 12 — AI Evidence Contract / Boundary
 * Defines what AI receives and what AI must NOT invent.
 */
export interface EvidencePayload {
  symbol: string;
  timeframes: string[];
  marketContext?: Record<string, unknown>;
  mtfContext?: Record<string, unknown>;
  smartMoneyContext?: Record<string, unknown>;
  indicatorContext?: Record<string, unknown>;
  setupContext?: Record<string, unknown>;
  historicalEvidence?: string;
  dataQuality?: string;
}

export const AI_BOUNDARY_RULES = [
  "AI must NOT invent market prices.",
  "AI must NOT create market structures (BOS/CHOCH/FVG/OB/liquidity zones) that are not present in smartMoneyContext.",
  "AI must NOT invent confidence/probability/performance statistics unless historicalEvidence explicitly provides a deterministic metric.",
  "AI must NOT invent indicators.",
  "AI must NOT invent trade executions or orders.",
  "AI must NOT invent historical statistics.",
  "AI explanation must distinguish observed data, derived conclusions, and historical evidence clearly.",
] as const;
