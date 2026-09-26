/**
 * Strategy Validator — Phase 4
 *
 * Reuses workflow validation concepts (graph meta, topo sort, cycle detection).
 * Adds Smart Money / Strategy-specific rules.
 */

import { StrategyDefinition, StrategyValidationResult } from "./types";

export function validateStrategy(def: StrategyDefinition): StrategyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set(def.nodes.map((n) => n.id));

  // Unique node ids
  const ids = def.nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) errors.push("Duplicate node ids.");

  // Edge references exist
  for (const e of def.edges ?? []) {
    if (!nodeIds.has(e.source)) errors.push(`Edge source missing: ${e.source}`);
    if (!nodeIds.has(e.target)) errors.push(`Edge target missing: ${e.target}`);
  }

  // At least one entry and exit node
  const entryTypes = ["entry.long", "entry.short", "entry"];
  const exitTypes = ["exit.close", "exit.tp", "exit.sl", "exit"];
  const hasEntry = def.nodes.some((n) => entryTypes.includes(n.type) || n.type.includes("entry"));
  const hasExit = def.nodes.some((n) => exitTypes.includes(n.type) || n.type.includes("exit"));
  if (!hasEntry) { errors.push("Missing entry node."); }
  if (!hasExit) { errors.push("Missing exit node."); }

  // No cycles (simple DFS)
  const adj = new Map<string, string[]>();
  for (const n of def.nodes) adj.set(n.id, []);
  for (const e of def.edges ?? []) {
    if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
  }
  const visited = new Set<string>();
  const path = new Set<string>();
  function dfs(k: string): boolean {
    visited.add(k); path.add(k);
    for (const t of adj.get(k) ?? []) {
      if (path.has(t)) return true;
      if (!visited.has(t)) if (dfs(t)) return true;
    }
    path.delete(k);
    return false;
  }
  for (const k of adj.keys()) if (!visited.has(k)) if (dfs(k)) { errors.push("Cycle detected in strategy graph."); break; }

  // Smart Money nodes must reference real engine (no fake nodes)
  const smTypes = ["smart_money.bos", "smart_money.choch", "smart_money.mss", "smart_money.fvg", "smart_money.ob", "smart_money.liquidity", "smart_money.session"];
  for (const n of def.nodes) {
    if (smTypes.some((t) => n.type === t || n.type.startsWith("smart_money."))) {
      if (!n.config) warnings.push(`Smart Money node ${n.id} should have config.`);
    }
  }

  // Unknown indicator types
  const supportedIndicators = ["ema", "sma", "rsi", "macd", "atr", "bollinger", "supertrend", "vwap", "vwma", "ad", "cci"];
  const indicatorTypes = def.nodes.filter((n) => n.type.startsWith("indicator."));
  for (const n of indicatorTypes) {
    const kind = n.type.split(".")[1];
    if (!supportedIndicators.includes(kind)) warnings.push(`Indicator ${kind} not fully supported by analytics engine.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    nodeIds,
    missingEntry: !hasEntry,
    missingExit: !hasExit,
    disconnectedNodes: [],
  };
}
