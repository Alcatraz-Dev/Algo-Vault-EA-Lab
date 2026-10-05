/**
 * AlgoVault Agentic Trading Intelligence — Agent Runtime (Phase 14 §6)
 * @ts-nocheck
 *
 * AgentRuntime is the orchestration layer above the existing deterministic engines.
 * It reasons, plans, selects tools, observes, decides, and proposes actions.
 * It never becomes the final authority for market truth, risk limits, account state,
 * order validation, broker permissions, or live execution authorization.
 */
// @ts-nocheck

import type {
  AgentDefinition,
  AgentPermission,
  AgentRiskLevel,
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentTask,
  DecisionType,
  ExecutionResult,
  Observation,
  ObservationKind,
  ProposedAction,
  RunBudget,
  StepStatus,
  ToolCallRecord,
  ToolDefinition,
} from "./contracts";
import { TOOL_REGISTRY, isToolAllowed, isRiskLevelAcceptable } from "./tool-registry";

export class AgentRuntime {
  constructor(
    public readonly agentDef: AgentDefinition,
    public readonly task: AgentTask,
    public status: AgentRunStatus = "queued",
    public steps: AgentStep[] = [],
    public toolCalls: ToolCallRecord[] = [],
    public observations: Observation[] = [],
    public decisions: unknown[] = [],
    public actions: ProposedAction[] = [],
    public errors: string[] = [],
    public budget: RunBudget = defaultBudget,
    public correlationId?: string,
    public causationId?: string,
  ) {}

  /** Convenience: is the agent allowed to use a tool? */
  canUseTool(toolName: string): boolean {
    return isToolAllowed(toolName, this.agentDef.permissions) && isRiskLevelAcceptable(toolName, this.allowedRiskLevels);
  }

  get allowedRiskLevels(): AgentRiskLevel[] {
    // Risk ladder: an agent may use tools at or below its max risk.
    const ladder: Record<AgentRiskLevel, AgentRiskLevel[]> = {
      read_only: ["read_only"],
      low_risk: ["read_only", "low_risk"],
      user_confirmation: ["read_only", "low_risk", "user_confirmation"],
      high_risk: ["read_only", "low_risk", "user_confirmation", "high_risk"],
      live_trading: ["read_only", "low_risk", "user_confirmation", "high_risk", "live_trading"],
    };
    return ladder[this.agentDef.riskLevel] ?? ["read_only"];
  }

  /** Start the run. */
  start(): void {
    this.status = "planning";
  }

  /** Transition to running after planning. */
  beginExecution(): void {
    this.status = "running";
    this.steps.push({ index: 0, name: "init", status: "completed", startedAt: Date.now(), completedAt: Date.now() });
  }

  /** Return the task id for convenience. */
  get taskId(): string {
    return this.task.id;
  }

  /** Append an observation. */
  observe(kind: ObservationKind, text: string, source: string, evidenceRefs: string[] = [], metadata?: Record<string, unknown>): Observation {
    const obs: Observation = {
      id: `${this.taskId}-obs-${this.observations.length}`,
      kind,
      text,
      source,
      timestamp: Date.now(),
      evidenceRefs,
      metadata,
    };
    this.observations.push(obs);
    return obs;
  }

  /** Make a decision at the current step. */
  decide(decision: DecisionType, reason: string, evidenceRefs: string[], confidence: number, proposedNextSteps: string[]): void {
    this.decisions.push({
      stepIndex: this.steps.length - 1,
      decision,
      reason,
      evidenceRefs,
      confidence,
      proposedNextSteps,
    });
    this.status = "running";
  }

  /** Propose an action. */
  proposeAction(type: string, payload: Record<string, unknown>, reason: string,      evidence: Array<{ id: string; sourceType: string; sourceId: string; timestamp?: number; path?: string; value?: unknown }>, confidence: number, requiresConfirmation: boolean, riskLevel: AgentRiskLevel, permissionRequired: AgentPermission): ProposedAction {
    const action: ProposedAction = {
      id: `${this.taskId}-action-${this.actions.length}`,
      type,
      payload,
      reason,
      evidence,
      confidence,
      requiresConfirmation,
      riskLevel,
      permissionRequired,
      idempotencyKey: `${this.task.correlationId ?? this.taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      proposedAt: Date.now(),
      status: "pending",
    };
    this.actions.push(action);
    return action;
  }

  /** Call a tool and record the call. */
  callTool(toolName: string, args: Record<string, unknown>): unknown {
    if (!this.canUseTool(toolName)) {
      this.errors.push(`Tool '${toolName}' not allowed for this agent.`);
      return undefined;
    }
    const tool = TOOL_REGISTRY[toolName];
    const call: ToolCallRecord = {
      id: `${this.taskId}-tool-${this.toolCalls.length}`,
      tool: toolName,
      args,
      status: "running",
      startedAt: Date.now(),
      permissionChecked: true,
    };
    this.toolCalls.push(call);
    // In a real agent, invoke the tool implementation here.
    // For now, return undefined and mark the call completed.
    call.status = "completed";
    call.completedAt = Date.now();
    return undefined;
  }

  /** Complete the run successfully. */
  complete(output?: unknown): void {
    this.status = "completed";
    this.budget = { ...this.budget, startedAt: this.budget.startedAt }; // keep startedAt
  }

  /** Fail the run. */
  fail(error: string): void {
    this.status = "failed";
    this.errors.push(error);
  }

  /** Cancel the run. */
  cancel(reason: string): void {
    this.status = "cancelled";
    this.errors.push(reason);
  }

  /** Time out the run. */
  timeout(): void {
    this.status = "timed_out";
    this.errors.push("Agent run timed out.");
  }

  /** Block the run due to missing data or permission. */
  block(reason: string): void {
    this.status = "blocked";
    this.errors.push(reason);
  }
}

// ─── Default budget ────────────────────────────────────────────────────────────
const defaultBudget: RunBudget = {
  maxHypotheses: 5,
  maxCandidates: 10,
  maxBacktests: 20,
  maxRuntimeMs: 60_000,
  maxComputeCostCents: 50,
  spentHypotheses: 0,
  spentCandidates: 0,
  spentBacktests: 0,
  startedAt: Date.now(),
};

// ─── Agent registry (built-ins) ────────────────────────────────────────────────
export const AGENT_DEFINITIONS: ReadonlyArray<AgentDefinition> = [
  {
    id: "market-analyst",
    name: "Market Analyst Agent",
    version: "1.0.0",
    description: "Inspects market state, structure, liquidity, indicators, sessions, and summarizes evidence.",
    capabilities: ["market_snapshot", "structure", "liquidity", "indicators", "sessions"],
    allowedTools: ["get_market_snapshot", "get_candles", "get_indicators", "get_smart_money", "monitor_market"],
    permissions: ["market_read"],
    riskLevel: "read_only",
    maxRuntimeMs: 30_000,
    maxCostPerRunCents: 5,
    maxActionsPerRun: 20,
    modelPreference: { provider: "default", model: "fast", temperature: 0.2, maxTokens: 1024 },
  },
  {
    id: "setup-analyst",
    name: "Setup Analyst Agent",
    version: "1.0.0",
    description: "Inspects Setup Memory, validates setup evidence, confirmation, invalidation, historical similarity.",
    capabilities: ["setup", "confirmation", "invalidation", "similarity"],
    allowedTools: ["get_setup", "search_historical_setups", "create_setup", "monitor_market"],
    permissions: ["setup_read", "setup_create"],
    riskLevel: "low_risk",
    maxRuntimeMs: 30_000,
    maxCostPerRunCents: 5,
    maxActionsPerRun: 20,
  },
  {
    id: "research-agent",
    name: "Research Agent",
    version: "1.0.0",
    description: "Formulates hypotheses, launches controlled research, compares candidates, inspects OOS/WFA/Monte Carlo/robustness.",
    capabilities: ["hypothesis", "research", "candidates", "validation", "report"],
    allowedTools: ["start_research", "get_research_status", "create_research_hypothesis", "evaluate_research_results", "compare_candidates", "run_backtest", "run_replay"],
    permissions: ["research_read", "research_launch"],
    riskLevel: "low_risk",
    maxRuntimeMs: 120_000,
    maxCostPerRunCents: 50,
    maxActionsPerRun: 50,
    modelPreference: { provider: "default", model: "reasoning", temperature: 0.3, maxTokens: 2048 },
  },
  {
    id: "strategy-health-agent",
    name: "Strategy Health Agent",
    version: "1.0.0",
    description: "Monitors strategy performance, detects degradation, compares current behavior to baseline, recommends investigation.",
    capabilities: ["health", "degradation", "baseline", "regime", "recommendation"],
    allowedTools: ["get_strategy", "get_strategy_health", "monitor_strategy", "get_positions", "get_risk_state"],
    permissions: ["strategy_read", "risk_read"],
    riskLevel: "read_only",
    maxRuntimeMs: 30_000,
    maxCostPerRunCents: 5,
    maxActionsPerRun: 20,
  },
  {
    id: "risk-agent",
    name: "Risk Agent",
    version: "1.0.0",
    description: "Monitors risk state, detects breaches, recommends defensive actions.",
    capabilities: ["monitoring", "breach_detection", "recommendation"],
    allowedTools: ["get_risk_state", "get_positions", "monitor_risk", "create_alert", "pause_strategy"],
    permissions: ["risk_read", "risk_recommend", "strategy_pause", "alert_create"],
    riskLevel: "high_risk",
    maxRuntimeMs: 30_000,
    maxCostPerRunCents: 5,
    maxActionsPerRun: 10,
  },
  {
    id: "journal-agent",
    name: "Journal Agent",
    version: "1.0.0",
    description: "Summarizes trades, identifies recurring patterns, generates research hypotheses.",
    capabilities: ["journal", "patterns", "hypothesis"],
    allowedTools: ["get_journal", "create_journal_entry", "create_research_hypothesis"],
    permissions: ["journal_read", "journal_create", "research_launch"],
    riskLevel: "low_risk",
    maxRuntimeMs: 30_000,
    maxCostPerRunCents: 5,
    maxActionsPerRun: 20,
  },
  {
    id: "execution-supervisor",
    name: "Execution Supervisor Agent",
    version: "1.0.0",
    description: "Prepares execution intent, verifies required conditions, requests deterministic validation. Never bypasses the Risk Engine.",
    capabilities: ["intent", "validation", "risk", "permission"],
    allowedTools: ["prepare_order", "get_risk_state", "get_positions", "get_orders", "get_strategy"],
    permissions: ["execution_prepare", "risk_read", "strategy_read"],
    riskLevel: "user_confirmation",
    maxRuntimeMs: 30_000,
    maxCostPerRunCents: 5,
    maxActionsPerRun: 5,
  },
  {
    id: "orchestrator",
    name: "Agent Team Orchestrator",
    version: "1.0.0",
    description: "Coordinates specialized agents, preserves disagreements, synthesizes final intelligence.",
    capabilities: ["orchestration", "multi_agent", "synthesis"],
    allowedTools: ["orchestrate_agents", "synthesize_intelligence", "get_market_snapshot", "get_strategy", "get_strategy_health", "get_risk_state"],
    permissions: ["market_read", "strategy_read", "risk_read"],
    riskLevel: "low_risk",
    maxRuntimeMs: 120_000,
    maxCostPerRunCents: 50,
    maxActionsPerRun: 50,
    modelPreference: { provider: "default", model: "reasoning", temperature: 0.3, maxTokens: 2048 },
  },
];

/** Lookup an agent definition by id. */
export function getAgentDefinition(id: string): AgentDefinition | undefined {
  return AGENT_DEFINITIONS.find((a) => a.id === id);
}
