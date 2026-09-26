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
  notes?: string;
}
