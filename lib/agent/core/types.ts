// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Core Types
//
// Shared vocabulary for the whole agent subsystem. Kept dependency-free: this
// file imports nothing from Firebase, AI or the filesystem so every type here
// can be safely used from client components, tests and API routes.
// ─────────────────────────────────────────────────────────────────────────────

// ── Modes ────────────────────────────────────────────────────────────────────

export type AgentMode = "ask" | "assist" | "engineer" | "autonomous";

export const AGENT_MODES: readonly AgentMode[] = ["ask", "assist", "engineer", "autonomous"];

export const MODE_DESCRIPTIONS: Record<AgentMode, string> = {
    ask: "Read-only analysis. Inspects the project, answers, proposes changes without applying them.",
    assist: "Read + controlled editing with visible changes. No test runs or commits.",
    engineer: "Plan → edit → test → verify → fix. Git commit requires confirmation.",
    autonomous: "Engineer capabilities applied iteratively within strict run limits.",
};

// ── Tools ────────────────────────────────────────────────────────────────────

export type ToolCategory = "filesystem" | "git" | "terminal" | "tests" | "knowledge" | "memory" | "context";

export interface ToolResult {
    ok: boolean;
    /** Redacted, size-capped output safe for model + UI. */
    output?: string;
    /** Structured result (already sanitized), when the tool produces one. */
    data?: unknown;
    /** Deny/block reason when ok === false. */
    error?: string;
    /** Stable error code when applicable (policy_denied, command_blocked, …). */
    code?: string;
    /** Wall-clock duration in ms. */
    durationMs?: number;
}

export interface ToolExecutionContext {
    runId: string;
    /** Authenticated operator uid (memory scoping + usage attribution). */
    uid: string;
    mode: AgentMode;
    /** AbortSignal bound to the run's cancel button. */
    signal: AbortSignal;
    /** Workspace-relative path scope hint, when the task targets an area. */
    scopeHint?: string;
    /** Limit tracker for this run. */
    limits: RunLimitsState;
    /** Append an operational event (UI + persistence). */
    emit: (event: AgentEvent) => void;
}

export interface AgentTool {
    id: string;
    description: string;
    category: ToolCategory;
    /** JSON-schema-ish description of args, for the planner prompt and validation. */
    argsHint: string;
    execute: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>;
}

/**
 * Helper for building AgentTool objects from a guarded executor function.
 * The executor receives (args, ctx) and returns ToolResult; metadata is static.
 */
export function defineTool(
    meta: Pick<AgentTool, "id" | "description" | "category" | "argsHint">,
    executor: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolResult>,
): AgentTool {
    return { ...meta, execute: executor };
}

// ── Events (operational log — NO private chain-of-thought) ───────────────────

export type AgentEventType =
    | "run_started"
    | "run_ended"
    | "status"             // human-readable progress ("Inspecting repository…")
    | "plan_created"
    | "plan_step_started"
    | "plan_step_done"
    | "plan_step_failed"
    | "tool_started"
    | "tool_done"
    | "tool_denied"        // policy refusal
    | "files_changed"
    | "diff_ready"
    | "tests_started"
    | "tests_result"
    | "verification"
    | "confirmation_required"
    | "confirmation_granted"
    | "memory_hit"
    | "rule_violation"     // project-rule conflict detected
    | "budget_exceeded"
    | "limit_reached"
    | "error"
    | "cancelled";

export interface AgentEvent {
    seq: number;
    runId: string;
    type: AgentEventType;
    message: string;
    at: number;
    /** Optional structured payload (paths, test names, verdicts) — sanitized. */
    data?: Record<string, unknown>;
}

// ── Plans ────────────────────────────────────────────────────────────────────

export interface PlanStep {
    id: string;
    title: string;
    /** Tool ids this step intends to use, informative for the UI. */
    tools: string[];
    /** Files the step expects to touch (workspace-relative, best-effort). */
    expectedPaths?: string[];
    detail?: string;
}

export interface AgentPlan {
    summary: string;
    steps: PlanStep[];
    /** Areas of the repo the plan expects to affect. */
    affectedAreas: string[];
    /** Risks the plan itself flags (surfaced to the user before execution). */
    risks: string[];
    /** True when the plan should NOT execute automatically (needs user review). */
    requiresReview?: boolean;
    /** Inferred task kind, drives verification defaults. */
    taskKind?: "feature" | "bugfix" | "refactor" | "test" | "docs" | "analysis" | "unknown";
}

// ── Limits ───────────────────────────────────────────────────────────────────

export interface RunLimits {
    /** Maximum planner/executor loop iterations. */
    maxIterations: number;
    /** Maximum files the agent may modify in one run. */
    maxChangedFiles: number;
    /** Maximum terminal commands per run. */
    maxTerminalCommands: number;
    /** Maximum wall-clock runtime in ms. */
    maxRuntimeMs: number;
    /** Maximum AI requests per run (belt-and-braces on top of the budget guard). */
    maxAIRequests: number;
    /** Maximum retry count per failed step. */
    maxRetriesPerStep: number;
}

export interface RunLimitsState {
    limits: RunLimits;
    iterations: number;
    filesChanged: string[];
    terminalCommands: number;
    aiRequests: number;
    startedAt: number;
    retriesByStep: Record<string, number>;
}

export function createLimitsState(limits: RunLimits): RunLimitsState {
    return {
        limits,
        iterations: 0,
        filesChanged: [],
        terminalCommands: 0,
        aiRequests: 0,
        startedAt: Date.now(),
        retriesByStep: {},
    };
}

/** Default limits per mode. Autonomous is deliberately tighter, not looser. */
export function defaultLimitsFor(mode: AgentMode): RunLimits {
    switch (mode) {
        case "ask":
            return { maxIterations: 2, maxChangedFiles: 0, maxTerminalCommands: 6, maxRuntimeMs: 3 * 60_000, maxAIRequests: 8, maxRetriesPerStep: 0 };
        case "assist":
            return { maxIterations: 4, maxChangedFiles: 6, maxTerminalCommands: 10, maxRuntimeMs: 5 * 60_000, maxAIRequests: 16, maxRetriesPerStep: 1 };
        case "engineer":
            return { maxIterations: 8, maxChangedFiles: 12, maxTerminalCommands: 24, maxRuntimeMs: 10 * 60_000, maxAIRequests: 30, maxRetriesPerStep: 2 };
        case "autonomous":
            return { maxIterations: 12, maxChangedFiles: 15, maxTerminalCommands: 30, maxRuntimeMs: 12 * 60_000, maxAIRequests: 40, maxRetriesPerStep: 2 };
    }
}

/** True when any hard limit is exhausted (drives safe stop). */
export function isLimitReached(state: RunLimitsState): { reached: boolean; which?: string } {
    if (state.iterations >= state.limits.maxIterations) {
        return { reached: true, which: "maxIterations" };
    }
    if (state.limits.maxChangedFiles > 0 && state.filesChanged.length >= state.limits.maxChangedFiles) {
        return { reached: true, which: "maxChangedFiles" };
    }
    if (state.limits.maxChangedFiles === 0 && state.filesChanged.length > 0) {
        return { reached: true, which: "maxChangedFiles" };
    }
    if (state.terminalCommands >= state.limits.maxTerminalCommands) {
        return { reached: true, which: "maxTerminalCommands" };
    }
    if (state.aiRequests >= state.limits.maxAIRequests) {
        return { reached: true, which: "maxAIRequests" };
    }
    if (Date.now() - state.startedAt >= state.limits.maxRuntimeMs) {
        return { reached: true, which: "maxRuntimeMs" };
    }
    return { reached: false };
}

// ── Run records (RTDB-persisted safe metadata) ───────────────────────────────

export type AgentRunStatus = "planning" | "awaiting_confirmation" | "running" | "completed" | "failed" | "cancelled";

export interface AgentRunRecord {
    runId: string;
    taskId: string;
    /** The user's request, redacted. */
    request: string;
    mode: AgentMode;
    status: AgentRunStatus;
    createdAt: number;
    updatedAt: number;
    finishedAt?: number | null;
    /** Auto-incrementing operation event count, for cheap pagination. */
    eventCount?: number;
    /** Final concise report (verification results, summary). */
    summary?: string | null;
    /** Verification snapshot: typecheck/lint/tests/build verdicts. */
    verification?: Record<string, string> | null;
    /** Workspace-relative paths changed by THIS run (agent-generated, not user). */
    filesChanged?: string[] | null;
    /** Counters — no secrets. */
    stats?: {
        toolCalls?: number;
        terminalCommands?: number;
        aiRequests?: number;
        deniedCalls?: number;
        confirmations?: number;
    } | null;
    /** Redacted errors observed. */
    errors?: string[] | null;
    /** Budget/usage metadata from the AI gateway (estimated cost unknown ⇒ null). */
    usage?: {
        estimatedCostUsd?: number | null;
        totalTokens?: number | null;
        providers?: string[] | null;
    } | null;
}

// ── Approvals ────────────────────────────────────────────────────────────────

export interface PendingConfirmation {
    confirmCode: string;
    runId: string;
    toolId: string;
    /** Redacted summary of what is being confirmed. */
    description: string;
    createdAt: number;
    status: "pending" | "granted" | "denied";
}

// ── Memory ───────────────────────────────────────────────────────────────────

export type MemoryKind =
    | "project_decision"
    | "architecture_constraint"
    | "completed_task"
    | "known_regression"
    | "resolved_error"
    | "implementation_pattern";

export interface AgentMemoryEntry {
    id: string;
    kind: MemoryKind;
    title: string;
    body: string;
    tags: string[];
    createdAt: number;
    updatedAt: number;
    createdBy?: string | null;
    /** How often memory retrieval matched this entry (operational metric). */
    hits?: number | null;
}

// ── Project rules (rule engine) ──────────────────────────────────────────────

export interface ProjectRule {
    id: string;
    title: string;
    /** Human explanation, shown in the UI when a conflict is detected. */
    rationale: string;
    /**
     * Test whether a planned change conflicts with the rule. Given the file
     * paths + a diff summary, return a conflict description or null.
     * Pure function of its inputs.
     */
    detect: (input: RuleDetectionInput) => string | null;
    severity: "block" | "warn";
}

export interface RuleDetectionInput {
    paths: string[];
    /** Short textual summary of intended change (redacted). */
    changeSummary: string;
    /** Unified-diff snippet when available. */
    diffText?: string;
}

// ── Scope classification ─────────────────────────────────────────────────────

export type ScopeVerdict = "in_scope" | "out_of_scope" | "ambiguous";

export interface ScopeCheck {
    verdict: ScopeVerdict;
    reason: string;
}
