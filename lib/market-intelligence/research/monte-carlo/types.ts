/**
 * Monte Carlo Types
 */
export interface MonteCarloConfig {
  seed: number;
  simulations: number;
  method: "shuffle" | "bootstrap";
  maxSimulations?: number;
}

export interface MonteCarloDistributionSummary {
  method: string;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  count: number;
}

export interface MonteCarloResult {
  seed: number;
  simulations: number;
  simulationsCompleted: number;
  sourceTradeCount: number;
  endingEquityDistribution?: MonteCarloDistributionSummary;
  returnDistribution?: MonteCarloDistributionSummary;
  drawdownDistribution?: MonteCarloDistributionSummary;
  losingStreakDistribution?: MonteCarloDistributionSummary;
  /** 95th-percentile max drawdown across simulations (0–1 fraction). */
  drawdownP95?: number;
  /** 5th-percentile total return across simulations (fraction; pessimistic tail). */
  returnP5?: number;
  /** Share of simulations that ended with a profit (0–1). */
  profitProbability?: number;
  limitations: string[];
}
