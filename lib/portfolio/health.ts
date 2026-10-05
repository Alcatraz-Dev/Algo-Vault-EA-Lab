/**
 * AlgoVault — Portfolio Health Engine (Phase 15 §20).
 *
 * PURE + DETERMINISTIC. Health is NINE components, never one opaque number.
 * Each component carries its own rating, its own documented score, the reasons
 * behind it and the evidence ids behind the reasons.
 *
 * Scoring (all 0..1, higher = healthier):
 *
 *   RISK           1 − min(1, openRiskPercent / portfolioRiskLimit)
 *   EXPOSURE       1 − min(1, grossToEquity / grossExposureCeiling)
 *   CONCENTRATION   1 − max axis HHI
 *   CORRELATION    1 − clusteredExposureWeight (UNKNOWN when not computable)
 *   STRATEGY       worst strategy health mapped to {GOOD:1, WATCH:.7, WARNING:.4, CRITICAL:0, UNKNOWN:null}
 *   EXECUTION      data freshness + account connectivity, not a quality score
 *   DRAWDOWN       1 − min(1, drawdownPercent / drawdownLimit)
 *   DIVERSIFICATION 1/HHI of the symbol axis (effective number of bets)
 *   REGIME         regime confidence, penalised when the regime is adverse
 *
 * A component whose input cannot be measured is `UNKNOWN` and is excluded from
 * `overall` rather than being counted as healthy.
 */

import type {
    ConcentrationAxis,
    HealthRating,
    PortfolioAccount,
    PortfolioConcentration,
    PortfolioCorrelationRisk,
    PortfolioExposure,
    PortfolioHealth,
    PortfolioHealthComponent,
    PortfolioHealthComponentState,
    PortfolioRegimeState,
    PortfolioRiskSnapshot,
    RiskBudgetUsage,
} from "./types";

export const DEFAULT_GROSS_EXPOSURE_CEILING = 10; // 10x equity notional
export const DEFAULT_DRAWDOWN_CEILING_PERCENT = 10;

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
}

function round(v: number): number {
    return Math.round(v * 1000) / 1000;
}

function ratingFromScore(score: number | null): HealthRating {
    if (score === null) return "UNKNOWN";
    if (score >= 0.75) return "GOOD";
    if (score >= 0.55) return "WATCH";
    if (score >= 0.3) return "WARNING";
    return "CRITICAL";
}

const RATING_ORDER: Record<HealthRating, number> = {
    GOOD: 0,
    WATCH: 1,
    WARNING: 2,
    CRITICAL: 3,
    UNKNOWN: 4,
};

export interface StrategyHealthInput {
    strategyId: string;
    health: HealthRating;
}

export interface ComputeHealthInput {
    portfolioId: string;
    exposure: PortfolioExposure;
    concentration: PortfolioConcentration;
    correlation: PortfolioCorrelationRisk;
    risk: PortfolioRiskSnapshot;
    regime: PortfolioRegimeState;
    accounts: PortfolioAccount[];
    strategies: StrategyHealthInput[];
    riskBudgetUsage: RiskBudgetUsage[];
    portfolioRiskLimitPercent?: number;
    drawdownLimitPercent?: number;
    grossExposureCeiling?: number;
    dataFreshnessOk: boolean;
    calculatedAt: number;
}

export function computeHealth(input: ComputeHealthInput): PortfolioHealth {
    const reasons: Record<PortfolioHealthComponent, string[]> = {
        RISK: [],
        EXPOSURE: [],
        CONCENTRATION: [],
        CORRELATION: [],
        STRATEGY: [],
        EXECUTION: [],
        DRAWDOWN: [],
        DIVERSIFICATION: [],
        REGIME: [],
    };

    const grossCeiling = input.grossExposureCeiling ?? DEFAULT_GROSS_EXPOSURE_CEILING;
    const ddCeiling = input.drawdownLimitPercent ?? DEFAULT_DRAWDOWN_CEILING_PERCENT;
    const riskLimit = input.portfolioRiskLimitPercent ?? 2;

    /* RISK --------------------------------------------------------------- */
    let riskScore: number | null = null;
    if (input.risk.openRiskPercent === null) {
        reasons.RISK.push("Open risk is unavailable — no open position with a recorded stop loss.");
    } else {
        riskScore = clamp01(1 - Math.min(1, input.risk.openRiskPercent / Math.max(riskLimit, 0.0001)));
        reasons.RISK.push(
            `Open risk at stop is ${round(input.risk.openRiskPercent)}% of equity against a ${riskLimit}% budget.`
        );
        const breached = input.riskBudgetUsage.filter((u) => u.status === "BREACHED");
        for (const b of breached) reasons.RISK.push(`Budget breached: ${b.kind}${b.scopeKey ? ` (${b.scopeKey})` : ""}.`);
    }

    /* EXPOSURE ----------------------------------------------------------- */
    let exposureScore: number | null = null;
    if (input.exposure.grossToEquity === null) {
        reasons.EXPOSURE.push("Equity is unavailable — exposure ratios cannot be computed.");
    } else {
        exposureScore = clamp01(1 - Math.min(1, input.exposure.grossToEquity / grossCeiling));
        reasons.EXPOSURE.push(
            `Gross notional is ${round(input.exposure.grossToEquity)}x equity (net ${round(input.exposure.netToEquity ?? 0)}x) against a ${grossCeiling}x ceiling.`
        );
        const marginBudget = input.riskBudgetUsage.find((u) => u.kind === "MARGIN");
        if (marginBudget && marginBudget.status !== "OK") {
            reasons.EXPOSURE.push(`Margin budget is ${marginBudget.status} (${marginBudget.usedPercent}% of ${marginBudget.limitPercent}%).`);
        }
    }

    /* CONCENTRATION ------------------------------------------------------ */
    let concentrationScore: number | null = null;
    const availableAxes = input.concentration.axes.filter(
        (a): a is ConcentrationAxis & { status: "AVAILABLE" } => a.status === "AVAILABLE" && a.entries.length > 0
    );
    if (availableAxes.length === 0) {
        reasons.CONCENTRATION.push("No open positions — concentration is not measurable.");
    } else {
        const maxHhi = Math.max(...availableAxes.map((a) => a.hhi));
        concentrationScore = clamp01(1 - maxHhi);
        const worst = availableAxes.reduce((best, a) => (a.hhi > best.hhi ? a : best));
        reasons.CONCENTRATION.push(
            `${worst.axis} concentration HHI ${round(worst.hhi)} (${worst.maxEntry?.key ?? "n/a"} at ${round((worst.maxEntry?.weight ?? 0) * 100)}%).`
        );
    }

    /* CORRELATION -------------------------------------------------------- */
    let correlationScore: number | null = null;
    if (input.correlation.severity === "UNKNOWN") {
        reasons.CORRELATION.push("Correlation could not be computed from available history.");
    } else {
        correlationScore = clamp01(1 - input.correlation.clusteredExposureWeight);
        reasons.CORRELATION.push(
            `Largest correlated cluster holds ${round(input.correlation.clusteredExposureWeight * 100)}% of gross exposure at mean ρ ${round(input.correlation.meanCorrelation)}.`
        );
        for (const e of input.correlation.evidence) if (e.kind === "CALCULATED") reasons.CORRELATION.push(e.text);
    }

    /* STRATEGY ----------------------------------------------------------- */
    let strategyScore: number | null = null;
    if (input.strategies.length === 0) {
        reasons.STRATEGY.push("No strategies are active on this portfolio.");
    } else {
        const worstStrategy = input.strategies.reduce((worst, s) =>
            RATING_ORDER[s.health] > RATING_ORDER[worst.health] ? s : worst
        );
        const mapping: Record<HealthRating, number | null> = {
            GOOD: 1,
            WATCH: 0.7,
            WARNING: 0.4,
            CRITICAL: 0,
            UNKNOWN: null,
        };
        strategyScore = mapping[worstStrategy.health];
        reasons.STRATEGY.push(
            `${input.strategies.length} strategy(s) tracked; weakest is ${worstStrategy.strategyId} at ${worstStrategy.health}.`
        );
    }

    /* EXECUTION ---------------------------------------------------------- */
    const onlineAccounts = input.accounts.filter((a) => a.connected).length;
    let executionScore: number | null = null;
    if (input.accounts.length === 0) {
        reasons.EXECUTION.push("No account is connected to this portfolio.");
    } else if (!input.dataFreshnessOk) {
        reasons.EXECUTION.push("Account or market data is stale — execution state cannot be trusted.");
    } else {
        executionScore = clamp01(onlineAccounts / input.accounts.length);
        reasons.EXECUTION.push(`${onlineAccounts}/${input.accounts.length} account(s) reporting live data.`);
    }

    /* DRAWDOWN ----------------------------------------------------------- */
    let drawdownScore: number | null = null;
    if (input.risk.drawdownPercent === null) {
        reasons.DRAWDOWN.push("No drawdown high-water mark recorded.");
    } else {
        drawdownScore = clamp01(1 - Math.min(1, Math.max(0, input.risk.drawdownPercent) / Math.max(ddCeiling, 0.0001)));
        reasons.DRAWDOWN.push(
            `Drawdown is ${round(input.risk.drawdownPercent)}% of peak equity against a ${ddCeiling}% budget.`
        );
        const ddBudget = input.riskBudgetUsage.find((u) => u.kind === "DRAWDOWN");
        if (ddBudget && ddBudget.status === "BREACHED") reasons.DRAWDOWN.push("Drawdown budget is breached.");
    }

    /* DIVERSIFICATION ---------------------------------------------------- */
    const symbolAxis = availableAxes.find((a) => a.axis === "SYMBOL");
    let diversificationScore: number | null = null;
    if (!symbolAxis || symbolAxis.entries.length === 0) {
        reasons.DIVERSIFICATION.push("No symbol-level exposure to diversify.");
    } else {
        const effective = symbolAxis.effectiveCount;
        diversificationScore = clamp01((effective - 1) / Math.max(1, symbolAxis.entries.length - 1));
        reasons.DIVERSIFICATION.push(
            `Effective independent bets ≈ ${round(effective)} across ${symbolAxis.entries.length} symbol(s).`
        );
    }

    /* REGIME ------------------------------------------------------------- */
    let regimeScore: number | null = null;
    if (input.regime.regime === "UNKNOWN") {
        reasons.REGIME.push("Portfolio regime could not be classified from measured data.");
    } else {
        const adverse = input.regime.regime === "RISK_OFF" || input.regime.regime === "LIQUIDITY_STRESS" || input.regime.regime === "CORRELATION_BREAK";
        regimeScore = clamp01(input.regime.confidence * (adverse ? 0.4 : 1));
        reasons.REGIME.push(
            `Regime ${input.regime.regime} at ${round(input.regime.confidence * 100)}% confidence from ${input.regime.evidence.length} deterministic signal(s).`
        );
        if (adverse) reasons.REGIME.push("Adverse regimes reduce the regime component — diversification benefits less in these conditions.");
    }

    const components: PortfolioHealthComponentState[] = (
        [
            ["RISK", riskScore],
            ["EXPOSURE", exposureScore],
            ["CONCENTRATION", concentrationScore],
            ["CORRELATION", correlationScore],
            ["STRATEGY", strategyScore],
            ["EXECUTION", executionScore],
            ["DRAWDOWN", drawdownScore],
            ["DIVERSIFICATION", diversificationScore],
            ["REGIME", regimeScore],
        ] as Array<[PortfolioHealthComponent, number | null]>
    ).map(([component, score]) => ({
        component,
        rating: ratingFromScore(score),
        score: score === null ? 0 : round(score),
        reasons: reasons[component],
        evidence: reasons[component]
            .slice(0, 2)
            .map((r, i) => `${component.toLowerCase()}:${i + 1}`),
    }));

    const measured = components.filter((c) => c.rating !== "UNKNOWN");
    const overall: HealthRating =
        measured.length === 0
            ? "UNKNOWN"
            : measured.reduce<HealthRating>((worst, c) => (RATING_ORDER[c.rating] > RATING_ORDER[worst] ? c.rating : worst), "GOOD");

    return {
        portfolioId: input.portfolioId,
        calculatedAt: input.calculatedAt,
        components,
        overall,
        worstComponents: components.filter((c) => c.rating === overall && c.rating !== "GOOD").map((c) => c.component),
        unavailableComponents: components.filter((c) => c.rating === "UNKNOWN").map((c) => c.component),
        limitations: [
            "Health is reported per component. The overall rating is the worst measured component — it is a deliberate summary, not a probability or a score to optimise.",
        ],
    };
}
