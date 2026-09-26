/**
 * Strategy Definition — Phase 4 adapter contract.
 *
 * Does NOT replace Strategy Lab or Trading Studio.
 * Connects visual graph (React Flow / Workflow Automation) to
 * existing backtesting and Smart Money engines.
 */

import { Timeframe } from "../types";

export interface StrategyNode {
  id: string;
  type: string; // dotted: category.subtype, matches registry
  label: string;
  enabled?: boolean;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface StrategyEdge {
  id: string;
  source: string;
  target: string;
  enabled?: boolean;
  label?: string;
}

export interface StrategyDefinition {
  id: string;
  name: string;
  version: number;
  symbol?: string;
  timeframe?: Timeframe;
  nodes: StrategyNode[];
  edges: StrategyEdge[];
  entryConditions?: ConditionExpression;
  exitConditions?: ConditionExpression;
  risk?: RiskConfig;
  metadata?: {
    description?: string;
    createdAt?: number;
    updatedAt?: number;
    source?: "algovault";
  };
}

export interface ConditionExpression {
  operator: "AND" | "OR" | "NOT";
  conditions?: ConditionExpression[];
  nodeId?: string; // reference to Smart Money / Indicator node
  value?: string | number | boolean;
  parameter?: string;
}

export interface RiskConfig {
  positionSizing: "fixed_quantity" | "fixed_notional" | "risk_percent";
  value: number;
  maxPositions?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface StrategyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  nodeIds: Set<string>;
  missingEntry?: boolean;
  missingExit?: boolean;
  disconnectedNodes?: string[];
}
