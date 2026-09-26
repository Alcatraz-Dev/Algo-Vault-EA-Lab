/**
 * Limits — safe execution boundaries.
 */

export const RESEARCH_LIMITS = {
  maxParameters: 5,
  maxValuesPerParameter: 10,
  maxConfigurations: 500,
  maxConcurrent: 3,
  timeoutMs: 120000,
};

export function checkLimits(configs: number): boolean {
  return configs <= RESEARCH_LIMITS.maxConfigurations;
}
