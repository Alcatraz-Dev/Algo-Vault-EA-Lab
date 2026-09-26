/**
 * Reproducibility — deterministic identity.
 */
import { StrategyDefinition } from "../../strategies/types";

export function canonicalConfigurationId(parameters: Record<string, unknown>): string {
  const sorted = Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}=${v}`).join("|");
}

export function buildReproducibilityMeta(strategy: StrategyDefinition, datasetIdentity?: string, configCount?: number): Record<string, string | number> {
  return {
    strategyId: strategy.id,
    version: String(strategy.version ?? 1),
    datasetIdentity: datasetIdentity ?? "unknown",
    configCount: configCount ?? 0,
    source: "algovault_research",
  };
}
