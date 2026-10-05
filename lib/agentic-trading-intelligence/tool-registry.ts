/** AlgoVault Agentic Trading Intelligence — Tool Registry (Phase 14 §9)

 * Canonical Agent Tool Registry.
 * Reuses existing deterministic engines, AI router, event bus, RTDB.
 * Each tool has: name, description, schema, permission, risk level, input validation,
 * output schema.
 */

import type { AgentPermission, AgentRiskLevel, ToolSchema } from "./contracts";

// ─── Tool definitions ──────────────────────────────────────────────────────────
export const TOOL_DEFINITIONS: ReadonlyArray<ToolDefinition> = [
  {
    name: "get_market_snapshot",
    description: "Fetch current market state, structure, liquidity, FVG/OB, MTF context.",
    schema: { type: "object", properties: { symbol: { type: "string" }, timeframe: { type: "string" } }, required: ["symbol"] },
    permission: "market_read",
    riskLevel: "read_only",
    inputValidation: {
      required: ["symbol"],
      typeChecks: { symbol: "string", timeframe: "string" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false,
    },
    outputSchema: { type: "object", properties: { symbol: { type: "string" }, structure: { type: "object" }, liquidity: { type: "object" }, fvg: { type: "array" }, ob: { type: "array" }, mtf: { type: "array" }, timestamp: { type: "number" } } },
  },
  {
    name: "get_candles",
    description: "Fetch historical candles for a symbol/timeframe.",
    schema: { type: "object", properties: { symbol: { type: "string" }, timeframe: { type: "string" }, limit: { type: "number" } }, required: ["symbol", "timeframe"] },
    permission: "market_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["symbol", "timeframe"],
      typeChecks: { symbol: "string", timeframe: "string", limit: "number" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { symbol: { type: "string" }, timeframe: { type: "string" }, candles: { type: "array" }, timestamp: { type: "number" } } },
  },
  {
    name: "get_indicators",
    description: "Compute requested indicators over candles.",
    schema: { type: "object", properties: { symbol: { type: "string" }, timeframe: { type: "string" }, indicators: { type: "array" } }, required: ["symbol", "timeframe", "indicators"] },
    permission: "market_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["symbol", "timeframe", "indicators"],
      typeChecks: { symbol: "string", timeframe: "string", indicators: "array" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { symbol: { type: "string" }, indicators: { type: "object" }, timestamp: { type: "number" } } },
  },
  {
    name: "get_smart_money",
    description: "Inspect Smart Money structure, liquidity, BOS/CHoCH, FVG, order blocks.",
    schema: { type: "object", properties: { symbol: { type: "string" }, timeframe: { type: "string" } }, required: ["symbol", "timeframe"] },
    permission: "market_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["symbol", "timeframe"],
      typeChecks: { symbol: "string", timeframe: "string" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { symbol: { type: "string" }, structure: { type: "object" }, events: { type: "array" }, fvg: { type: "array" }, ob: { type: "array" }, liquidity: { type: "object" } } },
  },
  {
    name: "get_setup",
    description: "Inspect an existing Setup Memory record and its conditions.",
    schema: { type: "object", properties: { setupId: { type: "string" } }, required: ["setupId"] },
    permission: "setup_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["setupId"],
      typeChecks: { setupId: "string" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { setup: { type: "object" }, conditions: { type: "array" }, confirmation: { type: "object" }, invalidation: { type: "object" }, similarity: { type: "object" } } },
  },
  {
    name: "search_historical_setups",
    description: "Search historical setups similar to a pattern or market state.",
    schema: { type: "object", properties: { symbol: { type: "string" }, pattern: { type: "object" }, limit: { type: "number" } }, required: ["symbol"] },
    permission: "setup_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["symbol"],
      typeChecks: { symbol: "string", pattern: "object", limit: "number" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { symbol: { type: "string" }, matches: { type: "array" }, timestamp: { type: "number" } } },
  },
  {
    name: "get_strategy",
    description: "Inspect a strategy's definition, version, health, performance.",
    schema: { type: "object", properties: { strategyId: { type: "string" } }, required: ["strategyId"] },
    permission: "strategy_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["strategyId"],
      typeChecks: { strategyId: "string" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { strategy: { type: "object" }, version: { type: "object" }, health: { type: "object" }, performance: { type: "object" } } },
  },
  {
    name: "get_strategy_health",
    description: "Monitor strategy performance, detect degradation, compare to baseline.",
    schema: { type: "object", properties: { strategyId: { type: "string" }, window: { type: "number" } }, required: ["strategyId"] },
    permission: "strategy_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["strategyId"],
      typeChecks: { strategyId: "string", window: "number" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { strategyId: { type: "string" }, health: { type: "object" }, baseline: { type: "object" }, current: { type: "object" }, degradation: { type: "object" } } },
  },
  {
    name: "run_backtest",
    description: "Run a backtest for a strategy version over a historical range.",
    schema: { type: "object", properties: { strategyId: { type: "string" }, from: { type: "number" }, to: { type: "number" } }, required: ["strategyId", "from", "to"] },
    permission: "strategy_read",
    riskLevel: "low_risk",    inputValidation: {
      required: ["strategyId", "from", "to"],
      typeChecks: { strategyId: "string", from: "number", to: "number" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { strategyId: { type: "string" }, result: { type: "object" }, runtime: { type: "number" } } },
  },
  {
    name: "run_replay",
    description: "Run a replay of a strategy over a market range for observation.",
    schema: { type: "object", properties: { strategyId: { type: "string" }, symbol: { type: "string" }, timeframe: { type: "string" }, from: { type: "number" }, to: { type: "number" } }, required: ["strategyId", "symbol", "timeframe", "from", "to"] },
    permission: "strategy_read",
    riskLevel: "low_risk",    inputValidation: {
      required: ["strategyId", "symbol", "timeframe", "from", "to"],
      typeChecks: { strategyId: "string", symbol: "string", timeframe: "string", from: "number", to: "number" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { strategyId: { type: "string" }, replay: { type: "object" }, timestamp: { type: "number" } } },
  },
  {
    name: "start_research",
    description: "Launch controlled research with a hypothesis and bounded budget.",
    schema: { type: "object", properties: { hypothesis: { type: "object" }, constraints: { type: "object" } }, required: ["hypothesis", "constraints"] },
    permission: "research_launch",
    riskLevel: "low_risk",    inputValidation: {
      required: ["hypothesis", "constraints"],
      typeChecks: { hypothesis: "object", constraints: "object" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: true
    },
    outputSchema: { type: "object", properties: { researchId: { type: "string" }, status: { type: "string" }, budget: { type: "object" } } },
  },
  {
    name: "get_research_status",
    description: "Inspect the status and results of a research mission.",
    schema: { type: "object", properties: { researchId: { type: "string" } }, required: ["researchId"] },
    permission: "research_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["researchId"],
      typeChecks: { researchId: "string" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { researchId: { type: "string" }, status: { type: "string" }, candidates: { type: "array" }, events: { type: "array" } } },
  },
  {
    name: "get_risk_state",
    description: "Inspect current risk state, including limits, exposure, breaches.",
    schema: { type: "object", properties: { scope: { type: "string" } }, required: [] },
    permission: "risk_read",
    riskLevel: "read_only",    inputValidation: {
      required: [],
      typeChecks: { scope: "string" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { status: { type: "string" }, limits: { type: "object" }, exposure: { type: "object" }, breaches: { type: "array" } } },
  },
  {
    name: "get_positions",
    description: "Fetch open positions, exposure, strategy association.",
    schema: { type: "object", properties: { strategyId: { type: "string" } }, required: [] },
    permission: "risk_read",
    riskLevel: "read_only",    inputValidation: {
      required: [],
      typeChecks: { strategyId: "string" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { positions: { type: "array" }, exposure: { type: "object" }, strategyExposure: { type: "object" } } },
  },
  {
    name: "get_orders",
    description: "Fetch open orders and their status.",
    schema: { type: "object", properties: { symbol: { type: "string" } }, required: [] },
    permission: "risk_read",
    riskLevel: "read_only",    inputValidation: {
      required: [],
      typeChecks: { symbol: "string" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { orders: { type: "array" }, timestamp: { type: "number" } } },
  },
  {
    name: "get_journal",
    description: "Fetch journal entries, patterns, trade summaries.",
    schema: { type: "object", properties: { limit: { type: "number" }, symbol: { type: "string" } }, required: [] },
    permission: "journal_read",
    riskLevel: "read_only",    inputValidation: {
      required: [],
      typeChecks: { limit: "number", symbol: "string" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { entries: { type: "array" }, patterns: { type: "array" }, summary: { type: "object" } } },
  },
  {
    name: "create_alert",
    description: "Create a market or setup alert.",
    schema: { type: "object", properties: { symbol: { type: "string" }, condition: { type: "object" }, message: { type: "string" } }, required: ["symbol", "condition", "message"] },
    permission: "alert_create",
    riskLevel: "low_risk",    inputValidation: {
      required: ["symbol", "condition", "message"],
      typeChecks: { symbol: "string", condition: "object", message: "string" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: true
    },
    outputSchema: { type: "object", properties: { alertId: { type: "string" }, status: { type: "string" } } },
  },
  {
    name: "create_setup",
    description: "Record a setup candidate for future review.",
    schema: { type: "object", properties: { symbol: { type: "string" }, timeframe: { type: "string" }, context: { type: "object" } }, required: ["symbol", "timeframe", "context"] },
    permission: "setup_create",
    riskLevel: "low_risk",    inputValidation: {
      required: ["symbol", "timeframe", "context"],
      typeChecks: { symbol: "string", timeframe: "string", context: "object" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: true
    },
    outputSchema: { type: "object", properties: { setupId: { type: "string" }, status: { type: "string" } } },
  },
  {
    name: "create_journal_entry",
    description: "Create a journal entry summarizing an insight or trade review.",
    schema: { type: "object", properties: { symbol: { type: "string" }, type: { type: "string" }, summary: { type: "string" }, context: { type: "object" } }, required: ["type", "summary"] },
    permission: "journal_create",
    riskLevel: "low_risk",    inputValidation: {
      required: ["type", "summary"],
      typeChecks: { symbol: "string", type: "string", summary: "string", context: "object" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: true
    },
    outputSchema: { type: "object", properties: { entryId: { type: "string" }, status: { type: "string" } } },
  },
  {
    name: "pause_strategy",
    description: "Pause an active strategy. Requires HIGH_RISK permission and confirmation.",
    schema: { type: "object", properties: { strategyId: { type: "string" } }, required: ["strategyId"] },
    permission: "strategy_pause",
    riskLevel: "high_risk",    inputValidation: {
      required: ["strategyId"],
      typeChecks: { strategyId: "string" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { strategyId: { type: "string" }, status: { type: "string" } } },
  },
  {
    name: "prepare_order",
    description: "Prepare an order intent for deterministic validation, risk engine, permission, and broker check.",
    schema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string" }, orderType: { type: "string" }, quantity: { type: "number" }, stopLoss: { type: "number" }, takeProfit: { type: "number" }, risk: { type: "number" }, strategyId: { type: "string" } }, required: ["symbol", "side", "orderType", "quantity"] },
    permission: "execution_prepare",
    riskLevel: "user_confirmation",    inputValidation: {
      required: ["symbol", "side", "orderType", "quantity"],
      typeChecks: { symbol: "string", side: "string", orderType: "string", quantity: "number", stopLoss: "number", takeProfit: "number", risk: "number", strategyId: "string" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: true
    },
    outputSchema: { type: "object", properties: { intentId: { type: "string" }, intent: { type: "object" }, validation: { type: "object" }, riskEngine: { type: "object" }, permissions: { type: "object" }, status: { type: "string" } } },
  },
  {
    name: "submit_live_order",
    description: "Submit a live order to the broker. Requires LIVE_TRADING permission and user authorization. Agents cannot bypass risk engine.",
    schema: { type: "object", properties: { clientOrderId: { type: "string" }, symbol: { type: "string" }, side: { type: "string" }, orderType: { type: "string" }, quantity: { type: "number" }, price: { type: "number" }, stopLoss: { type: "number" }, takeProfit: { type: "number" } }, required: ["clientOrderId", "symbol", "side", "orderType", "quantity"] },
    permission: "execution_submit",
    riskLevel: "live_trading",    inputValidation: {
      required: ["clientOrderId", "symbol", "side", "orderType", "quantity"],
      typeChecks: { clientOrderId: "string", symbol: "string", side: "string", orderType: "string", quantity: "number", price: "number", stopLoss: "number", takeProfit: "number" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: true
    },
    // No `required` array: every output property is optional (orderId/error are
    // present only on fill, so a schema-level `?` would be meaningless here).
    outputSchema: { type: "object", properties: { clientOrderId: { type: "string" }, status: { type: "string" }, orderId: { type: "string" }, error: { type: "string" } } },
  },
  {
    name: "create_research_hypothesis",
    description: "Formulate a research hypothesis from observed behavior or anomaly.",
    schema: { type: "object", properties: { observation: { type: "object" }, hypothesis: { type: "string" }, constraints: { type: "object" } }, required: ["observation", "hypothesis", "constraints"] },
    permission: "research_launch",
    riskLevel: "low_risk",    inputValidation: {
      required: ["observation", "hypothesis", "constraints"],
      typeChecks: { observation: "object", hypothesis: "string", constraints: "object" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { hypothesisId: { type: "string" }, status: { type: "string" } } },
  },
  {
    name: "evaluate_research_results",
    description: "Evaluate research candidates against OOS, WFA, Monte Carlo, robustness.",
    schema: { type: "object", properties: { researchId: { type: "string" }, criteria: { type: "object" } }, required: ["researchId", "criteria"] },
    permission: "research_read",
    riskLevel: "low_risk",    inputValidation: {
      required: ["researchId", "criteria"],
      typeChecks: { researchId: "string", criteria: "object" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { researchId: { type: "string" }, evaluation: { type: "object" }, survivors: { type: "array" } } },
  },
  {
    name: "compare_candidates",
    description: "Compare research candidates by performance, robustness, regime behavior.",
    schema: { type: "object", properties: { researchId: { type: "string" }, candidates: { type: "array" } }, required: ["researchId", "candidates"] },
    permission: "research_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["researchId", "candidates"],
      typeChecks: { researchId: "string", candidates: "array" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { researchId: { type: "string" }, comparison: { type: "object" } } },
  },
  {
    name: "monitor_market",
    description: "Monitor market state for structure, liquidity, setup candidates.",
    schema: { type: "object", properties: { symbol: { type: "string" }, timeframe: { type: "string" }, events: { type: "array" } }, required: ["symbol", "timeframe"] },
    permission: "market_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["symbol", "timeframe"],
      typeChecks: { symbol: "string", timeframe: "string", events: "array" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { symbol: { type: "string" }, events: { type: "array" }, timestamp: { type: "number" } } },
  },
  {
    name: "monitor_strategy",
    description: "Monitor a strategy's health, performance, regime behavior.",
    schema: { type: "object", properties: { strategyId: { type: "string" }, metrics: { type: "array" } }, required: ["strategyId"] },
    permission: "strategy_read",
    riskLevel: "read_only",    inputValidation: {
      required: ["strategyId"],
      typeChecks: { strategyId: "string", metrics: "array" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { strategyId: { type: "string" }, health: { type: "object" }, metrics: { type: "array" }, timestamp: { type: "number" } } },
  },
  {
    name: "monitor_risk",
    description: "Monitor risk state, detect breaches, recommend defensive actions.",
    schema: { type: "object", properties: { scope: { type: "string" } }, required: [] },
    permission: "risk_recommend",
    riskLevel: "high_risk",    inputValidation: {
      required: [],
      typeChecks: { scope: "string" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { status: { type: "string" }, breaches: { type: "array" }, recommendations: { type: "array" } } },
  },
  {
    name: "synthesize_intelligence",
    description: "Synthesize intelligence from multiple agent outputs, preserving disagreements.",
    schema: { type: "object", properties: { inputs: { type: "array" }, goal: { type: "string" } }, required: ["inputs", "goal"] },
    permission: "market_read",
    riskLevel: "low_risk",    inputValidation: {
      required: ["inputs", "goal"],
      typeChecks: { inputs: "array", goal: "string" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { synthesis: { type: "object" }, disagreements: { type: "array" }, confidence: { type: "number" } } },
  },
  {
    name: "orchestrate_agents",
    description: "Coordinate multiple specialized agents to complete a complex task.",
    schema: { type: "object", properties: { goal: { type: "string" }, agents: { type: "array" }, plan: { type: "array" } }, required: ["goal", "agents", "plan"] },
    permission: "market_read",
    riskLevel: "low_risk",    inputValidation: {
      required: ["goal", "agents", "plan"],
      typeChecks: { goal: "string", agents: "array", plan: "array" },
      staleDataGuard: false,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { taskId: { type: "string" }, runId: { type: "string" }, status: { type: "string" } } },
  },
  {
    name: "approve_action",
    description: "Approve a proposed agent action that requires user confirmation.",
    schema: { type: "object", properties: { actionId: { type: "string" }, confirmationToken: { type: "string" } }, required: ["actionId", "confirmationToken"] },
    permission: "user_confirm",
    riskLevel: "user_confirmation",    inputValidation: {
      required: ["actionId", "confirmationToken"],
      typeChecks: { actionId: "string", confirmationToken: "string" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { actionId: { type: "string" }, status: { type: "string" }, approvedAt: { type: "number" } } },
  },
  {
    name: "reject_action",
    description: "Reject a proposed agent action.",
    schema: { type: "object", properties: { actionId: { type: "string" } }, required: ["actionId"] },
    permission: "user_confirm",
    riskLevel: "user_confirmation",    inputValidation: {
      required: ["actionId"],
      typeChecks: { actionId: "string" },
      staleDataGuard: true,
      permissionGuard: true,
      idempotencyKeyRequired: false
    },
    outputSchema: { type: "object", properties: { actionId: { type: "string" }, status: { type: "string" } } },
  },
];

export type ToolDefinition = {
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
};

export {};

// ─── Tool Registry ─────────────────────────────────────────────────────────────
/** Canonical tool-by-name lookup. */
export const TOOL_REGISTRY: Readonly<Record<string, ToolDefinition>> = Object.fromEntries(
  TOOL_DEFINITIONS.map((t) => [t.name, t])
);

/** Returns the set of tool names an agent may invoke given its allowed tools. */
export function allowedToolSet(allowedTools: readonly string[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const tool of allowedTools) {
    if (TOOL_REGISTRY[tool]) set.add(tool);
  }
  return set;
}

/** Checks whether a tool is allowed for an agent based on its permissions. */
export function isToolAllowed(toolName: string, permissions: readonly AgentPermission[]): boolean {
  const tool = TOOL_REGISTRY[toolName];
  if (!tool) return false;
  return permissions.includes(tool.permission);
}

/** Checks whether a tool's risk level is acceptable for the agent. */
export function isRiskLevelAcceptable(toolName: string, allowedRiskLevels: readonly AgentRiskLevel[]): boolean {
  const tool = TOOL_REGISTRY[toolName];
  if (!tool) return false;
  return allowedRiskLevels.includes(tool.riskLevel);
}
