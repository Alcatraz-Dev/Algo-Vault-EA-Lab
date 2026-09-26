/** Build deterministic edge IDs. No duplicate edges. */
import type { KnowledgeEdge, KnowledgeNodeRef } from "./types";
export function buildEdgeId(from: KnowledgeNodeRef, relation: string, to: KnowledgeNodeRef): string {
  const raw = [from.type, from.id, relation, to.type, to.id].join(":");
  // simple hash-like canonical representation (not cryptographic; deterministic)
  return "edge-" + Buffer.from(raw).toString("base64url").substring(0, 32);
}
export function buildEdge(from: KnowledgeNodeRef, relation: string, to: KnowledgeNodeRef, workspace?: any): KnowledgeEdge {
  return { id: buildEdgeId(from, relation, to), from, to, type: relation, createdAt: new Date().toISOString(), workspaceContext: workspace ? { symbol: workspace.symbol, timeframe: workspace.timeframe, datasetId: workspace.datasetId } : undefined };
}
