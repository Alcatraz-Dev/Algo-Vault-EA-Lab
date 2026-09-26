/**
 * Parameter Perturbation — deterministic sensitivity around selected config.
 */
import { RobustnessConfig, RobustnessResult } from "./types";

export function generatePerturbations(config: RobustnessConfig, selectedConfig: Record<string, unknown>, maxP?: number): RobustnessResult[] {
  const results: RobustnessResult[] = [];
  const pert = config.parameters?.perturbations ?? [];
  const limit = maxP ?? config.parameters?.maxPerturbations ?? 5;
  for (let i = 0; i < Math.min(pert.length, limit); i++) {
    const p = pert[i];
    results.push({
      testId: `param_${p.parameterId}_${i}`,
      category: "parameter",
      configuration: { [p.parameterId]: { delta: p.delta }, base: selectedConfig },
      status: "completed",
      limitations: [`Parameter perturbation ${p.parameterId}. Requires real backtest for metrics.`],
    });
  }
  return results;
}
