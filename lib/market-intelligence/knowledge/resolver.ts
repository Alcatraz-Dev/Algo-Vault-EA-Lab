/** Resolver: outgoing, incoming, lineage (with cycle protection). */
import type { KnowledgeEdge, KnowledgeNodeRef } from "./types";
export function getOutgoing(node: KnowledgeNodeRef, edges: KnowledgeEdge[]): KnowledgeEdge[] { return edges.filter((e) => e.from.id === node.id && e.from.type === node.type); }
export function getIncoming(node: KnowledgeNodeRef, edges: KnowledgeEdge[]): KnowledgeEdge[] { return edges.filter((e) => e.to.id === node.id && e.to.type === node.type); }
export function resolveLineage(root: KnowledgeNodeRef, edges: KnowledgeEdge[], maxDepth = 8): { nodes: KnowledgeNodeRef[]; edges: KnowledgeEdge[]; truncated?: boolean } {
  const nodes: KnowledgeNodeRef[] = [root];
  const resultEdges: KnowledgeEdge[] = [];
  const visited = new Set<string>([`${root.type}:${root.id}`]);
  let depth = 0; let truncated = false;
  let current = [root];
  while (depth < maxDepth && current.length > 0) {
    const next = current.flatMap((n) => getOutgoing(n, edges));
    for (const edge of next) {
      resultEdges.push(edge);
      const key = `${edge.to.type}:${edge.to.id}`;
      if (!visited.has(key)) { visited.add(key); nodes.push(edge.to); current.push(edge.to); }
    }
    current = next.map((e) => e.to);
    depth += 1;
    if (current.length === 0) break;
  }
  if (current.length > 0 && depth >= maxDepth) truncated = true;
  return { nodes, edges: resultEdges, truncated };
}
