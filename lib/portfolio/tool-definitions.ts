/**
 * AlgoVault — Portfolio tool definitions (Phase 15 §22).
 *
 * EXTENDS the canonical Phase 14 Agent Tool Registry in
 * `@/lib/agentic-trading-intelligence/tool-registry`. These are declared with
 * the same `ToolDefinition` shape and merged into `TOOL_DEFINITIONS` there, so
 * there is exactly ONE tool registry in the platform.
 *
 * Every portfolio tool is `read_only` and guarded by the stale-data guard: a
 * tool that cannot see fresh state must not be able to authorise anything.
 */

import type { AgentPermission, AgentRiskLevel, ToolSchema } from "@/lib/agentic-trading-intelligence/contracts";

/**
 * Structurally identical to the canonical `ToolDefinition`, declared locally
 * with the guard flags required (not optional) so merging these into the
 * canonical registry cannot widen a guard by accident.
 */
export interface PortfolioToolDefinition {
    name: string;
    description: string;
    schema: ToolSchema;
    permission: AgentPermission;
    riskLevel: AgentRiskLevel;
    inputValidation: {
        required: string[];
        typeChecks: Record<string, "string" | "number" | "boolean" | "enum" | "object" | "array">;
        staleDataGuard: boolean;
        permissionGuard: boolean;
        idempotencyKeyRequired: boolean;
    };
    outputSchema: ToolSchema;
}

const snapshotOutput: ToolSchema = {
    type: "object",
    properties: {
        portfolioId: { type: "string" },
        equity: { type: "number" },
        grossExposure: { type: "number" },
        netExposure: { type: "number" },
        concentrationScore: { type: "number" },
        correlationRiskScore: { type: "number" },
        portfolioRiskScore: { type: "number" },
        regime: { type: "enum", enum: ["NORMAL", "TRENDING", "RANGE", "HIGH_VOLATILITY", "LOW_VOLATILITY", "RISK_ON", "RISK_OFF", "CORRELATION_BREAK", "LIQUIDITY_STRESS", "UNKNOWN"] },
        dataTimestamp: { type: "number" },
        freshness: { type: "enum", enum: ["FRESH", "STALE", "UNAVAILABLE"] },
    },
};

const portfolioIdSchema: ToolSchema = {
    type: "object",
    properties: { portfolioId: { type: "string" } },
    required: ["portfolioId"],
};

export const PORTFOLIO_TOOL_DEFINITIONS: PortfolioToolDefinition[] = [
    {
        name: "get_portfolio_snapshot",
        description:
            "Read the canonical deterministic portfolio snapshot: equity, PnL, exposure, margin, drawdown, risk budgets, regime and health components.",
        schema: portfolioIdSchema,
        permission: "risk_read",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId"],
            typeChecks: { portfolioId: "string" },
            staleDataGuard: true,
            permissionGuard: true,
            idempotencyKeyRequired: false,
        },
        outputSchema: snapshotOutput,
    },
    {
        name: "get_portfolio_exposure",
        description:
            "Read the deterministic exposure breakdown: gross, net, and slices by symbol, asset class, currency, direction, strategy and account.",
        schema: portfolioIdSchema,
        permission: "risk_read",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId"],
            typeChecks: { portfolioId: "string" },
            staleDataGuard: true,
            permissionGuard: true,
            idempotencyKeyRequired: false,
        },
        outputSchema: {
            type: "object",
            properties: {
                grossExposure: { type: "number" },
                netExposure: { type: "number" },
                bySymbol: { type: "array" },
                byAssetClass: { type: "array" },
                byCurrency: { type: "array" },
                byStrategy: { type: "array" },
                byDirection: { type: "array" },
            },
        },
    },
    {
        name: "get_portfolio_risk",
        description: "Read portfolio risk budgets, utilization, warnings, drawdown, daily loss and margin level.",
        schema: portfolioIdSchema,
        permission: "risk_read",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId"],
            typeChecks: { portfolioId: "string" },
            staleDataGuard: true,
            permissionGuard: true,
            idempotencyKeyRequired: false,
        },
        outputSchema: {
            type: "object",
            properties: { openRiskPercent: { type: "number" }, drawdownPercent: { type: "number" }, riskBudgetUsage: { type: "array" }, warnings: { type: "array" } },
        },
    },
    {
        name: "get_portfolio_correlation",
        description:
            "Read the deterministic correlation matrix and portfolio correlation risk. Returns UNAVAILABLE rather than an estimated coefficient.",
        schema: portfolioIdSchema,
        permission: "risk_read",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId"],
            typeChecks: { portfolioId: "string" },
            staleDataGuard: true,
            permissionGuard: true,
            idempotencyKeyRequired: false,
        },
        outputSchema: { type: "object", properties: { matrix: { type: "array" }, pairs: { type: "array" }, severity: { type: "string" }, limitations: { type: "array" } } },
    },
    {
        name: "get_portfolio_concentration",
        description: "Read the deterministic concentration breakdown (HHI, top share, effective bet count) per axis.",
        schema: portfolioIdSchema,
        permission: "risk_read",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId"],
            typeChecks: { portfolioId: "string" },
            staleDataGuard: true,
            permissionGuard: true,
            idempotencyKeyRequired: false,
        },
        outputSchema: { type: "object", properties: { axes: { type: "array" }, concentrationScore: { type: "number" }, severity: { type: "string" } } },
    },
    {
        name: "get_portfolio_strategies",
        description: "Read per-strategy portfolio state: exposure, PnL, drawdown, health, OOS Sharpe and overlaps with other strategies.",
        schema: portfolioIdSchema,
        permission: "strategy_read",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId"],
            typeChecks: { portfolioId: "string" },
            staleDataGuard: true,
            permissionGuard: true,
            idempotencyKeyRequired: false,
        },
        outputSchema: { type: "object", properties: { strategies: { type: "array" }, overlaps: { type: "array" }, hiddenConcentrationDetected: { type: "boolean" } } },
    },
    {
        name: "get_portfolio_health",
        description: "Read the nine portfolio health components with their individual ratings, scores and reasons.",
        schema: portfolioIdSchema,
        permission: "risk_read",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId"],
            typeChecks: { portfolioId: "string" },
            staleDataGuard: true,
            permissionGuard: true,
            idempotencyKeyRequired: false,
        },
        outputSchema: { type: "object", properties: { components: { type: "array" }, overall: { type: "string" }, worstComponents: { type: "array" } } },
    },
    {
        name: "get_portfolio_journal",
        description: "Read recorded portfolio journal entries: what AlgoVault recommended, what the user did, and what happened next.",
        schema: {
            type: "object",
            properties: { portfolioId: { type: "string" }, limit: { type: "number" } },
            required: ["portfolioId"],
        },
        permission: "journal_read",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId"],
            typeChecks: { portfolioId: "string", limit: "number" },
            // Journal entries are an immutable historical record: staleness is
            // a property of the record, not a safety risk. Every tool that reads
            // LIVE state carries the guard.
            staleDataGuard: false,
            permissionGuard: true,
            idempotencyKeyRequired: false,
        },
        outputSchema: { type: "object", properties: { entries: { type: "array" } } },
    },
    {
        name: "precheck_trade",
        description:
            "Classify a proposed trade against the portfolio: TRADE_ACCEPTABLE / TRADE_WARNING / TRADE_REQUIRES_APPROVAL / TRADE_BLOCKED, with incremental exposure, risk, correlation and concentration impact.",
        schema: {
            type: "object",
            properties: {
                portfolioId: { type: "string" },
                symbol: { type: "string" },
                side: { type: "enum", enum: ["LONG", "SHORT"] },
                quantity: { type: "number" },
                entryPrice: { type: "number" },
                stopLoss: { type: "number" },
                strategyId: { type: "string" },
            },
            required: ["portfolioId", "symbol", "side", "quantity", "entryPrice"],
        },
        permission: "risk_read",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId", "symbol", "side", "quantity", "entryPrice"],
            typeChecks: { portfolioId: "string", symbol: "string", side: "enum", quantity: "number", entryPrice: "number", stopLoss: "number", strategyId: "string" },
            staleDataGuard: true,
            permissionGuard: true,
            idempotencyKeyRequired: true,
        },
        outputSchema: {
            type: "object",
            properties: {
                verdict: { type: "enum", enum: ["TRADE_ACCEPTABLE", "TRADE_WARNING", "TRADE_REQUIRES_APPROVAL", "TRADE_BLOCKED"] },
                reasons: { type: "array" },
                decision: { type: "object" },
            },
        },
    },
    {
        name: "recommend_allocation",
        description:
            "Produce allocation recommendations (INCREASE / MAINTAIN / REDUCE / PAUSE / REVIEW) from measured strategy evidence. Never executes.",
        schema: {
            type: "object",
            properties: { portfolioId: { type: "string" }, method: { type: "enum", enum: ["EQUAL", "RISK_BASED", "VOLATILITY_ADJUSTED", "RISK_PARITY", "STRATEGY_BUDGET", "USER_DEFINED"] } },
            required: ["portfolioId"],
        },
        permission: "risk_recommend",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId"],
            typeChecks: { portfolioId: "string", method: "enum" },
            staleDataGuard: true,
            permissionGuard: true,
            idempotencyKeyRequired: true,
        },
        outputSchema: { type: "object", properties: { recommendations: { type: "array" }, requiresApproval: { type: "boolean" } } },
    },
    {
        name: "run_portfolio_stress",
        description:
            "Run deterministic portfolio stress scenarios and return the measured impact with explicit historical/simulated provenance.",
        schema: portfolioIdSchema,
        permission: "research_launch",
        riskLevel: "read_only",
        inputValidation: {
            required: ["portfolioId"],
            typeChecks: { portfolioId: "string" },
            staleDataGuard: true,
            permissionGuard: true,
            idempotencyKeyRequired: true,
        },
        outputSchema: { type: "object", properties: { scenarios: { type: "array" }, worstCase: { type: "object" }, method: { type: "string" } } },
    },
];

/** The permission each portfolio tool requires, exported for audit surfaces. */
export const PORTFOLIO_TOOL_PERMISSIONS: Record<string, AgentPermission> = Object.fromEntries(
    PORTFOLIO_TOOL_DEFINITIONS.map((t) => [t.name, t.permission])
);

/** Every portfolio tool is read-only; asserted rather than assumed. */
export function allPortfolioToolsReadOnly(): boolean {
    return PORTFOLIO_TOOL_DEFINITIONS.every((t) => t.riskLevel === ("read_only" satisfies AgentRiskLevel));
}

/** Tools that read immutable history and therefore do not need a stale-data guard. */
export const HISTORICAL_PORTFOLIO_TOOLS: readonly string[] = ["get_portfolio_journal"];

/** Every tool that reads LIVE portfolio state carries the stale-data guard. */
export function allLiveStateToolsGuarded(): boolean {
    return PORTFOLIO_TOOL_DEFINITIONS.filter((t) => !HISTORICAL_PORTFOLIO_TOOLS.includes(t.name)).every(
        (t) => t.inputValidation.staleDataGuard
    );
}
