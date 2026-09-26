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
  limitations: string[];
}
