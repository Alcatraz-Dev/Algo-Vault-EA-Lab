/**
 * Phase 12 — Structured Market Context Pipeline
 * Combines existing data sources deterministically; never invents values.
 */
import { deriveDataQuality } from "./data-quality";
import { evaluateMTF, MTFEntry } from "./mtf-confluence";
import { transitionSetup } from "./setup-lifecycle";
import { AI_BOUNDARY_RULES, EvidencePayload } from "./ai-boundary";
import { buildHistoricalEvidence, HistoricalEvidence } from "./historical-bridge";

export interface StructuredMarketContext {
  symbol: string;
  timeframes: string[];
  timestamp: string;
  dataQuality: ReturnType<typeof deriveDataQuality>;
  mtfEntries: MTFEntry[];
  setupLifecycle?: ReturnType<typeof transitionSetup>;
  historicalEvidence: HistoricalEvidence;
  aiEvidencePayload?: EvidencePayload;
  aiBoundaryRules: typeof AI_BOUNDARY_RULES;
}

export function assembleContext(
  symbol: string,
  availableTimeframes: string[],
  biases: Record<string, string | undefined>,
  setup?: ReturnType<typeof transitionSetup>,
  historical?: { backtestId?: string; replayAvailable?: boolean }
): StructuredMarketContext {
  const dq = deriveDataQuality(availableTimeframes);
  const mtf = evaluateMTF(availableTimeframes, biases);
  const hist = buildHistoricalEvidence(historical?.backtestId, historical?.replayAvailable);
  return {
    symbol,
    timeframes: availableTimeframes,
    timestamp: new Date().toISOString(),
    dataQuality: dq,
    mtfEntries: mtf,
    setupLifecycle: setup,
    historicalEvidence: hist,
    aiBoundaryRules: AI_BOUNDARY_RULES,
  };
}
