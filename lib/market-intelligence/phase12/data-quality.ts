/**
 * Phase 12 — Data Quality Representation
 * Only derived from actual data conditions; never fabricated.
 */
export type DataQuality = "healthy" | "partial" | "stale" | "insufficient" | "unavailable";

export interface DataQualityState {
  overall: DataQuality;
  symbolAvailable: boolean;
  timeframes: Record<string, DataQuality>;
  candles: Record<string, DataQuality>;
  smartMoney: DataQuality;
  indicators: DataQuality;
  historical: DataQuality;
  aiEligible: boolean;
}

export function deriveDataQuality(
  availableTimeframes: string[]
): DataQualityState {
  const q: DataQualityState = {
    overall: "insufficient",
    symbolAvailable: true,
    timeframes: {},
    candles: {},
    smartMoney: "unavailable",
    indicators: "unavailable",
    historical: "unavailable",
    aiEligible: false,
  };
  for (const tf of availableTimeframes) q.timeframes[tf] = "healthy";
  if (availableTimeframes.length >= 2) q.overall = "partial";
  if (availableTimeframes.length >= 4) q.overall = "healthy";
  q.aiEligible = q.overall === "healthy" || q.overall === "partial";
  return q;
}
