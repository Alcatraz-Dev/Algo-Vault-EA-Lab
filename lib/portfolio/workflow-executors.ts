/**
 * Portfolio workflow node executors (Phase 15 §35).
 *
 * EXTENDS the canonical Workflow Automation executor switch in
 * `lib/workflows/executors.ts`. Every node here is read-only or produces an
 * advisory artifact — none of them can place, resize or close a live order.
 */

import type { NodeExecutionArgs, NodeExecutionResult } from "@/lib/workflows/types";
import { buildPortfolioBundle } from "@/lib/portfolio/service";
import { computeAllocation, recommendAllocation } from "@/lib/portfolio/allocation";
import { defaultScenarios, runStressTests } from "@/lib/portfolio/stress";
import { runTradePreCheck } from "@/lib/portfolio/decision";
import { contractSizeOf } from "@/lib/portfolio/instruments";
import { writeJournalEntry } from "@/lib/portfolio/store";
import type { AllocationMethod, PortfolioJournalEntry, PortfolioScenario, ScenarioKind } from "@/lib/portfolio/types";

function portfolioIdOf(args: NodeExecutionArgs): string {
    return String(args.config.portfolioId || "primary");
}

async function bundleFor(args: NodeExecutionArgs) {
    return buildPortfolioBundle({
        userId: args.uid,
        portfolioId: portfolioIdOf(args),
        timeframe: (String(args.config.timeframe || "H1") as never) ?? "H1",
    });
}

export async function portfolioSnapshotNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const bundle = await bundleFor(args);
    const s = bundle.snapshot;
    return {
        status: "success",
        output: {
            portfolioId: s.portfolioId,
            equity: s.equity,
            balance: s.balance,
            unrealizedPnL: s.unrealizedPnL,
            grossExposure: s.grossExposure,
            netExposure: s.netExposure,
            grossToEquity: s.exposure.grossToEquity,
            marginUsed: s.marginUsed,
            freeMargin: s.freeMargin,
            leverage: s.leverage,
            drawdownPercent: s.risk.drawdownPercent,
            dailyLossPercent: s.risk.dailyLossPercent,
            positionCount: s.positionCount,
            concentrationScore: s.concentrationScore,
            correlationRiskScore: s.correlationRiskScore,
            portfolioRiskScore: s.portfolioRiskScore,
            regime: s.regime,
            health: s.health.overall,
            freshness: s.freshness.freshness,
            dataTimestamp: s.freshness.dataTimestamp,
            limitations: s.limitations,
        },
    };
}

export async function portfolioCorrelationNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const bundle = await bundleFor(args);
    return {
        status: "success",
        output: {
            available: bundle.matrix !== null,
            symbols: bundle.matrix?.symbols ?? [],
            window: bundle.matrix?.window ?? null,
            method: bundle.matrix?.method ?? null,
            pairs: (bundle.matrix?.pairs ?? []).map((p) => ({
                a: p.a,
                b: p.b,
                coefficient: p.coefficient,
                status: p.status,
                observations: p.observations,
            })),
            clusteredExposureWeight: bundle.snapshot.correlation.clusteredExposureWeight,
            meanCorrelation: bundle.snapshot.correlation.meanCorrelation,
            severity: bundle.snapshot.correlation.severity,
            unavailableSymbols: bundle.unavailableSymbols,
            limitations: bundle.matrix?.limitations ?? ["Correlation is UNAVAILABLE — no aligned price history."],
        },
    };
}

export async function portfolioConcentrationNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const bundle = await bundleFor(args);
    return {
        status: "success",
        output: {
            concentrationScore: bundle.snapshot.concentration.concentrationScore,
            severity: bundle.snapshot.concentration.severity,
            maxAxis: bundle.snapshot.concentration.maxAxis,
            axes: bundle.snapshot.concentration.axes.map((a) => ({
                axis: a.axis,
                hhi: a.hhi,
                effectiveCount: a.effectiveCount,
                topShare: a.topShare,
                topThreeShare: a.topThreeShare,
                maxEntry: a.maxEntry,
                status: a.status,
            })),
            limitations: bundle.snapshot.concentration.limitations,
        },
    };
}

export async function portfolioStressNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const bundle = await bundleFor(args);
    const kind = String(args.config.kind || "CORRELATION_SPIKE").toUpperCase() as ScenarioKind;
    const scenarios: PortfolioScenario[] = defaultScenarios().filter((s) => s.kind === kind);
    if (scenarios.length === 0) {
        return { status: "failed", error: `Scenario "${kind}" is not a supported portfolio stress scenario.` };
    }
    const result = runStressTests({
        portfolioId: bundle.portfolio.portfolioId,
        positions: bundle.snapshot.positions,
        accounts: bundle.snapshot.accounts,
        equity: bundle.snapshot.equity,
        scenarios,
        riskBudgets: bundle.snapshot.riskBudgetUsage.map((u) => ({
            kind: u.kind,
            limitPercent: u.limitPercent,
            scopeKey: u.scopeKey,
        })),
        generatedAt: Date.now(),
        dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
    });
    return {
        status: "success",
        output: {
            method: result.method,
            worstCase: result.worstCase,
            scenarios: result.scenarios.map((r) => ({
                scenarioId: r.scenario.scenarioId,
                basis: r.scenario.basis,
                pnlImpact: r.pnlImpact,
                pnlImpactPercent: r.pnlImpactPercent,
                breach: r.breach,
                breaches: r.breaches,
            })),
            limitations: result.limitations,
        },
    };
}

export async function portfolioAllocationNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const bundle = await bundleFor(args);
    if (bundle.strategyIntelligence.strategies.length === 0) {
        return {
            status: "success",
            output: {
                recommendations: [],
                limitations: ["No strategies are attributed to this portfolio — no allocation recommendation was produced."],
            },
        };
    }
    const method = String(args.config.method || "RISK_PARITY").toUpperCase() as AllocationMethod;
    const allocation = computeAllocation({
        portfolioId: bundle.portfolio.portfolioId,
        method,
        inputs: bundle.strategyIntelligence.strategies.map((s) => ({
            strategyId: s.strategyId,
            currentWeight: s.equityWeight,
            pnlContribution: s.unrealizedPnL,
            volatility: null,
            maxDrawdownPercent: s.maxDrawdownPercent,
            oosSharpe: s.oosSharpe,
            sampleSize: s.sampleSize,
            correlationToPortfolio: s.correlationToPortfolio,
            health: s.health,
            active: s.active,
        })),
        calculatedAt: Date.now(),
    });
    const recommendations = recommendAllocation(allocation, bundle.strategyIntelligence, { now: Date.now() });
    return {
        status: "success",
        output: {
            method: allocation.method,
            normalized: allocation.normalized,
            recommendations: recommendations.map((r) => ({
                strategyId: r.strategyId,
                action: r.action,
                targetWeight: r.targetWeight,
                currentWeight: r.currentWeight,
                confidence: r.confidence,
                rationale: r.rationale,
            })),
            // Advisory by construction: nothing here is executable.
            requiresApproval: true,
            limitations: allocation.limitations,
        },
    };
}

export async function portfolioTradePreCheckNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const bundle = await bundleFor(args);
    const symbol = String(args.config.symbol || "").trim().toUpperCase();
    const quantity = Number(args.config.quantity ?? 0);
    const entryPrice = Number(args.config.entryPrice ?? 0);
    if (!symbol || !(quantity > 0) || !(entryPrice > 0)) {
        return { status: "failed", error: "Symbol, a positive quantity and a positive entry price are required for a portfolio pre-check." };
    }

    const allocation = computeAllocation({
        portfolioId: bundle.portfolio.portfolioId,
        method: "EQUAL",
        inputs: bundle.strategyIntelligence.strategies.map((s) => ({
            strategyId: s.strategyId,
            currentWeight: s.equityWeight,
            pnlContribution: s.unrealizedPnL,
            volatility: null,
            maxDrawdownPercent: s.maxDrawdownPercent,
            oosSharpe: s.oosSharpe,
            sampleSize: s.sampleSize,
            correlationToPortfolio: s.correlationToPortfolio,
            health: s.health,
            active: s.active,
        })),
        calculatedAt: Date.now(),
    });

    const precheck = runTradePreCheck({
        portfolioId: bundle.portfolio.portfolioId,
        trade: {
            symbol,
            side: String(args.config.side || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG",
            quantity,
            entryPrice,
            stopLoss: args.config.stopLoss !== undefined && args.config.stopLoss !== "" ? Number(args.config.stopLoss) : null,
            strategyId: args.config.strategyId ? String(args.config.strategyId) : undefined,
        },
        exposure: bundle.snapshot.exposure,
        concentration: bundle.snapshot.concentration,
        correlation: bundle.snapshot.correlation,
        correlationMatrixSymbols: bundle.matrix?.symbols ?? null,
        correlationMatrix: bundle.matrix?.matrix ?? null,
        risk: bundle.snapshot.risk,
        riskBudgetUsage: bundle.snapshot.riskBudgetUsage,
        equity: bundle.snapshot.equity,
        leverage: bundle.snapshot.leverage,
        contractSize: contractSizeOf(symbol),
        positions: bundle.snapshot.positions,
        allocation,
        freshness: bundle.snapshot.freshness,
        now: Date.now(),
        contractSizeOf,
    });

    return {
        status: precheck.verdict === "TRADE_BLOCKED" ? "failed" : "success",
        output: {
            verdict: precheck.verdict,
            individualTradeRisk: precheck.individualTradeRisk,
            portfolioImpact: precheck.portfolioImpact,
            reasons: precheck.reasons,
            decisionId: precheck.decision.decisionId,
            dataTimestamp: precheck.dataTimestamp,
            limitations: precheck.decision.limitations,
        },
        error: precheck.verdict === "TRADE_BLOCKED" ? `Portfolio blocked the trade: ${precheck.blockingReasons.join(" ")}` : undefined,
    };
}

export async function portfolioReduceRiskNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const bundle = await bundleFor(args);
    const strategyId = args.config.strategyId ? String(args.config.strategyId) : null;
    const reason = String(args.config.reason || "Portfolio risk condition triggered.");

    const recommendation = {
        artifactId: `wf_reduce_${args.run.id.slice(-10)}_${args.node.id.slice(0, 8)}`,
        type: "REDUCE_RISK",
        portfolioId: bundle.portfolio.portfolioId,
        strategyId,
        reason,
        currentRiskScore: bundle.snapshot.portfolioRiskScore,
        breaches: bundle.snapshot.risk.riskBudgetUsage.filter((u) => u.status !== "OK"),
        // Structural guarantee: a workflow can emit this artifact but can never
        // act on it. Applying it requires the user plus the existing gates.
        requiresApproval: true,
        executable: false,
        dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
        limitations: [
            "This node produces a recommendation artifact only. It does not close, resize or pause anything.",
        ],
    };

    await writeJournalEntry(args.uid, bundle.portfolio.portfolioId, {
        portfolioId: bundle.portfolio.portfolioId,
        type: "RISK_WARNING",
        whatAlgoVaultRecommended: `Reduce risk${strategyId ? ` for ${strategyId}` : ""}: ${reason}`,
        whatTheUserDid: "Pending — recommendation raised, no action taken.",
        whatHappenedAfter: null,
        evidenceAtDecision: bundle.snapshot.risk.riskBudgetUsage
            .filter((u) => u.status !== "OK")
            .map((u) => ({
                id: u.budgetId,
                kind: "CALCULATED" as const,
                source: "portfolio-risk-budget-engine",
                detail: `${u.kind} ${u.usedPercent}% of ${u.limitPercent}%`,
                value: u.usedPercent,
            })),
        outcomeAssessment: "PENDING",
        createdAt: Date.now(),
        dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
    });

    return { status: "success", output: recommendation };
}

export async function portfolioRequestApprovalNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const bundle = await bundleFor(args);
    const summary = String(args.config.summary || "Portfolio change requires approval.");
    return {
        status: "success",
        output: {
            artifactId: `wf_approval_${args.run.id.slice(-10)}_${args.node.id.slice(0, 8)}`,
            type: "PORTFOLIO_CHANGE_REQUEST",
            portfolioId: bundle.portfolio.portfolioId,
            summary,
            requiresApproval: true,
            permissionRequired: "USER_CONFIRMATION",
            automationMode: bundle.portfolio.automationMode,
            dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
            limitations: [
                "Approval requests are advisory artifacts. Automation mode never authorises live capital movement on its own.",
            ],
        },
    };
}

export async function portfolioJournalNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    const bundle = await bundleFor(args);
    const entryId = await writeJournalEntry(args.uid, bundle.portfolio.portfolioId, {
        portfolioId: bundle.portfolio.portfolioId,
        type: String(args.config.type || "PORTFOLIO_DECISION") as PortfolioJournalEntry["type"],
        whatAlgoVaultRecommended: String(args.config.recommended || ""),
        whatTheUserDid: String(args.config.userDid || "Not recorded."),
        whatHappenedAfter: null,
        evidenceAtDecision: [],
        outcomeAssessment: "PENDING",
        createdAt: Date.now(),
        dataTimestamp: bundle.snapshot.freshness.dataTimestamp,
    });
    return { status: "success", output: { entryId, portfolioId: bundle.portfolio.portfolioId } };
}

/**
 * Dispatch a portfolio node. Registered in the canonical executor switch.
 */
export async function executePortfolioNode(type: string, args: NodeExecutionArgs): Promise<NodeExecutionResult> {
    switch (type) {
        case "portfolio.snapshot":
            return portfolioSnapshotNode(args);
        case "portfolio.correlation":
            return portfolioCorrelationNode(args);
        case "portfolio.concentration":
            return portfolioConcentrationNode(args);
        case "portfolio.stress_test":
            return portfolioStressNode(args);
        case "portfolio.allocation_recommendation":
            return portfolioAllocationNode(args);
        case "portfolio.trade_precheck":
            return portfolioTradePreCheckNode(args);
        case "portfolio.reduce_risk":
            return portfolioReduceRiskNode(args);
        case "portfolio.request_approval":
            return portfolioRequestApprovalNode(args);
        case "portfolio.journal_entry":
            return portfolioJournalNode(args);
        default:
            return { status: "failed", error: `Unknown portfolio node type "${type}".` };
    }
}
