/**
 * Strategy Definition Compiler — compiles structured strategy rules into the
 * canonical StrategyDefinition used by the existing Strategy Engine.
 *
 * Relationship with existing modules:
 *   Workflow Logic (lib/workflows) -> trading-strategy-compiler (this) -> StrategyDefinition (lib/strategy-lab/types) -> Strategy Engine (lib/strategy-engine)
 *
 * No second strategy engine is created.
 */

import type { Strategy } from "../strategy-lab/types"; // canonical

export interface CompiledStrategyResult {
  definition: Strategy;
  errors: string[];
  warnings: string[];
}

/** Raw condition shape carried by a draft before validation into a Strategy. */
interface StrategyConditionDraft {
  type: string;
  [key: string]: unknown;
}

/**
 * Draft input accepted by the compiler: a partial canonical Strategy plus the
 * raw draft fields (instruments / entry & exit conditions) that validation
 * checks before the result is folded into a Strategy.
 */
type StrategyCompileInput = Omit<Partial<Strategy>, "stopLoss" | "version" | "timeframes"> & {
  timeframes?: Strategy["timeframes"] | string[];
  instruments?: Array<{ symbol: string; timeframe: string }>;
  entryConditions?: StrategyConditionDraft[];
  exitConditions?: StrategyConditionDraft[];
  stopLoss?: Strategy["stopLoss"] | { type?: string; value?: number };
  version?: number | string;
};

export function compileToCanonicalDefinition(
  input: StrategyCompileInput
): CompiledStrategyResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Reuse existing validation logic from lib/strategy-engine/validation
  if (!input.entryConditions || input.entryConditions.length === 0) {
    errors.push("Strategy requires at least one entry condition.");
  }
  if (!input.exitConditions || input.exitConditions.length === 0) {
    errors.push("Strategy requires at least one exit condition.");
  }
  if (!input.stopLoss) {
    errors.push("Stop loss is undefined — required for risk-controlled strategies.");
  }
  if (!input.instruments || input.instruments.length === 0) {
    errors.push("No instruments defined.");
  }
  if (input.timeframes && Array.isArray(input.timeframes) && input.timeframes.length === 0) {
    errors.push("Timeframes array is empty.");
  }

  // Conflicting conditions check
  const conditions = input.entryConditions || [];
  const exitConditions = input.exitConditions || [];
  const hasFutureReference = conditions.some((c: any) => c?.futureConfirmation || c?.lookahead);
  if (hasFutureReference) {
    errors.push("Condition references unavailable future confirmation — look-ahead risk.");
  }

  // Impossible conditions (stub for extensibility — real detection lives in lib/plugins/ai-generator)
  if (conditions.length > 0 && conditions.some((c: any) => c?.alwaysTrue)) {
    warnings.push("Condition appears to match on every bar; verify it produces meaningful entries.");
  }

  // Ensure versioning
  const definition: Strategy = {
    ...input,
    version: input.version ?? 1,
    id: input.id ?? `strat_${Date.now().toString(36)}`,
  } as Strategy;

  return { definition, errors, warnings };
}
