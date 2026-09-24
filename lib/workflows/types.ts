/**
 * Workflow Automation Engine — shared types.
 *
 * The Workflow Automation domain is a user-facing, Pro-gated n8n-style
 * node/edge DAG engine layered on AlgoVault's existing infrastructure
 * (AI Router, notifications, market data, risk engine, gateway, subscriptions).
 *
 * Canonical location: `lib/workflows/` — do not fork into another module.
 */

// ─── Graph model ─────────────────────────────────────────────────────────────

/** Aggregated permission classes enforced server-side (analysis | signal | execution). */
export type WorkflowPermissionLevel = "analysis" | "signal" | "execution";

export type NodeCategory =
    | "trigger"        // manual / schedule / webhook
    | "market_data"    // quotes, candles, live market state (fetch-once per run)
    | "technical"      // TA indicators computed locally over candle data
    | "ai"             // AI analysis through the canonical AI Router (validated)
    | "logic"          // condition / delay / set variable
    | "risk"           // risk checks & position sizing (server-enforced)
    | "signal"         // create a signal artifact (analysis → signal boundary)
    | "execution"      // order requests via gateway (explicit execution grant)
    | "notification"   // in-app / telegram / discord / email / webhook delivery
    | "integration"    // AlgoVault integrations (scan, economic calendar)
    | "storage"        // RTDB read/write against whitelisted user paths
    | "http"           // outbound HTTP (SSRF-protected, no secret exposure)
    | "transform"      // template rendering / JSON shaping
    | "simulation"     // backtest / simulation over fetched data
    | "reports"       // structured report generation (real data only)
    | "marketing";     // AI marketing content factory (analysis-gated)

export interface WorkflowNode {
    id: string;
    /** Dotted type: `<category>.<kind>` — must exist in the node registry. */
    type: string;
    label?: string;
    description?: string;
    /** Disabled nodes are skipped but stay in the graph. */
    enabled?: boolean;
    position: { x: number; y: number };
    config: Record<string, unknown>;
    /** When true, a failed node does not fail the whole run. */
    continueOnError?: boolean;
}

export interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    /** When false the edge is skipped by graph traversal. */
    enabled?: boolean;
}

export type WorkflowStatus =
    | "draft"
    | "active"
    | "paused"
    | "disabled"
    | "archived";

/** Marketplace/visibility classification. */
export type MarketplaceType =
    | "private"
    | "admin_template"
    | "marketplace"
    | "pro";

export interface WorkflowScheduleConfig {
    enabled: boolean;
    /** Standard 5-field cron (UTC). */
    cron: string;
    timezone?: string;
}

export interface WorkflowAutomation {
    id: string;
    userId: string;
    name: string;
    description?: string;
    status: WorkflowStatus;
    visibility: MarketplaceType;
    version: number;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    /** Derived at save: every distinct permission level used by enabled nodes. */
    requiredPermissions: WorkflowPermissionLevel[];
    schedule?: WorkflowScheduleConfig;
    settings: {
        timeoutMs?: number;
        maxConcurrency?: number;
        notifyOnCompletion?: boolean;
    };
    /** Secret for webhook-triggered runs (server-only, hashed at rest). */
    webhookSecretHash?: string;
    createdAt: number;
    updatedAt: number;
    createdBy: string;
    lastRunAt?: number;
    lastRunStatus?: WorkflowRun["status"];
    versionHistory?: string[];
    sourceMarketplaceId?: string;
    tags?: string[];
}

// ─── Runs & traces ───────────────────────────────────────────────────────────

export type WorkflowRunStatus =
    | "queued"
    | "running"
    | "success"
    | "failed"
    | "partial"
    | "cancelled"
    | "timeout";

export type WorkflowRunTrigger =
    | "manual"
    | "schedule"
    | "webhook"
    | "test"
    | "admin_test";

export interface WorkflowRun {
    id: string;
    workflowId: string;
    workflowName: string;
    workflowVersion: number;
    userId: string;
    trigger: WorkflowRunTrigger;
    status: WorkflowRunStatus;
    startedAt: number;
    finishedAt: number | null;
    durationMs: number | null;
    nodesTotal: number;
    nodesCompleted: number;
    nodesFailed: number;
    nodesSkipped: number;
    executedNodes: string[];
    failedNodes: string[];
    skippedNodes: string[];
    error?: string;
    testMode: boolean;
    triggerDetail?: string;
    killSwitchHit?: boolean;
    killSwitchReason?: string;
}

export interface NodeExecutionRecord {
    /** Stable idempotency key: `<runId>:<nodeId>`. */
    id: string;
    runId: string;
    workflowId: string;
    nodeId: string;
    nodeType: string;
    nodeLabel: string;
    category: NodeCategory;
    status: "success" | "failed" | "skipped" | "cancelled" | "pending";
    startedAt: number;
    finishedAt: number;
    durationMs: number;
    attempts: number;
    retries: number;
    error?: string;
    inputs?: Record<string, unknown>;
    /** Trimmed output payload (records stay small in RTDB). */
    output?: Record<string, unknown>;
    // truncated = the raw output was large and output holds a summary
    truncated?: boolean;
    rateLimited?: boolean;
}

// ─── Registry (node contracts) ───────────────────────────────────────────────

export interface NodeFieldSpec {
    key: string;
    label: string;
    type: "string" | "number" | "boolean" | "select" | "multiselect" | "template" | "json" | "secret";
    required?: boolean;
    default?: unknown;
    options?: Array<{ value: string; label: string }>;
    help?: string;
    placeholder?: string;
    /** Mark as exposing credentials; never echoed back to clients in full. */
    sensitive?: boolean;
}

export interface WorkflowNodeDefinition {
    type: string;
    category: NodeCategory;
    name: string;
    description: string;
    /** Permission class required to run this node (server-side gate). */
    permission: WorkflowPermissionLevel | "none";
    configSchema: NodeFieldSpec[];
    timeoutMs?: number;
    defaults?: Record<string, unknown>;
    /** Requires the workflow to contain a completed risk node earlier. */
    riskGuardRequired?: boolean;
    rateLimitPerMinute?: number;
    /** Dangerous side-effect nodes never run in test mode. */
    noExecInTest?: boolean;
}

export interface NodeExecutionArgs {
    run: WorkflowRun;
    workflow: WorkflowAutomation;
    node: WorkflowNode;
    definition: WorkflowNodeDefinition;
    /** Resolved config values ($refs and {{ templates }} already applied). */
    config: Record<string, unknown>;
    /** Payloads of upstream completed nodes, keyed by node id. */
    payloads: Record<string, NodeExecutionRecord>;
    variables: Record<string, unknown>;
    /** Fetch-once snapshot cache shared by every node in the run. */
    snapshots: MarketSnapshotCache;
    signal: AbortSignal;
    uid: string;
}

export interface NodeExecutionResult {
    status: "success" | "failed" | "skipped";
    output?: Record<string, unknown>;
    error?: string;
    rateLimited?: boolean;
}

// ─── Market snapshot cache ───────────────────────────────────────────────────

export type SnapshotKind = "quote" | "candles" | "state";

export interface SnapshotEntry {
    kind: SnapshotKind;
    symbol: string;
    timeframe?: string;
    data: unknown;
    fetchedAt: number;
    provider: string;
}

export interface MarketSnapshotCache {
    getOrFetch<T>(key: string, fetcher: () => Promise<T | null>): Promise<T | null>;
    entries: Map<string, SnapshotEntry>;
}

// ─── Entitlement & limits ────────────────────────────────────────────────────

export type WorkflowTier = "free" | "pro" | "enterprise";

export interface WorkflowLimits {
    tier: WorkflowTier;
    maxWorkflows: number;
    maxActiveWorkflows: number;
    maxNodesPerWorkflow: number;
    maxRunsPerDay: number;
    maxConcurrency: number;
    schedulesEnabled: boolean;
    aiBuilderEnabled: boolean;
    marketplaceEnabled: boolean;
    executionEnabled: boolean;
    webhookTriggersEnabled: boolean;
    runCooldownMs: number;
}

// ─── Marketplace / templates ─────────────────────────────────────────────────

export interface MarketplaceItem {
    id: string;
    name: string;
    description: string;
    type: MarketplaceType;
    /** Snapshot of the workflow definition (nodes/edges/settings). */
    template: {
        nodes: WorkflowNode[];
        edges: WorkflowEdge[];
        settings: WorkflowAutomation["settings"];
    };
    category: NodeCategory[];
    tags: string[];
    installs: number;
    authorName: string;
    createdAt: number;
    updatedAt: number;
    pro: boolean;
}

// ─── AI builder drafts ───────────────────────────────────────────────────────

export interface WorkflowBuildValidation {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export interface WorkflowBuildDraft {
    id: string;
    userId: string;
    prompt: string;
    workflow: WorkflowAutomation;
    validation: WorkflowBuildValidation;
    status: "generated" | "approved" | "rejected";
    createdAt: number;
    createdBy: string;
}

// ─── Aggregates for admin/monitoring ─────────────────────────────────────────

export interface WorkflowUsageCounters {
    userId: string;
    runsToday: number;
    workflowCount: number;
    activeCount: number;
    lastRunAt: number | null;
}