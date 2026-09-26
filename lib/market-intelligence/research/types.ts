export interface ParameterDefinition {
  id: string;
  label: string;
  type: "number" | "integer" | "boolean" | "enum";
  min?: number;
  max?: number;
  step?: number;
  values?: (string | number | boolean)[];
  description?: string;
}

export interface ParameterSpace {
  definitions: ParameterDefinition[];
}

export interface ResearchConfiguration {
  id: string; // deterministic
  parameters: Record<string, number | boolean | string>;
  createdAt?: never; // not used for identity
}

export interface ResearchRun {
  id: string;
  strategyId: string;
  datasetIdentity?: string; // canonical reference
  executionConfig: string;
  parameterSpace: ParameterSpace;
  configurations: ResearchConfiguration[];
  status: "pending" | "running" | "completed" | "failed" | "limited";
  results?: ResearchResult[];
  limitations: string[];
  reproducibilityMeta: Record<string, string | number>;
}

export interface ResearchResult {
  configurationId: string;
  metrics?: {
    totalTrades?: number;
    winRate?: number;
    netProfit?: number;
    maxDrawdown?: number;
    profitFactor?: number;
    averageTrade?: number;
  } | null;
  status: "completed" | "failed";
  limitations?: string[];
}
