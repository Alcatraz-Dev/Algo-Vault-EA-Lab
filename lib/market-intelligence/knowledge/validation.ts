/** Graph validation. */
import type { KnowledgeEdge, KnowledgeGraphValidationResult } from "./types";
import { RELATION_TYPES } from "./relationship-types";
export function validateGraph(edges: KnowledgeEdge[], knownNodes?: Set<string>): KnowledgeGraphValidationResult {
  const orphanEdges: KnowledgeEdge[] = []; const duplicateEdges: string[] = []; const invalidEdges: KnowledgeEdge[] = []; const missingNodes: string[] = []; const warnings: string[] = [];
  const seenIds = new Set<string>();
  for (const e of edges) {
    if (seenIds.has(e.id)) { duplicateEdges.push(e.id); continue; }
    seenIds.add(e.id);
    if (!e.from || !e.to) { orphanEdges.push(e); continue; }
    if (!RELATION_TYPES.includes(e.type)) { invalidEdges.push(e); warnings.push(`Unknown relation: ${e.type}`); }
    if (e.from.id === e.to.id && (e.from.type === "setup" || e.from.type === "pattern")) { warnings.push(`Self-reference on ${e.from.type}:${e.from.id}`); }
  }
  return { valid: duplicateEdges.length === 0 && invalidEdges.length === 0, orphanEdges, duplicateEdges, invalidEdges, missingNodes, warnings };
}
