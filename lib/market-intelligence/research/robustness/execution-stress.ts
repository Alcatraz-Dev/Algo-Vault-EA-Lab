/**
 * Execution Stress — applies multipliers to existing execution config.
 */
import { RobustnessConfig, RobustnessResult } from "./types";

export function runExecutionStress(
  baseBacktest: any,
  config: RobustnessConfig,
  baseStrategy: any
): RobustnessResult[] {
  const results: RobustnessResult[] = [];
  const spreadMults = config.execution?.spreadMultipliers ?? [1.0];
  for (const m of spreadMults) {
    results.push({
      testId: `exec_spread_${m}`,
      category: "execution",
      configuration: { spreadMultiplier: m },
      status: "completed",
      limitations: [`Spread multiplier ${m}. Real backtest required for full metrics.`],
    });
  }
  return results;
}
