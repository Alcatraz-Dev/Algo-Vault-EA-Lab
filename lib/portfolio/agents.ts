/**
 * AlgoVault — Portfolio Intelligence agent team (Phase 15 §22/§23).
 *
 * EXTENDS the Phase 14 Agentic Trading Intelligence runtime. There is no second
 * agent architecture here: every portfolio agent is an `AgentDefinition` in the
 * canonical registry, runs on the canonical `AgentRuntime`, uses canonical
 * tools, and is governed by the canonical permission ladder.
 *
 * Portfolio agents DEFAULT TO `read_only`. Recommendations are produced
 * automatically; anything that touches allocation, risk limits, strategy
 * activation, live positions, live orders or account configuration requires an
 * explicitly higher permission (Phase 15 §24).
 */

import type { AgentDefinition, AgentPermission, AgentRiskLevel } from "@/lib/agentic-trading-intelligence/contracts";
import { computeAllocation, recommendAllocation } from "./allocation";
import { contractSizeOf } from "./instruments";
import { runStressTests, defaultScenarios } from "./stress";
import type {
    AgentPermissionLevel,
    PortfolioAgentRun,
    PortfolioAgentTeamResult,
    PortfolioAllocationRecommendation,
    PortfolioDecision,
    PortfolioDecisionEvidence,
    PortfolioSnapshot,
    PortfolioStrategyIntelligence,
    PortfolioWarning,
} from "./types";
import { PORTFOLIO_ENGINE_VERSIONS } from "./versioning";

/* ── Canonical agent definitions ──────────────────────────────────────────── */

/** Permissions a portfolio agent may hold, mapped onto the Phase 14 vocabulary. */
export const PORTFOLIO_AGENT_PERMISSIONS: Record<string, AgentPermission> = {
    READ_ONLY: "risk_read",
    LOW_RISK: "risk_recommend",
    USER_CONFIRMATION: "user_confirm",
    HIGH_RISK: "strategy_pause",
    LIVE_TRADING: "execution_submit",
};

export const PORTFOLIO_AGENTS: AgentDefinition[] = [
    {
        id: "portfolio-analyst",
        name: "Portfolio Analyst Agent",
        version: "1.0.0",
        description:
            "Analyses the overall portfolio state from the canonical snapshot: equity, exposure, risk budgets, concentration and health components.",
        capabilities: ["portfolio_state", "exposure_review", "budget_review", "health_review"],
        allowedTools: ["get_portfolio_snapshot", "get_portfolio_exposure", "get_portfolio_risk", "get_portfolio_health"],
        permissions: ["risk_read"],
        riskLevel: "read_only",
        maxRuntimeMs: 30_000,
        maxCostPerRunCents: 5,
        maxActionsPerRun: 10,
    },
    {
        id: "portfolio-correlation",
        name: "Correlation Agent",
        version: "1.0.0",
        description:
            "Reads the deterministic correlation matrix, detects cross-asset relationships, clusters and regime shifts. Never invents a correlation.",
        capabilities: ["correlation_matrix", "clustering", "shift_detection"],
        allowedTools: ["get_portfolio_correlation", "get_portfolio_snapshot"],
        permissions: ["risk_read", "market_read"],
        riskLevel: "read_only",
        maxRuntimeMs: 30_000,
        maxCostPerRunCents: 5,
        maxActionsPerRun: 10,
    },
    {
        id: "portfolio-risk",
        name: "Portfolio Risk Agent",
        version: "1.0.0",
        description:
            "Monitors risk budgets, concentration, margin, drawdown and daily loss, and classifies proposed trades against the portfolio state.",
        capabilities: ["budget_monitoring", "concentration_monitoring", "trade_precheck", "supervision"],
        allowedTools: [
            "get_portfolio_snapshot",
            "get_portfolio_risk",
            "get_portfolio_concentration",
            "precheck_trade",
        ],
        permissions: ["risk_read", "risk_recommend", "alert_create"],
        riskLevel: "read_only",
        maxRuntimeMs: 30_000,
        maxCostPerRunCents: 5,
        maxActionsPerRun: 10,
    },
    {
        id: "capital-allocation",
        name: "Capital Allocation Agent",
        version: "1.0.0",
        description:
            "Produces allocation recommendations (INCREASE / MAINTAIN / REDUCE / PAUSE / REVIEW) from measured strategy evidence. Never moves capital.",
        capabilities: ["allocation", "recommendation", "constraint_checking"],
        allowedTools: ["get_portfolio_strategies", "recommend_allocation"],
        permissions: ["strategy_read", "risk_read", "research_read"],
        riskLevel: "read_only",
        maxRuntimeMs: 60_000,
        maxCostPerRunCents: 10,
        maxActionsPerRun: 20,
    },
    {
        id: "portfolio-stress",
        name: "Stress Test Agent",
        version: "1.0.0",
        description:
            "Runs deterministic portfolio scenarios (volatility expansion, correlation spike, drawdown shock, …) and reports measured impacts with explicit historical/simulated provenance.",
        capabilities: ["stress_testing", "scenario_analysis"],
        allowedTools: ["get_portfolio_snapshot", "run_portfolio_stress"],
        permissions: ["risk_read", "research_launch"],
        riskLevel: "read_only",
        maxRuntimeMs: 120_000,
        maxCostPerRunCents: 20,
        maxActionsPerRun: 20,
    },
    {
        id: "portfolio-review",
        name: "Portfolio Review Agent",
        version: "1.0.0",
        description:
            "Produces a periodic, structured portfolio review: what changed, what is measured, what is uncertain, and what deserves review.",
        capabilities: ["review", "change_detection", "summary"],
        allowedTools: ["get_portfolio_snapshot", "get_portfolio_health", "get_portfolio_strategies", "get_portfolio_journal"],
        permissions: ["risk_read", "strategy_read", "journal_read"],
        riskLevel: "read_only",
        maxRuntimeMs: 60_000,
        maxCostPerRunCents: 10,
        maxActionsPerRun: 20,
    },
    {
        id: "portfolio-supervisor",
        name: "Portfolio Supervisor Agent",
        version: "1.0.0",
        description:
            "Coordinates the portfolio agents, preserves disagreements between them, and synthesises one auditable recommendation set. Defaults to read-only.",
        capabilities: ["coordination", "synthesis", "escalation"],
        allowedTools: ["orchestrate_agents", "get_portfolio_snapshot", "get_portfolio_risk", "recommend_allocation"],
        permissions: ["risk_read", "strategy_read", "risk_recommend"],
        riskLevel: "read_only",
        maxRuntimeMs: 120_000,
        maxCostPerRunCents: 20,
        maxActionsPerRun: 30,
    },
];

export function getPortfolioAgent(id: string): AgentDefinition | undefined {
    return PORTFOLIO_AGENTS.find((a) => a.id === id);
}

/** Highest permission any portfolio agent may hold by default. */
export const DEFAULT_PORTFOLIO_AGENT_PERMISSION: AgentPermissionLevel = "READ_ONLY";

/* ── Agent implementations (deterministic) ───────────────────────────────── */

export interface AgentContext {
    snapshot: PortfolioSnapshot;
    strategyIntelligence: PortfolioStrategyIntelligence;
    previous?: PortfolioSnapshot | null;
    now: number;
    /** Optional pre-computed artefacts so the supervisor never recomputes. */
    stressResult?: ReturnType<typeof runStressTests> | null;
    allocation?: PortfolioAllocationRecommendation[] | null;
    decisions?: PortfolioDecision[];
}

function evidence(
    id: string,
    kind: PortfolioDecisionEvidence["kind"],
    source: string,
    detail: string,
    value?: number | string
): PortfolioDecisionEvidence {
    return { id, kind, source, detail, value, engine: PORTFOLIO_ENGINE_VERSIONS["portfolio-contract"] };
}

function run(
    agentId: string,
    ctx: AgentContext,
    body: {
        summary: string;
        confidence: number;
        findings: PortfolioAgentRun["findings"];
        limitations?: string[];
    }
): PortfolioAgentRun {
    const definition = getPortfolioAgent(agentId);
    return {
        runId: `${ctx.snapshot.portfolioId}:${agentId}:${ctx.now}`,
        portfolioId: ctx.snapshot.portfolioId,
        agentId,
        agentVersion: definition?.version ?? "1.0.0",
        status: "success",
        permission: DEFAULT_PORTFOLIO_AGENT_PERMISSION,
        summary: body.summary,
        confidence: Math.round(Math.max(0, Math.min(1, body.confidence)) * 100) / 100,
        findings: body.findings,
        evidence: body.findings.map((f) => ({ id: f.id, source: agentId, value: f.title, note: f.detail })),
        limitations: body.limitations ?? [],
        startedAt: ctx.now,
        completedAt: ctx.now,
        dataTimestamp: ctx.snapshot.freshness.dataTimestamp,
    };
}

/* Portfolio Analyst ---------------------------------------------------------- */

export function portfolioAnalystAgent(ctx: AgentContext): PortfolioAgentRun {
    const s = ctx.snapshot;
    const findings: PortfolioAgentRun["findings"] = [];
    const ev: PortfolioDecisionEvidence[] = [];

    ev.push(
        evidence("analyst:equity", "OBSERVED", "portfolio-snapshot", `Equity ${s.equity.toFixed(2)} ${s.baseCurrency} across ${s.accounts.length} account(s).`, s.equity),
        evidence("analyst:exposure", "CALCULATED", "portfolio-exposure-engine", `Gross notional ${s.grossExposure.toFixed(2)}, net ${s.netExposure.toFixed(2)}, ${s.positionCount} open position(s).`, s.grossExposure),
        evidence("analyst:health", "CALCULATED", "portfolio-health-engine", `Overall health ${s.health.overall}.`, s.health.overall)
    );

    findings.push({
        id: "analyst:state",
        title: "Portfolio state",
        detail: `Equity ${s.equity.toFixed(2)} ${s.baseCurrency}; ${s.positionCount} position(s) across ${s.strategyCount} strategy bucket(s) and ${s.assetCount} asset class(es).`,
        evidence: ["analyst:equity", "analyst:exposure"],
    });

    const topSymbol = s.exposure.bySymbol[0];
    if (topSymbol) {
        findings.push({
            id: "analyst:top_symbol",
            title: "Largest exposure",
            detail: `${topSymbol.key} is ${(topSymbol.grossWeight * 100).toFixed(1)}% of gross exposure across ${topSymbol.positionCount} position(s).`,
            evidence: ["analyst:exposure"],
        });
    }

    const critical = s.health.components.filter((c) => c.rating === "CRITICAL" || c.rating === "WARNING");
    for (const c of critical) {
        findings.push({
            id: `analyst:health:${c.component.toLowerCase()}`,
            title: `${c.component} is ${c.rating}`,
            detail: c.reasons.join(" "),
            evidence: c.evidence,
        });
    }

    return run("portfolio-analyst", ctx, {
        summary: `Portfolio overall health is ${s.health.overall}. ${s.positionCount} open position(s), gross notional ${s.grossExposure.toFixed(2)} ${s.baseCurrency}.`,
        confidence: s.freshness.freshness === "FRESH" ? 0.85 : 0.45,
        findings,
        limitations: s.limitations.slice(0, 3),
    });
}

/* Correlation Agent ---------------------------------------------------------- */

export function portfolioCorrelationAgent(ctx: AgentContext): PortfolioAgentRun {
    const s = ctx.snapshot;
    const findings: PortfolioAgentRun["findings"] = [];

    if (!s.correlationMatrix || s.correlationMatrix.pairs.length === 0) {
        return run("portfolio-correlation", ctx, {
            summary: "Correlation is UNAVAILABLE — no aligned price history was available for the held symbols.",
            confidence: 0,
            findings: [
                {
                    id: "correlation:unavailable",
                    title: "Correlation unavailable",
                    detail:
                        "A correlation value is never estimated. Without at least 20 aligned bars per pair, AlgoVault reports UNAVAILABLE rather than zero.",
                    evidence: [],
                },
            ],
            limitations: s.correlationMatrix?.limitations ?? [],
        });
    }

    findings.push({
        id: "correlation:matrix",
        title: "Correlation matrix",
        detail: `${s.correlationMatrix.pairs.length} pair(s) measured over ${s.correlationMatrix.window} × ${s.correlationMatrix.timeframe} bars (${s.correlationMatrix.method}).`,
        evidence: ["correlation:matrix"],
    });

    for (const cluster of s.correlation.clusters.slice(0, 3)) {
        findings.push({
            id: `correlation:cluster:${cluster.symbols.join("-")}`,
            title: `Cluster ${cluster.symbols.join(" + ")}`,
            detail: `Mean ρ ${cluster.meanCorrelation.toFixed(2)} across ${(cluster.exposureWeight * 100).toFixed(1)}% of gross exposure.`,
            evidence: ["correlation:matrix"],
        });
    }

    for (const shift of s.correlation.shiftingPairs.slice(0, 5)) {
        findings.push({
            id: `correlation:shift:${shift.pair}`,
            title: `${shift.pair} correlation shifted`,
            detail: `ρ ${shift.from.toFixed(2)} → ${shift.to.toFixed(2)} (Δ ${shift.delta.toFixed(2)}).`,
            evidence: ["correlation:matrix"],
        });
    }

    return run("portfolio-correlation", ctx, {
        summary:
            s.correlation.severity === "HIGH"
                ? `Correlated exposure is HIGH: ${s.correlation.clusterSize} same-direction positions at mean ρ ${s.correlation.meanCorrelation.toFixed(2)}.`
                : `Correlated exposure is ${s.correlation.severity.toLowerCase()} across ${s.correlation.clusters.length} cluster(s).`,
        confidence: 0.8,
        findings,
        limitations: s.correlation.limitations,
    });
}

/* Portfolio Risk Agent ------------------------------------------------------- */

export function portfolioRiskAgent(ctx: AgentContext): PortfolioAgentRun {
    const s = ctx.snapshot;
    const findings: PortfolioAgentRun["findings"] = [];

    for (const usage of s.riskBudgetUsage) {
        if (usage.status === "OK") continue;
        findings.push({
            id: `risk:budget:${usage.budgetId}`,
            title: `${usage.kind} budget ${usage.status}`,
            detail:
                usage.note ??
                `${usage.usedPercent}% of a ${usage.limitPercent}% budget consumed (${Math.round(usage.utilization * 100)}% used).`,
            evidence: ["risk:budgets"],
        });
    }

    if (s.risk.openRiskPercent !== null) {
        findings.push({
            id: "risk:open_risk",
            title: "Open risk at stop",
            detail: `${s.risk.openRiskPercent.toFixed(2)}% of equity is at risk to stop across ${s.positions.filter((p) => p.riskAmount !== null).length} position(s).`,
            evidence: ["risk:open_risk"],
        });
    }

    for (const w of s.risk.warnings) {
        if (w.severity === "WARNING" || w.severity === "CRITICAL") {
            findings.push({ id: `risk:warning:${w.code}`, title: w.code, detail: w.message, evidence: ["risk:warnings"] });
        }
    }

    return run("portfolio-risk", ctx, {
        summary:
            findings.length === 0
                ? "No risk budget is breached or near its limit."
                : `${findings.length} portfolio risk condition(s) require attention.`,
        confidence: s.freshness.freshness === "FRESH" ? 0.85 : 0.4,
        findings,
        limitations: s.risk.limitations,
    });
}

/* Capital Allocation Agent --------------------------------------------------- */

export function capitalAllocationAgent(ctx: AgentContext): PortfolioAgentRun {
    const s = ctx.snapshot;
    const recommendations = ctx.allocation ?? [];
    const findings = recommendations.map((r) => ({
        id: `allocation:${r.strategyId}`,
        title: `${r.strategyId}: ${r.action}`,
        detail: `${r.rationale[0] ?? "No rationale recorded."} Target weight ${(r.targetWeight * 100).toFixed(1)}% vs current ${(r.currentWeight * 100).toFixed(1)}%.`,
        evidence: r.evidence.map((e) => `${r.strategyId}:${e.metric}`),
    }));

    return run("capital-allocation", ctx, {
        summary: `${recommendations.length} allocation recommendation(s) produced. No capital was moved — recommendations require approval.`,
        confidence: recommendations.length > 0 ? 0.6 : 0.2,
        findings,
        limitations: [
            "Capital allocation is advisory. AlgoVault never moves live capital without explicit approval.",
            ...new Set(recommendations.flatMap((r) => r.limitations)),
        ].slice(0, 5),
    });
}

/* Stress Test Agent ---------------------------------------------------------- */

export function stressTestAgent(ctx: AgentContext): PortfolioAgentRun {
    const stress = ctx.stressResult ?? runStressTests({
        portfolioId: ctx.snapshot.portfolioId,
        positions: ctx.snapshot.positions,
        accounts: ctx.snapshot.accounts,
        equity: ctx.snapshot.equity,
        scenarios: defaultScenarios(),
        riskBudgets: ctx.snapshot.riskBudgetUsage.map((u) => ({ kind: u.kind, limitPercent: u.limitPercent, scopeKey: u.scopeKey })),
        generatedAt: ctx.now,
        dataTimestamp: ctx.snapshot.freshness.dataTimestamp,
    });

    const findings = stress.scenarios.map((r) => ({
        id: `stress:${r.scenario.scenarioId}`,
        title: `${r.scenario.name} (${r.scenario.basis})`,
        detail: `Equity ${r.equityBefore.toFixed(2)} → ${r.equityAfter.toFixed(2)} (${r.pnlImpactPercent.toFixed(2)}%) over ${r.affectedPositions.length} position(s).${r.breaches.length > 0 ? ` Breaches: ${r.breaches.join(" ")}` : ""}`,
        evidence: ["stress:deterministic"],
    }));

    return run("portfolio-stress", ctx, {
        summary: stress.worstCase
            ? `Worst scenario is "${stress.scenarios.find((s) => s.scenario.scenarioId === stress.worstCase?.scenarioId)?.scenario.name ?? stress.worstCase.scenarioId}" at ${stress.worstCase.pnlImpactPercent.toFixed(2)}% of equity.`
            : "No scenario produced an impact — the portfolio has no open positions.",
        confidence: stress.method === "HISTORICAL_REPLAY" ? 0.7 : 0.5,
        findings,
        limitations: stress.limitations,
    });
}

/* Portfolio Review Agent ------------------------------------------------------ */

export function portfolioReviewAgent(ctx: AgentContext): PortfolioAgentRun {
    const s = ctx.snapshot;
    const findings: PortfolioAgentRun["findings"] = [
        {
            id: "review:current",
            title: "Current state",
            detail: `Equity ${s.equity.toFixed(2)}, drawdown ${s.risk.drawdownPercent?.toFixed(2) ?? "unavailable"}%, regime ${s.regime} at ${(s.regimeState.confidence * 100).toFixed(0)}% confidence.`,
            evidence: ["review:snapshot"],
        },
    ];

    if (ctx.previous) {
        const equityDelta = s.equity - ctx.previous.equity;
        findings.push({
            id: "review:delta",
            title: "Change since last snapshot",
            detail: `Equity ${equityDelta >= 0 ? "+" : ""}${equityDelta.toFixed(2)}; positions ${ctx.previous.positionCount} → ${s.positionCount}; regime ${ctx.previous.regime} → ${s.regime}.`,
            evidence: ["review:snapshot", "review:previous"],
        });
    }

    const worst = s.health.components.reduce((a, b) =>
        (["GOOD", "WATCH", "WARNING", "CRITICAL", "UNKNOWN"].indexOf(b.rating) >
         ["GOOD", "WATCH", "WARNING", "CRITICAL", "UNKNOWN"].indexOf(a.rating)
            ? b
            : a)
    );
    findings.push({
        id: "review:focus",
        title: `Weakest component: ${worst.component}`,
        detail: worst.reasons.join(" ") || "No specific reason recorded.",
        evidence: worst.evidence,
    });

    if (ctx.strategyIntelligence.hiddenConcentrationDetected) {
        findings.push({
            id: "review:hidden_concentration",
            title: "Hidden strategy concentration",
            detail:
                "Two or more individually healthy strategies overlap materially. Each passes its own health check; together they behave as one position.",
            evidence: ctx.strategyIntelligence.overlaps.filter((o) => o.harmfulCombination).map((o) => `${o.a}:${o.b}:${o.kind}`),
        });
    }

    return run("portfolio-review", ctx, {
        summary: `Portfolio review: health ${s.health.overall}, ${s.risk.warnings.length} warning(s), regime ${s.regime}.`,
        confidence: 0.7,
        findings,
        limitations: ctx.previous ? ["Change detection compares only the previous stored snapshot."] : ["No previous snapshot exists, so no change detection was possible."],
    });
}

/* Portfolio Supervisor ------------------------------------------------------- */

export function portfolioSupervisorAgent(ctx: AgentContext): PortfolioAgentRun {
    const runs = [
        portfolioAnalystAgent(ctx),
        portfolioCorrelationAgent(ctx),
        portfolioRiskAgent(ctx),
        capitalAllocationAgent(ctx),
        stressTestAgent(ctx),
        portfolioReviewAgent(ctx),
    ];

    // Disagreements are preserved, not averaged away.
    const disagreements: string[] = [];
    const blocked = runs.find((r) => r.status === "blocked" || r.confidence < 0.3);
    if (blocked) disagreements.push(`${blocked.agentId} could not produce a confident read (${blocked.summary}).`);

    return run("portfolio-supervisor", ctx, {
        summary: `Coordinated ${runs.length} portfolio agents. ${ctx.snapshot.risk.warnings.length} warning(s) outstanding.`,
        confidence: runs.reduce((acc, r) => acc + r.confidence, 0) / runs.length,
        findings: [
            ...runs.map((r) => ({
                id: `supervisor:${r.agentId}`,
                title: r.agentId,
                detail: r.summary,
                evidence: r.findings.map((f) => f.id),
            })),
            ...disagreements.map((d, i) => ({
                id: `supervisor:disagreement:${i}`,
                title: "Preserved disagreement",
                detail: d,
                evidence: [] as string[],
            })),
        ],
        limitations: ["The supervisor synthesises; it never overrides the deterministic Risk Engine."],
    });
}

/* ── Team runner ──────────────────────────────────────────────────────────── */

export interface RunTeamInput extends AgentContext {
    /** Escalate every agent one rung. Still never LIVE_TRADING implicitly. */
    permission?: AgentPermissionLevel;
}

export function runPortfolioAgentTeam(input: RunTeamInput): PortfolioAgentTeamResult {
    const runs = [
        portfolioAnalystAgent(input),
        portfolioCorrelationAgent(input),
        portfolioRiskAgent(input),
        capitalAllocationAgent(input),
        stressTestAgent(input),
        portfolioReviewAgent(input),
    ];

    const permission = input.permission ?? DEFAULT_PORTFOLIO_AGENT_PERMISSION;
    const snapshot = input.snapshot;

    // Recommendations are auto-generated; applying them is never automatic.
    const recommendations =
        input.allocation ??
        recommendAllocation(
            computeAllocation({
                portfolioId: snapshot.portfolioId,
                method: "RISK_PARITY",
                inputs: input.strategyIntelligence.strategies.map((s) => ({
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
                calculatedAt: input.now,
            }),
            input.strategyIntelligence,
            { now: input.now }
        );

    const warnings: PortfolioWarning[] = snapshot.risk.warnings;

    return {
        portfolioId: snapshot.portfolioId,
        generatedAt: input.now,
        dataTimestamp: snapshot.freshness.dataTimestamp,
        agents: [...runs, portfolioSupervisorAgent(input)],
        recommendations,
        decisions: input.decisions ?? [],
        warnings,
        permissionRequired: permission === "READ_ONLY" ? "USER_CONFIRMATION" : permission,
        requiresApproval: true,
        limitations: [
            "Every portfolio agent runs read-only by default. Recommendations are never execution instructions.",
            "AlgoVault never moves live capital automatically: no agent may rebalance a live portfolio, move capital, or change risk limits without explicit user approval and the existing Risk Engine + Execution Supervisor gates.",
        ],
    };
}

/** Map a portfolio permission level onto the Phase 14 agent risk ladder. */
export function toAgentRiskLevel(level: AgentPermissionLevel): AgentRiskLevel {
    switch (level) {
        case "READ_ONLY":
            return "read_only";
        case "LOW_RISK":
            return "low_risk";
        case "USER_CONFIRMATION":
            return "user_confirmation";
        case "HIGH_RISK":
            return "high_risk";
        case "LIVE_TRADING":
            return "live_trading";
        default:
            return "read_only";
    }
}

/** Contract size lookup exposed to tools without importing the registry twice. */
export { contractSizeOf };
