/**
 * AlgoVault — Portfolio Risk Budget Engine (Phase 15 §11).
 *
 * PURE + DETERMINISTIC. A budget is a percentage of portfolio equity. Usage is
 * measured from the canonical snapshot — never estimated.
 *
 *   utilization = usedPercent / limitPercent
 *   status      = OK      utilization < 0.75
 *                 WATCH   0.75 ≤ utilization < 1
 *                 BREACHED utilization ≥ 1
 *                 UNKNOWN the budget's denominator or the underlying datum is
 *                          unavailable, so no honest verdict can be given.
 *
 * `UNKNOWN` is a real answer. It is deliberately different from `OK`: an
 * unmeasured budget is not a healthy budget.
 */

import type {
    PortfolioAccount,
    PortfolioCorrelationRisk,
    PortfolioConcentration,
    PortfolioExposure,
    PortfolioRiskBudget,
    PortfolioRiskSnapshot,
    RiskBudgetKind,
    RiskBudgetUsage,
} from "./types";

export const WATCH_THRESHOLD = 0.75;

export interface BudgetMeasurement {
    /** Measured consumption in percent of equity. null = not measurable. */
    usedPercent: number | null;
    note?: string;
}

function statusOf(limit: number, usedPercent: number | null): RiskBudgetUsage["status"] {
    if (!Number.isFinite(limit) || limit <= 0) return "UNKNOWN";
    if (usedPercent === null || !Number.isFinite(usedPercent)) return "UNKNOWN";
    const utilization = usedPercent / limit;
    if (utilization >= 1) return "BREACHED";
    if (utilization >= WATCH_THRESHOLD) return "WATCH";
    return "OK";
}

/**
 * Evaluate every budget against the measured snapshot.
 *
 * `context` is assembled by the snapshot builder; this function performs no
 * arithmetic beyond the documented ratios.
 */
export function evaluateRiskBudgets(input: {
    budgets: PortfolioRiskBudget[];
    equity: number | null;
    exposure: PortfolioExposure;
    concentration: PortfolioConcentration;
    correlation: PortfolioCorrelationRisk;
    accounts: PortfolioAccount[];
    positionsRiskPercentByStrategy: Record<string, number | null>;
    positionsRiskPercentBySymbol: Record<string, number | null>;
    openRiskPercent: number | null;
    drawdownPercent: number | null;
    dailyLossPercent: number | null;
    marginLevelPercent: number | null;
}): RiskBudgetUsage[] {
    const { equity, exposure, concentration, correlation, budgets } = input;
    const pct = (value: number | null | undefined): number | null =>
        equity && equity > 0 && typeof value === "number" && Number.isFinite(value) ? (value / equity) * 100 : null;

    const totalMargin = input.accounts.reduce((acc, a) => acc + (Number.isFinite(a.marginUsed) ? a.marginUsed : 0), 0);

    const measure = (budget: PortfolioRiskBudget): BudgetMeasurement => {
        switch (budget.kind) {
            case "GROSS_EXPOSURE":
                return { usedPercent: pct(exposure.grossExposure) };
            case "DAILY_LOSS":
                return input.dailyLossPercent === null
                    ? { usedPercent: null, note: "Realized daily loss is not recorded by the gateway for this account." }
                    : { usedPercent: Math.max(0, input.dailyLossPercent) };
            case "DRAWDOWN":
                return input.drawdownPercent === null
                    ? { usedPercent: null, note: "No drawdown high-water mark recorded." }
                    : { usedPercent: Math.max(0, input.drawdownPercent) };
            case "MARGIN":
                return input.marginLevelPercent === null
                    ? { usedPercent: null, note: "No margin level recorded." }
                    : { usedPercent: Math.max(0, 100 - input.marginLevelPercent) };
            case "CORRELATION":
                return {
                    usedPercent:
                        correlation.severity === "UNKNOWN"
                            ? null
                            : pct(exposure.grossExposure * correlation.clusteredExposureWeight),
                    note:
                        correlation.severity === "UNKNOWN"
                            ? "Correlation could not be computed."
                            : `Clustered exposure ${(correlation.clusteredExposureWeight * 100).toFixed(1)}% at mean ρ ${correlation.meanCorrelation.toFixed(2)}.`,
                };
            case "PORTFOLIO_RISK":
                return { usedPercent: input.openRiskPercent };
            case "STRATEGY_RISK": {
                const used = input.positionsRiskPercentByStrategy[budget.scopeKey];
                return used === undefined || used === null
                    ? { usedPercent: null, note: `No open risk recorded for strategy ${budget.scopeKey || "(portfolio)"}.` }
                    : { usedPercent: used };
            }
            case "SYMBOL": {
                const used = input.positionsRiskPercentBySymbol[budget.scopeKey];
                return used === undefined || used === null
                    ? { usedPercent: null, note: `No open risk recorded for ${budget.scopeKey}.` }
                    : { usedPercent: used };
            }
            case "ASSET_CLASS": {
                const slice = exposure.byAssetClass.find((s) => s.key === budget.scopeKey);
                if (!slice || slice.status !== "AVAILABLE") {
                    return { usedPercent: null, note: `Asset class ${budget.scopeKey} is not held and has no determinable instruments.` };
                }
                return { usedPercent: pct(slice.grossNotional) };
            }
            default:
                return { usedPercent: null, note: "Unknown budget kind." };
        }
    };

    return budgets
        .filter((b) => b.enabled)
        .map((budget) => {
            const { usedPercent, note } = measure(budget);
            const status = statusOf(budget.limitPercent, usedPercent);
            return {
                budgetId: budget.budgetId,
                scope: budget.scope,
                scopeKey: budget.scopeKey,
                kind: budget.kind,
                limitPercent: budget.limitPercent,
                usedPercent: usedPercent === null ? 0 : Math.round(usedPercent * 100) / 100,
                utilization: usedPercent === null || budget.limitPercent <= 0 ? 0 : Math.round((usedPercent / budget.limitPercent) * 1000) / 1000,
                status,
                note: note ?? (status === "UNKNOWN" ? "Budget could not be measured from available data." : undefined),
            };
        });
}

/**
 * The system default: a conservative budget set applied when a portfolio has no
 * stored configuration. Documented so the numbers are never mysterious.
 */
export function defaultRiskBudgets(now: number, updatedBy: string): PortfolioRiskBudget[] {
    return [
        {
            budgetId: "default:portfolio-risk",
            scope: "PORTFOLIO",
            scopeKey: "",
            kind: "PORTFOLIO_RISK",
            limitPercent: 2,
            enabled: true,
            updatedAt: now,
            updatedBy,
        },
        {
            budgetId: "default:daily-loss",
            scope: "PORTFOLIO",
            scopeKey: "",
            kind: "DAILY_LOSS",
            limitPercent: 3,
            enabled: true,
            updatedAt: now,
            updatedBy,
        },
        {
            budgetId: "default:drawdown",
            scope: "PORTFOLIO",
            scopeKey: "",
            kind: "DRAWDOWN",
            limitPercent: 10,
            enabled: true,
            updatedAt: now,
            updatedBy,
        },
        {
            budgetId: "default:gross-exposure",
            scope: "PORTFOLIO",
            scopeKey: "",
            kind: "GROSS_EXPOSURE",
            limitPercent: 500,
            enabled: true,
            updatedAt: now,
            updatedBy,
        },
        {
            budgetId: "default:margin",
            scope: "PORTFOLIO",
            scopeKey: "",
            kind: "MARGIN",
            limitPercent: 50,
            enabled: true,
            updatedAt: now,
            updatedBy,
        },
        {
            budgetId: "default:correlation",
            scope: "PORTFOLIO",
            scopeKey: "",
            kind: "CORRELATION",
            limitPercent: 60,
            enabled: true,
            updatedAt: now,
            updatedBy,
        },
    ];
}

/** Budget kinds a user may configure, with their measured semantics. */
export const RISK_BUDGET_KIND_LABELS: Record<RiskBudgetKind, string> = {
    DAILY_LOSS: "Daily realized loss (% of equity)",
    PORTFOLIO_RISK: "Open risk at stop (% of equity)",
    STRATEGY_RISK: "Per-strategy open risk (% of equity)",
    ASSET_CLASS: "Asset-class notional (% of equity)",
    SYMBOL: "Per-symbol open risk (% of equity)",
    DRAWDOWN: "Drawdown (% of peak equity)",
    CORRELATION: "Correlated-cluster notional (% of equity)",
    MARGIN: "Margin usage (% of equity)",
    GROSS_EXPOSURE: "Gross notional (% of equity)",
};

/** Total margin helper reused by the risk snapshot and the pre-check. */
export function totalMarginUsed(accounts: PortfolioAccount[]): number {
    return accounts.reduce((acc, a) => acc + (Number.isFinite(a.marginUsed) ? a.marginUsed : 0), 0);
}

/** Narrow helper used by the pre-check to name budgets a proposal would break. */
export function breachedBudgets(usage: RiskBudgetUsage[]): RiskBudgetUsage[] {
    return usage.filter((u) => u.status === "BREACHED");
}

export type { PortfolioRiskSnapshot };
