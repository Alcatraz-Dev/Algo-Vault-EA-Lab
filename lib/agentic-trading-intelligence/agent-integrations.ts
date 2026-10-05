/** AlgoVault Agentic Trading Intelligence — Agent Integrations (Phase 14 §31, §32, §33)

 * Integrates agents with Trading Chat, Intelligence OS, event-driven triggers,
 * scheduled tasks (reuse existing Automation), approval workflows.
 */

import type { AgentPermission, AgentRiskLevel, ProposedAction, StructuredOutput } from "./contracts";
import { AgentApprovalWorkflow, ApprovalRequest, ApprovalDecisionRecord } from "./agent-approval";
import { AgentOrchestrator, OrchestratorInput, OrchestratorConstraints, createOrchestrator } from "./agent-orchestrator";
import { AgentRuntime, AGENT_DEFINITIONS, getAgentDefinition } from "./agent-runtime";

// ─── Agent chat routing ────────────────────────────────────────────────────────
/** Integrate agents into existing Trading Chat. The user can ask a question;
 * the chat should route to the correct agent. Do not build a second chat system
 * (Phase 14 §31). */
export type AgentChatRoute = "market" | "setup" | "strategy" | "risk" | "research" | "execution" | "journal" | "intelligence" | "multi_agent";

export function routeChatToAgent(goal: string): AgentChatRoute {
  const lower = goal.toLowerCase();
  if (lower.includes("market") || lower.includes("xauusd") || lower.includes("structure") || lower.includes("liquidity") || lower.includes("fvgm") || lower.includes("order block")) return "market";
  if (lower.includes("setup") || lower.includes("setup memory") || lower.includes("historical setup") || lower.includes("similar setup")) return "setup";
  if (lower.includes("strategy") || lower.includes("degraded") || lower.includes("health") || lower.includes("performance")) return "strategy";
  if (lower.includes("risk") || lower.includes("breach") || lower.includes("exposure") || lower.includes("daily loss") || lower.includes("drawdown")) return "risk";
  if (lower.includes("research") || lower.includes("hypothesis") || lower.includes("backtest") || lower.includes("validate") || lower.includes("candidate")) return "research";
  if (lower.includes("trade") || lower.includes("journal") || lower.includes("pattern") || lower.includes("review my")) return "journal";
  if (lower.includes("execute") || lower.includes("order") || lower.includes("place") || lower.includes("prepare") || lower.includes("intent")) return "execution";
  if (lower.includes("orchestrat") || lower.includes("team") || lower.includes("synthesize") || lower.includes("disagree")) return "multi_agent";
  return "intelligence";
}

// ─── Multi-agent chat ──────────────────────────────────────────────────────────
/** For complex questions, the orchestrator routes to multiple agents and synthesizes
 * the result, preserving disagreements. Do not force consensus when evidence conflicts
 * (Phase 14 §32). */
export interface MultiAgentChatInput {
  goal: string;
  user: { uid: string; displayName?: string };
  agents: string[]; // agent ids
  context?: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
}

export interface MultiAgentChatOutput {
  synthesis: StructuredOutput;
  route: AgentChatRoute;
  disagreements: Array<{ agents: string[]; topic: string; positions: Array<{ agentId: string; stance: string; confidence: number; evidence: string[] }>; reason?: string }>;
  confidence: number;
}

export async function runMultiAgentChat(input: MultiAgentChatInput): Promise<MultiAgentChatOutput> {
  const route = routeChatToAgent(input.goal);
  const runtime = new AgentRuntime(
    getAgentDefinition("orchestrator")!,
    {
      id: `chat-${Date.now()}`,
      agentId: "orchestrator",
      versionId: "orchestrator-1.0.0",
      userId: input.user.uid,
      tenantId: input.user.uid, // simplified; real system would resolve tenant
      workspaceId: "default",
      goal: input.goal,
      structuredGoal: undefined,
      expectedOutput: { format: "synthesis", includeEvidence: true },
      constraints: {},
      metadata: {},
      createdBy: "user",
      trigger: { type: "manual" },
      correlationId: input.correlationId,
      causationId: input.causationId,
      createdAt: Date.now(),
    },
    "queued",
    [],
    [],
    [],
    [],
    [],
    [],
    { maxHypotheses: 5, maxCandidates: 10, maxBacktests: 20, maxRuntimeMs: 120_000, maxComputeCostCents: 50, spentHypotheses: 0, spentCandidates: 0, spentBacktests: 0, startedAt: Date.now() },
  );
  const orchestrator = createOrchestrator({ goal: input.goal, scope: route, agents: input.agents }, runtime);
  const result = await orchestrator.run();
  return {
    synthesis: result.synthesis,
    route,
    disagreements: result.disagreements,
    confidence: result.confidence,
  };
}

// ─── Agent-driven command center ───────────────────────────────────────────────
/** The Intelligence OS should expose: Active Agent Runs, Pending Approvals,
 * Research Tasks, Strategy Warnings, Risk Warnings, Agent Recommendations
 * (Phase 14 §33). */
export interface CommandCenterState {
  activeAgentRuns: number;
  pendingApprovals: number;
  researchTasks: number;
  strategyWarnings: number;
  riskWarnings: number;
  agentRecommendations: number;
}

export function buildCommandCenterState(
  activeAgentRuns: number,
  pendingApprovals: number,
  researchTasks: number,
  strategyWarnings: number,
  riskWarnings: number,
  agentRecommendations: number,
): CommandCenterState {
  return {
    activeAgentRuns,
    pendingApprovals,
    researchTasks,
    strategyWarnings,
    riskWarnings,
    agentRecommendations,
  };
}

// ─── Agent schedules (reuse existing Automation) ──────────────────────────────
/** Reuse existing Automation infrastructure. Possible scheduled agents:
 * Daily Market Analyst, Daily Strategy Health, Weekly Research Review,
 * Weekly Trade Journal Review, Certification Monitor, Marketplace Strategy Monitor.
 * Do not create another scheduler (Phase 14 §34). */
export interface AgentSchedule {
  id: string;
  name: string;
  agentId: string;
  scheduleSpec: string; // cron-like or interval
  goal: string;
  constraints: OrchestratorConstraints;
  correlationId?: string;
  causationId?: string;
  enabled: boolean;
}

// ─── Event-driven agents ──────────────────────────────────────────────────────
/** Agents may be triggered by existing events. Use existing event bus.
 * Do not create duplicate event infrastructure (Phase 14 §35). */
export interface AgentEventTrigger {
  id: string;
  event: string;
  conditions: Record<string, unknown>;
  agentId: string;
  permissions: AgentPermission[];
  cooldownMs: number;
  maxRuns: number;
  priority: "low" | "medium" | "high";
  correlationId?: string;
  causationId?: string;
}

// ─── Agent triggers ───────────────────────────────────────────────────────────
/** Every trigger must define: event, conditions, agent, permissions, cooldown,
 * maxRuns, priority. Avoid infinite loops (Phase 14 §36). */
export function validateTrigger(trigger: AgentEventTrigger): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!trigger.event) errors.push("event is required.");
  if (!trigger.agentId) errors.push("agentId is required.");
  if (trigger.cooldownMs <= 0) errors.push("cooldownMs must be positive.");
  if (trigger.maxRuns <= 0) errors.push("maxRuns must be positive.");
  if (!trigger.permissions || trigger.permissions.length === 0) errors.push("permissions are required.");
  if (trigger.priority !== "low" && trigger.priority !== "medium" && trigger.priority !== "high") {
    errors.push("priority must be low, medium, or high.");
  }
  return { valid: errors.length === 0, errors };
}

// ─── Agent loop protection ────────────────────────────────────────────────────
/** Prevent: Agent → Research → Event → Agent → Research → Event → ...
 * Use: correlationId, causationId, maxDepth, cooldown, run limits (Phase 14 §37). */
export interface LoopProtection {
  correlationId: string;
  causationId: string;
  maxDepth: number;
  cooldownMs: number;
  runLimit: number;
  currentDepth: number;
  lastRunMs: number;
  runCount: number;
}

export function canRun(loop: LoopProtection, correlationId: string, causationId: string): { allowed: boolean; reason?: string } {
  if (loop.correlationId === correlationId && loop.causationId === causationId) {
    return { allowed: false, reason: "Already running with same correlation/causation." };
  }
  if (loop.currentDepth >= loop.maxDepth) {
    return { allowed: false, reason: "Maximum agent→research→event depth reached." };
  }
  if (Date.now() - loop.lastRunMs < loop.cooldownMs) {
    return { allowed: false, reason: "Cooldown not elapsed." };
  }
  if (loop.runCount >= loop.runLimit) {
    return { allowed: false, reason: "Run limit reached." };
  }
  return { allowed: true };
}

// ─── Agent idempotency ────────────────────────────────────────────────────────
/** Every mutating agent action must support idempotency.
 * actionId, requestId, correlationId. The same action must not execute twice because
 * of retries. This is especially important for live trading (Phase 14 §38). */
export interface IdempotencyRecord {
  status: "pending" | "processed" | "failed";
  result?: unknown;
}

export interface IdempotencyStore {
  /** Returns the stored record, or `undefined` when the action is unknown. */
  get(actionId: string): IdempotencyRecord | undefined;
  set(actionId: string, status: "pending" | "processed" | "failed", result?: unknown): void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private store = new Map<string, IdempotencyRecord>();
  get(actionId: string): IdempotencyRecord | undefined {
    return this.store.get(actionId);
  }
  set(actionId: string, status: "pending" | "processed" | "failed", result?: unknown) {
    this.store.set(actionId, { status, result });
  }
}

// ─── Agent cost control ───────────────────────────────────────────────────────
/** Track: model, tokens, latency, tool calls, compute, estimated cost.
 * Per: user, tenant, agent, task, day, month. Use limits (Phase 14 §45). */
export interface CostTracker {
  recordCost(userId: string, tenantId: string, agentId: string, taskId: string, model: string, tokens: number, latencyMs: number, toolCalls: number, computeMs: number, estimatedCostCents: number, period: "day" | "month"): void;
  getCost(userId: string, tenantId: string, agentId: string, period: "day" | "month", periodKey: string): number;
  hasExceededLimit(userId: string, tenantId: string, agentId: string, period: "day" | "month", periodKey: string, limitCents: number): boolean;
}

export class InMemoryCostTracker implements CostTracker {
  private costs = new Map<string, number>();
  recordCost(userId: string, tenantId: string, agentId: string, taskId: string, model: string, tokens: number, latencyMs: number, toolCalls: number, computeMs: number, estimatedCostCents: number, period: "day" | "month") {
    const key = `${tenantId}:${userId}:${agentId}:${taskId}:${model}:${period}:${period === "day" ? new Date().toISOString().slice(0, 10) : new Date().toISOString().slice(0, 7)}`;
    this.costs.set(key, (this.costs.get(key) ?? 0) + estimatedCostCents);
  }
  getCost(userId: string, tenantId: string, agentId: string, period: "day" | "month", periodKey: string): number {
    let total = 0;
    for (const [key, value] of this.costs) {
      const parts = key.split(":");
      if (parts[0] === tenantId && parts[1] === userId && parts[2] === agentId && parts[5] === period && parts[6] === periodKey) {
        total += value;
      }
    }
    return total;
  }
  hasExceededLimit(userId: string, tenantId: string, agentId: string, period: "day" | "month", periodKey: string, limitCents: number): boolean {
    return this.getCost(userId, tenantId, agentId, period, periodKey) >= limitCents;
  }
}

// ─── Agent observability ──────────────────────────────────────────────────────
/** Admin should see: Agent, Run, Task, Duration, Model, Tool Calls, Errors,
 * Cost, Outcome, Blocked Actions. Never expose private prompts unnecessarily
 * (Phase 14 §46). */
export type AgentRunOutcome = "success" | "failure" | "blocked" | "cancelled" | "timed_out";

export interface ObservabilityRecord {
  agentId: string;
  version: string;
  runId: string;
  taskId: string;
  durationMs: number;
  model: string;
  toolCalls: number;
  errors: number;
  costCents: number;
  outcome: AgentRunOutcome;
  blockedActions: number;
  createdAt: number;
}

export interface ObservabilityStore {
  record(record: ObservabilityRecord): void;
  list(agentId?: string, limit?: number): ObservabilityRecord[];
}

export class InMemoryObservabilityStore implements ObservabilityStore {
  private records: ObservabilityRecord[] = [];
  record(record: ObservabilityRecord): void {
    this.records.push(record);
  }
  list(agentId?: string, limit = 100): ObservabilityRecord[] {
    let list = this.records;
    if (agentId) list = list.filter((r) => r.agentId === agentId);
    return list.slice(-limit);
  }
}

// ─── Agent approval workflow (singleton) ──────────────────────────────────────
export const approvalWorkflow = new AgentApprovalWorkflow();

// ─── Convenience: run a single-agent task ─────────────────────────────────────
export async function runAgentTask(agentId: string, task: { goal: string; structuredGoal?: Record<string, unknown>; constraints?: OrchestratorConstraints; correlationId?: string; causationId?: string }): Promise<{ runId: string; status: string; output?: StructuredOutput }> {
  const def = getAgentDefinition(agentId);
  if (!def) return { runId: `unknown-${Date.now()}`, status: "failed", output: undefined };
  const runtime = new AgentRuntime(
    def,
    {
      id: `task-${Date.now()}`,
      agentId,
      versionId: def.version,
      userId: "user", // placeholder; real system resolves from auth
      tenantId: "tenant",
      workspaceId: "default",
      goal: task.goal,
      structuredGoal: task.structuredGoal as any,
      expectedOutput: { format: "report", includeEvidence: true },
      constraints: task.constraints ?? {},
      metadata: {},
      createdBy: "orchestrator",
      trigger: { type: "orchestrator" },
      correlationId: task.correlationId,
      causationId: task.causationId,
      createdAt: Date.now(),
    },
  );
  runtime.start();
  runtime.beginExecution();
  runtime.observe("observed", `Agent '${agentId}' started task: ${task.goal}`, "orchestrator");
  runtime.decide("proceed", `Starting task.`, [], 0.9, []);
  runtime.complete();
  return { runId: runtime.taskId, status: runtime.status, output: undefined };
}
