/**
 * Parameter Research Engine — Phase 6.1
 */
export { ParameterSpace, ParameterDefinition, ResearchConfiguration, ResearchRun, ResearchResult } from "./types";
export { generateConfigurations } from "./parameter-space";
export { validateParameterSpace } from "./validation";
export { normalizeMetrics } from "./metrics";
export { canonicalConfigurationId, buildReproducibilityMeta } from "./reproducibility";
export { RESEARCH_LIMITS, checkLimits } from "./limits";
export { runParameterResearch } from "./runner";
