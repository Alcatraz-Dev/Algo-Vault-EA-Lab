/**
 * AlgoVault — Portfolio Regime Engine (Phase 15 §19).
 *
 * PURE + DETERMINISTIC. A regime is only activated when measured evidence
 * crosses a printed threshold. Every vote is recorded; regimes that could not be
 * activated are listed in `notSupported` so an UNKNOWN is honest rather than
 * quiet.
 *
 * Inputs are all measured values derived from real position/equity history:
 *   realisedVolatilityPct   std-dev of daily equity-relative returns × √252
 *   volatilityPercentile    where today's realised vol sits in its own history
 *   drawdownPercent         current drawdown
 *   equityTrend             20-period slope of equity, normalised
 *   correlationShift        mean |Δρ| of the held pairs
 *   clusteredWeight         share of gross exposure in one correlated cluster
 *
 * Scores are normalized rule confidences (0..1), never probabilities.
 */

import type { PortfolioCorrelationRisk, PortfolioRegime, PortfolioRegimeState } from "./types";

/** Absolute daily-equity volatility thresholds, as a fraction. */
const HIGH_VOL_ANNUALISED = 0.35;
const LOW_VOL_ANNUALISED = 0.12;

export interface EquitySeriesPoint {
    timestamp: number;
    equity: number;
}

export interface ComputeRegimeInput {
    portfolioId: string;
    /** Equity history, oldest first. May be short — the engine degrades honestly. */
    equitySeries: EquitySeriesPoint[];
    /** Rolling correlation of the currently held symbols, when computable. */
    correlation?: PortfolioCorrelationRisk;
    /** Mean absolute correlation delta across held pairs, 0..1. */
    correlationShift?: number | null;
    clusteredWeight?: number;
    calculatedAt: number;
    dataTimestamp: number;
}

/* ── deterministic statistics ─────────────────────────────────────────────── */

export function dailyReturns(series: EquitySeriesPoint[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < series.length; i += 1) {
        const prev = series[i - 1].equity;
        const curr = series[i].equity;
        if (!(prev > 0) || !Number.isFinite(curr)) continue;
        out.push(curr / prev - 1);
    }
    return out;
}

export function stdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length);
}

/** Annualised realised volatility of the equity curve. */
export function realisedVolatility(series: EquitySeriesPoint[]): number | null {
    const returns = dailyReturns(series);
    if (returns.length < 5) return null;
    return stdDev(returns) * Math.sqrt(252);
}

/** Where the latest realised vol sits inside the observed history (0..1). */
export function volatilityPercentile(series: EquitySeriesPoint[]): number | null {
    const returns = dailyReturns(series);
    if (returns.length < 20) return null;
    const window = Math.min(20, Math.floor(returns.length / 2));
    const current = stdDev(returns.slice(-window));
    const rolling: number[] = [];
    for (let i = window; i <= returns.length; i += 1) {
        rolling.push(stdDev(returns.slice(i - window, i)));
    }
    const below = rolling.filter((v) => v <= current).length;
    return rolling.length > 0 ? below / rolling.length : null;
}

export function drawdownOf(series: EquitySeriesPoint[]): number {
    let peak = 0;
    let worst = 0;
    for (const point of series) {
        peak = Math.max(peak, point.equity);
        if (peak > 0) worst = Math.max(worst, (peak - point.equity) / peak);
    }
    return worst;
}

/** Normalised linear-regression slope of the last `window` equity points. */
export function equityTrend(series: EquitySeriesPoint[], window = 20): number | null {
    const slice = series.slice(-window);
    if (slice.length < 5) return null;
    const n = slice.length;
    const meanX = (n - 1) / 2;
    const meanY = slice.reduce((a, p) => a + p.equity, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
        const x = i - meanX;
        num += x * (slice[i].equity - meanY);
        den += x * x;
    }
    if (den === 0) return null;
    const slope = num / den;
    return meanY > 0 ? slope / meanY : null;
}

function round(v: number): number {
    return Math.round(v * 1000) / 1000;
}

interface Vote {
    regime: PortfolioRegime;
    weight: number;
    evidence: PortfolioRegimeState["evidence"][number];
}

/**
 * Classify the portfolio regime. Returns UNKNOWN — never a guess — when the
 * equity history is too short to support any classification.
 */
export function computeRegime(input: ComputeRegimeInput): PortfolioRegimeState {
    const notSupported: string[] = [];
    const votes: Vote[] = [];
    const vol = realisedVolatility(input.equitySeries);
    const volPct = volatilityPercentile(input.equitySeries);
    const dd = drawdownOf(input.equitySeries);
    const trend = equityTrend(input.equitySeries);
    const clustered = input.clusteredWeight ?? null;

    if (vol === null) {
        return {
            regime: "UNKNOWN",
            confidence: 0,
            evidence: [],
            alternatives: [],
            notSupported: [
                `Equity history too short to measure volatility (${input.equitySeries.length} point(s); at least 6 required).`,
            ],
            calculatedAt: input.calculatedAt,
            dataTimestamp: input.dataTimestamp,
        };
    }

    if (vol >= HIGH_VOL_ANNUALISED) {
        votes.push({
            regime: "HIGH_VOLATILITY",
            weight: 0.8,
            evidence: {
                id: "vol-annualised",
                metric: "realisedVolatilityPct",
                observed: round(vol * 100),
                threshold: HIGH_VOL_ANNUALISED * 100,
                supports: "HIGH_VOLATILITY",
            },
        });
    } else if (vol <= LOW_VOL_ANNUALISED) {
        votes.push({
            regime: "LOW_VOLATILITY",
            weight: 0.7,
            evidence: {
                id: "vol-annualised",
                metric: "realisedVolatilityPct",
                observed: round(vol * 100),
                threshold: LOW_VOL_ANNUALISED * 100,
                supports: "LOW_VOLATILITY",
            },
        });
    } else {
        notSupported.push(`Realised volatility ${round(vol * 100)}% sits between the low (${LOW_VOL_ANNUALISED * 100}%) and high (${HIGH_VOL_ANNUALISED * 100}%) bands.`);
    }

    if (volPct !== null && volPct >= 0.8) {
        votes.push({
            regime: "HIGH_VOLATILITY",
            weight: 0.6,
            evidence: {
                id: "vol-percentile",
                metric: "volatilityPercentile",
                observed: round(volPct),
                threshold: 0.8,
                supports: "HIGH_VOLATILITY",
            },
        });
    }

    if (trend !== null) {
        if (trend > 0.002) {
            votes.push({
                regime: "TRENDING",
                weight: 0.6,
                evidence: {
                    id: "equity-trend",
                    metric: "equityTrendPerPeriod",
                    observed: round(trend * 100),
                    threshold: 0.2,
                    supports: "TRENDING",
                },
            });
        } else if (trend < -0.002) {
            // A sustained decline in the equity curve is direct evidence of a
            // risk-off state. It is NOT also evidence for risk-on: the two are
            // mutually exclusive and one observation must not vote twice.
            votes.push({
                regime: "RISK_OFF",
                weight: 0.7,
                evidence: {
                    id: "equity-trend",
                    metric: "equityTrendPerPeriod",
                    observed: round(trend * 100),
                    threshold: -0.2,
                    supports: "RISK_OFF",
                },
            });
        } else {
            votes.push({
                regime: "RANGE",
                weight: 0.55,
                evidence: {
                    id: "equity-trend",
                    metric: "equityTrendPerPeriod",
                    observed: round(trend * 100),
                    threshold: 0.2,
                    supports: "RANGE",
                },
            });
        }
    }

    // Risk-on requires positive trend, shallow drawdown AND normal volatility.
    // Any one of those failing means the state is not evidenced, so it is
    // recorded as unsupported rather than asserted.
    if (trend !== null && trend > 0.002 && dd < 0.05 && vol < HIGH_VOL_ANNUALISED && vol > LOW_VOL_ANNUALISED) {
        votes.push({
            regime: "RISK_ON",
            weight: 0.7,
            evidence: {
                id: "risk-on-conditions",
                metric: "trendPositiveWithShallowDrawdown",
                observed: round(trend * 100),
                threshold: 0.2,
                supports: "RISK_ON",
            },
        });
    } else if (trend !== null) {
        notSupported.push(
            "RISK_ON not activated: it requires a positive equity trend, drawdown below 5% and normal volatility simultaneously."
        );
    }

    if (dd >= 0.08) {
        votes.push({
            regime: "RISK_OFF",
            weight: 0.75,
            evidence: {
                id: "drawdown",
                metric: "drawdownPercent",
                observed: round(dd * 100),
                threshold: 8,
                supports: "RISK_OFF",
            },
        });
        if (vol >= HIGH_VOL_ANNUALISED) {
            votes.push({
                regime: "LIQUIDITY_STRESS",
                weight: 0.6,
                evidence: {
                    id: "drawdown+vol",
                    metric: "drawdownWithHighVol",
                    observed: round(dd * 100),
                    threshold: 8,
                    supports: "LIQUIDITY_STRESS",
                },
            });
        }
    }

    const shift = input.correlationShift;
    if (shift !== null && shift !== undefined && Number.isFinite(shift) && shift >= 0.25) {
        votes.push({
            regime: "CORRELATION_BREAK",
            weight: 0.75,
            evidence: {
                id: "correlation-shift",
                metric: "meanAbsCorrelationDelta",
                observed: round(shift),
                threshold: 0.25,
                supports: "CORRELATION_BREAK",
            },
        });
    }

    if (clustered !== null && clustered >= 0.6 && shift !== null && shift !== undefined && shift >= 0.2) {
        votes.push({
            regime: "CORRELATION_BREAK",
            weight: 0.7,
            evidence: {
                id: "clustered-shift",
                metric: "clusteredWeightWithShift",
                observed: round(clustered),
                threshold: 0.6,
                supports: "CORRELATION_BREAK",
            },
        });
    }

    if (input.correlation && input.correlation.shiftingPairs.length > 0) {
        notSupported.push(
            `${input.correlation.shiftingPairs.length} correlation pair(s) shifted without an absolute correlation shift above 0.25.`
        );
    }

    const scores = new Map<PortfolioRegime, number>();
    for (const v of votes) {
        scores.set(v.regime, Math.min(1, (scores.get(v.regime) ?? 0) + v.weight));
    }

    const ranked = Array.from(scores.entries())
        .map(([regime, score]) => ({ regime, score: round(score) }))
        .sort((a, b) => b.score - a.score);

    const winner = ranked[0];
    if (!winner || winner.score < 0.5) {
        return {
            regime: "UNKNOWN",
            confidence: 0,
            evidence: votes.map((v) => v.evidence),
            alternatives: ranked,
            notSupported: [
                ...notSupported,
                `No regime reached the 0.5 activation threshold (best was ${winner?.regime ?? "none"} at ${winner?.score ?? 0}).`,
            ],
            calculatedAt: input.calculatedAt,
            dataTimestamp: input.dataTimestamp,
        };
    }

    if (winner.regime === "HIGH_VOLATILITY" && dd >= 0.08) {
        notSupported.push("RISK_OFF was outranked by HIGH_VOLATILITY: the measured drawdown dominates the volatility signal.");
    }

    return {
        regime: winner.regime,
        confidence: round(Math.min(1, winner.score)),
        evidence: votes.filter((v) => v.regime === winner.regime).map((v) => v.evidence),
        alternatives: ranked.slice(1, 4),
        notSupported,
        calculatedAt: input.calculatedAt,
        dataTimestamp: input.dataTimestamp,
    };
}
