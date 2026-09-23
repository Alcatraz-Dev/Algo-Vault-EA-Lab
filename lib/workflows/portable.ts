/**
 * Portable workflow definition — the canonical shape used by export / import
 * and marketplace install. Strips user-specific, runtime, and secret fields so
 * a definition can travel between users, environments, or the marketplace.
 */

import { WorkflowAutomation, WorkflowNode, WorkflowEdge, WorkflowScheduleConfig } from "./types";
import { getNodeDefinition } from "./node-registry";

export interface PortableWorkflow {
    name: string;
    description?: string;
    settings: WorkflowAutomation["settings"];
    schedule?: WorkflowScheduleConfig;
    nodes: PortableNode[];
    edges: PortableEdge[];
}

export interface PortableNode {
    id: string;
    type: string;
    label?: string;
    description?: string;
    enabled?: boolean;
    position: { x: number; y: number };
    config: Record<string, unknown>;
    continueOnError?: boolean;
}

export interface PortableEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    enabled?: boolean;
}

/** Fields whose values must never leave the server (secrets / sensitive). */
function secretKeysFor(nodeType: string): Set<string> {
    const def = getNodeDefinition(nodeType);
    return new Set(
        def?.configSchema.filter((f) => f.type === "secret" || f.sensitive).map((f) => f.key) ?? []
    );
}

/** Returns a copy of `node` with secret/sensitive config values removed. */
export function stripSecretConfig(node: WorkflowNode): PortableNode {
    const secretKeys = secretKeysFor(node.type);
    const cleanConfig: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.config ?? {})) {
        if (secretKeys.has(key)) continue;
        cleanConfig[key] = value;
    }
    return {
        id: node.id,
        type: node.type,
        label: node.label,
        description: node.description,
        enabled: node.enabled,
        position: node.position,
        config: cleanConfig,
        continueOnError: node.continueOnError,
    };
}

/** Build a sanitized portable definition from a stored WorkflowAutomation. */
export function toPortable(workflow: WorkflowAutomation): PortableWorkflow {
    return {
        name: workflow.name,
        description: workflow.description,
        settings: workflow.settings,
        schedule: workflow.schedule,
        nodes: (workflow.nodes ?? []).map(stripSecretConfig),
        edges: (workflow.edges ?? []).map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            enabled: e.enabled,
        })),
    };
}