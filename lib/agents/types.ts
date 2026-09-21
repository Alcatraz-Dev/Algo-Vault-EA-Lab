/**
 * AlgoVault Multi-Agent Intelligence Engine — shared types.
 *
 * This is the contract layer of the Agent Orchestrator. Every agent,
 * workflow, execution and draft that flows through the system is typed
 * here so that:
 *   - agents return structured data (never unstructured natural language),
 *   - workflows are declarative (sequential / parallel / conditional),
 *   - permissions are explicit and enforceable,
 *   - execution traces are observable and real.
 *
 * Nothing in this module performs I/O. All runtime behaviour lives in
 * `runtime/`. All data access lives in `database.ts`.
 */

// ─── Agent identity & lifecycle ─────────────────────────────────────────────

export type AgentStatus =
    | "draft"
    | "testing"
    | "active"
    | "paused"
    | "disabled"
    | "deprecated";

export type AgentRole =
    | "scout"
    | "context"
    | "strategy-matcher"
    | "risk"
    | "news"
    | "pattern-discovery"
    | "structure"
    | "volatility"
    | "critic"
    | "verification"
    | "synthesis"
    | "notification"
    | "custom";

/**
 * Data domains an agent may access. This is the agent-side permission
 * vocabulary. `runtime/permissions.ts` maps these onto the caller's
 * effective entitlements (plugin manifest / extension / user) at execution
 * time — the permission layer is never bypassed.
 */
export type AgentPermission =
    | "market_data"
    | "historical_data"
    | "strategy_data"
    | "trading_history"
    | "portfolio_data"
    | "risk_data"
    | "news_data"
    | "ai_analysis"
    | "notifications"
    | "telegram"
    | "discord"
    | "webhook";

export type AgentPermissionSet = Partial<Record<AgentPermission, boolean>>;

/**
 * Standard agent output contract (spec § "Standard Agent Output").
 * Every agent — built-in or generated — resolves to this shape.
 */
export type AgentOutput = {
    agentId: string;
    status: "success" | "failed" | "skipped" | "blocked";
    /** Contextual confidence 0..1. Metadata for the Synthesizer — never a prediction probability. */
    confidence: number;
    summary: string;
    findings: AgentFinding[];
    /** Every important finding references the data used to reach it. */
    evidence: AgentEvidence[];
    warnings: string[];
    /** Symbols / contexts / datasets actually read. */
    dataUsed: string[];
    /** Machine-readable hint for the orchestrator (next registered step). */
    nextStep: string;
    error?: string;
    /** True when an AI provider augmented the deterministic core with narration. */
    aiEnhanced?: boolean;
    /** Structured values the orchestrator may read for branches (e.g. critic majorConflict). */
    metadata?: Record<string, unknown>;
};

export type AgentFinding = {
    id: string;
    title: string;
    detail: string;
    /** Evidence ids (see AgentEvidence) that back this finding. */
    evidence?: string[];
    tags?: string[];
};

export type AgentEvidence = {
    id: string;
    /** What was actually read, e.g. "market:XAUUSD:M5". */
    dataUsed: string;
    value?: number | string | boolean;
    note?: string;
};

// ─── Agent contract ─────────────────────────────────────────────────────────

/**
 * The registerable contract for a single agent (spec § "Agent Contract").
 * Built-ins ship in `catalog.ts`; AI-generated agents must pass through
 * validation before they can be registered.
 */
export type AgentContract = {
    id: string;
    name: string;
    version: string;
    role: AgentRole;
    description: string;
    capabilities: string[];
    requiredPermissions: AgentPermission[];
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    systemInstructions: string;
    tools: string[];
    modelConfiguration: {
        /** deterministic = measured data only; hybrid = deterministic core + optional AI narration. */
        poweredBy: "deterministic" | "hybrid";
        provider?: string;
        model?: string;
        temperature?: number;
        maxTokens?: number;
        responseFormat?: "text" | "json_object";
    };
    timeoutMs: number;
    retryPolicy: {
        maxRetries: number;
        backoffMs: number;
    };
    validationRules: {
        failOnError?: boolean;
        minConfidence?: number;
    };
    status: AgentStatus;
    createdBy?: string;
    createdAt?: number;
    updatedAt?: number;
};

// ─── Workflows ──────────────────────────────────────────────────────────────

export type WorkflowTrigger =
    | "manual"
    | "schedule"
    | "market_event"
    | "plugin"
    | "extension";

export type WorkflowStepMode = "sequential" | "parallel";

export type FailurePolicy = "retry" | "skip" | "abort" | "fallback";

export type WorkflowStep =
    | {
          id: string;
          mode: "sequential";
          agent: string;
          dependsOn?: string[];
          optional?: boolean;
          onFailure?: FailurePolicy;
          fallbackAgent?: string;
          timeoutMs?: number;
          note?: string;
      }
    | {
          id: string;
          mode: "parallel";
          agents: string[];
          dependsOn?: string[];
          optional?: boolean;
          onFailure?: FailurePolicy;
          timeoutMs?: number;
          note?: string;
      };

export type BranchOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";

/**
 * Conditional branch (spec § "Conditional Branching"). Evaluated between
 * steps against the live shared context. `source` is a path resolved by
 * the executor, e.g.:
 *   "flags.market_data_invalid",
 *   "outputs.critic.majorConflict",
 *   "outputs.critic.confidenceAdjustment",
 *   "variables.volatility_is_extreme".
 */
export type ConditionalBranch = {
    id: string;
    label?: string;
    source: string;
    operator: BranchOperator;
    value?: number | string | boolean;
    /** Action taken when the branch matches. */
    action: "abort" | "skipTo" | "markFlag";
    /** Step id for skipTo. */
    target?: string;
    /** Flag name for markFlag. */
    flag?: string;
    reason: string;
};

export type AgentNotifyChannel = "in_app" | "telegram" | "discord" | "email" | "webhook";

export type WorkflowDefinition = {
    id: string;
    name: string;
    version: string;
    description: string;
    status: AgentStatus;
    trigger: WorkflowTrigger;
    requiredPermissions: AgentPermission[];
    steps: WorkflowStep[];
    branches?: ConditionalBranch[];
    /** Whole-workflow wall-clock budget (ms). */
    timeoutMs: number;
    /** Default per-step budget (ms) when a step does not set its own. */
    defaultStepTimeoutMs?: number;
    retryPolicy?: { maxRetries: number; backoffMs: number };
    notification: {
        /** "auto" proceeds to the notification agent; "none" is pure analysis. */
        method: "auto" | "none";
        channels: AgentNotifyChannel[];
        /** Critic-first safety (spec §21). */
        requiresCritic: boolean;
        /** Behaviour when the critic reports a major contradiction. */
        onCriticConflict: "block" | "downgrade" | "notify_low";
        minConfidenceToNotify?: number;
        cooldownMin?: number;
        maxPerDay?: number;
        quietHoursStart?: string;
        quietHoursEnd?: string;
    };
    versionHistory?: string[];
    createdBy?: string;
    createdAt?: number;
    updatedAt?: number;
    changelog?: Record<string, string>;
};

// ─── Shared execution context (controlled agent memory) ─────────────────────

/**
 * The shared, permission-scoped context of one workflow execution
 * (spec § "Agent Memory"). Agents only ever read what the executor put
 * here — which is itself derived from declared permissions.
 */
export type WorkflowContext = {
    user: {
        uid: string | null;
        displayName?: string;
        /** Caller context: plugin id, extension id, admin test, etc. */
        context?: string;
        contextId?: string;
    };
    /** Live market snapshots keyed by symbol — only when market_data granted. */
    market: Record<string, unknown>;
    /** History objects (trades/positions) — only when trading_history granted. */
    history: { trades: unknown[]; positions: unknown[]; botCount: number; symbols: string[] };
    /** Computed risk context — only when risk_data / portfolio_data granted. */
    risk: { drawdownPercent: number; exposureRatio: number; positionCount: number; correlatedExposure: number; symbols: string[] };
    /** News / events — only when news_data granted. */
    news: { incoming: unknown[]; relevant: unknown[] };
    /** Strategy fingerprint context — only when strategy_data granted. */
    strategy: Record<string, unknown>;
    /** Mutable variables produced by branches/agents during the run. */
    variables: Record<string, unknown>;
    /** Flags raised by conditional branches. */
    flags: string[];
    /** Prior agent outputs in execution order. */
    agentOutputs: Record<string, AgentOutput>;
    config?: Record<string, unknown>;
};

// ─── Execution records / observability ──────────────────────────────────────

export type ExecutionOutcome = "running" | "success" | "failed" | "aborted" | "partial";

export type WorkflowExecutionRecord = {
    id: string;
    workflowId: string;
    workflowVersion: string;
    userId: string | null;
    trigger: WorkflowTrigger | "test" | "admin_test";
    triggeredBy?: { type: string; id?: string };
    status: ExecutionOutcome;
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    stepsTotal: number;
    stepsCompleted: number;
    stepsFailed: number;
    agentsRun: number;
    symbols: string[];
    finalOutput: WorkflowFinalOutput | null;
    errors: string[];
    aiCalls: number;
    estimatedCostUsd: number;
    notifyDecision?: {
        warranted: boolean;
        delivered: boolean;
        reason: string;
        channels?: string[];
        blockedBy?: string;
    };
    testOnly: boolean;
};

export type WorkflowStepRecord = {
    id: string;
    executionId: string;
    stepId: string;
    mode: WorkflowStepMode;
    agentIds: string[];
    status: "completed" | "failed" | "skipped" | "aborted";
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    condition?: { matched: boolean; action?: string; reason?: string };
    error?: string;
};

export type AgentExecutionRecord = {
    id: string;
    executionId: string;
    stepId: string;
    workflowId: string;
    workflowVersion: string;
    agentId: string;
    agentVersion: string;
    status: AgentOutput["status"];
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    retries: number;
    output: AgentOutput | null;
    model?: string;
    provider?: string;
    aiUsed: boolean;
    error?: string;
};

export type AgentLogRecord = {
    id: string;
    userId?: string | null;
    workflowId: string;
    executionId?: string;
    agentId?: string;
    level: "info" | "warn" | "error";
    message: string;
    createdAt: number;
};

/** Per-workflow / per-agent / per-model usage & cost accounting. */
export type AgentUsageRecord = {
    id: string;
    workflowId: string;
    agentId: string;
    provider: string;
    model: string;
    executions: number;
    aiCalls: number;
    /** null when the provider did not expose token counts. */
    tokensUsed: number | null;
    estimatedCostUsd: number;
    totalMs: number;
    successes: number;
    failures: number;
    lastExecutedAt: number;
};

// ─── Final synthesis output ─────────────────────────────────────────────────

export type EvidenceStrength =
    | "strong"
    | "moderate"
    | "limited"
    | "conflicting"
    | "insufficient";

/**
 * The structured intelligence a workflow produces (spec § "Example result").
 * Distinguishes facts from inference, includes uncertainty and conflicts,
 * and never asserts guaranteed outcomes.
 */
export type WorkflowFinalOutput = {
    workflowId: string;
    executionId: string;
    status: ExecutionOutcome;
    title: string;
    summary: string;
    context: {
        symbols: string[];
        regime?: string;
        volatility?: string;
        structure?: string;
        session?: string;
    };
    evidenceStrength: EvidenceStrength;
    facts: string[];
    inferences: string[];
    uncertainty: string[];
    conflicts: string[];
    critic: {
        majorConflict: boolean;
        criticism: string[];
        contradictoryEvidence: string[];
        missingEvidence: string[];
        riskFlags: string[];
        confidenceAdjustment: number;
    };
    risk: {
        drawdownPercent: number;
        exposureRatio: number;
        positionCount: number;
        correlatedExposure: number;
        flags: string[];
    };
    notify: {
        warranted: boolean;
        reason: string;
        severity: "low" | "medium" | "high";
        title: string;
        message: string;
    };
};

// ─── AI generation drafts ───────────────────────────────────────────────────

export type AgentSpecDraft = {
    kind: "agent" | "workflow";
    agent?: AgentContract;
    workflow?: WorkflowDefinition;
    capabilities?: string[];
    testCases: string[];
    /** Capabilities the generator wanted but that are unsupported by the registry. */
    unsupportedCapabilities?: { required: string; suggestedImplementation: string }[];
};

export type AgentDraft = {
    id: string;
    kind: "agent" | "workflow";
    name: string;
    displayName: string;
    description: string;
    spec: AgentSpecDraft;
    validation: {
        schema: boolean;
        permissions: boolean;
        security: boolean;
        workflow: boolean;
        sandbox: boolean;
        tests: boolean;
    };
    validationMessages: string[];
    status: "generated" | "passed" | "rejected" | "published";
    createdBy: string;
    createdAt: number;
    updatedAt: number;
};

export type AgentGenerationJob = {
    id: string;
    kind: "agent" | "workflow";
    prompt: string;
    status: "queued" | "generating" | "done" | "failed";
    error?: string;
    draftId?: string;
    createdBy: string;
    createdAt: number;
    finishedAt: number | null;
};

export type AgentAuditLog = {
    id: string;
    actor: string;
    action: string;
    agentId?: string;
    workflowId?: string;
    detail: Record<string, unknown>;
    createdAt: number;
};