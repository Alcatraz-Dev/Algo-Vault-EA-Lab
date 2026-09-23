/**
 * Workflow validation — signs off every graph before it can be saved, run,
 * or AI-built. Feeds three call sites:
 *   1. save (/api/workflows PATCH)   — blocks invalid saves
 *   2. run (/api/workflows run)      — re-validates at execution time
 *   3. AI builder                     — Generate → Validate → Preview → Review
 *
 * Checks:
 *   - node ids unique, edges reference real nodes, DAG is acyclic
 *   - every node type exists in the registry and config satisfies its schema
 *   - every runnable node is reachable from a trigger
 *   - signal/execution nodes are gated by a risk node that runs BEFORE them
 *   - AI nodes carry a non-empty prompt (never auto-activated)
 *   - resulting permission set is derived, not client-supplied
 */

import {
    WorkflowAutomation,
    WorkflowEdge,
    WorkflowNode,
    WorkflowPermissionLevel,
    NodeCategory,
} from "./types";
import {
    getNodeDefinition,
    neededNodesForPermission,
    isRiskNodeType,
    isSignalNodeType,
    isExecutionNodeType,
    nodePermissionClass,
    CATEGORY_PERMISSION,
} from "./node-registry";
import { isValidCron } from "./cron";

export interface WorkflowValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export function emptyValidation(): WorkflowValidationResult {
    return { valid: true, errors: [], warnings: [] };
}

function err(result: WorkflowValidationResult, message: string): void {
    result.errors.push(message);
    result.valid = false;
}

function warn(result: WorkflowValidationResult, message: string): void {
    result.warnings.push(message);
}

interface GraphMeta {
    nodeIds: Set<string>;
    edgesByTarget: Map<string, string[]>;
    edgesBySource: Map<string, string[]>;
}

function graphMeta(nodes: WorkflowNode[], edges: WorkflowEdge[]): GraphMeta {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edgesByTarget = new Map<string, string[]>();
    const edgesBySource = new Map<string, string[]>();
    for (const edge of edges) {
        if (edge.enabled === false) continue;
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
        if (edge.source === edge.target) continue;
        const t = edgesByTarget.get(edge.target) ?? [];
        t.push(edge.source);
        edgesByTarget.set(edge.target, t);
        const s = edgesBySource.get(edge.source) ?? [];
        s.push(edge.target);
        edgesBySource.set(edge.source, s);
    }
    return { nodeIds, edgesByTarget, edgesBySource };
}

/** Topological ordering; returns null on cycle. Order is deterministic (ids sorted). */
export function topoSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] | null {
    const meta = graphMeta(nodes, edges);
    return buildTopo(meta);
}

function buildTopo(meta: GraphMeta): string[] | null {
    const indegree = new Map<string, number>();
    for (const [target, sources] of meta.edgesByTarget) {
        indegree.set(target, sources.length);
    }
    for (const id of meta.nodeIds) {
        if (!indegree.has(id)) indegree.set(id, 0);
    }
    const queue = [...meta.nodeIds].filter((id) => (indegree.get(id) ?? 0) === 0).sort();
    const order: string[] = [];
    while (queue.length > 0) {
        const id = queue.shift()!;
        order.push(id);
        for (const target of meta.edgesBySource.get(id) ?? []) {
            const next = (indegree.get(target) ?? 1) - 1;
            indegree.set(target, next);
            if (next === 0) queue.push(target);
        }
        queue.sort();
    }
    if (order.length !== meta.nodeIds.size) return null; // cycle
    return order;
}

/** Whether a risk node exists and can execute before the node. */
function riskGuardCovers(nodes: WorkflowNode[], edges: WorkflowEdge[], target: WorkflowNode): boolean {
    const meta = graphMeta(nodes, edges);
    const riskNodes = nodes.filter((n) => n.enabled !== false && isRiskNodeType(n.type));
    if (riskNodes.length === 0) return false;
    const hasDirectDep = meta.edgesByTarget.get(target.id)?.some((src) => riskNodes.some((r) => r.id === src)) ?? false;
    if (hasDirectDep) return true;
    // Any risk node anywhere in the upstream closure of target.
    const upstream = new Set<string>();
    const stack = [...(meta.edgesByTarget.get(target.id) ?? [])];
    while (stack.length > 0) {
        const id = stack.pop()!;
        if (upstream.has(id)) continue;
        upstream.add(id);
        stack.push(...(meta.edgesByTarget.get(id) ?? []));
    }
    return riskNodes.some((r) => upstream.has(r.id));
}

/**
 * Validates a complete workflow definition. `permitted` is the caller's
 * entitlement for signal/execution classes (checked again at run time).
 */
export function validateWorkflow(
    workflow: Pick<WorkflowAutomation, "nodes" | "edges" | "settings" | "schedule" | "name">,
    permitted: { analysis: boolean; signal: boolean; execution: boolean },
    limits?: { maxNodes?: number }
): WorkflowValidationResult {
    const result = emptyValidation();
    const nodes = workflow.nodes ?? [];
    const edges = workflow.edges ?? [];

    if (!workflow.name || !String(workflow.name).trim()) {
        err(result, "Workflow name is required.");
    }

    // Slow/validation-only guards below run against enabled nodes.
    const enabledNodes = nodes.filter((n) => n.enabled !== false);
    if (enabledNodes.length === 0) {
        err(result, "Workflow has no enabled nodes.");
        return result;
    }
    if (limits?.maxNodes && enabledNodes.length > limits.maxNodes) {
        err(result, `Workflow exceeds the node limit (${limits.maxNodes}).`);
    }

    const seen = new Set<string>();
    for (const node of nodes) {
        if (seen.has(node.id)) err(result, `Duplicate node id "${node.id}".`);
        seen.add(node.id);
        const definition = getNodeDefinition(node.type);
        if (!definition) {
            err(result, `Unknown node type "${node.type}" — not in the registry.`);
            continue;
        }
        for (const field of definition.configSchema) {
            if (field.required && (node.config[field.key] === undefined || node.config[field.key] === null || node.config[field.key] === "")) {
                err(result, `Node "${node.id}" (${definition.name}): "${field.label}" is required.`);
            }
        }
    }

    for (const edge of edges) {
        if (!seen.has(edge.source)) err(result, `Edge references unknown source node "${edge.source}".`);
        if (!seen.has(edge.target)) err(result, `Edge references unknown target node "${edge.target}".`);
    }

    const order = topoSort(nodes, edges);
    if (order === null) {
        err(result, "Workflow graph contains a cycle — every run would deadlock.");
    } else {
        // Every enabled, non-trigger node must be reachable from some trigger.
        const reachable = new Set<string>();
        const stack = enabledNodes.filter((n) => n.type.startsWith("trigger.")).map((n) => n.id);
        const bySource = new Map<string, string[]>();
        for (const edge of edges) {
            if (!seen.has(edge.source) || !seen.has(edge.target)) continue;
            const s = bySource.get(edge.source) ?? [];
            s.push(edge.target);
            bySource.set(edge.source, s);
        }
        while (stack.length > 0) {
            const id = stack.pop()!;
            if (reachable.has(id)) continue;
            reachable.add(id);
            stack.push(...(bySource.get(id) ?? []));
        }
        for (const node of enabledNodes) {
            if (!node.type.startsWith("trigger.") && !reachable.has(node.id)) {
                err(result, `Node "${node.id}" is not reachable from any trigger node.`);
            }
        }
    }

    // Permission derivation — never trust the client.
    const required = deriveRequiredPermissions(enabledNodes);
    const classified: WorkflowPermissionLevel[] = [];
    for (const level of required) {
        if (level === "execution") {
            if (!permitted.execution) {
                err(result, "Workflow requires trade execution permission, which your plan does not include.");
            }
        } else if (level === "signal") {
            if (!permitted.signal) {
                err(result, "Workflow requires signal creation permission, which your plan does not include.");
            }
        }
    }
    void classified;

    // Risk guard: signal/execution side effects require a prior risk node.
    for (const node of enabledNodes) {
        if (isSignalNodeType(node.type) || isExecutionNodeType(node.type)) {
            if (!riskGuardCovers(nodes, edges, node)) {
                err(result, `Node "${node.id}" (${node.type}) requires a risk node that runs before it.`);
            }
        }
    }

    // AI nodes must have a non-empty prompt template and may reference upstream nodes.
    for (const node of enabledNodes) {
        if (node.type === "ai.analyze") {
            const prompt = String(node.config.prompt ?? "");
            if (!prompt.trim()) {
                err(result, `AI node "${node.id}" has an empty prompt.`);
            } else {
                warn(result, `AI node "${node.id}" will not auto-activate — review its output before running.`);
            }
        }
    }

    // Schedule sanity
    if (workflow.schedule?.enabled && workflow.schedule.cron) {
        if (!isValidCron(workflow.schedule.cron)) {
            err(result, `Invalid cron expression "${workflow.schedule.cron}".`);
        }
    }

    return result;
}

/** Derives required permission classes from the enabled node set. */
export function deriveRequiredPermissions(nodes: { type: string; enabled?: boolean }[]): WorkflowPermissionLevel[] {
    const set = new Set<WorkflowPermissionLevel>();
    for (const node of nodes) {
        if (node.enabled === false) continue;
        const permission = nodePermissionClass(node.type);
        if (permission && permission !== "none") set.add(permission);
    }
    // execution implies signal implies analysis
    const out: WorkflowPermissionLevel[] = [];
    if (set.has("execution")) out.push("execution");
    if (set.has("signal")) out.push("signal");
    if (set.has("analysis")) out.push("analysis");
    return out;
}

/**
 * Category → permission map for the registry (exported for reuse in node-registry).
 */
export const CATEGORY_TO_PERMISSION = CATEGORY_PERMISSION;

/** Human-readable classification of a node's side-effect class. */
export function describeNodeRiskClass(type: string): "analysis" | "signal" | "execution" | "none" {
    const permission = nodePermissionClass(type);
    return permission ?? "none";
}

export function classifyNodeCategory(type: string): NodeCategory | null {
    return getNodeDefinition(type)?.category ?? null;
}

// Re-exports used by the AI builder / engine.
export { neededNodesForPermission };