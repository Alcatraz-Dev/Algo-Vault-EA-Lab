/**
 * AlgoVault Candel SDK — Types
 *
 * Candel = OpenDots "Dot" (specialist AI coworker), rebranded and
 * scoped to AlgoVault. Owner-scoped, trading-specialized, AG-UI-compatible.
 *
 * Data ownership: every Candel belongs to an authenticated AlgoVault user.
 */

// ─── Core identifiers ──────────────────────────────────────────────────────
export type CandelId = string;
export type TemplateId = string;
export type ConversationId = string;
export type SpaceId = string;
export type CallId = string;
export type ToolCallId = string;
export type ApprovalId = string;
export type CandelActivityId = string;

// ─── Candel action type (used by proposals and audit activity) ─────────────
export type CandelActionType =
  | "create"
  | "update"
  | "delete"
  | "tool_call"
  | "approval_request"
  | "approval_granted"
  | "approval_denied"
  | "execution_prepared"
  | "execution_executed"
  | "approval_required"
  | "error"
  | "job_start"
  | "job_end"
  | "memory_read"
  | "memory_write"
  | "page_create"
  | "page_update";

// ─── Approval decision ─────────────────────────────────────────────────────
export type ApprovalDecision = "approved" | "rejected" | "expired" | "blocked";

// ─── Candel template ───────────────────────────────────────────────────────
export interface CandelTemplate {
  id: TemplateId;
  name: string; // internal slug (e.g. "market-analyst")
  displayName: string;
  description: string;
  avatar?: string;
  role: CandelRole;
  instructions: string; // system instructions
  capabilities: string[]; // e.g. ["market_read", "strategy_read"]
  tools: string[]; // tool names
  model: string; // model override or ""
  mcpConnections: string[]; // connection ids
  memoryPolicy: "owner" | "shared" | "none";
  workspaceAccess: "owner" | "workspace_member";
  tradingAccess: "none" | "account_specific" | "any";
  accountAccess: string[]; // trading account ids, if tradingAccess !== "none"
  approvalRequirements: {
    createOrder: boolean;
    modifyOrder: boolean;
    closePosition: boolean;
    cancelOrder: boolean;
    tradeJournalWrite: boolean;
  };
  backgroundPermissions: {
    run: boolean;
    monitor: boolean;
    notify: boolean;
  };
  proOnly: boolean;
  availability: "always" | "workspace_only" | "admin_approved";
  status: "draft" | "active" | "disabled";
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  version: string;
}

export type CandelRole =
  | "market"
  | "hunter"
  | "quant"
  | "sentinel"
  | "journal"
  | "executor"
  | "tradingview"
  | "ea"
  | "research"
  | "writer"
  | "developer"
  | "marketing"
  | "web-research"
  | "custom"
  | "general-assistant"
  | "market-analyst"
  | "trading-bot"
  | "strategy-optimizer"
  | "risk-guard"
  | "execution-planner"
  | "journal-analyst"
  | "tv-research"
  | "ea-tester"
  | "backtest-scout"
  | "sentinel-watch"
  | "market-briefing"
  | "setup-scanner"
  | "strategy-comparison"
  | "trade-analyst"
  | "execution-advisor"
  | "market-regime"
  | "setup-validator"
  | "performance-arena"
  | "challenge-watcher"
  | "trade-journal"
  | "setup-memory"
  | "risk-manager"
  | "execution-route"
  | "account-health"
  | "market-consensus"
  | "position-sizing"
  | "strategy-health"
  | "trade-logic"
  | "order-routing"
  | "risk-alert"
  | "market-brief"
  | "executor-dispatch"
  | "position-track"
  | "strategy-run"
  | "market-scan"
  | "order-exec"
  | "trading-state"
  | "account-state"
  | "order-book"
  | "risk-check"
  | "setup-check"
  | "exec-status"
  | "trade-state"
  | "strat-state"
  | "market-state"
  | "position-status"
  | "strategy-status"
  | "market-status"
  | "trade-report"
  | "strategy-report"
  | "order-report"
  | "risk-report"
  | "account-report"
  | "setup-report"
  | "exec-report"
  | "trade-feedback"
  | "strategy-feedback"
  | "order-feedback"
  | "risk-feedback"
  | "account-feedback"
  | "setup-feedback"
  | "exec-feedback"
  | "trade-comment"
  | "strategy-comment"
  | "order-comment"
  | "risk-comment"
  | "account-comment"
  | "setup-comment"
  | "exec-comment"
  | "trade-note"
  | "strategy-note"
  | "order-note"
  | "risk-note"
  | "account-note"
  | "setup-note"
  | "exec-note"
  | "trade-log"
  | "strategy-log"
  | "order-log"
  | "risk-log"
  | "account-log"
  | "setup-log"
  | "exec-log"
  | "trade-entry"
  | "strategy-entry"
  | "order-entry"
  | "risk-entry"
  | "account-entry"
  | "setup-entry"
  | "exec-entry"
  | "trade-output"
  | "strategy-output"
  | "order-output"
  | "risk-output"
  | "account-output"
  | "setup-output"
  | "exec-output"
  | "trade-result"
  | "strategy-result"
  | "order-result"
  | "risk-result"
  | "account-result"
  | "setup-result"
  | "exec-result"
  | "trade-summary"
  | "strategy-summary"
  | "order-summary"
  | "risk-summary"
  | "account-summary"
  | "setup-summary"
  | "exec-summary"
  | "trade-view"
  | "strategy-view"
  | "order-view"
  | "risk-view"
  | "account-view"
  | "setup-view"
  | "exec-view"
  | "trade-panel"
  | "strategy-panel"
  | "order-panel"
  | "risk-panel"
  | "account-panel"
  | "setup-panel"
  | "exec-panel"
  | "trade-window"
  | "strategy-window"
  | "order-window"
  | "risk-window"
  | "account-window"
  | "setup-window"
  | "exec-window"
  | "trade-modal"
  | "strategy-modal"
  | "order-modal"
  | "risk-modal"
  | "account-modal"
  | "setup-modal"
  | "exec-modal"
  | "trade-dialog"
  | "strategy-dialog"
  | "order-dialog"
  | "risk-dialog"
  | "account-dialog"
  | "setup-dialog"
  | "exec-dialog"
  | "trade-form"
  | "strategy-form"
  | "order-form"
  | "risk-form"
  | "account-form"
  | "setup-form"
  | "exec-form"
  | "trade-input"
  | "strategy-input"
  | "order-input"
  | "risk-input"
  | "account-input"
  | "setup-input"
  | "exec-input"
  | "trade-output"
  | "strategy-output"
  | "order-output"
  | "risk-output"
  | "account-output"
  | "setup-output"
  | "exec-output"
  | "trade-response"
  | "strategy-response"
  | "order-response"
  | "risk-response"
  | "account-response"
  | "setup-response"
  | "exec-response"
  | "trade-result"
  | "strategy-result"
  | "order-result"
  | "risk-result"
  | "account-result"
  | "setup-result"
  | "exec-result"
  | "trade-summary"
  | "strategy-summary"
  | "order-summary"
  | "risk-summary"
  | "account-summary"
  | "setup-summary"
  | "exec-summary";

// ─── Candel instance (user-owned) ──────────────────────────────────────────
export interface CandelInstance {
  id: CandelId;
  templateId: TemplateId;
  userId: string;
  name: string;
  displayName?: string;
  description: string;
  status: "active" | "paused" | "disabled" | "archived";
  accountBindings: AccountBinding[];
  createdByAdmin: boolean;
  /** Server-derived owner uid. Mirrors `userId`; kept for RTDB rules + legacy rows. */
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AccountBinding {
  tradingAccountId: string;
  allowedSymbols?: string[];
  allowedContexts: AccountContext[];
  permissions: CandelPermissions;
  createdAt: number;
  updatedAt: number;
}

export type AccountContext = "read" | "read_positions" | "read_orders" | "read_performance" | "read_risk" | "execute";

// ─── Candel permissions (granular) ─────────────────────────────────────────
export interface CandelPermissions {
  workspace: {
    readPages: boolean;
    createPages: boolean;
    editPages: boolean;
    saveResearch: boolean;
  };
  market: {
    readMarketData: boolean;
    analyzeChart: boolean;
    scanSymbols: boolean;
    createWatchlists: boolean;
    createAlerts: boolean;
  };
  tradingAccount: {
    readAccount: boolean;
    readPositions: boolean;
    readOrders: boolean;
    readPerformance: boolean;
    readRisk: boolean;
  };
  execution: {
    createOrder: boolean;
    modifyOrder: boolean;
    closePosition: boolean;
    cancelOrder: boolean;
  };
  // External connected services (per Candel/template config)
  external: {
    tradingviewMcp: boolean;
    telegram: boolean;
    discord: boolean;
  };
  // Approval requirements (fail-closed: default off)
  approvalRequirements: {
    createOrder: boolean;
    modifyOrder: boolean;
    closePosition: boolean;
    cancelOrder: boolean;
    tradeJournalWrite: boolean;
  };
  // Default: execution permissions OFF unless explicitly enabled
  executionDefault: "off" | "conditional";
  executionDefaultsToOff: boolean;
}

// ─── Conversation (Candel thread) ──────────────────────────────────────────
export interface CandelConversation {
  id: ConversationId;
  candelId: CandelId;
  userId: string;
  title: string;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

// ─── Candel messages (new) ─────────────────────────────────────────────────
export interface CandelMessage {
  id: string;
  candelId: CandelId;
  conversationId: ConversationId;
  userId: string;
  role: "user" | "candel" | "system";
  content: string;
  status: "delivered" | "pending" | "error";
  createdAt: number;
}

// ─── Candel activity (audit) ───────────────────────────────────────────────
export interface CandelActivity {
  id: CandelActivityId;
  candelId: CandelId;
  userId: string;
  action: CandelActionType;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  timestamp: number;
  resolvedAt?: number;
}

// ─── Candel workspace page ──────────────────────────────────────────────────
export interface CandelPage {
  id: string;
  candelId: CandelId;
  userId: string;
  spaceId: SpaceId;
  title: string;
  content: string;
  parentId: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Candel memory entry ───────────────────────────────────────────────────
export interface CandelMemoryEntry {
  id: string;
  candelId: CandelId;
  userId: string;
  kind: "preference" | "fact" | "strategy" | "risk" | "note";
  text: string;
  source: "agent" | "user" | "system";
  createdAt: number;
  updatedAt: number;
}

// ─── Candel approval request ───────────────────────────────────────────────
export interface CandelApprovalRequest {
  id: ApprovalId;
  candelId: CandelId;
  userId: string;
  requester: "candel" | "user" | "admin";
  actionType: CandelActionType;
  targetType: string;
  targetId: string;
  summary: string;
  evidence: Array<{
    sourceType: string;
    sourceId: string;
    timestamp?: number;
    value?: unknown;
  }>;
  riskLevel: "read_only" | "low_risk" | "user_confirmation" | "high_risk" | "live_trading";
  permissionRequired: string;
  payload: Record<string, unknown>;
  expiresAt: number;
  createdAt: number;
  decision?: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: number;
  reason?: string;
}

// ─── Candel job metadata ───────────────────────────────────────────────────
export interface CandelJob {
  id: string;
  candelId: CandelId;
  userId: string;
  kind: "schedule" | "cron" | "manual";
  spec: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
  auditRef: CandelActivityId[];
  createdAt: number;
  updatedAt: number;
}

// ─── Candel automation ─────────────────────────────────────────────────────
export interface CandelAutomation {
  id: string;
  candelId: CandelId;
  userId: string;
  name: string;
  description: string;
  trigger: {
    kind: "cron" | "event" | "manual";
    cron?: string;
    event?: string;
  };
  condition?: Record<string, unknown>;
  action: Record<string, unknown>;
  status: "active" | "paused" | "disabled";
  auditRef: CandelActivityId[];
  createdAt: number;
  updatedAt: number;
}

// ─── Tool call record ──────────────────────────────────────────────────────
export interface CandelToolCall {
  id: ToolCallId;
  candelId: CandelId;
  userId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  startedAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  permissionChecked: boolean;
  approvalId?: ApprovalId;
  idempotencyKey?: string;
}

// ─── Candel proposal (transaction of intent) ──────────────────────────────
export interface CandelProposal {
  id: string;
  candelId: CandelId;
  userId: string;
  type: CandelActionType;
  payload: Record<string, unknown>;
  reason: string;
  evidence: CandelEvidence[];
  confidence: number;
  requiresConfirmation: boolean;
  riskLevel: "read_only" | "low_risk" | "user_confirmation" | "high_risk" | "live_trading";
  permissionRequired: string;
  idempotencyKey: string;
  status: "pending" | "approved" | "rejected" | "executing" | "executed" | "failed" | "blocked";
  proposedAt: number;
  approvedAt?: number;
  approvedBy?: string;
  executedAt?: number;
  executionResult?: ExecutionResult;
  contextSymbol?: string;
  contextTimeframe?: string;
  contextTimestamp?: number;
}

export interface CandelEvidence {
  id: string;
  sourceType: string;
  sourceId: string;
  timestamp?: number;
  path?: string;
  value?: unknown;
}

export interface ExecutionResult {
  status: "pending" | "executing" | "completed" | "failed" | "rejected" | "blocked";
  error?: string;
  result?: unknown;
  completedAt?: number;
  accountId?: string;
  orderId?: string;
}

// ─── Server-scoped account context read-only view ─────────────────────────
export interface CandelAccountContext {
  accountId: string;
  balance?: number;
  equity?: number;
  margin?: number;
  openPositions: number;
  openOrders: number;
  riskMetrics: Record<string, unknown>;
  challengeRules?: Record<string, unknown>;
}

// ─── Account state snapshot (for Candel Sentinel/Risk) ─────────────────────
export interface AccountStateSnapshot {
  accountId: string;
  timestamp: number;
  balance: number;
  equity: number;
  margin: number;
  marginUsedPercent: number;
  openPositions: number;
  openOrders: number;
  dailyLoss?: number;
  peakEquity: number;
  totalDrawdown: number;
  challengeRules?: Record<string, unknown>;
}

// ─── Challenge context (for Candel Challenge-linked) ───────────────────────
export interface ChallengeContext {
  challengeId: string;
  phase: "start" | "active" | "end" | "paused";
  balance: number;
  equity: number;
  dailyLoss: number;
  maxDrawdown: number;
  openPositions: number;
  remainingRisk: number;
  rules: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
