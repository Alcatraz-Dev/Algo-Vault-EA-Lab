import { MarketCandle, SupportedSymbol, Timeframe } from "@/lib/market-data/types";
import { BacktestConfig, OptimizationOutcome, OptimizeParam, OptimizeRange, OptimizeResult, Strategy } from "./types";
import { backtestStrategy } from "./backtest";

// ─────────────────────────────────────────────────────────────────────────────
// Parameter optimization (grid search with brute-force caps).
//
// Searches a grid drawn from the OptimizeRange lists, runs a backtest for each
// combination, and ranks results by a transparent composite score:
//
//   score = winRate*0.30 + PF*0.25 + min(returnPct,50)*0.20 + (100-maxDD)*0.15 + expectancyR*0.10
//
// If the full grid exceeds maxRuns the engine samples randomly so worst-case
// response stays bounded.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_GRID_RUNS = 240;

function applyParam(strategy: Strategy, param: OptimizeParam, value: string | number): Strategy {
    const next = JSON.parse(JSON.stringify(strategy)) as Strategy;
    switch (param) {
        case "slAtr":
            next.stopLoss.atrMultiple = Number(value);
            break;
        case "tp1R":
            next.takeProfit.r1 = Number(value);
            next.takeProfit.partialCloses.find((p) => p.atR > 0)!.atR = Number(value);
            break;
        case "tp2R":
            next.takeProfit.r2 = Number(value);
            break;
        case "tp3R":
            next.takeProfit.r3 = Number(value);
            break;
        case "riskPercent":
            next.risk.riskPercent = Number(value);
            next.risk.mode = "percent";
            break;
        case "sessions":
            if (Array.isArray(value)) next.filters.sessions = value;
            break;
    }
    return next;
}

function computeScore(metrics: OptimizationOutcome["results"][number]["metrics"]): {
    score: number;
    breakdown: Record<string, number>;
} {
    const winRateScore = metrics.winRate;                                  // 0-100
    const pfScore = Math.min(metrics.profitFactor, 3) / 3 * 100;           // PF capped at 3
    const retScore = Math.min(metrics.returnPct, 50) * 2;                  // capped at 50%
    const ddScore = Math.max(0, 100 - metrics.maxDrawdownPct);             // lower DD is better
    const expScore = (Math.max(-0.1, Math.min(metrics.expectancyR, 0.5)) / 0.5) * 50 + 50;

    const score =
        winRateScore * 0.30 +
        pfScore * 0.25 +
        retScore * 0.20 +
        ddScore * 0.15 +
        expScore * 0.10;

    return {
        score: Number(score.toFixed(2)),
        breakdown: {
            winRate: Number(winRateScore.toFixed(2)),
            profitFactor: Number(pfScore.toFixed(2)),
            returnPct: Number(retScore.toFixed(2)),
            maxDrawdown: Number(ddScore.toFixed(2)),
            expectancy: Number(expScore.toFixed(2)),
        },
    };
}

function buildGrid(ranges: OptimizeRange[]): Array<Record<string, string | number>> {
    const combinations: Array<Record<string, string | number>> = [{}];
    for (const range of ranges) {
        const current = combinations;
        const next: Array<Record<string, string | number>> = [];
        for (const base of current) {
            for (const value of range.values) {
                next.push({ ...base, [range.param]: value });
            }
        }
        combinations.length = 0;
        combinations.push(...next);
    }
    return combinations;
}

export function optimizeStrategy(
    strategy: Strategy,
    symbol: SupportedSymbol,
    timeframe: Timeframe,
    candles: MarketCandle[],
    ranges: OptimizeRange[],
    baseConfig: BacktestConfig,
    maxRuns: number,
    from: number,
    to: number
): OptimizationOutcome {
    const grid = buildGrid(ranges);
    const capped = Math.min(grid.length, maxRuns || MAX_GRID_RUNS);

    // Random sample if grid is too large.
    const sampled = grid.length > capped ? shuffle(grid).slice(0, capped) : grid;

    const results: OptimizeResult[] = [];
    let best: OptimizeResult | null = null;
    let worst: OptimizeResult | null = null;

    const scores: number[] = [];

    for (const combo of sampled) {
        const entries = Object.entries(combo);
        let param: OptimizeParam = "slAtr";
        let value: string | number = combo[param];
        if (entries.length > 0) {
            const [p, v] = entries[0];
            param = p as OptimizeParam;
            value = v;
        }
        const variant = applyParam(strategy, param, value);
        const result = backtestStrategy(variant, symbol, { [timeframe]: candles }, baseConfig, from, to);

        const { score, breakdown } = computeScore(result.metrics);

        const optimizeResult: OptimizeResult = {
            config: combo,
            metrics: result.metrics,
            score,
            scoreBreakdown: breakdown,
        };
        results.push(optimizeResult);
        scores.push(score);

        if (!best || score > best.score) best = optimizeResult;
        if (!worst || score < worst.score) worst = optimizeResult;
    }

    // Sort descending.
    results.sort((a, b) => b.score - a.score);

    // Stability = standard deviation of scores across the grid.
    const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (scores.length || 1);
    const stabilityStdDev = Number(Math.sqrt(variance).toFixed(2));

    return {
        id: `opt-${strategy.id}-${Date.now()}`,
        symbol,
        strategyId: strategy.id,
        generatedAt: Date.now(),
        ranges,
        results,
        best,
        worst,
        stabilityStdDev,
    };
}

function shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}