/**
 * Monte Carlo — deterministic resampling of actual trade results.
 */
import { MonteCarloConfig, MonteCarloResult } from "./types";

function seededRandom(seed: number): () => number {
  // Simple deterministic LCG
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export function runMonteCarlo(
  sourceTrades: { netPnL: number; durationMs?: number }[],
  config: MonteCarloConfig
): MonteCarloResult {
  const maxSim = config.maxSimulations ?? 10000;
  const sims = Math.min(config.simulations, maxSim);
  if (sourceTrades.length < 2) {
    return { seed: config.seed, simulations: 0, simulationsCompleted: 0, sourceTradeCount: sourceTrades.length, limitations: ["Insufficient source trades for Monte Carlo."], endingEquityDistribution: undefined, returnDistribution: undefined, drawdownDistribution: undefined, losingStreakDistribution: undefined };
  }

  const rand = seededRandom(config.seed);
  const equities: number[] = [];
  const returns: number[] = [];
  const draws: number[] = [];

  for (let i = 0; i < sims; i++) {
    let equity = 10000; // base; real base should come from backtest config
    let peak = equity;
    let maxDD = 0;
    const shuffled = config.method === "shuffle" ? shuffleArray([...sourceTrades], rand) : bootstrapArray([...sourceTrades], rand, sourceTrades.length);
    for (const t of shuffled) {
      equity += t.netPnL ?? 0;
      if (equity > peak) peak = equity;
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    equities.push(equity);
    returns.push((equity - 10000) / 10000);
    draws.push(maxDD);
  }

  const stats = (arr: number[]) => {
    const s = arr.sort((a, b) => a - b);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { min: s[0], max: s[s.length - 1], mean: Math.round(mean * 100) / 100, median: s[Math.floor(s.length / 2)], count: arr.length };
  };

  return {
    seed: config.seed,
    simulations: sims,
    simulationsCompleted: sims,
    sourceTradeCount: sourceTrades.length,
    endingEquityDistribution: stats(equities),
    returnDistribution: stats(returns),
    drawdownDistribution: stats(draws),
    losingStreakDistribution: undefined,
    limitations: ["Monte Carlo resamples historical trade outcomes only. Not predictive."],
  };
}

function shuffleArray<T>(arr: T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function bootstrapArray<T>(arr: T[], rand: () => number, n: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.floor(rand() * arr.length)]);
  }
  return out;
}
