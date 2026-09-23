/**
 * Workflow Automation — DAG execution engine.
 *
 * Scheduling model (n8n-style):
 *   - a node runs as soon as every edge into it has produced a completed node
 *   - ready nodes run concurrently, bounded by the workflow's max concurrency
 *   - market data is fetched once per run (shared snapshot cache), so N nodes
 *     reading the same symbol+timeframe cost exactly one provider call
 *   - retries (with backoff), per-node timeouts, and cancellation are enforced
 *     with AbortController
 *   - idempotency: node records are persisted with stable `<runId>:<nodeId>`
 *     keys; a resumed run skips already-completed work
 *   - permission classes and the risk-guard rule are re-verified at run time —
 *     never trusted from the client
 *
 * Persistence is real: run + per-node traces land in RTDB via `database.ts`.
 */

import {
    createRun,
    getCompletedNodesForRun,
    getRun,
    saveNodeRecord,
    updateRun,
} from "./database";
import { getGlobalSettings } from "./database";
import { createSnapshotCache } from "./market";
import {
    NodeExecutionArgs,
    NodeExecutionRecord,
    NodeExecutionResult,
    WorkflowAutomation,
    WorkflowNode,
    WorkflowRun,
    WorkflowRunStatus,
    WorkflowRunTrigger,
} from "./types";
import { executeNodeForType } from "./executors";
import {
    getNodeDefinition,
    isExecutionNodeType,
    isRiskNodeType,
    isSignalNodeType,
    nodePermissionClass,
} from "./node-registry";
import { lookupValue, PayloadLookup, resolveConfig } from "./paths";
import { tryConsume } from "./rate-limiter";

export interface ExecuteWorkflowParams {
    uid: string;
    isAdmin: boolean;
    workflow: WorkflowAutomation;
    trigger: WorkflowRunTrigger;
    triggerDetail?: string;
    testMode?: boolean;
    inputs?: Record<string, unknown>;
    /** Resume/idempotency: re-run the same runId, skipping completed nodes. */
    runId?: string;
    /** Overrides for settings (admin/test). */
    overrides?: { concurrency?: number; timeoutMs?: number };
    /** Permission classes this caller is allowed (server-derived). */
    permitted: { analysis: boolean; signal: boolean; execution: boolean };
}

export interface RunOutcome {
    run: WorkflowRun;
    nodeRecords: NodeExecutionRecord[];
}

const MAX_NODE_OUTPUT_BYTES = 60_000;
const DEFAULT_RETRIES = 2;
const RETRY_BACKOFF_MS = 400;
const NODE_TIMEOUT_MS = 60_000;

function runIdFor(uid: string): string {
    return `run_${Date.now().toString(36)}_${uid.slice(-6)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Trims a node output so run records stay small in RTDB. */
export function trimOutput(output: Record<string, unknown>): { output: Record<string, unknown>; truncated: boolean } {
    const size = JSON.stringify(output)?.length ?? 0;
    if (size <= MAX_NODE_OUTPUT_BYTES) return { output, truncated: false };
    return { output: trim(output, 0) as Record<string, unknown>, truncated: true };
}

function trim(value: unknown, depth: number): unknown {
    if (depth > 5 || value === null || value === undefined) return null;
    if (Array.isArray(value)) {
        const arr = value as unknown[];
        const kept = arr.length > 80 ? [...arr.slice(0, 80), { __dropped: arr.length - 80 }] : arr;
        return kept.map((v) => trim(v, depth + 1));
    }
    if (typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            if (key.length > 120) continue;
            out[key] = trim(val, depth + 1);
        }
        return out;
    }
    if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…`;
    return value;
}

/**
 * Runs (or resumes) a workflow. The workflow must already be validated —
 * `validateWorkflow` is re-run by the callers that mutate; the engine trusts
 * the passed node/edge set but re-enforces permissions and risk guards.
 */
export async function executeWorkflow(params: ExecuteWorkflowParams): Promise<RunOutcome> {
    const { uid, workflow, trigger, testMode = false, inputs, permitted, isAdmin } = params;
    const isResume = Boolean(params.runId);
    const runId = params.runId ?? runIdFor(uid);

    const startedAt = Date.now();
    const enabledNodes = workflow.nodes.filter((n) => n.enabled !== false);
    const concurrency = Math.max(1, params.overrides?.concurrency ?? workflow.settings.maxConcurrency ?? 4);
    const runTimeoutMs = params.overrides?.timeoutMs ?? workflow.settings.timeoutMs ?? 120_000;

    // ── Kill switch (admins may still run for recovery/testing) ─────────────
    const settings = await getGlobalSettings();
    if (settings.killSwitchEnabled && !isAdmin) {
        const killed: WorkflowRun = {
            id: runId, workflowId: workflow.id, workflowName: workflow.name, workflowVersion: workflow.version,
            userId: uid, trigger, status: "failed", startedAt, finishedAt: startedAt, durationMs: 0,
            nodesTotal: enabledNodes.length, nodesCompleted: 0, nodesFailed: 0, nodesSkipped: 0,
            executedNodes: [], failedNodes: [], skippedNodes: [],
            error: "Workflow automation has been temporarily disabled by the platform administrators.",
            testMode, killSwitchHit: true, killSwitchReason: settings.killSwitchReason,
        };
        await createRun(killed);
        return { run: killed, nodeRecords: [] };
    }

    // ── Run state ───────────────────────────────────────────────────────────
    const abortController = new AbortController();
    const snapshots = createSnapshotCache();
    const variables: Record<string, unknown> = { ...(inputs ?? {}) };
    variables.workflow = { id: workflow.id, name: workflow.name, version: workflow.version };
    variables.trigger = trigger;

    const nodesById = new Map(enabledNodes.map((n) => [n.id, n]));
    const edgesByTarget = new Map<string, string[]>();
    for (const edge of workflow.edges) {
        if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
        if (edge.source === edge.target) continue;
        const t = edgesByTarget.get(edge.target) ?? [];
        t.push(edge.source);
        edgesByTarget.set(edge.target, t);
    }

    const completed: Record<string, NodeExecutionRecord> = {};
    const executedNodes: string[] = [];
    const failedNodes: string[] = [];
    const skippedNodes: string[] = [];
    const nodeRecords: NodeExecutionRecord[] = [];

    if (isResume) {
        for (const record of await getCompletedNodesForRun(runId)) {
            completed[record.nodeId] = record;
            nodeRecords.push(record);
            executedNodes.push(record.nodeId);
            if (record.status === "failed") failedNodes.push(record.nodeId);
            if (record.status === "skipped") skippedNodes.push(record.nodeId);
        }
    }

    const run: WorkflowRun = {
        id: runId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowVersion: workflow.version,
        userId: uid,
        trigger,
        status: "running",
        startedAt,
        finishedAt: null,
        durationMs: null,
        nodesTotal: enabledNodes.length,
        nodesCompleted: executedNodes.length,
        nodesFailed: failedNodes.length,
        nodesSkipped: skippedNodes.length,
        executedNodes,
        failedNodes,
        skippedNodes,
        testMode,
        triggerDetail: params.triggerDetail,
    };

    if (!isResume) await createRun(run);
    else await updateRun(uid, runId, { status: "running" as const });

    const pending = new Set(enabledNodes.map((n) => n.id));
    for (const id of Object.keys(completed)) pending.delete(id);

    let abortReason: string | null = null;
    let abortedByTimeout = false;

    const runTimer = setTimeout(() => {
        abortController.abort("run-timeout");
    }, runTimeoutMs);

    try {
        while (pending.size > 0) {
            if (abortController.signal.aborted) {
                abortReason = String(abortController.signal.reason ?? "cancelled");
                abortedByTimeout = abortReason === "run-timeout";
                break;
            }
            const live = await getRun(uid, runId).catch(() => null);
            if (live && (live.status === "cancelled" || live.status === "timeout")) {
                abortReason = live.status;
                abortedByTimeout = live.status === "timeout";
                break;
            }

            const ready = [...pending].filter((id) => {
                const deps = edgesByTarget.get(id) ?? [];
                return deps.every((d) => completed[d] !== undefined);
            }).sort();

            if (ready.length === 0) {
                abortReason = "Workflow graph is blocked (cycle or disconnected dependency).";
                break;
            }

            const batch = ready.slice(0, concurrency);
            const results = await Promise.all(batch.map(async (nodeId) => {
                const node = nodesById.get(nodeId)!;
                const recordForNode = await runNode(node, {
                    uid,
                    runId,
                    workflowId: workflow.id,
                    workflow,
                    run,
                    completed,
                    variables,
                    snapshots,
                    abortController,
                    testMode,
                    trigger,
                    permitted,
                    edgesByTarget,
                    isAdmin,
                });
                completed[nodeId] = recordForNode;
                return recordForNode;
            }));

            for (const recordForNode of results) {
                nodeRecords.push(recordForNode);
                pending.delete(recordForNode.nodeId);
                executedNodes.push(recordForNode.nodeId);
                if (recordForNode.status === "failed") failedNodes.push(recordForNode.nodeId);
                else if (recordForNode.status === "skipped") skippedNodes.push(recordForNode.nodeId);
            }
        }
    } finally {
        clearTimeout(runTimer);
    }

    const finishedAt = Date.now();
    let status: WorkflowRunStatus;
    if (abortedByTimeout) status = "timeout";
    else if (abortReason === "cancelled" || abortReason === "cancelled-by-user" || abortController.signal.aborted) status = "cancelled";
    else if (abortReason) status = "failed";
    else if (pending.size > 0) status = "failed";
    else if (failedNodes.length > 0) status = "partial";
    else status = "success";

    const finalRun: WorkflowRun = {
        ...run,
        status,
        finishedAt,
        durationMs: finishedAt - startedAt,
        nodesCompleted: executedNodes.length - failedNodes.length - skippedNodes.length,
        nodesFailed: failedNodes.length,
        nodesSkipped: skippedNodes.length,
        executedNodes,
        failedNodes,
        skippedNodes,
        error: abortReason && status === "failed" ? abortReason : run.error,
    };
    await updateRun(uid, runId, finalRun);

    return { run: finalRun, nodeRecords };
}

interface RunNodeContext {
    uid: string;
    runId: string;
    workflowId: string;
    workflow: WorkflowAutomation;
    run: WorkflowRun;
    completed: Record<string, NodeExecutionRecord>;
    variables: Record<string, unknown>;
    snapshots: ReturnType<typeof createSnapshotCache>;
    abortController: AbortController;
    testMode: boolean;
    trigger: WorkflowRunTrigger;
    permitted: { analysis: boolean; signal: boolean; execution: boolean };
    edgesByTarget: Map<string, string[]>;
    isAdmin: boolean;
}

async function runNode(node: WorkflowNode, ctx: RunNodeContext): Promise<NodeExecutionRecord> {
    const definition = getNodeDefinition(node.type);
    const startedAt = Date.now();
    const finish = (status: NodeExecutionRecord["status"], error?: string, extra?: Partial<NodeExecutionRecord>): NodeExecutionRecord => ({
        id: `${ctx.runId}:${node.id}`,
        runId: ctx.runId,
        workflowId: ctx.workflowId,
        nodeId: node.id,
        nodeType: node.type,
        nodeLabel: node.label || definition?.name || node.id,
        category: definition?.category ?? "logic",
        status,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        attempts: extra?.attempts ?? 1,
        retries: extra?.retries ?? 0,
        error,
        output: extra?.output,
        truncated: extra?.truncated,
        rateLimited: extra?.rateLimited,
        inputs: extra?.inputs ?? undefined,
    });

    // Trigger nodes are entry-point markers, not executable steps: mark them
    // as fired (success) without dispatching to an executor.
    if (definition && node.type.startsWith("trigger.")) {
        const rec = finish("success", undefined, { output: { fired: true, trigger: node.type } });
        await saveNodeRecord(rec);
        return rec;
    }

    // Permission class gate (server-side truth).
    const permission = nodePermissionClass(node.type);
    const permittedClass =
        permission === "execution" ? ctx.permitted.execution
        : permission === "signal" ? ctx.permitted.signal
        : permission === "analysis" ? ctx.permitted.analysis
        : true;
    if (!permittedClass) {
        const rec = finish("failed", `Permission class "${permission}" is not enabled for this account.`);
        await saveNodeRecord(rec);
        return rec;
    }

    // Risk guard: signal/execution nodes require a succeeded upstream risk node.
    if (isSignalNodeType(node.type) || isExecutionNodeType(node.type)) {
        const upstreamClosure = transitiveUpstream(node.id, ctx.edgesByTarget);
        if (upstreamClosure.length === 0) {
            const rec = finish("failed", "Signal/execution nodes require a risk node earlier in the graph.");
            await saveNodeRecord(rec);
            return rec;
        }
        let riskOk = false;
        for (const depId of upstreamClosure) {
            const rec = ctx.completed[depId];
            if (rec && isRiskNodeType(rec.nodeType)) {
                if (rec.status === "success") riskOk = true;
                else {
                    const rc = finish("failed", `Risk node "${depId}" did not pass (${rec.status}) — no signal/execution allowed.`);
                    await saveNodeRecord(rc);
                    return rc;
                }
            }
        }
        if (!riskOk) {
            const rc = finish("failed", "No passing risk node found upstream — add a risk.check/position_size node before this step.");
            await saveNodeRecord(rc);
            return rc;
        }
    }

    // Test mode: never run side-effect nodes.
    if (ctx.testMode && definition?.noExecInTest) {
        const rec = finish("skipped", "Skipped in test mode (no execution side effects in tests)");
        await saveNodeRecord(rec);
        return rec;
    }

    // Rate limit (per uid + node type).
    if (definition?.rateLimitPerMinute && tryConsume(ctx.uid, node.type, definition.rateLimitPerMinute) < 0) {
        const rec = finish("failed", "Rate limit reached for this node type — try again later.", { rateLimited: true });
        await saveNodeRecord(rec);
        return rec;
    }

    // Resolve config against completed payloads (safe $ref/{{ }} resolution).
    const lookup: PayloadLookup = { nodes: ctx.completed, variables: ctx.variables };
    const config = resolveConfig(node.config, lookup);
    const renderedInputs = captureInputs(node, config);

    const maxAttempts = DEFAULT_RETRIES;
    let attempts = 0;
    let lastResult: NodeExecutionResult | null = null;

    while (attempts < maxAttempts) {
        attempts += 1;
        if (ctx.abortController.signal.aborted) break;

        const nodeTimeout = Math.min(definition?.timeoutMs ?? 30_000, NODE_TIMEOUT_MS);
        const attemptController = new AbortController();
        const onAbort = () => attemptController.abort(ctx.abortController.signal.reason ?? "cancelled");
        ctx.abortController.signal.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(() => attemptController.abort("node-timeout"), nodeTimeout);

        try {
            const args: NodeExecutionArgs = {
                run: ctx.run,
                workflow: ctx.workflow,
                node,
                definition: definition ?? getNodeDefinition("logic.condition")!,
                config,
                payloads: ctx.completed,
                variables: ctx.variables,
                snapshots: ctx.snapshots,
                signal: attemptController.signal,
                uid: ctx.uid,
            };
            lastResult = await executeNodeForType(args);
        } catch (err) {
            lastResult = { status: "failed", error: err instanceof Error ? err.message : String(err) };
        } finally {
            clearTimeout(timer);
            ctx.abortController.signal.removeEventListener("abort", onAbort);
        }

        if (lastResult.status === "success" || lastResult.status === "skipped") break;
        if (attemptController.signal.aborted) break; // timeout/cancel — don't burn retries on the same request
        if (node.continueOnError || lastResult.rateLimited) break;
        if (attempts < maxAttempts) await sleep(RETRY_BACKOFF_MS * attempts);
    }

    const trimmed = trimOutput(lastResult?.output ?? {});
    const rec = finish(
        lastResult?.status === "success" ? "success"
        : lastResult?.status === "skipped" ? "skipped"
        : "failed",
        lastResult?.error ?? (lastResult && lastResult.status !== "success" ? "Node failed." : undefined),
        {
            attempts,
            retries: Math.max(0, attempts - 1),
            output: trimmed.output,
            truncated: trimmed.truncated,
            rateLimited: lastResult?.rateLimited,
            inputs: renderedInputs,
        }
    );
    await saveNodeRecord(rec);
    return rec;
}

function transitiveUpstream(nodeId: string, edgesByTarget: Map<string, string[]>): string[] {
    const seen = new Set<string>();
    const stack = [...(edgesByTarget.get(nodeId) ?? [])];
    while (stack.length > 0) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...(edgesByTarget.get(id) ?? []));
    }
    return [...seen];
}

/** Small, safe input snapshot for the trace (only resolved scalar/config values). */
function captureInputs(node: WorkflowNode, config: Record<string, unknown>): Record<string, unknown> | undefined {
    try {
        const keys = Object.keys(config).slice(0, 8);
        const out: Record<string, unknown> = {};
        for (const key of keys) {
            const value = config[key];
            if (typeof value === "string" && value.length > 500) out[key] = value.slice(0, 500);
            else out[key] = value;
        }
        return out;
    } catch {
        return undefined;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Marks a run cancelled in the DB. The engine cross-checks this at each
 * batch boundary, so cancellation takes effect within seconds even across
 * serverless instances.
 */
export async function cancelRun(uid: string, runId: string): Promise<boolean> {
    const run = await getRun(uid, runId);
    if (!run) return false;
    if (run.status !== "running" && run.status !== "queued") return false;
    await updateRun(uid, runId, {
        status: "cancelled",
        finishedAt: Date.now(),
    });
    return true;
}

export { lookupValue };