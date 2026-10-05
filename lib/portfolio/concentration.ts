/**
 * AlgoVault — Portfolio Concentration Engine (Phase 15 §10).
 *
 * PURE + DETERMINISTIC. Every score below has a printed formula. There is no
 * AI component and no heuristic weight that a reviewer cannot recompute.
 *
 *   percentage concentration(k) = grossWeight of slice k        (0..1)
 *   HHI                            = Σ weightᵢ²                  (0..1, 1 = single bet)
 *   effective number of bets      = 1 / HHI
 *   top share                      = max weightᵢ
 *   top-3 share                    = Σ of the three largest weightᵢ
 *
 * HHI bounds: a perfectly flat N-way split gives 1/N; a single-instrument
 * portfolio gives 1. Values are reported unclamped so the maths stays checkable.
 */

import type {
    ConcentrationAxis,
    DataFreshness,
    PortfolioConcentration,
    PortfolioExposure,
    PortfolioPosition,
} from "./types";

type AxisName = ConcentrationAxis["axis"];

/** Documented severity bands — fixed thresholds, not a model. */
const MODERATE = 0.5;
const HIGH = 0.7;

function buildAxis(
    axis: AxisName,
    entries: Array<{ key: string; label?: string; weight: number; notional: number }>
): ConcentrationAxis {
    const sorted = [...entries].sort((a, b) => b.weight - a.weight);
    const hhi = sorted.reduce((acc, e) => acc + e.weight * e.weight, 0);
    const effectiveCount = hhi > 0 ? 1 / hhi : 0;
    const topShare = sorted[0]?.weight ?? 0;
    const topThreeShare = sorted.slice(0, 3).reduce((acc, e) => acc + e.weight, 0);
    return {
        axis,
        entries: sorted.map((e) => ({ key: e.key, weight: e.weight, notional: e.notional })),
        hhi: round(hhi),
        effectiveCount: round(effectiveCount),
        maxEntry: sorted[0] ? { key: sorted[0].key, weight: round(sorted[0].weight) } : null,
        topShare: round(topShare),
        topThreeShare: round(topThreeShare),
        status: "AVAILABLE",
    };
}

function round(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.round(v * 10000) / 10000;
}

function unavailableAxis(axis: AxisName, reason: string): ConcentrationAxis {
    return {
        axis,
        entries: [],
        hhi: 0,
        effectiveCount: 0,
        maxEntry: null,
        topShare: 0,
        topThreeShare: 0,
        status: "UNAVAILABLE",
        reason,
    };
}

export interface ComputeConcentrationInput {
    portfolioId: string;
    exposure: PortfolioExposure;
    positions: PortfolioPosition[];
    dataTimestamp: number;
    freshness: DataFreshness;
}

export function computeConcentration(input: ComputeConcentrationInput): PortfolioConcentration {
    const { exposure } = input;
    const limitations: string[] = [];

    const toEntries = (slices: typeof exposure.bySymbol) =>
        slices
            .filter((s) => s.status === "AVAILABLE" && s.grossWeight > 0)
            .map((s) => ({ key: s.key, weight: s.grossWeight, notional: s.grossNotional }));

    const axes: ConcentrationAxis[] = [];

    if (exposure.grossExposure > 0) {
        axes.push(buildAxis("SYMBOL", toEntries(exposure.bySymbol)));
        axes.push(buildAxis("ASSET_CLASS", toEntries(exposure.byAssetClass)));
        axes.push(buildAxis("STRATEGY", toEntries(exposure.byStrategy)));
        axes.push(buildAxis("DIRECTION", toEntries(exposure.byDirection)));
        axes.push(buildAxis("ACCOUNT", toEntries(exposure.byAccount)));

        const currencySlices = exposure.byCurrency.filter((s) => s.status === "AVAILABLE" && s.grossWeight > 0);
        if (currencySlices.length > 0) {
            axes.push(buildAxis("CURRENCY", toEntries(currencySlices)));
        } else {
            axes.push(
                unavailableAxis("CURRENCY", "No determinable currency exposure for the open positions.")
            );
            limitations.push("Currency concentration is UNAVAILABLE — the open positions carry no determinable currency split.");
        }
    } else {
        for (const axis of ["SYMBOL", "ASSET_CLASS", "STRATEGY", "DIRECTION", "ACCOUNT", "CURRENCY"] as AxisName[]) {
            axes.push(unavailableAxis(axis, "No open positions — gross exposure is zero."));
        }
    }

    const available = axes.filter((a) => a.status === "AVAILABLE" && a.entries.length > 0);
    const concentrationScore = available.length > 0
        ? round(available.reduce((acc, a) => acc + a.hhi, 0) / available.length)
        : 0;

    const maxAxis = available.length > 0
        ? available.reduce((best, a) => (a.hhi > best.hhi ? a : best)).axis
        : null;

    const maxHhi = available.length > 0 ? Math.max(...available.map((a) => a.hhi)) : 0;
    const severity = maxHhi >= HIGH ? "HIGH" : maxHhi >= MODERATE ? "MODERATE" : "LOW";

    limitations.push(
        "Concentration scores are Herfindahl–Hirschman indices of measured exposure weights. They are not risk forecasts and they do not imply a trade should be taken or avoided."
    );

    return {
        portfolioId: input.portfolioId,
        calculatedAt: input.freshness.calculatedAt,
        dataTimestamp: input.dataTimestamp,
        axes,
        concentrationScore,
        maxAxis,
        severity,
        limitations,
    };
}

/**
 * Concentration score if one more position were added, used by the trade
 * pre-check to express the *incremental* concentration of a proposal.
 */
export function concentrationAfterTrade(
    concentration: PortfolioConcentration,
    symbol: string,
    incrementalGross: number,
    currentGross: number
): number | null {
    if (!(incrementalGross > 0)) return null;
    const axis = concentration.axes.find((a) => a.axis === "SYMBOL" && a.status === "AVAILABLE");
    if (!axis || currentGross <= 0) return null;
    const newGross = currentGross + incrementalGross;
    const weights = axis.entries.map((e) => ({ key: e.key, weight: (e.weight * currentGross) / newGross }));
    const existing = weights.find((w) => w.key === symbol);
    if (existing) existing.weight += incrementalGross / newGross;
    else weights.push({ key: symbol, weight: incrementalGross / newGross });
    return round(weights.reduce((acc, w) => acc + w.weight * w.weight, 0));
}
