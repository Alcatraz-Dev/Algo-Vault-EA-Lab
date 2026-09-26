/**
 * Robustness Types
 */
export interface ExecutionStressConfig {
  spreadMultiplier?: number;
  slippageMultiplier?: number;
  commissionMultiplier?: number;
}

export interface ParameterPerturbation {
  parameterId: string;
  delta?: number;
  relative?: boolean;
  percent?: number;
}

export interface RobustnessConfig {
  execution?: {
    spreadMultipliers?: number[];
    slippageMultipliers?: number[];
    commissionMultipliers?: number[];
  };
  parameters?: {
    perturbations?: ParameterPerturbation[];
    maxPerturbations?: number;
  };
  periods?: {
    enabled?: boolean;
    periodGranularity?: "year" | "quarter" | "month"; // example only
  };
  sessions?: {
    enabled?: boolean;
  };
  maxConfigurations?: number;
}

export interface RobustnessResult {
  testId: string;
  category: "execution" | "parameter" | "period" | "session";
  configuration: Record<string, unknown>;
  metrics?: {
    totalTrades?: number;
    netProfit?: number;
    winRate?: number;
    maxDrawdown?: number;
    profitFactor?: number;
  };
  status: "completed" | "failed" | "limited";
  limitations: string[];
}
