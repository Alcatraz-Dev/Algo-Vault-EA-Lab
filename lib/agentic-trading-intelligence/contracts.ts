/** AlgoVault Agentic Trading Intelligence — Agent Contracts (Phase 14 §3)

 * Canonical contracts for Agent Definition, Agent Version, Agent Runtime, Agent Task,
 * Agent Run, Agent Step, Agent Decision, Agent Action, Agent Permission.
 * Reuses existing AI router, event bus, RTDB, workflow automation and scheduler.
 */

// ─── Core identifiers ─────────────────────────────────────────────────────────
export type AgentId = string;
export type AgentVersionId = string;
export type TaskId = string;
export type RunId = string;

// ─── Agent Definition ─────────────────────────────────────────────────────────
/** Built-in agent definition contract (Phase 14 §4). */
export interface AgentDefinition {
  id: AgentId;
  name: string;
  version: string;
  description: string;
  capabilities: AgentCapability[];
  allowedTools: string[];
  permissions: AgentPermission[];
  riskLevel: AgentRiskLevel;
  maxRuntimeMs: number;
  maxCostPerRunCents: number;
  maxActionsPerRun: number;
  modelPreference?: AgentModelPreference;
}

// ─── Agent Version ─────────────────────────────────────────────────────────────
/** Immutable snapshot of an agent definition used by a run (Phase 14 §61). */
export interface AgentVersion extends AgentDefinition {
  snapshotAt: number; // milliseconds
  runCount: number;
}

// ─── Agent Runtime ─────────────────────────────────────────────────────────────
/**
 * Ambient runtime context for a live agent execution (Phase 14 §4): the
 * identity, permissions and environment availability a run executes against.
 *
 * Named `AgentRuntimeContext` rather than `AgentRuntime` because
 * `./agent-runtime` owns the executable `AgentRuntime` class, which is what
 * consumers instantiate. This interface is the declarative contract only.
 */
export interface AgentRuntimeContext {
  agentId: AgentId;
  versionId: AgentVersionId;
  userId: string;
  tenantId: string;
  workspaceId: string;
  runId: RunId;
  status: AgentRunStatus;
  startedAt: number;
  allowedTools: readonly string[];
  allowedPermissions: readonly AgentPermission[];
  killSwitch: boolean;
  riskEngineAvailable: boolean;
  brokerAvailable: boolean;
  marketDataFresh: boolean;
  tools: AgentToolRegistry;
}

// ─── Agent Task ───────────────────────────────────────────────────────────────
/** What an agent is asked to do (Phase 14 §7). */
export interface AgentTask {
  id: TaskId;
  agentId: AgentId;
  versionId: AgentVersionId;
  userId: string;
  tenantId: string;
  workspaceId: string;
  goal: string;
  structuredGoal?: StructuredGoal;
  expectedOutput: ExpectedOutput;
  constraints: TaskConstraints;
  metadata: Record<string, unknown>;
  createdBy: "user" | "orchestrator" | "trigger";
  trigger?: TaskTrigger;
  correlationId?: string;
  causationId?: string;
  createdAt: number;
}

// ─── Agent Run ────────────────────────────────────────────────────────────────
/** One complete execution of an agent against a task (Phase 14 §13). */
export interface AgentRun {
  id: RunId;
  taskId: TaskId;
  agentId: AgentId;
  versionId: AgentVersionId;
  userId: string;
  tenantId: string;
  workspaceId: string;
  status: AgentRunStatus;
  startedAt: number;
  completedAt?: number;
  steps: AgentStep[];
  toolCalls: ToolCallRecord[];
  observations: Observation[];
  decisions: AgentDecision[];
  actions: ProposedAction[];
  errors: string[];
  finalOutput?: StructuredOutput;
  snapshot?: RunSnapshot;
  budget: RunBudget;
  correlationId?: string;
  causationId?: string;
}

// ─── Agent Step ───────────────────────────────────────────────────────────────
/** A single reasoning step in an agent run (Phase 14 §4). */
export interface AgentStep {
  index: number;
  name: string;
  status: StepStatus;
  plan?: string;
  toolCall?: ToolCallRecord;
  observation?: Observation;
  decision?: AgentDecision;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

// ─── Agent Decision ───────────────────────────────────────────────────────────
/** A decision reached by an agent at a step (Phase 14 §4). */
export interface AgentDecision {
  stepIndex: number;
  decision: DecisionType;
  reason: string;
  evidenceRefs: string[];
  confidence: number;
  proposedNextSteps: string[];
}

// ─── Agent Action ─────────────────────────────────────────────────────────────
/** A proposed (not yet authorized) agent action (Phase 14 §11). */
export interface ProposedAction {
  id: string;
  type: AgentActionType;
  payload: Record<string, unknown>;
  reason: string;
  evidence: EvidenceReference[];
  confidence: number;
  requiresConfirmation: boolean;
  riskLevel: AgentRiskLevel;
  permissionRequired: AgentPermission;
  idempotencyKey: string;
  proposedAt: number;
  approvedAt?: number;
  approvedBy?: string;
  status: "pending" | "approved" | "rejected" | "executing" | "executed" | "failed" | "blocked";
  executedAt?: number;
  executionResult?: ExecutionResult;
}

// ─── Agent Permission ──────────────────────────────────────────────────────────
/** Permissions an agent must hold to invoke a tool or take an action (Phase 14 §10). */
export type AgentCapability = string;

export type AgentModelPreference = {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export interface AgentToolRegistry {
  canUse(toolName: string): boolean;
  call(toolName: string, args: Record<string, unknown>): unknown;
}

export type AgentPermission =
  | "market_read"
  | "market_write"
  | "setup_read"
  | "setup_create"
  | "strategy_read"
  | "strategy_pause"
  | "research_read"
  | "research_launch"
  | "risk_read"
  | "risk_recommend"
  | "execution_prepare"
  | "execution_submit"
  | "journal_read"
  | "journal_create"
  | "alert_create"
  | "user_confirm"
  | "admin_approve"
  // Portfolio Intelligence (Phase 15). Every portfolio permission maps onto
  // these existing permissions — no portfolio-specific authority was invented.
  | "portfolio_read"
  | "portfolio_recommend";

// ─── Tool Registry ────────────────────────────────────────────────────────────
/** Tool definition in the canonical Agent Tool Registry (Phase 14 §9). */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolSchema;
  permission: AgentPermission;
  riskLevel: AgentRiskLevel;
  inputValidation: InputValidation;
  outputSchema: ToolSchema;
}

// ─── Tool Permission Model ────────────────────────────────────────────────────
/** Classification of tool risk levels (Phase 14 §10). */
export type AgentRiskLevel = "read_only" | "low_risk" | "user_confirmation" | "high_risk" | "live_trading";

// ─── Observation Model ────────────────────────────────────────────────────────
/** Observation kinds (Phase 14 §15). */
export type ObservationKind = "observed" | "calculated" | "inferred" | "hypothesis";

// ─── Evidence Graph ───────────────────────────────────────────────────────────
/** Reference to source data that supports an observation or conclusion (Phase 14 §16). */
export interface EvidenceReference {
  id: string;
  sourceType: EvidenceSource;
  sourceId: string;
  timestamp?: number;
  path?: string;
  value?: unknown;
}

export type EvidenceSource =
  | "market"
  | "smart_money"
  | "indicator"
  | "setup"
  | "strategy"
  | "research"
  | "risk"
  | "position"
  | "order"
  | "journal"
  | "event"
  | "portfolio"
  | "account"
  | "correlation"
  | "allocation"
  | "stress";

// ─── Helper types ─────────────────────────────────────────────────────────────
export type AgentRunStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting_for_data"
  | "waiting_for_user"
  | "waiting_for_confirmation"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type DecisionType =
  | "proceed"
  | "gather_more_data"
  | "propose_action"
  | "request_user"
  | "block"
  | "retry"
  | "stop";

export type AgentActionType =
  | "get_market_snapshot"
  | "get_candles"
  | "get_indicators"
  | "get_smart_money"
  | "get_setup"
  | "search_historical_setups"
  | "get_strategy"
  | "get_strategy_health"
  | "run_backtest"
  | "run_replay"
  | "start_research"
  | "get_research_status"
  | "get_risk_state"
  | "get_positions"
  | "get_orders"
  | "get_journal"
  | "create_alert"
  | "create_setup"
  | "create_journal_entry"
  | "pause_strategy"
  | "prepare_order"
  | "submit_live_order"
  | "create_research_hypothesis"
  | "evaluate_research_results"
  | "compare_candidates"
  | "monitor_market"
  | "monitor_strategy"
  | "monitor_risk"
  | "synthesize_intelligence"
  | "orchestrate_agents"
  | "approve_action"
  | "reject_action"
  // Portfolio Intelligence (Phase 15)
  | "get_portfolio_snapshot"
  | "get_portfolio_exposure"
  | "get_portfolio_risk"
  | "get_portfolio_correlation"
  | "get_portfolio_concentration"
  | "get_portfolio_strategies"
  | "get_portfolio_health"
  | "get_portfolio_journal"
  | "precheck_trade"
  | "recommend_allocation"
  | "run_portfolio_stress";

export interface StructuredGoal {
  intent: string;
  scope: GoalScope;
  successCriteria: string[];
  limitations: string[];
}

export type GoalScope = "market" | "setup" | "strategy" | "risk" | "research" | "execution" | "journal" | "intelligence" | "multi_agent" | "portfolio";

export interface ExpectedOutput {
  format: "report" | "recommendation" | "intelligence" | "decision" | "action" | "observation" | "synthesis";
  includeEvidence: boolean;
  confidenceThreshold?: number;
}

export interface TaskConstraints {
  maxSteps?: number;
  maxTimeMs?: number;
  maxToolCalls?: number;
  maxBudgetCents?: number;
  allowedTools?: string[];
  requiredPermissions?: AgentPermission[];
  tenantScope?: boolean;
  noFutureLeakage?: boolean;
}

export interface ToolCallRecord {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  startedAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  permissionChecked: boolean;
  idempotencyKey?: string;
}

export interface Observation {
  id: string;
  kind: ObservationKind;
  text: string;
  source: string;
  timestamp: number;
  evidenceRefs: string[];
  metadata?: Record<string, unknown>;
}

export interface StructuredOutput {
  type: "market_analysis" | "setup_review" | "strategy_health" | "research_report" | "risk_assessment" | "execution_intent" | "trade_review" | "intelligence_brief";
  objective: string;
  observedFacts: string[];
  analysis: string[];
  evidence: EvidenceReference[];
  risks: string[];
  decision: string;
  actions: ProposedAction[];
  limitations: string[];
  nextSteps: string[];
  provenance: {
    agentId: AgentId;
    versionId: AgentVersionId;
    model: string;
    tools: string[];
    contextSnapshot: string;
    engineVersions: Record<string, string>;
    dataTimestamp: number;
  };
}

export interface RunBudget {
  maxHypotheses: number;
  maxCandidates: number;
  maxBacktests: number;
  maxRuntimeMs: number;
  maxComputeCostCents: number;
  spentHypotheses: number;
  spentCandidates: number;
  spentBacktests: number;
  startedAt: number;
}

export interface RunSnapshot {
  agentVersion: string;
  model: string;
  tools: string[];
  contextSnapshot: string;
  engineVersions: Record<string, string>;
  dataTimestamp: number;
  result: unknown;
  actions: ProposedAction[];
  capturedAt: number;
}

export interface ExecutionResult {
  status: "pending" | "executing" | "completed" | "failed" | "rejected" | "blocked";
  error?: string;
  result?: unknown;
  completedAt?: number;
}

export interface TaskTrigger {
  type: "manual" | "scheduled" | "event" | "orchestrator";
  event?: string;
  scheduleId?: string;
  scheduleSpec?: string;
  sourceAgentId?: AgentId;
}

export interface InputValidation {
  required: string[];
  typeChecks: Record<string, "string" | "number" | "boolean" | "enum" | "object" | "array">;
  custom?: string;
  staleDataGuard?: boolean;
  permissionGuard?: boolean;
  idempotencyKeyRequired: boolean;
}

export interface ToolSchema {
  type: "object";
  properties?: Record<string, ToolProperty>;
  required?: string[];
}

export interface ToolProperty {
  type: "string" | "number" | "boolean" | "object" | "array" | "enum";
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}
