/**
 * Position sizing and ruin analysis — the maths behind the Risk of Ruin tool.
 *
 * Two different answers to "how much should I risk?":
 *   • ANALYTIC — Kelly fraction and expected value per trade, from the win
 *     rate and reward:risk ratio. Closed form, exact for the model.
 *   • EMPIRICAL — a deterministic Monte-Carlo of equity paths with a fixed
 *     fractional risk per trade, reporting how often a drawdown threshold is
 *     breached.
 *
 * Both are model outputs over the numbers the caller supplies. They are not
 * forecasts, and a positive Kelly fraction is not a promise of profit.
 */

import { percentile, seededRandom } from "./validation/stats";

export interface KellyInput {
    /** Win probability in [0, 1]. */
    winRate: number;
    /** Reward:risk ratio (average win / average loss), > 0. */
    riskReward: number;
    /** Optional account size — when present the dollar value is reported too. */
    accountSize?: number;
}

export interface KellyResult {
    /** Full Kelly fraction of equity to risk per trade (can be negative = no edge). */
    kellyFraction: number;
    /** Half Kelly (the practically used variant), floored at 0. */
    halfKellyFraction: number;
    /** Fraction of equity recommended by this module (half Kelly, floored at 0). */
    recommendedRiskFraction: number;
    edgePerTrade: number;
    /** Present only when accountSize was supplied. */
    kellyRiskAmount: number | null;
}

export function kellyFraction(winRate: number, riskReward: number): number | null {
    if (!(winRate > 0 && winRate < 1)) return null;
    if (!(riskReward > 0) || !Number.isFinite(riskReward)) return null;
    return winRate - (1 - winRate) / riskReward;
}

export function kellyResult(input: KellyInput): KellyResult | null {
    const k = kellyFraction(input.winRate, input.riskReward);
    if (k === null) return null;
    const half = Math.max(0, k / 2);
    return {
        kellyFraction: round(k),
        halfKellyFraction: round(half),
        recommendedRiskFraction: round(half),
        edgePerTrade: round(input.winRate * input.riskReward - (1 - input.winRate)),
        kellyRiskAmount: input.accountSize && input.accountSize > 0 ? round(half * input.accountSize, 2) : null,
    };
}

export interface ExpectedValueInput {
    winRate: number;
    riskReward: number;
    /** Risk per trade in % of equity. */
    riskPerTradePct: number;
    /** Optional account size for the dollar answer. */
    accountSize?: number;
}

export interface ExpectedValueResult {
    /** Expected R per trade (positive = edge). */
    expectedR: number;
    expectedValue: number | null;
    /** Expected value as % of the account, based on riskPerTradePct. */
    expectedValuePct: number;
}

export function expectedValuePerTrade(input: ExpectedValueInput): ExpectedValueResult | null {
    if (!(input.winRate >= 0 && input.winRate <= 1)) return null;
    if (!(input.riskReward > 0) || !(input.riskPerTradePct > 0)) return null;
    const expectedR = input.winRate * input.riskReward - (1 - input.winRate);
    const riskFraction = input.riskPerTradePct / 100;
    const expectedValuePct = expectedR * riskFraction * 100;
    return {
        expectedR: round(expectedR, 4),
        expectedValue: input.accountSize && input.accountSize > 0 ? round(expectedR * riskFraction * input.accountSize, 2) : null,
        expectedValuePct: round(expectedValuePct, 4),
    };
}

export interface RuinSimulationInput {
    winRate: number;
    riskReward: number;
    /** Risk per trade in % of current equity. */
    riskPerTradePct: number;
    /** Drawdown from peak that counts as ruin, in %. */
    ruinDrawdownPct: number;
    /** Number of simulated paths (default 1000 — the advertised figure). */
    paths?: number;
    /** Trades per path (default 500). */
    tradesPerPath?: number;
    /** Deterministic seed (default 42). */
    seed?: number;
}

export interface RuinSimulationResult {
    paths: number;
    tradesPerPath: number;
    seed: number;
    /** Share of paths that breached the drawdown threshold, in [0, 1]. */
    ruinProbability: number;
    endings: { p5: number; median: number; p95: number; worst: number };
    maxDrawdown: { median: number; p95: number };
    /** Median equity as a multiple of starting equity. */
    medianEquityMultiple: number;
    limitations: string[];
}

export function simulateRuin(input: RuinSimulationInput): RuinSimulationResult | null {
    const { winRate, riskReward, riskPerTradePct, ruinDrawdownPct } = input;
    if (!(winRate >= 0 && winRate <= 1)) return null;
    if (!(riskReward > 0) || !(riskPerTradePct > 0) || !(ruinDrawdownPct > 0)) return null;

    const paths = Math.min(50_000, Math.max(1, Math.floor(input.paths ?? 1000)));
    const tradesPerPath = Math.min(20_000, Math.max(1, Math.floor(input.tradesPerPath ?? 500)));
    const seed = Number.isFinite(input.seed) && (input.seed as number) > 0 ? Math.floor(input.seed as number) : 42;
    const rand = seededRandom(seed);
    const risk = riskPerTradePct / 100;
    const ruinLevel = ruinDrawdownPct / 100;

    const endings: number[] = [];
    const maxDrawdowns: number[] = [];
    let ruined = 0;

    for (let p = 0; p < paths; p++) {
        let equity = 1;
        let peak = 1;
        let maxDd = 0;
        let pathRuined = false;
        for (let t = 0; t < tradesPerPath; t++) {
            if (rand() < winRate) {
                equity *= 1 + riskReward * risk;
            } else {
                equity *= 1 - risk;
            }
            if (equity > peak) peak = equity;
            const dd = peak > 0 ? (peak - equity) / peak : 0;
            if (dd > maxDd) maxDd = dd;
            if (dd >= ruinLevel || equity <= 0) {
                pathRuined = true;
                break;
            }
        }
        if (pathRuined) ruined++;
        endings.push(equity);
        maxDrawdowns.push(maxDd);
    }

    return {
        paths,
        tradesPerPath,
        seed,
        ruinProbability: round(ruined / paths, 6),
        endings: {
            p5: round(percentile(endings, 0.05), 4),
            median: round(percentile(endings, 0.5), 4),
            p95: round(percentile(endings, 0.95), 4),
            worst: round(Math.min(...endings), 4),
        },
        maxDrawdown: {
            median: round(percentile(maxDrawdowns, 0.5) * 100, 2),
            p95: round(percentile(maxDrawdowns, 0.95) * 100, 2),
        },
        medianEquityMultiple: round(percentile(endings, 0.5), 4),
        limitations: [
            "Monte Carlo over the supplied win rate and reward:risk only — outcomes are independent draws, not market structure.",
            "Ruin is defined by the drawdown threshold, not by broker margin or liquidation rules.",
            "A low simulated ruin probability is not a guarantee; it is the model's frequency under its own assumptions.",
        ],
    };
}

function round(value: number, digits = 6): number {
    if (!Number.isFinite(value)) return value;
    const factor = Math.pow(10, digits);
    const out = Math.round(value * factor) / factor;
    return Object.is(out, -0) ? 0 : out;
}
