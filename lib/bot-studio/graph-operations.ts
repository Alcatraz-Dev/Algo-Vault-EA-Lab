/** Pure graph editing operations shared by the Bot Studio UI and tests. */

export interface EditableGraphNode {
    id: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
}

export interface EditableGraphEdge {
    id: string;
    source: string;
    target: string;
}

export type DuplicateEdgesMode = "internal" | "connected";

/**
 * Clone selected nodes with a small offset. `internal` copies only edges whose
 * endpoints are both selected. `connected` also copies incident edges, leaving
 * unselected endpoints connected to their original nodes.
 */
export function duplicateGraphSelection<
    N extends EditableGraphNode,
    E extends EditableGraphEdge,
>(
    nodes: N[],
    edges: E[],
    selectedIds: string[],
    mode: DuplicateEdgesMode,
    createId: (kind: "node" | "edge", originalId: string) => string,
): { nodes: N[]; edges: E[]; duplicatedNodeIds: string[] } {
    const selected = new Set(selectedIds);
    const sourceNodes = nodes.filter((node) => selected.has(node.id));
    if (sourceNodes.length === 0) return { nodes, edges, duplicatedNodeIds: [] };

    const idMap = new Map(sourceNodes.map((node) => [node.id, createId("node", node.id)]));
    const baseNodes = nodes.map((node) => selected.has(node.id) ? { ...node, selected: false } as N : node);
    const clones = sourceNodes.map((node) => ({
        ...node,
        id: idMap.get(node.id)!,
        position: { x: node.position.x + 48, y: node.position.y + 48 },
        data: structuredClone(node.data) as N["data"],
        selected: true,
    }) as N);

    const copiedEdges = edges
        .filter((edge) => {
            const sourceSelected = selected.has(edge.source);
            const targetSelected = selected.has(edge.target);
            return mode === "internal"
                ? sourceSelected && targetSelected
                : sourceSelected || targetSelected;
        })
        .map((edge) => ({
            ...edge,
            id: createId("edge", edge.id),
            source: idMap.get(edge.source) ?? edge.source,
            target: idMap.get(edge.target) ?? edge.target,
            selected: false,
        }) as E);

    return {
        nodes: [...baseNodes, ...clones],
        edges: [...edges, ...copiedEdges],
        duplicatedNodeIds: clones.map((node) => node.id),
    };
}
