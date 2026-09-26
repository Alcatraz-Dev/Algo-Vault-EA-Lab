/**
 * Research Evaluation Types
 */
export interface ResearchEvaluation {
  configurationId: string;
  sourceBacktest?: { id: string; metrics?: any; trades?: any[] };
  sourceOOS?: { metrics?: any; validationBacktest?: any };
  sourceWalkForward?: { windows?: any[]; aggregate?: any };
  sourceRobustness?: any[];
  sourceMonteCarlo?: { seed?: number; simulations?: number };
  historical?: { metrics?: any };
  limitations: string[];
}

export interface ComparisonSummary {
  configurations: string[];
  comparisonId: string;
  selectedMetric: string;
  results: Record<string, number | string | null>;
  limitations: string[];
}

export interface StabilitySummary {
  oosWindowRange?: { min?: number; max?: number; mean?: number };
  robustnessRange?: { min?: number; max?: number; mean?: number };
  monteCarloDistribution?: { min?: number; max?: number; median?: number; count?: number };
  limitations: string[];
}
