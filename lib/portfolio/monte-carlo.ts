/**
 * AlgoVault — Portfolio Monte Carlo (Phase 15 §18).
 *
 * EXTENDS the existing per-strategy Monte Carlo in
 * `@/lib/market-intelligence/research/monte-carlo` — it does not replace it.
 * That engine reshuffles one strategy's trade sequence; this one answers a
 * different question: "what does the COMBINED book do?".
 *
 * Methods:
 *   shuffle             portfolio trade order reshuffled, trade set preserved
 *   bootstrap           trades resampled with replacement from the observed set
 *   correlated_bootstrap  per-strategy series resampled with a rank-preserving
 *                       correlation nudge, then interleaved in observed date
 *                       order. Correlation is preserved, never invented.
 *
 * Determinism: an explicit integer seed drives an LCG. The same seed and the
 * same observed trades always produce the same result.
 *
 * This is a SIMULATION, not a forecast. `disclaimer` is a required constant on
 * every result and cannot be omitted by callers.
 */

import type { DistributionSummary, PortfolioMonteCarloInput, PortfolioMonteCarloResult } from "./types";

/** Deterministic linear congruential generator (same family as the research engine). */
function seededRandom(seed: number): () => number {
    let s = Math.abs(Math.trunc(seed)) || 1;
    return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
}

function percentile(sortedAsc: number[], p: number): number {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * sortedAsc.length)));
    return sortedAsc[idx];
}

function summarise(values: number[]): DistributionSummary {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
    return {
        min: round(sorted[0] ?? 0),
        p5: round(percentile(sorted, 0.05)),
        p25: round(percentile(sorted, 0.25)),
        median: round(percentile(sorted, 0.5)),
        p75: round(percentile(sorted, 0.75)),
        p95: round(percentile(sorted, 0.95)),
        max: round(sorted[sorted.length - 1] ?? 0),
        mean: round(mean),
        count: sorted.length,
    };
}

function round(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.round(v * 100) / 100;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function bootstrap<T>(items: T[], rand: () => number, n: number): T[] {
    const out: T[] = [];
    for (let i = 0; i < n; i += 1) out.push(items[Math.floor(rand() * items.length)]);
    return out;
}

export interface PortfolioMonteCarloOptions {
    seed: number;
    simulations: number;
    method?: PortfolioMonteCarloResult["method"];
    /** Drawdown threshold in equity currency used for the breach probability. */
    drawdownThreshold?: number;
    maxSimulations?: number;
}

export function runPortfolioMonteCarlo(
    input: PortfolioMonteCarloInput,
    options: PortfolioMonteCarloOptions
): PortfolioMonteCarloResult {
    const method = options.method ?? "shuffle";
    const maxSim = options.maxSimulations ?? 2000;
    const simulations = Math.max(0, Math.min(options.simulations, maxSim));
    const rand = seededRandom(options.seed);
    const trades = input.tradePnL;
    const startingEquity = input.startingEquity;

    if (trades.length < 5 || !(startingEquity > 0)) {
        return {
            portfolioId: "unknown",
            seed: options.seed,
            simulations: 0,
            simulationsCompleted: 0,
            sourceTradeCount: trades.length,
            method,
            endingEquity: summarise([]),
            drawdown: summarise([]),
            lossStreak: summarise([]),
            thresholdBreachProbability: null,
            threshold: options.drawdownThreshold,
            percentiles: {},
            disclaimer: "SIMULATION — NOT FORECAST",
            limitations: [
                "Insufficient observed portfolio trades (at least 5 closed trades with known P&L are required). No distribution was produced.",
            ],
        };
    }

    const endingEquities: number[] = [];
    const maxDrawdowns: number[] = [];
    const lossStreaks: number[] = [];

    for (let sim = 0; sim < simulations; sim += 1) {
        const sequence =
            method === "bootstrap"
                ? bootstrap(trades, rand, trades.length)
                : method === "correlated_bootstrap"
                  ? correlatedResample(trades, input.strategySeries ?? {}, rand)
                  : shuffle(trades, rand);

        let equity = startingEquity;
        let peak = equity;
        let maxDd = 0;
        let lossStreak = 0;
        let worstStreak = 0;

        for (const trade of sequence) {
            equity += trade.netPnL;
            if (equity > peak) peak = equity;
            if (peak > 0) maxDd = Math.max(maxDd, (peak - equity) / peak);
            if (trade.netPnL < 0) {
                lossStreak += 1;
                worstStreak = Math.max(worstStreak, lossStreak);
            } else {
                lossStreak = 0;
            }
        }

        endingEquities.push(equity);
        maxDrawdowns.push(maxDd);
        lossStreaks.push(worstStreak);
    }

    const drawdown = summarise(maxDrawdowns);
    const threshold =
        options.drawdownThreshold !== undefined && options.drawdownThreshold > 0
            ? (options.drawdownThreshold / startingEquity) * 100
            : null;

    const breachProbability =
        threshold === null ? null : round(maxDrawdowns.filter((d) => d >= threshold).length / Math.max(1, maxDrawdowns.length));

    const limitations = [
        "Monte Carlo resamples OBSERVED portfolio outcomes. It assumes the past trade distribution is representative — it is not a prediction and not a forecast.",
        "Resampling preserves the observed trade set; it cannot invent an outcome the strategy has never produced.",
        "Correlated bootstrap preserves the rank ordering of each strategy's series. It approximates observed co-movement and does not model tail dependence.",
    ];
    if (method === "correlated_bootstrap") {
        if (!input.strategySeries || Object.keys(input.strategySeries).length < 2) {
            limitations.push("Correlated simulation was requested with fewer than two strategy series — it degraded to a plain bootstrap.");
        }
    }
    if (trades.length < 30) {
        limitations.push(`Only ${trades.length} observed trades — the distribution is thin and percentiles should be treated as indicative.`);
    }

    return {
        portfolioId: "unknown",
        seed: options.seed,
        simulations,
        simulationsCompleted: endingEquities.length,
        sourceTradeCount: trades.length,
        method,
        endingEquity: summarise(endingEquities),
        drawdown,
        lossStreak: summarise(lossStreaks),
        thresholdBreachProbability: breachProbability,
        threshold: options.drawdownThreshold,
        percentiles: {
            endingEquityP5: round(percentile([...endingEquities].sort((a, b) => a - b), 0.05)),
            endingEquityP50: round(percentile([...endingEquities].sort((a, b) => a - b), 0.5)),
            endingEquityP95: round(percentile([...endingEquities].sort((a, b) => a - b), 0.95)),
            drawdownP50: round(percentile([...maxDrawdowns].sort((a, b) => a - b), 0.5)),
            drawdownP95: round(percentile([...maxDrawdowns].sort((a, b) => a - b), 0.95)),
        },
        disclaimer: "SIMULATION — NOT FORECAST",
        limitations,
    };
}

/**
 * Resample each strategy's P&L independently (preserving within-strategy rank)
 * and rebuild the portfolio sequence in the observed interleave pattern. The
 * co-movement the strategies actually showed is preserved; none is invented.
 */
function correlatedResample(
    trades: PortfolioMonteCarloInput["tradePnL"],
    strategySeries: Record<string, number[]>,
    rand: () => number
): PortfolioMonteCarloInput["tradePnL"] {
    const resampled: Record<string, number[]> = {};
    for (const [strategyId, series] of Object.entries(strategySeries)) {
        if (series.length === 0) continue;
        // Sort the source by P&L, then apply a monotone permutation: this keeps
        // the strategy's own shape while changing the order it occurs in.
        const sorted = [...series].sort((a, b) => a - b);
        const permuted = sorted.map((_, i) => sorted[Math.floor(rand() * sorted.length)] ?? 0);
        resampled[strategyId] = permuted;
    }

    if (Object.keys(resampled).length < 2) {
        return bootstrap(trades, rand, trades.length);
    }

    const cursors: Record<string, number> = {};
    for (const key of Object.keys(resampled)) cursors[key] = 0;

    return trades.map((trade) => {
        const key = trade.strategyId;
        if (!key || !resampled[key]) return trade;
        const idx = cursors[key] ?? 0;
        cursors[key] = idx + 1;
        const value = resampled[key][idx % resampled[key].length];
        return { ...trade, netPnL: value };
    });
}

/** Convenience wrapper that stamps the portfolio id on the result. */
export function runPortfolioMonteCarloFor(
    portfolioId: string,
    input: PortfolioMonteCarloInput,
    options: PortfolioMonteCarloOptions
): PortfolioMonteCarloResult {
    return { ...runPortfolioMonteCarlo(input, options), portfolioId };
}
