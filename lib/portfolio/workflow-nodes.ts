/**
 * AlgoVault — Portfolio workflow nodes (Phase 15 §35).
 *
 * EXTENDS the existing Workflow Automation engine. There is no second workflow
 * builder: these node definitions are merged into the canonical node registry
 * and dispatched by the canonical executor switch.
 *
 * Safety rules baked into the nodes themselves:
 *   • every node is `analysis` permission — none of them can place an order;
 *   • `portfolio.reduce_risk` only produces a RECOMMENDATION and always emits
 *     `requiresApproval: true`;
 *   • `portfolio.pause_strategy` is the only state-changing node and it routes
 *     through the existing pause_strategy agent action, never directly.
 */

import type { WorkflowNodeDefinition } from "@/lib/workflows/types";

export const PORTFOLIO_WORKFLOW_NODES: WorkflowNodeDefinition[] = [
    /* ─── Triggers ──────────────────────────────────────────────────────── */
    {
        type: "trigger.portfolio",
        category: "trigger",
        name: "Portfolio Event Trigger",
        description:
            "Fires when a measured portfolio threshold is crossed: risk, correlation, concentration, drawdown, margin, allocation change, regime change or health degradation.",
        permission: "none",
        configSchema: [
            { key: "portfolioId", label: "Portfolio", type: "string", default: "primary" },
            {
                key: "metric",
                label: "Metric",
                type: "select",
                required: true,
                options: [
                    { value: "portfolioRiskScore", label: "Portfolio risk score" },
                    { value: "grossToEquity", label: "Gross exposure / equity" },
                    { value: "concentrationScore", label: "Concentration score (HHI)" },
                    { value: "correlationRiskScore", label: "Correlated cluster weight" },
                    { value: "drawdownPercent", label: "Drawdown %" },
                    { value: "marginLevelPercent", label: "Margin level %" },
                    { value: "allocationChanged", label: "Strategy allocation changed" },
                    { value: "regime", label: "Regime changed" },
                    { value: "health", label: "Portfolio health degraded" },
                ],
                default: "portfolioRiskScore",
            },
            {
                key: "operator",
                label: "Operator",
                type: "select",
                options: [
                    { value: "gt", label: "Greater than" },
                    { value: "gte", label: "Greater or equal" },
                    { value: "lt", label: "Less than" },
                    { value: "lte", label: "Less or equal" },
                    { value: "eq", label: "Equals" },
                ],
                default: "gt",
            },
            { key: "value", label: "Threshold", type: "number", required: true, default: 2 },
        ],
        defaults: { portfolioId: "primary", metric: "portfolioRiskScore", operator: "gt", value: 2 },
    },
    /* ─── Portfolio reads ────────────────────────────────────────────────── */
    {
        type: "portfolio.snapshot",
        category: "integration",
        name: "Portfolio Snapshot",
        description:
            "Reads the canonical deterministic portfolio snapshot: equity, PnL, exposure, margin, drawdown, regime and health components.",
        permission: "analysis",
        configSchema: [
            { key: "portfolioId", label: "Portfolio", type: "string", default: "primary" },
            { key: "timeframe", label: "Correlation timeframe", type: "select", options: [
                { value: "M15", label: "15 min" }, { value: "H1", label: "1 hour" },
                { value: "H4", label: "4 hours" }, { value: "D1", label: "Daily" },
            ], default: "H1" },
        ],
        defaults: { portfolioId: "primary", timeframe: "H1" },
        timeoutMs: 20_000,
        rateLimitPerMinute: 30,
    },
    {
        type: "portfolio.correlation",
        category: "integration",
        name: "Portfolio Correlation",
        description:
            "Reads the deterministic correlation matrix and correlated-cluster weight. Returns UNAVAILABLE when no aligned history exists.",
        permission: "analysis",
        configSchema: [{ key: "portfolioId", label: "Portfolio", type: "string", default: "primary" }],
        defaults: { portfolioId: "primary" },
        timeoutMs: 20_000,
        rateLimitPerMinute: 20,
    },
    {
        type: "portfolio.concentration",
        category: "integration",
        name: "Portfolio Concentration",
        description: "Reads concentration per axis (symbol, asset class, strategy, direction, currency, account) with HHI and effective bet count.",
        permission: "analysis",
        configSchema: [{ key: "portfolioId", label: "Portfolio", type: "string", default: "primary" }],
        defaults: { portfolioId: "primary" },
        timeoutMs: 20_000,
        rateLimitPerMinute: 30,
    },
    /* ─── Portfolio analysis ─────────────────────────────────────────────── */
    {
        type: "portfolio.stress_test",
        category: "simulation",
        name: "Portfolio Stress Test",
        description:
            "Runs deterministic portfolio scenarios and returns measured impact with explicit historical/simulated provenance.",
        permission: "analysis",
        configSchema: [
            { key: "portfolioId", label: "Portfolio", type: "string", default: "primary" },
            { key: "kind", label: "Scenario", type: "select", options: [
                { value: "VOLATILITY_EXPANSION", label: "Volatility expansion" },
                { value: "SPREAD_WIDENING", label: "Spread widening" },
                { value: "SLIPPAGE_INCREASE", label: "Slippage increase" },
                { value: "CORRELATION_SPIKE", label: "Correlation spike" },
                { value: "DRAWDOWN_SHOCK", label: "Drawdown shock" },
                { value: "ADVERSE_TREND", label: "Adverse trend continuation" },
                { value: "LIQUIDITY_REDUCTION", label: "Liquidity reduction" },
            ], default: "CORRELATION_SPIKE" },
        ],
        defaults: { portfolioId: "primary", kind: "CORRELATION_SPIKE" },
        timeoutMs: 30_000,
        rateLimitPerMinute: 10,
    },
    {
        type: "portfolio.allocation_recommendation",
        category: "reports",
        name: "Capital Allocation Recommendation",
        description:
            "Produces INCREASE / MAINTAIN / REDUCE / PAUSE / REVIEW recommendations. Advisory only — never moves capital.",
        permission: "analysis",
        configSchema: [
            { key: "portfolioId", label: "Portfolio", type: "string", default: "primary" },
            { key: "method", label: "Method", type: "select", options: [
                { value: "RISK_PARITY", label: "Risk parity" },
                { value: "EQUAL", label: "Equal" },
                { value: "RISK_BASED", label: "Risk based (OOS Sharpe)" },
                { value: "VOLATILITY_ADJUSTED", label: "Volatility adjusted" },
            ], default: "RISK_PARITY" },
        ],
        defaults: { portfolioId: "primary", method: "RISK_PARITY" },
        timeoutMs: 30_000,
        rateLimitPerMinute: 10,
    },
    {
        type: "portfolio.trade_precheck",
        category: "risk",
        name: "Portfolio Trade Pre-Check",
        description:
            "Classifies a proposed trade against the portfolio: incremental exposure, risk, correlation, concentration, margin and drawdown impact.",
        permission: "analysis",
        configSchema: [
            { key: "portfolioId", label: "Portfolio", type: "string", default: "primary" },
            { key: "symbol", label: "Symbol", type: "string", required: true, placeholder: "XAUUSD" },
            { key: "side", label: "Side", type: "select", options: [
                { value: "LONG", label: "Long" }, { value: "SHORT", label: "Short" },
            ], default: "LONG" },
            { key: "quantity", label: "Lots", type: "number", required: true, default: 0.1 },
            { key: "entryPrice", label: "Entry", type: "number", required: true },
            { key: "stopLoss", label: "Stop loss", type: "number" },
            { key: "strategyId", label: "Strategy", type: "string" },
        ],
        defaults: { portfolioId: "primary", symbol: "XAUUSD", side: "LONG", quantity: 0.1 },
        timeoutMs: 20_000,
        rateLimitPerMinute: 60,
    },
    /* ─── Portfolio actions (recommendations only) ───────────────────────── */
    {
        type: "portfolio.reduce_risk",
        category: "signal",
        name: "Reduce Risk Recommendation",
        description:
            "Emits a REDUCE_RISK recommendation for review. Never closes or resizes a live position — it produces an artifact that requires approval.",
        permission: "signal",
        configSchema: [
            { key: "portfolioId", label: "Portfolio", type: "string", default: "primary" },
            { key: "strategyId", label: "Strategy (optional)", type: "string" },
            { key: "reason", label: "Reason", type: "string", required: true },
        ],
        defaults: { portfolioId: "primary", reason: "Portfolio risk budget exceeded" },
        noExecInTest: true,
    },
    {
        type: "portfolio.request_approval",
        category: "signal",
        name: "Request Portfolio Approval",
        description: "Raises a portfolio change for explicit user approval through the existing approval workflow.",
        permission: "signal",
        configSchema: [
            { key: "portfolioId", label: "Portfolio", type: "string", default: "primary" },
            { key: "summary", label: "Summary", type: "string", required: true },
        ],
        defaults: { portfolioId: "primary", summary: "Portfolio change requires approval" },
        noExecInTest: true,
    },
    {
        type: "portfolio.journal_entry",
        category: "storage",
        name: "Portfolio Journal Entry",
        description: "Appends an entry to the portfolio journal recording what AlgoVault recommended, what the user did, and what happened next.",
        permission: "analysis",
        configSchema: [
            { key: "portfolioId", label: "Portfolio", type: "string", default: "primary" },
            { key: "type", label: "Entry type", type: "select", options: [
                { value: "PORTFOLIO_DECISION", label: "Portfolio decision" },
                { value: "RISK_WARNING", label: "Risk warning" },
                { value: "STRESS_TEST", label: "Stress test" },
                { value: "STRATEGY_INTERACTION", label: "Strategy interaction" },
                { value: "REGIME_CHANGE", label: "Regime change" },
                { value: "USER_OVERRIDE", label: "User override" },
            ], default: "PORTFOLIO_DECISION" },
            { key: "recommended", label: "What AlgoVault recommended", type: "string", required: true },
            { key: "userDid", label: "What the user did", type: "string" },
        ],
        defaults: { portfolioId: "primary", type: "PORTFOLIO_DECISION" },
    },
];

export const PORTFOLIO_WORKFLOW_NODE_TYPES = PORTFOLIO_WORKFLOW_NODES.map((n) => n.type);
