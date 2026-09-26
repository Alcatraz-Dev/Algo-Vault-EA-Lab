/** Aggregator — deterministic grouping of existing historical setup records. */
import type { HistoricalSetupRecord, PatternStatistics } from "./types";
import { buildPatternSignature } from "./pattern-key";

export function aggregatePatterns(records: HistoricalSetupRecord[]): Record<string, PatternStatistics> {
  const map: Record<string, PatternStatistics> = {};
  for (const r of records) {
    const key = buildPatternSignature(r.symbol, r.timeframe, undefined, r.status, undefined, undefined, undefined, undefined); // simple canonical for aggregation
    const stats = map[key] || { occurrences: 0, triggered: 0, active: 0, partiallyMatched: 0, expired: 0, invalidated: 0, cancelled: 0, recordsIncluded: 0, recordsExcluded: 0, missingEvidence: 0, dataQualityStatus: "unknown" };
    stats.occurrences += 1;
    stats.recordsIncluded += 1;
    if (r.status === "TRIGGERED") stats.triggered += 1;
    else if (r.status === "ACTIVE") stats.active += 1;
    else if (r.status === "PARTIALLY_MATCHED") stats.partiallyMatched += 1;
    else if (r.status === "EXPIRED") stats.expired += 1;
    else if (r.status === "INVALIDATED") stats.invalidated += 1;
    else if (r.status === "CANCELLED") stats.cancelled += 1;
    if (!r.evidenceIds || r.evidenceIds.length === 0) stats.missingEvidence += 1;
    if (r.createdAt && (!stats.firstObserved || r.createdAt < stats.firstObserved)) stats.firstObserved = r.createdAt;
    if (r.updatedAt && (!stats.lastObserved || r.updatedAt > stats.lastObserved)) stats.lastObserved = r.updatedAt;
    map[key] = stats;
  }
  return map;
}
