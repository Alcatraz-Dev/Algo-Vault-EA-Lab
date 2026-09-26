/**
 * Robustness Runner — aggregates stress tests.
 */
import { RobustnessConfig, RobustnessResult } from "./types";
export function runRobustness(config: RobustnessConfig, baseBacktest?: any, baseStrategy?: any): RobustnessResult[] {
  const all: RobustnessResult[] = [];
  // Execution stress
  const { runExecutionStress } = require("./execution-stress");
  try { all.push(...runExecutionStress(baseBacktest, config, baseStrategy)); } catch (e) { all.push({ testId: "execution_failed", category: "execution", configuration: {}, status: "failed", limitations: [String(e)] }); }
  // Parameter perturbation
  const { generatePerturbations } = require("./parameter-perturbation");
  try { all.push(...generatePerturbations(config, {}, config.maxConfigurations)); } catch (e) { all.push({ testId: "param_failed", category: "parameter", configuration: {}, status: "failed", limitations: [String(e)] }); }
  return all;
}
