/** Build deterministic edge IDs. No duplicate edges. */
import type { KnowledgeEdge, KnowledgeNodeRef } from "./types";
export function buildEdgeId(from: KnowledgeNodeRef, relation: string, to: KnowledgeNodeRef): string {
  const raw = [from.type, from.id, relation, to.type, to.id].join(":");
  // Deterministic canonical key. IMPORTANT: do NOT truncate — an earlier
  // 32-char truncation covered only ~24 raw bytes, so edges sharing a
  // "from:relation" prefix (e.g. MISSION_GENERATED to two different targets)
  // collided and were silently dropped as duplicates. base64url is RTDB-key
  // safe; ids stay stable across processes.
  return "edge-" + Buffer.from(raw).toString("base64url");
}
export function buildEdge(from: KnowledgeNodeRef, relation: string, to: KnowledgeNodeRef, workspace?: { symbol?: string; timeframe?: string; datasetId?: string }): KnowledgeEdge {
  return { id: buildEdgeId(from, relation, to), from, to, type: relation, createdAt: new Date().toISOString(), workspaceContext: workspace ? { symbol: workspace.symbol, timeframe: workspace.timeframe, datasetId: workspace.datasetId } : undefined };
}
