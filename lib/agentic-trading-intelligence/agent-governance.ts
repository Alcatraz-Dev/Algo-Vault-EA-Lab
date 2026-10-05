/** AlgoVault Agentic Trading Intelligence — Agent Governance (Phase 14 §59)

 * Every agent has: agentId, version, owner, status, permissions, allowedTools,
 * maxRuntime, maxCost, maxActions, riskLevel.
 * Agent status lifecycle: DRAFT → TESTING → APPROVED → ACTIVE → PAUSED → DISABLED → RETIRED
 */

import type { AgentPermission, AgentRiskLevel } from "./contracts";

// Re-exported so sibling modules can pull the shared permission vocabulary
// through this module without importing the contracts barrel directly.
export type { AgentPermission } from "./contracts";

// ─── Agent Governance ──────────────────────────────────────────────────────────
export interface AgentGovernance {
  agentId: string;
  version: string;
  owner: string;
  status: AgentStatus;
  permissions: AgentPermission[];
  allowedTools: string[];
  maxRuntimeMs: number;
  maxCostPerRunCents: number;
  maxActionsPerRun: number;
  riskLevel: AgentRiskLevel;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  approvalHistory: ApprovalRecord[];
}

export type AgentStatus =
  | "draft"
  | "testing"
  | "approved"
  | "active"
  | "paused"
  | "disabled"
  | "retired";

export interface ApprovalRecord {
  approvedBy: string;
  approvedAt: number;
  status: AgentStatus;
  reason?: string;
  requirements: string[];
  testsPassed: boolean;
}

// ─── Agent Approval ────────────────────────────────────────────────────────────
/** An agent must pass: schema validation, tool validation, security tests,
 * safety tests, evaluation suite before becoming ACTIVE (Phase 14 §60). */
export interface AgentApproval {
  agentId: string;
  version: string;
  schemaValid: boolean;
  toolsValid: boolean;
  securityTestsPassed: boolean;
  safetyTestsPassed: boolean;
  evaluationPassed: boolean;
  approvedBy: string;
  approvedAt: number;
  status: AgentStatus;
}

// ─── Agent Versioning ─────────────────────────────────────────────────────────
/** Every meaningful agent change creates a new version (Phase 14 §61). */
export interface AgentVersionRecord {
  agentId: string;
  version: string;
  createdAt: number;
  createdBy: string;
  immutable: true;
}

// ─── Agent Snapshots ──────────────────────────────────────────────────────────
/** For important runs, preserve: agentVersion, model, tools, contextSnapshot,
 * engineVersions, dataTimestamp, result, actions (Phase 14 §62). */
export interface AgentRunSnapshot {
  runId: string;
  agentVersion: string;
  model: string;
  tools: string[];
  contextSnapshot: string;
  engineVersions: Record<string, string>;
  dataTimestamp: number;
  result: unknown;
  actions: Array<{ id: string; type: string; payload: unknown; status: string }>;
  capturedAt: number;
}

// ─── Agent Multi-Tenancy ──────────────────────────────────────────────────────
/** Every agent run must be scoped by tenantId, userId, workspaceId.
 * Agents must never cross tenant boundaries (Phase 14 §63). */
export interface AgentTenantScope {
  tenantId: string;
  userId: string;
  workspaceId: string;
}

// ─── Agent B2B Contracts ──────────────────────────────────────────────────────
/** The Intelligence Cloud should eventually allow authorized B2B tenants to use agents.
 * Example: Prop Firm → Risk Monitoring Agent, Broker → Market Intelligence Agent,
 * Developer → Strategy Research Agent. Use the same agent infrastructure.
 * Do not create separate B2B agents (Phase 14 §64). */
export interface B2BAgentAccess {
  tenantId: string;
  userId: string;
  workspaceId: string;
  agentId: string;
  version: string;
  allowedTools: string[];
  permissions: AgentPermission[];
  maxRuntimeMs: number;
  maxCostPerRunCents: number;
  maxActionsPerRun: number;
  authorizedAt: number;
}

// ─── Agent API Contracts ──────────────────────────────────────────────────────
/** Expose controlled agent operations through Intelligence Cloud.
 * Examples: POST /api/v1/agents/runs, GET /api/v1/agents/runs/{id},
 * GET /api/v1/agents, POST /api/v1/agents/{id}/actions/{actionId}/approve
 * Only expose approved capabilities (Phase 14 §65). */
export interface AgentApiRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  tenantId: string;
  userId: string;
}

export interface AgentApiResponse {
  status: "success" | "error";
  data?: unknown;
  error?: string;
}

// ─── Agent Webhooks ───────────────────────────────────────────────────────────
/** Allow authorized subscribers to receive:
 * AGENT_RUN_STARTED, AGENT_RUN_COMPLETED, AGENT_ACTION_PROPOSED,
 * AGENT_ACTION_BLOCKED, AGENT_ACTION_APPROVED, AGENT_RESEARCH_CREATED,
 * AGENT_RISK_WARNING. Use existing webhook security (Phase 14 §66). */
export type AgentWebhookEvent =
  | "AGENT_RUN_STARTED"
  | "AGENT_RUN_COMPLETED"
  | "AGENT_ACTION_PROPOSED"
  | "AGENT_ACTION_BLOCKED"
  | "AGENT_ACTION_APPROVED"
  | "AGENT_RESEARCH_CREATED"
  | "AGENT_RISK_WARNING";

export interface AgentWebhookPayload {
  event: AgentWebhookEvent;
  tenantId: string;
  userId: string;
  runId?: string;
  agentId?: string;
  actionId?: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

// ─── Agent Observability ──────────────────────────────────────────────────────
/** Admin should see: Agent, Run, Task, Duration, Model, Tool Calls, Errors,
 * Cost, Outcome, Blocked Actions. Never expose private prompts unnecessarily
 * (Phase 14 §46). */
export interface AgentObservabilityRecord {
  agentId: string;
  version: string;
  runId: string;
  taskId: string;
  durationMs: number;
  model: string;
  toolCalls: number;
  errors: number;
  costCents: number;
  outcome: "success" | "failure" | "blocked" | "cancelled" | "timed_out";
  blockedActions: number;
  createdAt: number;
}

// ─── Agent Cost Control ───────────────────────────────────────────────────────
/** Track: model, tokens, latency, tool calls, compute, estimated cost.
 * Per: user, tenant, agent, task, day, month. Use limits (Phase 14 §45). */
export interface AgentCostRecord {
  userId: string;
  tenantId: string;
  agentId: string;
  taskId: string;
  model: string;
  tokens: number;
  latencyMs: number;
  toolCalls: number;
  computeMs: number;
  estimatedCostCents: number;
  period: "day" | "month";
  periodKey: string; // e.g. "2026-10-05" or "2026-10"
}

// ─── Agent Memory ─────────────────────────────────────────────────────────────
/** Memory categories: Task Memory, Research Memory, Setup Memory, Strategy Memory,
 * User Preference Memory, Execution Context. Must be structured, inspectable,
 * scoped, timestamped, permission-aware (Phase 14 §12). */
export interface AgentMemoryEntry {
  id: string;
  category: MemoryCategory;
  tenantId: string;
  userId: string;
  workspaceId: string;
  key: string;
  value: unknown;
  timestamp: number;
  expiresAt?: number;
  permissions: AgentPermission[];
}

export type MemoryCategory =
  | "task"
  | "research"
  | "setup"
  | "strategy"
  | "user_preference"
  | "execution_context";

// ─── Agent Learning ───────────────────────────────────────────────────────────
/** Agents may learn from structured historical outcomes: Hypothesis → Research →
 * Result → Outcome → Future research prioritization. But do not let agents modify
 * their own safety rules or permissions (Phase 14 §53). */
export interface AgentLearningRecord {
  hypothesisId: string;
  researchId: string;
  outcome: "supported" | "disproven" | "inconclusive";
  metrics: Record<string, unknown>;
  learnedAt: number;
  nextPriority?: number; // higher = more likely to be prioritized
}

// ─── Agent Self-Improvement ───────────────────────────────────────────────────
/** Allowed: improve prompts, improve tool selection, improve research prioritization,
 * improve explanation quality. Not allowed automatically: change risk limits,
 * grant permissions, enable live trading, bypass validation, rewrite execution logic.
 * Any system-level change requires controlled deployment (Phase 14 §54). */
export interface AgentSelfImprovement {
  agentId: string;
  version: string;
  improvementArea: "prompt" | "tool_selection" | "research_prioritization" | "explanation_quality";
  proposedChange: string;
  status: "proposed" | "approved" | "deployed" | "rejected";
  approvedBy?: string;
  deployedAt?: number;
}

// ─── Agent Loop Protection ────────────────────────────────────────────────────
/** Prevent: Agent → Research → Event → Agent → Research → Event → ...
 * Use: correlationId, causationId, maxDepth, cooldown, run limits (Phase 14 §37). */
export interface AgentLoopProtection {
  correlationId: string;
  causationId: string;
  maxDepth: number; // how many agent→research→event hops are allowed
  cooldownMs: number; // minimum time between re-triggers
  runLimit: number; // max runs per correlationId
}

// ─── Agent Idempotency ────────────────────────────────────────────────────────
/** Every mutating agent action must support idempotency:
 * actionId, requestId, correlationId. The same action must not execute twice because
 * of retries. This is especially important for live trading (Phase 14 §38). */
export interface AgentIdempotency {
  actionId: string;
  requestId: string;
  correlationId: string;
  idempotencyKey: string;
  processedAt?: number;
  status: "pending" | "processed" | "failed";
}

// ─── Agent Fail-Closed ────────────────────────────────────────────────────────
/** If: market data stale, risk unavailable, broker unavailable, account state unavailable,
 * strategy version unavailable, permissions unclear, tool response malformed
 * then: BLOCK ACTION. Do not guess (Phase 14 §39). */
export interface AgentFailClosedCondition {
  condition: FailClosedCondition;
  blocked: boolean;
  reason?: string;
}

export type FailClosedCondition =
  | "market_data_stale"
  | "risk_unavailable"
  | "broker_unavailable"
  | "account_state_unavailable"
  | "strategy_version_unavailable"
  | "permissions_unclear"
  | "tool_response_malformed";

// ─── Agent Model Routing ──────────────────────────────────────────────────────
/** Different tasks may use different models:
 * Fast model → classification
 * Reasoning model → research planning
 * Specialized model → report generation
 * Use provider abstraction. Do not hard-code one model (Phase 14 §41). */
export type AgentModelRoute =
  | "fast"
  | "reasoning"
  | "specialized";

export interface AgentModelConfiguration {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  route: AgentModelRoute;
}

// ─── Agent Evaluation ─────────────────────────────────────────────────────────
/** Create an evaluation framework. Test agents against known scenarios:
 * Correct market interpretation, correct tool selection, correct risk handling,
 * correct refusal, correct stale-data behavior, correct research planning,
 * correct action permissions. Measure: factual correctness, tool correctness,
 * safety, hallucination rate, latency, cost (Phase 14 §47). */
export interface AgentEvaluationCase {
  id: string;
  scenario: string;
  expectedBehavior: string;
  inputs: Record<string, unknown>;
  expectedToolCalls: string[];
  expectedPermissions: AgentPermission[];
  expectedRiskLevel: AgentRiskLevel;
  expectedRefusal: boolean;
}

export interface AgentEvaluationResult {
  caseId: string;
  agentId: string;
  version: string;
  factualCorrectness: number; // 0..1
  toolCorrectness: number; // 0..1
  safetyScore: number; // 0..1
  hallucinationRate: number; // 0..1
  latencyMs: number;
  costCents: number;
  passed: boolean;
  evaluatedAt: number;
}

// ─── Agent Adversarial Testing ────────────────────────────────────────────────
/** Test: Prompt injection, malicious strategy instructions, fake market data,
 * stale market data, conflicting tool results, missing risk data, broker disconnect,
 * permission escalation, cross-tenant requests, repeated actions.
 * The agent must fail safely (Phase 14 §48). */
export interface AdversarialTestCase {
  id: string;
  attackType: AdversarialAttackType;
  description: string;
  inputs: Record<string, unknown>;
  expectedSafeFailure: boolean;
  expectedBlockedAction: boolean;
  expectedRefusal: boolean;
}

export type AdversarialAttackType =
  | "prompt_injection"
  | "malicious_strategy_instructions"
  | "fake_market_data"
  | "stale_market_data"
  | "conflicting_tool_results"
  | "missing_risk_data"
  | "broker_disconnect"
  | "permission_escalation"
  | "cross_tenant_requests"
  | "repeated_actions";

export interface AdversarialTestResult {
  caseId: string;
  agentId: string;
  version: string;
  safeFailure: boolean;
  blockedAction: boolean;
  refusal: boolean;
  observedBehavior: string;
  testedAt: number;
  passed: boolean;
}

// ─── Agent Security ───────────────────────────────────────────────────────────
/** Never allow agent instructions to override system policy.
 * Untrusted content may include: strategy descriptions, marketplace descriptions,
 * user text, external documents, webhook payloads. Treat them as untrusted input
 * (Phase 14 §49). */
export interface AgentSecurityPolicy {
  allowUntrustedContent: boolean; // must be false for production
  untrustedContentSources: string[];
  policyOverridesAllowed: boolean; // must be false
  executeArbitraryNaturalLanguage: boolean; // must be false
}

// ─── External Data Safety ─────────────────────────────────────────────────────
/** If agents consume external data: validate source, timestamp, provenance,
 * freshness, permissions. Do not treat arbitrary external text as market truth
 * (Phase 14 §50). */
export interface ExternalDataValidation {
  source: string;
  timestamp: number;
  provenance: string;
  freshnessMs: number;
  permissions: AgentPermission[];
  valid: boolean;
  reason?: string;
}

// ─── Agent Reporting ──────────────────────────────────────────────────────────
/** Agents should produce structured reports:
 * Objective, Observed Facts, Analysis, Evidence, Risks, Decision, Actions,
 * Limitations, Next Steps. This format should be reusable across: research,
 * strategy health, market analysis, trade review (Phase 14 §51). */
export interface AgentReport {
  objective: string;
  observedFacts: string[];
  analysis: string[];
  evidence: Array<{ id: string; sourceType: string; sourceId: string; timestamp?: number; value?: unknown }>;
  risks: string[];
  decision: string;
  actions: Array<{ id: string; type: string; payload: unknown; status: string }>;
  limitations: string[];
  nextSteps: string[];
}

// ─── Agent Journal Integration ────────────────────────────────────────────────
/** After meaningful agent tasks: Agent Run → Result → Optional Journal Entry.
 * Do not automatically create excessive journal noise. Only meaningful events
 * should be recorded (Phase 14 §52). */
export interface AgentJournalIntegration {
  runId: string;
  taskId: string;
  agentId: string;
  result: AgentReport;
  journalEntry?: { id: string; createdAt: number };
  createdAt: number;
}

// ─── Agent Market Monitoring ──────────────────────────────────────────────────
/** Create intelligent monitoring agents:
 * XAUUSD → Market State Changes → Structure Event → Liquidity Event →
 * Setup Candidate → Agent Review → Alert / Wait
 * The agent should NOT emit a trading signal simply because a market event happened
 * (Phase 14 §55). */
export interface AgentMarketMonitor {
  agentId: string;
  symbol: string;
  timeframe: string;
  events: Array<{ type: string; timestamp: number; data: unknown }>;
  reviewResult?: AgentReviewResult;
}

export interface AgentReviewResult {
  status: "valid" | "invalid" | "waiting" | "insufficient_evidence";
  reason: string;
  evidence: Array<{ id: string; sourceType: string; sourceId: string }>;
}

// ─── Agent Setup Review ───────────────────────────────────────────────────────
/** For each candidate: Market Context, Structure, Liquidity, FVG, Order Block,
 * MTF Alignment, Strategy Alignment, Risk, Historical Similarity.
 * Then: VALID, INVALID, WAITING, INSUFFICIENT_EVIDENCE.
 * Use deterministic conditions where available (Phase 14 §56). */
export interface AgentSetupReview {
  candidateId: string;
  marketContext: unknown;
  structure: unknown;
  liquidity: unknown;
  fvg: unknown;
  orderBlock: unknown;
  mtfAlignment: unknown;
  strategyAlignment: unknown;
  risk: unknown;
  historicalSimilarity: unknown;
  status: "valid" | "invalid" | "waiting" | "insufficient_evidence";
  reason: string;
  evidence: Array<{ id: string; sourceType: string; sourceId: string }>;
}

// ─── Agent Research Discovery ─────────────────────────────────────────────────
/** Agents should be able to detect: Unexpected strategy behavior, Recurring setup,
 * Regime transition, Execution anomaly, Risk anomaly. Then create a research
 * hypothesis. This connects the entire learning loop (Phase 14 §57). */
export interface AgentResearchDiscovery {
  detected: boolean;
  type: "unexpected_strategy_behavior" | "recurring_setup" | "regime_transition" | "execution_anomaly" | "risk_anomaly";
  observation: string;
  hypothesis?: string;
  researchId?: string;
  createdAt: number;
}

// ─── Autonomous Learning Loop ─────────────────────────────────────────────────
/** Implement: MARKET → OBSERVE → DETECT → ANALYZE → HYPOTHESIZE → RESEARCH →
 * VALIDATE → PAPER → MONITOR → LEARN → RESEARCH AGAIN.
 * This is the core of Agentic AlgoVault (Phase 14 §58). */
export interface AutonomousLearningLoop {
  cycleId: string;
  currentState: LearningLoopState;
  marketObservation?: AgentMarketMonitor;
  detection?: AgentResearchDiscovery;
  analysis?: AgentReport;
  hypothesis?: AgentResearchDiscovery;
  researchId?: string;
  validation?: AgentEvaluationResult;
  paperResult?: unknown;
  monitorResult?: AgentReport;
  learning?: AgentLearningRecord;
  createdAt: number;
  updatedAt: number;
}

export type LearningLoopState =
  | "observing"
  | "detecting"
  | "analyzing"
  | "hypothesizing"
  | "researching"
  | "validating"
  | "paper"
  | "monitoring"
  | "learning"
  | "complete"
  | "blocked";

// ─── Agent-Driven Command Center ─────────────────────────────────────────────
/** The Intelligence OS should expose:
 * Active Agent Runs, Pending Approvals, Research Tasks, Strategy Warnings,
 * Risk Warnings, Agent Recommendations (Phase 14 §33). */
export interface AgentCommandCenterState {
  activeAgentRuns: number;
  pendingApprovals: number;
  researchTasks: number;
  strategyWarnings: number;
  riskWarnings: number;
  agentRecommendations: number;
  updatedAt: number;
}
