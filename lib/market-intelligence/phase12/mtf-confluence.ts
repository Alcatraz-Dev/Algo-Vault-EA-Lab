/**
 * Phase 12 — MTF Alignment (deterministic from existing structure bias)
 * Never invents signals; explicit unavailable states preserved.
 */
import { Timeframe } from "../types";

export type MTFState = "aligned" | "mixed" | "conflicting" | "insufficient_data" | "unavailable";

export interface MTFEntry {
  timeframe: Timeframe;
  state: MTFState;
  trend?: "bullish" | "bearish" | "neutral" | "unavailable";
  structure?: "bullish" | "bearish" | "neutral" | "unavailable";
  dataAvailable: boolean;
}

export function evaluateMTF(
  available: string[],
  biases: Record<string, string | undefined>
): MTFEntry[] {
  const results: MTFEntry[] = [];
  for (const tf of available) {
    const bias = biases[tf];
    const entry: MTFEntry = {
      timeframe: tf as Timeframe,
      state: "unavailable",
      trend: "unavailable",
      structure: "unavailable",
      dataAvailable: false,
    };
    if (bias) {
      entry.state = bias === "bullish" || bias === "bearish" ? "aligned" : "mixed"; // simplified deterministic logic
      entry.trend = bias as "bullish" | "bearish";
      entry.structure = bias as "bullish" | "bearish";
      entry.dataAvailable = true;
    }
    if (available.length < 2 && !bias) entry.state = "insufficient_data";
    results.push(entry);
  }
  return results;
}
