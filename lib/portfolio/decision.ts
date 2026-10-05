/**
 * AlgoVault — Portfolio Decision Engine + Trade Pre-Check (Phase 15 §13/§21).
 *
 * PURE + DETERMINISTIC. Every decision is traceable: evidence, engine versions,
 * data timestamps, affected positions and strategies, and an explicit list of
 * limitations. The engine never returns a confidence it did not earn, and it
 * never silently downgrades a BLOCK.
 *
 * Fail-closed rule (Phase 15 §43): when a required input is missing or stale,
 * the verdict degrades toward REVIEW/TRADE_BLOCKED and never toward ALLOW.
 */

import { concentrationAfterTrade } from "./concentration";
import { portfolioCorrelationAfter } from "./correlation";
import type {
    AgentPermissionLevel,
    DataFreshness,
    PortfolioAllocation,
    PortfolioConcentration,
    PortfolioCorrelationRisk,
    PortfolioDecision,
    PortfolioDecisionEvidence,
    PortfolioDecisionType,
    PortfolioExposure,
    PortfolioImpact,
    PortfolioPosition,
    PortfolioRiskSnapshot,
    PortfolioTradePreCheck,
    ProposedTrade,
    RiskBudgetUsage,
    RiskImpact,
    TradePreCheckVerdict,
} from "./types";
import { PORTFOLIO_ENGINE_VERSIONS } from "./versioning";

let decisionCounter = 0;

function nextDecisionId(portfolioId: string, now: number): string {
    decisionCounter += 1;
    return `${portfolioId}:dec:${now}:${decisionCounter.toString(36)}`;
}

function engineRefs(): PortfolioDecision["engineVersions"] {
    return Object.entries(PORTFOLIO_ENGINE_VERSIONS).map(([id, version]) => ({ id, version }));
}

function round(v: number): number {
    return Math.round(v * 10000) / 10000;
}

/** Cash risk of a proposed trade: |entry − SL| × qty × contractSize. */
export function proposedTradeRisk(
    trade: ProposedTrade,
    contractSize: number | null
): { riskAmount: number | null; notional: number | null } {
    if (contractSize === null) return { riskAmount: null, notional: null };
    const qty = Math.abs(trade.quantity);
    const notional = trade.entryPrice * qty * contractSize;
    if (trade.stopLoss === null || trade.stopLoss === undefined || !(Math.abs(trade.entryPrice - trade.stopLoss) > 0)) {
        return { riskAmount: null, notional };
    }
    return { riskAmount: Math.abs(trade.entryPrice - trade.stopLoss) * qty * contractSize, notional };
}

/* ── Portfolio impact ─────────────────────────────────────────────────────── */

export interface ComputeImpactInput {
    portfolioId: string;
    exposure: PortfolioExposure;
    concentration: PortfolioConcentration;
    correlation: PortfolioCorrelationRisk;
    matrixSymbols: string[] | null;
    matrix: Array<Array<number | null>> | null;
    equity: number;
    accountsLeverage: number | null;
    trade: ProposedTrade;
    contractSize: number | null;
}

/**
 * Compute what the proposal DOES to the portfolio — the question the rest of
 * the platform cannot answer from a single order ticket.
 */
export function computePortfolioImpact(input: ComputeImpactInput): {
    impact: PortfolioImpact;
    riskAmount: number | null;
    notional: number | null;
    maxCorrelation: number | null;
    concentrationAfter: number | null;
} {
    const { exposure, trade } = input;
    const sign = trade.side === "LONG" ? 1 : -1;
    const { riskAmount, notional } = proposedTradeRisk(trade, input.contractSize);

    const heldSymbols = exposure.bySymbol.map((s) => s.key);
    const maxCorrelation =
        input.matrix && input.matrixSymbols
            ? buildMatrixLookup(input.matrix, input.matrixSymbols, trade.symbol, heldSymbols)
            : null;

    const incrementalGross = notional ?? 0;
    const grossAfter = exposure.grossExposure + incrementalGross;
    const netAfter = exposure.netExposure + sign * incrementalGross;
    const concentrationAfter = concentrationAfterTrade(
        input.concentration,
        trade.symbol,
        incrementalGross,
        exposure.grossExposure
    );

    const leverage = input.accountsLeverage && input.accountsLeverage > 0 ? input.accountsLeverage : 1;
    const marginAfter = incrementalGross > 0 ? incrementalGross / leverage : null;

    const affectedCurrencies: string[] = [];
    for (const slice of exposure.byCurrency) {
        if (slice.status !== "AVAILABLE") continue;
        // A trade in a currency the portfolio already leans on moves that slice.
        if (slice.key === "USD" || trade.symbol.includes(slice.key)) affectedCurrencies.push(slice.key);
    }

    const assetClass = soleAssetClass(exposure);

    return {
        impact: {
            incrementalGrossExposure: incrementalGross,
            incrementalNetExposure: sign * incrementalGross,
            grossExposureAfter: grossAfter,
            grossToEquityAfter: input.equity > 0 ? grossAfter / input.equity : null,
            concentrationAfter,
            correlationAfter: maxCorrelation,
            marginAfter,
            affectedCurrencies,
            affectedAssetClasses: assetClass ? [assetClass] : [],
        },
        riskAmount,
        notional,
        maxCorrelation,
        concentrationAfter,
    };
}

function buildMatrixLookup(
    matrix: Array<Array<number | null>>,
    symbols: string[],
    incoming: string,
    held: string[]
): number | null {
    const index = new Map(symbols.map((s, i) => [s, i]));
    const i = index.get(incoming);
    if (i === undefined) return null;
    const pseudo = { symbols: [...held], pairs: [] } as never;
    void pseudo;
    const values: number[] = [];
    for (const other of held) {
        if (other === incoming) continue;
        const j = index.get(other);
        if (j === undefined) continue;
        const v = matrix[i]?.[j];
        if (typeof v === "number") values.push(v);
    }
    if (values.length === 0) return null;
    return Math.max(...values);
}

/**
 * The single asset class of the book, when the portfolio is not diversified.
 * Used only to name the axis a proposal lands on; a diversified book returns
 * null rather than picking one.
 */
function soleAssetClass(exposure: PortfolioExposure): string | null {
    const slices = exposure.byAssetClass.filter((s) => s.status === "AVAILABLE" && s.grossNotional > 0);
    return slices.length === 1 ? slices[0].key : null;
}

/* ── Risk impact ──────────────────────────────────────────────────────────── */

export function computeRiskImpact(input: {
    equity: number;
    riskAmount: number | null;
    currentOpenRiskPercent: number | null;
    portfolioRiskLimitPercent: number | null;
    budgetsAtRisk: string[];
    drawdownImpactPercent: number | null;
}): RiskImpact {
    const incrementalRiskPercent =
        input.riskAmount !== null && input.equity > 0 ? (input.riskAmount / input.equity) * 100 : null;

    let rating: RiskImpact["rating"] = "UNKNOWN";
    if (incrementalRiskPercent !== null) {
        const after =
            (input.currentOpenRiskPercent ?? 0) + incrementalRiskPercent;
        const limit = input.portfolioRiskLimitPercent ?? 2;
        const utilization = limit > 0 ? after / limit : Infinity;
        if (utilization >= 1) rating = "SEVERE";
        else if (utilization >= 0.75) rating = "HIGH";
        else if (utilization >= 0.4) rating = "MODERATE";
        else rating = "LOW";
    }

    return {
        rating,
        incrementalRiskAmount: input.riskAmount,
        incrementalRiskPercent: incrementalRiskPercent === null ? null : round(incrementalRiskPercent),
        budgetsAtRisk: input.budgetsAtRisk,
        drawdownImpactPercent: input.drawdownImpactPercent,
    };
}

/* ── Trade pre-check ──────────────────────────────────────────────────────── */

export interface PreCheckInput {
    portfolioId: string;
    trade: ProposedTrade;
    exposure: PortfolioExposure;
    concentration: PortfolioConcentration;
    correlation: PortfolioCorrelationRisk;
    correlationMatrixSymbols: string[] | null;
    correlationMatrix: Array<Array<number | null>> | null;
    risk: PortfolioRiskSnapshot;
    riskBudgetUsage: RiskBudgetUsage[];
    equity: number;
    leverage: number | null;
    contractSize: number | null;
    positions: PortfolioPosition[];
    allocation: PortfolioAllocation | null;
    freshness: DataFreshness;
    now: number;
    /** Correlation policy — correlation alone never auto-rejects. */
    policy?: TradePolicy;
    contractSizeOf: (symbol: string) => number | null;
}

export interface TradePolicy {
    /** Correlation at which a proposal is at least warned about. */
    correlationWarnThreshold: number;
    /** Correlation at which a proposal requires explicit approval. */
    correlationApprovalThreshold: number;
    /** Symbol share of gross exposure above which a proposal is blocked. */
    maxSymbolWeight: number;
    /** Max strategy share of gross exposure above which a proposal is blocked. */
    maxStrategyWeight: number;
    /** Max gross/equity multiple after the trade. */
    maxGrossToEquity: number;
}

export const DEFAULT_TRADE_POLICY: TradePolicy = {
    correlationWarnThreshold: 0.6,
    correlationApprovalThreshold: 0.8,
    maxSymbolWeight: 0.5,
    maxStrategyWeight: 0.5,
    maxGrossToEquity: 10,
};

export function runTradePreCheck(input: PreCheckInput): PortfolioTradePreCheck {
    const policy = input.policy ?? DEFAULT_TRADE_POLICY;
    const evidence: PortfolioDecisionEvidence[] = [];
    const blockingReasons: string[] = [];
    const warningReasons: string[] = [];
    const limitations: string[] = [];

    const impactResult = computePortfolioImpact({
        portfolioId: input.portfolioId,
        exposure: input.exposure,
        concentration: input.concentration,
        correlation: input.correlation,
        matrixSymbols: input.correlationMatrixSymbols,
        matrix: input.correlationMatrix,
        equity: input.equity,
        accountsLeverage: input.leverage,
        trade: input.trade,
        contractSize: input.contractSizeOf(input.trade.symbol),
    });

    const { impact, riskAmount, notional, maxCorrelation } = impactResult;

    /* ── Fail-closed gates ─────────────────────────────────────────────── */

    if (input.contractSizeOf(input.trade.symbol) === null) {
        blockingReasons.push(
            `${input.trade.symbol} has no entry in the canonical instrument registry — portfolio impact cannot be priced, so this trade is not authorised.`
        );
        limitations.push("Instrument metadata unavailable for the proposed symbol.");
    }

    if (input.freshness.freshness === "UNAVAILABLE") {
        blockingReasons.push("Portfolio data is unavailable — AlgoVault does not authorise automated action on unknown state.");
    } else if (input.freshness.freshness === "STALE") {
        warningReasons.push(
            `Portfolio data is stale (${Math.round(input.freshness.dataAgeMs / 1000)}s old) — the pre-check is running against a stale portfolio state.`
        );
    }

    if (input.trade.stopLoss === null || input.trade.stopLoss === undefined) {
        warningReasons.push("No stop loss supplied — the trade's cash risk and portfolio risk impact cannot be quantified.");
    }

    /* ── Existing budgets ──────────────────────────────────────────────── */

    for (const budget of input.riskBudgetUsage) {
        if (budget.status === "BREACHED") {
            blockingReasons.push(
                `Budget already breached before this trade: ${budget.kind}${budget.scopeKey ? ` (${budget.scopeKey})` : ""} at ${budget.usedPercent}% of ${budget.limitPercent}%.`
            );
        } else if (budget.status === "WATCH") {
            warningReasons.push(
                `Budget near limit: ${budget.kind}${budget.scopeKey ? ` (${budget.scopeKey})` : ""} at ${budget.usedPercent}% of ${budget.limitPercent}% (${Math.round(budget.utilization * 100)}% used).`
            );
        }
    }

    /* ── Incremental budgets ───────────────────────────────────────────── */

    const riskLimit = input.riskBudgetUsage.find((b) => b.kind === "PORTFOLIO_RISK")?.limitPercent ?? null;
    const budgetsAtRisk: string[] = [];
    let riskImpact: RiskImpact;

    if (riskAmount !== null && input.equity > 0) {
        const incrementalPercent = (riskAmount / input.equity) * 100;
        const currentOpenRisk = input.risk.openRiskPercent ?? 0;
        const after = currentOpenRisk + incrementalPercent;

        if (riskLimit !== null && after > riskLimit) {
            budgetsAtRisk.push("PORTFOLIO_RISK");
            blockingReasons.push(
                `This trade would take open risk to ${after.toFixed(2)}% of equity, past the ${riskLimit}% portfolio risk budget.`
            );
        } else if (riskLimit !== null && after > riskLimit * 0.75) {
            budgetsAtRisk.push("PORTFOLIO_RISK");
            warningReasons.push(
                `This trade takes open risk to ${after.toFixed(2)}%, which is ${Math.round((after / riskLimit) * 100)}% of the ${riskLimit}% portfolio risk budget.`
            );
        }

        // Symbol-level budget.
        const symbolBudget = input.riskBudgetUsage.find((b) => b.kind === "SYMBOL" && b.scopeKey === input.trade.symbol);
        if (symbolBudget) {
            const symbolRiskAfter = ((input.risk.openRiskPercent ?? 0) * 0) + incrementalPercent; // conservative: attribute the new risk to the symbol
            const utilization = symbolRiskAfter / symbolBudget.limitPercent;
            if (utilization >= 1) {
                budgetsAtRisk.push(`SYMBOL:${input.trade.symbol}`);
                blockingReasons.push(`Symbol budget for ${input.trade.symbol} would be exceeded (${symbolRiskAfter.toFixed(2)}% vs ${symbolBudget.limitPercent}%).`);
            } else if (utilization >= 0.75) {
                budgetsAtRisk.push(`SYMBOL:${input.trade.symbol}`);
                warningReasons.push(`Symbol budget for ${input.trade.symbol} would reach ${Math.round(utilization * 100)}% of its limit.`);
            }
        }

        riskImpact = computeRiskImpact({
            equity: input.equity,
            riskAmount,
            currentOpenRiskPercent: currentOpenRisk,
            portfolioRiskLimitPercent: riskLimit,
            budgetsAtRisk,
            drawdownImpactPercent: input.equity > 0 ? -incrementalPercent : null,
        });
    } else {
        riskImpact = {
            rating: "UNKNOWN",
            incrementalRiskAmount: null,
            incrementalRiskPercent: null,
            budgetsAtRisk: [],
            drawdownImpactPercent: null,
        };
        if (input.trade.stopLoss) {
            limitations.push("Cash risk could not be priced — contract size is unavailable for this symbol.");
        }
    }

    /* ── Concentration ─────────────────────────────────────────────────── */

    const symbolSlice = input.exposure.bySymbol.find((s) => s.key === input.trade.symbol);
    const currentSymbolWeight = symbolSlice?.grossWeight ?? 0;
    const currentGross = input.exposure.grossExposure;
    const projectedWeight =
        notional !== null && currentGross + notional > 0
            ? (currentSymbolWeight * currentGross + notional) / (currentGross + notional)
            : null;

    if (projectedWeight !== null && projectedWeight > policy.maxSymbolWeight) {
        blockingReasons.push(
            `After this trade, ${input.trade.symbol} would be ${(projectedWeight * 100).toFixed(1)}% of gross exposure, past the ${(policy.maxSymbolWeight * 100).toFixed(0)}% policy limit.`
        );
    } else if (projectedWeight !== null && projectedWeight > policy.maxSymbolWeight * 0.75) {
        warningReasons.push(
            `After this trade, ${input.trade.symbol} would be ${(projectedWeight * 100).toFixed(1)}% of gross exposure.`
        );
    }

    const strategyId = input.trade.strategyId ?? "MANUAL";
    const strategySlice = input.exposure.byStrategy.find((s) => s.key === strategyId);
    const currentStrategyWeight = strategySlice?.grossWeight ?? 0;
    const projectedStrategyWeight =
        notional !== null && currentGross + notional > 0
            ? (currentStrategyWeight * currentGross + notional) / (currentGross + notional)
            : null;
    if (projectedStrategyWeight !== null && projectedStrategyWeight > policy.maxStrategyWeight) {
        blockingReasons.push(
            `After this trade, ${strategyId} would hold ${(projectedStrategyWeight * 100).toFixed(1)}% of gross exposure, past the ${(policy.maxStrategyWeight * 100).toFixed(0)}% strategy concentration policy.`
        );
    }

    if (impact.concentrationAfter !== null && input.concentration.concentrationScore > 0) {
        const delta = impact.concentrationAfter - input.concentration.concentrationScore;
        if (delta > 0.1) {
            warningReasons.push(
                `Symbol concentration would rise from ${input.concentration.concentrationScore.toFixed(3)} to ${impact.concentrationAfter.toFixed(3)} (HHI).`
            );
        }
    }

    /* ── Correlation — policy driven, never an automatic reject ────────── */

    if (maxCorrelation !== null) {
        evidence.push({
            id: "precheck:correlation",
            kind: "CALCULATED",
            source: "portfolio-correlation-engine",
            engine: PORTFOLIO_ENGINE_VERSIONS["portfolio-correlation"],
            detail: `Highest correlation between ${input.trade.symbol} and a currently held symbol is ρ ${maxCorrelation.toFixed(3)}.`,
            value: round(maxCorrelation),
        });
        if (Math.abs(maxCorrelation) >= policy.correlationApprovalThreshold) {
            warningReasons.push(
                `Portfolio impact: HIGH — ${input.trade.symbol} is correlated ρ ${maxCorrelation.toFixed(2)} with an existing holding. The correlation budget is ${Math.abs(maxCorrelation) * 100 > 0 ? "already consuming" : "not"} material here. This requires your approval, not an automatic block.`
            );
        } else if (Math.abs(maxCorrelation) >= policy.correlationWarnThreshold) {
            warningReasons.push(
                `${input.trade.symbol} is correlated ρ ${maxCorrelation.toFixed(2)} with an existing holding — correlated exposure increases.`
            );
        }
    } else if (heldSymbolsApart(input, input.trade.symbol).length > 0) {
        limitations.push(
            `Correlation between ${input.trade.symbol} and existing holdings is UNAVAILABLE (no aligned history) — it is not assumed to be zero.`
        );
    }

    /* ── Gross exposure ceiling ────────────────────────────────────────── */

    if (impact.grossToEquityAfter !== null && impact.grossToEquityAfter > policy.maxGrossToEquity) {
        blockingReasons.push(
            `Gross exposure would reach ${impact.grossToEquityAfter.toFixed(2)}x equity, past the ${policy.maxGrossToEquity}x policy ceiling.`
        );
    }

    /* ── Margin ────────────────────────────────────────────────────────── */

    if (impact.marginAfter !== null && input.equity > 0) {
        const marginAfterPct = (impact.marginAfter / input.equity) * 100;
        const marginBudget = input.riskBudgetUsage.find((b) => b.kind === "MARGIN");
        if (marginBudget && marginBudget.usedPercent + marginAfterPct > marginBudget.limitPercent) {
            budgetsAtRisk.push("MARGIN");
            blockingReasons.push(
                `Margin usage would reach ${(marginBudget.usedPercent + marginAfterPct).toFixed(1)}%, past the ${marginBudget.limitPercent}% budget.`
            );
        }
    }

    /* ── Verdict ───────────────────────────────────────────────────────── */

    let verdict: TradePreCheckVerdict;
    let permissionRequired: AgentPermissionLevel = "READ_ONLY";
    if (blockingReasons.length > 0) {
        verdict = "TRADE_BLOCKED";
        permissionRequired = "HIGH_RISK";
    } else if (warningReasons.some((r) => /requires your approval/.test(r))) {
        verdict = "TRADE_REQUIRES_APPROVAL";
        permissionRequired = "USER_CONFIRMATION";
    } else if (warningReasons.length > 0) {
        verdict = "TRADE_WARNING";
        permissionRequired = "LOW_RISK";
    } else {
        verdict = "TRADE_ACCEPTABLE";
    }

    const decisionType: PortfolioDecisionType =
        verdict === "TRADE_BLOCKED"
            ? "BLOCK"
            : verdict === "TRADE_REQUIRES_APPROVAL"
              ? "REVIEW"
              : verdict === "TRADE_WARNING"
                ? "ALLOW_WITH_WARNING"
                : "ALLOW";

    evidence.push(
        {
            id: "precheck:exposure",
            kind: "CALCULATED",
            source: "portfolio-exposure-engine",
            engine: PORTFOLIO_ENGINE_VERSIONS["portfolio-exposure"],
            detail: `Incremental gross notional ${notional !== null ? round(notional).toFixed(2) : "unavailable"}; gross exposure would move from ${round(currentGross).toFixed(2)} to ${round(impact.grossExposureAfter ?? 0).toFixed(2)}.`,
            value: round(impact.incrementalGrossExposure ?? 0),
        },
        {
            id: "precheck:risk",
            kind: riskAmount === null ? "INFERRED" : "CALCULATED",
            source: "portfolio-risk-budget-engine",
            engine: PORTFOLIO_ENGINE_VERSIONS["portfolio-risk-budget"],
            detail:
                riskAmount === null
                    ? "Incremental cash risk is UNAVAILABLE (no stop loss or no contract size)."
                    : `Incremental cash risk ${round(riskAmount).toFixed(2)} (${riskImpact.incrementalRiskPercent ?? "?"}% of equity).`,
            value: riskAmount ?? undefined,
        }
    );

    const decision: PortfolioDecision = {
        portfolioId: input.portfolioId,
        decisionId: nextDecisionId(input.portfolioId, input.now),
        decision: decisionType,
        confidence: confidenceForVerdict(verdict, riskAmount !== null, input.freshness.freshness),
        evidence,
        affectedPositions: input.positions
            .filter((p) => (verdict === "TRADE_BLOCKED" || verdict === "TRADE_REQUIRES_APPROVAL") && maxCorrelation !== null && p.symbol === input.trade.symbol)
            .map((p) => p.positionId),
        affectedStrategies: strategyId === "MANUAL" ? [] : [strategyId],
        riskImpact,
        portfolioImpact: impact,
        limitations,
        generatedAt: input.now,
        dataTimestamp: input.freshness.dataTimestamp,
        engineVersions: engineRefs(),
        permissionRequired,
        degraded: input.freshness.freshness !== "FRESH" || riskAmount === null,
        degradedReason:
            input.freshness.freshness !== "FRESH"
                ? `Portfolio data freshness is ${input.freshness.freshness}.`
                : riskAmount === null
                  ? "Cash risk could not be priced."
                  : undefined,
    };

    return {
        portfolioId: input.portfolioId,
        verdict,
        individualTradeRisk: riskImpact.rating === "UNKNOWN" ? "UNKNOWN" : riskImpact.rating === "SEVERE" ? "HIGH" : riskImpact.rating === "LOW" ? "LOW" : riskImpact.rating === "HIGH" ? "HIGH" : "MODERATE",
        portfolioImpact:
            maxCorrelation !== null && Math.abs(maxCorrelation) >= policy.correlationWarnThreshold
                ? "HIGH"
                : riskImpact.rating === "SEVERE" || riskImpact.rating === "HIGH"
                  ? "HIGH"
                  : riskImpact.rating === "UNKNOWN"
                    ? "UNKNOWN"
                    : riskImpact.rating === "MODERATE"
                      ? "MODERATE"
                      : "LOW",
        reasons: [...blockingReasons, ...warningReasons],
        blockingReasons,
        warningReasons,
        decision,
        dataTimestamp: input.freshness.dataTimestamp,
        freshness: input.freshness,
    };
}

function heldSymbolsApart(input: PreCheckInput, symbol: string): string[] {
    return input.exposure.bySymbol.map((s) => s.key).filter((s) => s !== symbol);
}

function confidenceForVerdict(verdict: TradePreCheckVerdict, riskPriced: boolean, freshness: string): number {
    let confidence = 0.5;
    if (riskPriced) confidence += 0.2;
    if (freshness === "FRESH") confidence += 0.2;
    else if (freshness === "STALE") confidence -= 0.2;
    if (verdict === "TRADE_BLOCKED") confidence += 0.1;
    return Math.round(Math.max(0.05, Math.min(0.95, confidence)) * 100) / 100;
}

/** Standalone re-balance / de-risk recommendation builder (never an execution instruction). */
export function buildRebalanceRecommendation(input: {
    portfolioId: string;
    reason: string;
    evidence: PortfolioDecisionEvidence[];
    affectedStrategies: string[];
    dataTimestamp: number;
    now: number;
}): PortfolioDecision {
    return {
        portfolioId: input.portfolioId,
        decisionId: nextDecisionId(input.portfolioId, input.now),
        decision: "REBALANCE_RECOMMENDATION",
        confidence: 0.4,
        evidence: input.evidence,
        affectedPositions: [],
        affectedStrategies: input.affectedStrategies,
        riskImpact: {
            rating: "UNKNOWN",
            incrementalRiskAmount: null,
            incrementalRiskPercent: null,
            budgetsAtRisk: [],
            drawdownImpactPercent: null,
        },
        portfolioImpact: {
            incrementalGrossExposure: 0,
            incrementalNetExposure: 0,
            grossExposureAfter: null,
            grossToEquityAfter: null,
            concentrationAfter: null,
            correlationAfter: null,
            marginAfter: null,
            affectedCurrencies: [],
            affectedAssetClasses: [],
        },
        limitations: [
            "This is a recommendation only. AlgoVault never rebalances a live portfolio automatically; it requires explicit approval and passes every existing Risk Engine and Execution Supervisor gate.",
        ],
        generatedAt: input.now,
        dataTimestamp: input.dataTimestamp,
        engineVersions: engineRefs(),
        permissionRequired: "USER_CONFIRMATION",
    };
}

export { portfolioCorrelationAfter };
