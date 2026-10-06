/** Intelligence Memory — Phase 10 types. Only persistent factual state. */
export interface SetupMemoryRecord {
  id: string;
  userId?: string;
  setupDefinitionId?: string;
  symbol?: string;
  timeframe?: string;
  mode?: "LIVE" | "HISTORICAL" | "REPLAY" | "BACKTEST" | "RESEARCH";
  status: "WAITING" | "PARTIALLY_MATCHED" | "ACTIVE" | "TRIGGERED" | "EXPIRED" | "INVALIDATED" | "CANCELLED";
  createdAt: number;
  updatedAt: number;
  triggeredAt?: number;
  resolvedAt?: number;
  expiredAt?: number;
  invalidatedAt?: number;
  cancelledAt?: number;
  cancelledBy?: string;
  conditions?: { type: string; matched?: boolean; evidence?: string; timestamp?: number }[];
  matchedCount: number;
  totalCount: number;
  stateHistory?: { state: string; timestamp: number; evidence?: string }[];
  evidenceIds?: string[];
  links?: { backtestId?: string; researchId?: string; tradeId?: string; replayTimestamp?: number };
  dataQuality?: { status?: string };
  /**
   * Phase 16 §40 — stored Cross-Asset Context snapshot for this setup:
   * { relationships, regime states, portfolio impact, capturedAt }.
   * Always a frozen snapshot of what was KNOWN when the setup formed, so the
   * learning loop can later ask whether cross-asset context improved outcomes.
   */
  crossAsset?: {
    relationships?: Array<{ symbol: string; coefficient: number | null; stability: string }>;
    regimeStates?: string[];
    portfolioImpact?: { relatedExposureWeight: number; correlatedHoldings: string[] };
    window?: { timeframe: string; bars: number };
    capturedAt: number;
    /** Explicit honesty: absent context is recorded as unavailable, not omitted. */
    status?: "AVAILABLE" | "UNAVAILABLE";
    reason?: string;
  };
  notes?: string;
}
