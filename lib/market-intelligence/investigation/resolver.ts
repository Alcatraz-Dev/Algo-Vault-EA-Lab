/** Investigation Resolver — orchestration over Phase 13 Knowledge Graph only. */
import type { KnowledgeNodeRef, KnowledgeEdge, KnowledgeGraphValidationResult } from "../knowledge/types";
import { resolveLineage, getIncoming, getOutgoing } from "../knowledge/resolver";
import type { InvestigationRoot, InvestigationContext } from "./types";

export interface ResolvedInvestigation {
  root: KnowledgeNodeRef;
  nodes: KnowledgeNodeRef[];
  edges: KnowledgeEdge[];
  lineageTruncated?: boolean;
  evidenceSections: { title: string; category: "FACT" | "INTERPRETATION" | "LIMITATION"; items: { label: string; value: string; source?: string }[] }[];
}

export function resolveInvestigation(root: InvestigationRoot, edges: KnowledgeEdge[], ctx?: InvestigationContext): ResolvedInvestigation {
  const rootRef: KnowledgeNodeRef = { type: root.type as any, id: root.id };
  const lineage = resolveLineage(rootRef, edges, 8);
  const sections = buildEvidenceSections(rootRef, lineage.edges);
  return { root: rootRef, nodes: lineage.nodes, edges: lineage.edges, lineageTruncated: lineage.truncated, evidenceSections: sections };
}

function buildEvidenceSections(root: KnowledgeNodeRef, edges: KnowledgeEdge[]) {
  const sections = [
    { title: "Lineage", category: "FACT" as const, items: edges.map(e => ({ label: `${e.from.type}:${e.from.id} → ${e.to.type}:${e.to.id}`, value: e.type || "related", source: "Knowledge Graph" })) },
    { title: "Limitations", category: "LIMITATION" as const, items: [{ label: "Future evidence excluded", value: "Replay safety enforced", source: "ReplayEngine / Phase 13" }] },
  ];
  return sections;
}
