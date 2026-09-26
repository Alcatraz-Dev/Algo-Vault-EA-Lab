export interface LiveMarketState {
  symbol?: string; timeframe?: string; lastBar?: { timestamp?: number; close?: number };
  dataStatus: "LIVE" | "DELAYED" | "HISTORICAL" | "SIMULATED" | "UNAVAILABLE";
  mode?: string; updatedAt?: number;
  recentEvents?: any[]; structure?: string; liquidity?: string[]; session?: string;
}
export interface NormalizedEvent { eventId?: string; eventType?: string; timestamp?: number; symbol?: string; timeframe?: string; source?: string; status?: "DETECTED" | "ACTIVE" | "UPDATED" | "RESOLVED" | "INVALIDATED"; evidence?: string; }
export interface SetupCondition { type: string; id?: string; matched?: boolean; evidence?: string; }
export interface SetupState { id?: string; symbol?: string; timeframe?: string; state: "WAITING" | "PARTIALLY_MATCHED" | "ACTIVE" | "TRIGGERED" | "EXPIRED" | "INVALIDATED"; conditions: SetupCondition[]; matchedCount: number; totalCount: number; evidence?: string[]; created?: number; updated?: number; }
