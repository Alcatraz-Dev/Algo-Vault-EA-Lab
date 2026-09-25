import { WorkflowNode, NodeCategory } from "./types";
import { getNodeDefinition } from "./node-registry";

export interface ConnectionRule {
  sourceCategory: NodeCategory | "*";
  targetCategory: NodeCategory | "*";
  allowed: boolean;
  reason?: string;
}

export const DEFAULT_CONNECTION_RULES: ConnectionRule[] = [
  // Block invalid targets
  { sourceCategory: "*", targetCategory: "trigger", allowed: false, reason: "Nodes cannot feed back into a Trigger node." },
  
  // Triggers feed into data/analysis/logic/risk/sim
  { sourceCategory: "trigger", targetCategory: "market_data", allowed: true },
  { sourceCategory: "trigger", targetCategory: "technical", allowed: true },
  { sourceCategory: "trigger", targetCategory: "ai", allowed: true },
  { sourceCategory: "trigger", targetCategory: "logic", allowed: true },
  { sourceCategory: "trigger", targetCategory: "risk", allowed: true },
  { sourceCategory: "trigger", targetCategory: "http", allowed: true },
  { sourceCategory: "trigger", targetCategory: "storage", allowed: true },
  { sourceCategory: "trigger", targetCategory: "integration", allowed: true },
  { sourceCategory: "trigger", targetCategory: "simulation", allowed: true },
  { sourceCategory: "trigger", targetCategory: "transform", allowed: true },

  // Market Data feeds analysis/logic/signal/risk
  { sourceCategory: "market_data", targetCategory: "technical", allowed: true },
  { sourceCategory: "market_data", targetCategory: "ai", allowed: true },
  { sourceCategory: "market_data", targetCategory: "logic", allowed: true },
  { sourceCategory: "market_data", targetCategory: "risk", allowed: true },
  { sourceCategory: "market_data", targetCategory: "signal", allowed: true },
  { sourceCategory: "market_data", targetCategory: "execution", allowed: true },
  { sourceCategory: "market_data", targetCategory: "transform", allowed: true },
  { sourceCategory: "market_data", targetCategory: "storage", allowed: true },
  { sourceCategory: "market_data", targetCategory: "simulation", allowed: true },
  { sourceCategory: "market_data", targetCategory: "reports", allowed: true },

  // Technical Analysis feeds TA (chaining), AI, logic, signals, risk
  { sourceCategory: "technical", targetCategory: "technical", allowed: true },
  { sourceCategory: "technical", targetCategory: "ai", allowed: true },
  { sourceCategory: "technical", targetCategory: "logic", allowed: true },
  { sourceCategory: "technical", targetCategory: "risk", allowed: true },
  { sourceCategory: "technical", targetCategory: "signal", allowed: true },
  { sourceCategory: "technical", targetCategory: "execution", allowed: true },
  { sourceCategory: "technical", targetCategory: "notification", allowed: true },
  { sourceCategory: "technical", targetCategory: "transform", allowed: true },
  { sourceCategory: "technical", targetCategory: "simulation", allowed: true },
  { sourceCategory: "technical", targetCategory: "reports", allowed: true },

  // AI feeds logic/signals/risk/notification
  { sourceCategory: "ai", targetCategory: "logic", allowed: true },
  { sourceCategory: "ai", targetCategory: "risk", allowed: true },
  { sourceCategory: "ai", targetCategory: "signal", allowed: true },
  { sourceCategory: "ai", targetCategory: "execution", allowed: true },
  { sourceCategory: "ai", targetCategory: "notification", allowed: true },
  { sourceCategory: "ai", targetCategory: "transform", allowed: true },
  { sourceCategory: "ai", targetCategory: "storage", allowed: true },
  { sourceCategory: "ai", targetCategory: "reports", allowed: true },

  // Logic feeds logic, risk, signals, execution, notifications
  { sourceCategory: "logic", targetCategory: "logic", allowed: true },
  { sourceCategory: "logic", targetCategory: "risk", allowed: true },
  { sourceCategory: "logic", targetCategory: "signal", allowed: true },
  { sourceCategory: "logic", targetCategory: "execution", allowed: true },
  { sourceCategory: "logic", targetCategory: "notification", allowed: true },
  { sourceCategory: "logic", targetCategory: "http", allowed: true },
  { sourceCategory: "logic", targetCategory: "storage", allowed: true },
  { sourceCategory: "logic", targetCategory: "transform", allowed: true },
  { sourceCategory: "logic", targetCategory: "reports", allowed: true },

  // Risk feeds signals & execution
  { sourceCategory: "risk", targetCategory: "signal", allowed: true },
  { sourceCategory: "risk", targetCategory: "execution", allowed: true },
  { sourceCategory: "risk", targetCategory: "logic", allowed: true },
  { sourceCategory: "risk", targetCategory: "notification", allowed: true },

  // Signal feeds risk, execution, notifications
  { sourceCategory: "signal", targetCategory: "risk", allowed: true },
  { sourceCategory: "signal", targetCategory: "execution", allowed: true },
  { sourceCategory: "signal", targetCategory: "logic", allowed: true },
  { sourceCategory: "signal", targetCategory: "notification", allowed: true },

  // Execution feeds notifications, integrations, storage, reports, marketing
  { sourceCategory: "execution", targetCategory: "notification", allowed: true },
  { sourceCategory: "execution", targetCategory: "integration", allowed: true },
  { sourceCategory: "execution", targetCategory: "storage", allowed: true },
  { sourceCategory: "execution", targetCategory: "http", allowed: true },
  { sourceCategory: "execution", targetCategory: "transform", allowed: true },
  { sourceCategory: "execution", targetCategory: "simulation", allowed: true },
  { sourceCategory: "execution", targetCategory: "reports", allowed: true },
  { sourceCategory: "execution", targetCategory: "marketing", allowed: true },

  // General utility nodes feed downstream
  { sourceCategory: "transform", targetCategory: "*", allowed: true },
  { sourceCategory: "http", targetCategory: "*", allowed: true },
  { sourceCategory: "storage", targetCategory: "*", allowed: true },
  { sourceCategory: "notification", targetCategory: "*", allowed: true },
  { sourceCategory: "simulation", targetCategory: "*", allowed: true },
  { sourceCategory: "reports", targetCategory: "*", allowed: true },
  { sourceCategory: "integration", targetCategory: "*", allowed: true },
];

export function isConnectionAllowed(
  sourceNode: WorkflowNode,
  targetNode: WorkflowNode
): { allowed: boolean; reason?: string } {
  if (sourceNode.id === targetNode.id) {
    return { allowed: false, reason: "Cannot connect a node to itself." };
  }

  const srcDef = getNodeDefinition(sourceNode.type);
  const tgtDef = getNodeDefinition(targetNode.type);
  if (!srcDef || !tgtDef) return { allowed: false, reason: "Unknown node type" };

  const srcCat = srcDef.category;
  const tgtCat = tgtDef.category;

  // Cannot connect anything into a trigger
  if (tgtCat === "trigger") {
    return { allowed: false, reason: "Trigger nodes cannot receive inputs." };
  }

  // Check matching rules in order
  for (const r of DEFAULT_CONNECTION_RULES) {
    const srcMatch = r.sourceCategory === "*" || r.sourceCategory === srcCat;
    const tgtMatch = r.targetCategory === "*" || r.targetCategory === tgtCat;
    if (srcMatch && tgtMatch) {
      if (r.allowed) return { allowed: true };
      return { allowed: false, reason: r.reason || "Connection not permitted by workflow rules." };
    }
  }

  // Default: Allow forward flow if target is not trigger
  return { allowed: true };
}

