/**
 * Strategy Compiler / Adapter — Phase 4
 *
 * Converts StrategyDefinition into a form consumable by the existing
 * backtesting engine (lib/strategy-lab/backtest.ts) via BacktestAdapter.
 */

import { StrategyDefinition, StrategyNode, StrategyEdge, ConditionExpression } from "./types";
import { BacktestConfig, BacktestContext } from "../../backtesting/adapter";
import { SmartMoneyEngine } from "../../smart-money/engine";

export interface CompiledStrategy {
  definition: StrategyDefinition;
  entryCondition: ConditionExpression;
  exitCondition?: ConditionExpression;
  riskConfig: StrategyDefinition["risk"];
}

export function compileStrategy(def: StrategyDefinition): CompiledStrategy {
  return {
    definition: def,
    entryCondition: def.entryConditions ?? { operator: "AND", conditions: [] },
    exitCondition: def.exitConditions,
    riskConfig: def.risk,
  };
}

export function evaluateCondition(
  expr: ConditionExpression,
  context: BacktestContext
): boolean {
  if (!expr) return false;

  switch (expr.operator) {
    case "AND":
      return (expr.conditions ?? []).every((c) => evaluateCondition(c, context));
    case "OR":
      return (expr.conditions ?? []).some((c) => evaluateCondition(c, context));
    case "NOT":
      return !(expr.conditions ?? []).some((c) => evaluateCondition(c, context));
    default:
      // Direct node reference evaluation
      const event = context.smartMoneyEvents.find((e) =>
        (e as any).type === expr.nodeId || (e as any).metadata?.nodeId === expr.nodeId
      );
      if (!event && expr.nodeId) {
        // If the node refers to a Smart Money event type, check if any exists
        const eventByType = context.smartMoneyEvents.find((e) => (e as any).type === expr.nodeId);
        return !!eventByType;
      }
      return false;
  }
}

export function describeStrategyForBacktest(config?: BacktestConfig): string {
  if (!config) return "No strategy configured. Build a strategy in Strategy Lab to backtest.";
  return `Backtest adapter active for ${config.symbol} ${config.timeframe}. Strategy rules defined via Strategy Builder.`;
}
