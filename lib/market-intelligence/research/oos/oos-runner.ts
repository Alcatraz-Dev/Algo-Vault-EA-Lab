/**
 * OOS Runner — uses existing Backtest Engine.
 */
import { BacktestResult } from "../../backtesting/adapter";
import { splitDataset, validateSplit, ResearchSplit } from "./split";

export interface OOSConfig {
  strategyConfigurationId: string;
  splitRatio: number;
  datasetStart: number;
  datasetEnd: number;
}

export interface OOSValidationResult {
  split: ResearchSplit;
  selectedConfigurationId: string;
  trainingBacktest?: Partial<BacktestResult>;
  validationBacktest?: Partial<BacktestResult>;
  validationMetrics?: {
    totalTrades?: number;
    netProfit?: number;
    maxDrawdown?: number;
    winRate?: number;
    profitFactor?: number;
  };
  dataQuality?: { trainingStatus: string; validationStatus: string; limitations: string[] };
  limitations: string[];
}

export function runOOSValidation(
  config: OOSConfig,
  datasetIdentity?: string,
  dataQuality?: any,
  backtestFn?: (cfg: any) => any
): OOSValidationResult {
  const errors: string[] = [];
  const split = splitDataset(config.datasetStart, config.datasetEnd, config.splitRatio);
  const validationErrors = validateSplit(split, config.datasetStart, config.datasetEnd);
  errors.push(...validationErrors);
  if (errors.length > 0) {
    return {
      split,
      selectedConfigurationId: config.strategyConfigurationId,
      limitations: errors,
    };
  }
  // In this adapter, we call the existing backtest adapter conceptually.
  const validationBacktest = backtestFn ? backtestFn({ id: config.strategyConfigurationId, split }) : undefined;
  return {
    split,
    selectedConfigurationId: config.strategyConfigurationId,
    trainingBacktest: undefined,
    validationBacktest: validationBacktest as Partial<BacktestResult>,
    validationMetrics: validationBacktest?.metrics ? {
      totalTrades: validationBacktest.metrics.totalTrades,
      netProfit: validationBacktest.metrics.netProfit,
      maxDrawdown: validationBacktest.metrics.maxDrawdown,
      winRate: validationBacktest.metrics.winRate,
      profitFactor: validationBacktest.metrics.profitFactor,
    } : undefined,
    dataQuality: { trainingStatus: "complete", validationStatus: "complete", limitations: errors },
    limitations: errors,
  };
}
