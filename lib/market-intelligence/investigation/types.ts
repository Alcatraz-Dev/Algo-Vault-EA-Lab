import type { KnowledgeNodeRef, KnowledgeEdge } from "../knowledge/types";

export type InvestigationRootType = "pattern" | "setup" | "validation_candidate" | "backtest" | "trade" | "evidence_report" | "smart_money_event" | "market_event";

export interface InvestigationRoot { type: InvestigationRootType; id: string; }

export interface InvestigationContext {
  root: InvestigationRoot;
  selectedNode?: KnowledgeNodeRef;
  selectedEdgeId?: string;
  workspace?: {
    symbol?: string; timeframe?: string; datasetId?: string; strategyId?: string;
    backtestId?: string; researchId?: string; tradeId?: string; eventId?: string;
  };
  mode: "live" | "backtest" | "replay";
  replayTimestamp?: number;
}

export interface EvidenceSection {
  title: string;
  category: "FACT" | "INTERPRETATION" | "LIMITATION";
  items: { label: string; value: string; source?: string }[];
}
