/**
 * Phase 12 — Historical Evidence Bridge (references existing backtest/replay)
 * Never invents historical statistics.
 */
export interface HistoricalEvidence {
  source: "backtest" | "replay" | "trade-journal" | "unavailable";
  hasEvidence: boolean;
  description: string;
}

export function buildHistoricalEvidence(
  backtestId?: string,
  replayAvailable?: boolean
): HistoricalEvidence {
  if (backtestId || replayAvailable) {
    return { source: "backtest", hasEvidence: true, description: "Historical evidence available via existing backtest/replay infrastructure." };
  }
  return { source: "unavailable", hasEvidence: false, description: "Historical evidence unavailable — no existing replay or backtest session referenced." };
}
