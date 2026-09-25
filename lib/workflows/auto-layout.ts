/**
 * Pure graph auto-wiring + layout helpers.
 *
 * These are browser-safe by design: they only touch the node registry and the
 * connection rules, never the AI gateway, Firebase Admin, or any other
 * server-only module. The AI Workflow Builder itself (`./ai-builder`) pulls in
 * `@/lib/ai/router` and `./database`, so client components that only need these
 * two helpers must import them from here — importing them from `./ai-builder`
 * drags the server-only graph into the browser bundle and breaks the build.
 */

import { WorkflowNode, WorkflowEdge } from "./types";
import { getNodeDefinition } from "./node-registry";
import { isConnectionAllowed } from "./connection-rules";

/** Determines pipeline rank category for auto-wiring and layout positioning. */
function getStageRank(category?: string): number {
    switch (category) {
        case "trigger": return 0;
        case "market_data": return 1;
        case "technical":
        case "ai": return 2;
        case "logic":
        case "filter": return 3;
        case "risk": return 4;
        case "signal":
        case "execution": return 5;
        case "notification":
        case "storage":
        case "http":
        case "transform":
        case "simulation":
        case "reports":
        case "marketing":
        case "integration": return 6;
        default: return 3;
    }
}

/** Automatically constructs valid topological DAG edges between nodes when edges are missing. */
export function autoConnectNodes(nodes: WorkflowNode[]): WorkflowEdge[] {
    if (nodes.length < 2) return [];

    // Group nodes by stage rank
    const stages: Record<number, WorkflowNode[]> = {};
    for (const node of nodes) {
        const def = getNodeDefinition(node.type);
        const rank = getStageRank(def?.category);
        if (!stages[rank]) stages[rank] = [];
        stages[rank].push(node);
    }

    const sortedRanks = Object.keys(stages).map(Number).sort((a, b) => a - b);
    const edges: WorkflowEdge[] = [];
    const edgeSeen = new Set<string>();

    for (let i = 0; i < sortedRanks.length - 1; i++) {
        const currentRank = sortedRanks[i];
        const nextRank = sortedRanks[i + 1];

        const sources = stages[currentRank];
        const targets = stages[nextRank];

        for (const src of sources) {
            for (const tgt of targets) {
                const check = isConnectionAllowed(src, tgt);
                if (check.allowed) {
                    const eid = `${src.id}:${tgt.id}`;
                    if (!edgeSeen.has(eid)) {
                        edgeSeen.add(eid);
                        edges.push({ id: `e_${src.id}_${tgt.id}`, source: src.id, target: tgt.id });
                    }
                }
            }
        }
    }

    // Fallback: If disconnected nodes remain, link sequential nodes
    for (let i = 0; i < nodes.length - 1; i++) {
        const src = nodes[i];
        const tgt = nodes[i + 1];
        const eid = `${src.id}:${tgt.id}`;
        if (!edgeSeen.has(eid)) {
            const check = isConnectionAllowed(src, tgt);
            if (check.allowed) {
                edgeSeen.add(eid);
                edges.push({ id: `e_${src.id}_${tgt.id}`, source: src.id, target: tgt.id });
            }
        }
    }

    return edges;
}

/** Auto-positions nodes nicely on a horizontal DAG grid (left to right). */
export function autoPositionNodes(nodes: WorkflowNode[]): void {
    const needLayout = nodes.some((n) => !n.position || (n.position.x === 0 && n.position.y === 0));
    if (!needLayout) return;

    const stages: Record<number, WorkflowNode[]> = {};
    for (const node of nodes) {
        const def = getNodeDefinition(node.type);
        const rank = getStageRank(def?.category);
        if (!stages[rank]) stages[rank] = [];
        stages[rank].push(node);
    }

    const sortedRanks = Object.keys(stages).map(Number).sort((a, b) => a - b);
    let col = 0;
    for (const rank of sortedRanks) {
        const list = stages[rank];
        list.forEach((node, idx) => {
            node.position = {
                x: 60 + col * 260,
                y: 100 + idx * 140,
            };
        });
        col++;
    }
}
