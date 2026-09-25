import { WorkflowNode, NodeCategory } from "./types";
import { getNodeDefinition, NODE_CATEGORY_ORDER } from "./node-registry";

export interface ConnectionRule {
  sourceCategory: NodeCategory | "*";
  targetCategory: NodeCategory | "*";
  allowed: boolean;
  reason?: string;
}

export const DEFAULT_CONNECTION_RULES: ConnectionRule[] = [
  { sourceCategory: "trigger", targetCategory: "market_data", allowed: true },
  { sourceCategory: "trigger", targetCategory: "technical", allowed: true },
  { sourceCategory: "trigger", targetCategory: "ai", allowed: true },
  { sourceCategory: "market_data", targetCategory: "technical", allowed: true },
  { sourceCategory: "market_data", targetCategory: "logic", allowed: true },
  { sourceCategory: "technical", targetCategory: "signal", allowed: true },
  { sourceCategory: "technical", targetCategory: "logic", allowed: true },
  { sourceCategory: "ai", targetCategory: "logic", allowed: true },
  { sourceCategory: "logic", targetCategory: "signal", allowed: true },
  { sourceCategory: "logic", targetCategory: "logic", allowed: true },
  { sourceCategory: "logic", targetCategory: "execution", allowed: true },
  { sourceCategory: "signal", targetCategory: "execution", allowed: true },
  { sourceCategory: "signal", targetCategory: "risk", allowed: true },
  { sourceCategory: "risk", targetCategory: "execution", allowed: true },
  { sourceCategory: "execution", targetCategory: "notification", allowed: true },
  { sourceCategory: "execution", targetCategory: "integration", allowed: true },
  { sourceCategory: "execution", targetCategory: "storage", allowed: true },
  { sourceCategory: "execution", targetCategory: "http", allowed: true },
  { sourceCategory: "execution", targetCategory: "transform", allowed: true },
  { sourceCategory: "execution", targetCategory: "simulation", allowed: true },
  { sourceCategory: "execution", targetCategory: "reports", allowed: true },
  { sourceCategory: "execution", targetCategory: "marketing", allowed: true },
  { sourceCategory: "notification", targetCategory: "*", allowed: true },
  // Block backward flows into triggers / loops
  { sourceCategory: "execution", targetCategory: "trigger", allowed: false, reason: "Execution cannot feed back into a trigger" },
  { sourceCategory: "signal", targetCategory: "trigger", allowed: false, reason: "Signal cannot feed back into a trigger" },
  { sourceCategory: "risk", targetCategory: "trigger", allowed: false, reason: "Risk node cannot feed trigger" },
  { sourceCategory: "*", targetCategory: "trigger", allowed: false, reason: "Only trigger nodes may receive into themselves via external sources (use schedule/webhook)" },
];

export function isConnectionAllowed(
  sourceNode: WorkflowNode,
  targetNode: WorkflowNode
): { allowed: boolean; reason?: string } {
  const srcDef = getNodeDefinition(sourceNode.type);
  const tgtDef = getNodeDefinition(targetNode.type);
  if (!srcDef || !tgtDef) return { allowed: false, reason: "Unknown node type" };
  const srcCat = srcDef.category;
  const tgtCat = tgtDef.category;
  for (const r of DEFAULT_CONNECTION_RULES) {
    const srcMatch = r.sourceCategory === "*" || r.sourceCategory === srcCat;
    const tgtMatch = r.targetCategory === "*" || r.targetCategory === tgtCat;
    if (srcMatch && tgtMatch) {
      return r.allowed ? { allowed: true } : { allowed: false, reason: r.reason || "Connection not permitted" };
    }
  }
  return { allowed: false, reason: "Connection not permitted by workflow rules" };
}
