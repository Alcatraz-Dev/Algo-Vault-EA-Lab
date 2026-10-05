/** AlgoVault Agentic Trading Intelligence — Agent Reporting (Phase 14 §51)

 * Agents should produce structured reports.
 * Format is reusable across: research, strategy health, market analysis, trade review.
 */

import type { EvidenceReference, ProposedAction, StructuredOutput } from "./contracts";

// ─── Standard report ───────────────────────────────────────────────────────────
export interface AgentReport {
  objective: string;
  observedFacts: string[];
  analysis: string[];
  evidence: EvidenceReference[];
  risks: string[];
  decision: string;
  actions: ProposedAction[];
  limitations: string[];
  nextSteps: string[];
}

// ─── Report builders ───────────────────────────────────────────────────────────
export function buildMarketAnalysisReport(
  objective: string,
  observedFacts: string[],
  analysis: string[],
  evidence: EvidenceReference[],
  risks: string[],
  decision: string,
  actions: ProposedAction[],
  limitations: string[],
  nextSteps: string[],
): AgentReport {
  return {
    objective,
    observedFacts,
    analysis,
    evidence,
    risks,
    decision,
    actions,
    limitations,
    nextSteps,
  };
}

export function buildStrategyHealthReport(
  objective: string,
  observedFacts: string[],
  analysis: string[],
  evidence: EvidenceReference[],
  risks: string[],
  decision: string,
  actions: ProposedAction[],
  limitations: string[],
  nextSteps: string[],
): AgentReport {
  return buildMarketAnalysisReport(objective, observedFacts, analysis, evidence, risks, decision, actions, limitations, nextSteps);
}

export function buildTradeReviewReport(
  objective: string,
  observedFacts: string[],
  analysis: string[],
  evidence: EvidenceReference[],
  risks: string[],
  decision: string,
  actions: ProposedAction[],
  limitations: string[],
  nextSteps: string[],
): AgentReport {
  return buildMarketAnalysisReport(objective, observedFacts, analysis, evidence, risks, decision, actions, limitations, nextSteps);
}

export function buildResearchReport(
  objective: string,
  observedFacts: string[],
  analysis: string[],
  evidence: EvidenceReference[],
  risks: string[],
  decision: string,
  actions: ProposedAction[],
  limitations: string[],
  nextSteps: string[],
): AgentReport {
  return buildMarketAnalysisReport(objective, observedFacts, analysis, evidence, risks, decision, actions, limitations, nextSteps);
}

// ─── Convert StructuredOutput to AgentReport ──────────────────────────────────
export function structuredOutputToReport(output: StructuredOutput): Omit<AgentReport, "objective" | "observedFacts" | "analysis" | "evidence" | "risks" | "decision" | "actions" | "limitations" | "nextSteps"> & AgentReport {
  return {
    objective: output.objective,
    observedFacts: output.observedFacts,
    analysis: output.analysis,
    evidence: output.evidence,
    risks: output.risks,
    decision: output.decision,
    actions: output.actions,
    limitations: output.limitations,
    nextSteps: output.nextSteps,
  };
}
