/** Normalize existing Smart Money / indicator / session events. No new calculation. */
import type { NormalizedEvent } from "./types";
export function normalizeEvent(e: any, type?: string): NormalizedEvent {
  return {
    eventId: e.id || String(e.timestamp || Date.now()),
    eventType: type || e.type || "UNKNOWN",
    timestamp: e.timestamp || Date.now(),
    symbol: e.symbol,
    timeframe: e.timeframe,
    source: e.source || "engine",
    status: "DETECTED",
    evidence: e.type ? `${e.type}` : undefined,
  };
}
