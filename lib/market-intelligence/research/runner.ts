/**
 * Research Runner — connects to existing backtest engine.
 */
import { ParameterSpace, ResearchConfiguration, ResearchRun, ResearchResult } from "./types";
import { generateConfigurations } from "./parameter-space";
import { validateParameterSpace } from "./validation";

export interface RunnerConfig {
  maxConcurrent?: number;
  timeoutMs?: number;
}

export function runParameterResearch(
  strategyId: string,
  space: ParameterSpace,
  backtestFn: (cfg: ResearchConfiguration) => any,
  limits?: { maxConfigurations?: number; maxParameters?: number; maxValuesPerParameter?: number }
): ResearchRun {
  const validation = validateParameterSpace(space, limits);
  if (!validation.valid) {
    return {
      id: "run_failed_validation",
      strategyId,
      parameterSpace: space,
      configurations: [],
      status: "failed",
      results: [],
      dataQuality: { status: "incomplete", candleCount: 0, gaps: 0, duplicates: 0, invalidOHLC: 0, timezone: "UTC", volumeAvailable: false, spreadAvailable: false, limitations: ["Parameter validation failed.", ...validation.errors] },
      limitations: ["Parameter validation failed.", ...validation.errors],
      reproducibilityMeta: { validationFailed: "true", version: "1" },
    };
  }

  const configurations = generateConfigurations(space, limits);
  const results: ResearchResult[] = [];

  for (const cfg of configurations) {
    try {
      const bt = backtestFn(cfg);
      results.push({
        configurationId: cfg.id,
        metrics: bt?.metrics ?? null,
        status: bt ? "completed" : "failed",
        limitations: bt?.limitations ?? ["Backtest result unavailable."],
      });
    } catch (e) {
      results.push({
        configurationId: cfg.id,
        metrics: null,
        status: "failed",
        limitations: [String(e)],
      });
    }
  }

  return {
    id: `run_${strategyId}_${Date.now()}`,
    strategyId,
    parameterSpace: space,
    configurations,
    status: "completed",
    results,
    limitations: ["Execution completed. Verify metrics against actual backtest results."],
    reproducibilityMeta: { version: "1", count: String(configurations.length), strategyId },
  };
}
