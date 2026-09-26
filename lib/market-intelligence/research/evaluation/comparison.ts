/**
 * Comparison — deterministic, uses existing metrics only.
 */
import { ResearchEvaluation, ComparisonSummary } from "./types";

export function compareConfigurations(evaluations: ResearchEvaluation[], metricKey: string): ComparisonSummary {
  const results: Record<string, number | string | null> = {};
  for (const ev of evaluations) {
    const m = ev.historical?.metrics ?? ev.sourceBacktest?.metrics;
    const val = typeof m === "object" && m !== null ? (m as any)[metricKey] ?? null : null;
    results[ev.configurationId] = val;
  }
  return {
    configurations: evaluations.map((e) => e.configurationId),
    comparisonId: `compare_${metricKey}_${evaluations.map((e) => e.configurationId).join("_")}`,
    selectedMetric: metricKey,
    results,
    limitations: ["Comparison uses factual metrics only; no ranking score applies."],
  };
}
