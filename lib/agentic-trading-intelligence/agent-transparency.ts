/** AlgoVault Agentic Trading Intelligence — Agent Transparency (Phase 14 §30)

 * Every recommendation should show: Why, Evidence, Data timestamp,
 * Engine versions, Risk, Limitations.
 */

import type { EvidenceReference, ProposedAction, StructuredOutput } from "./contracts";

// ─── Recommendation transparency ───────────────────────────────────────────────
export interface RecommendationTransparency {
  recommendation: string;
  why: string;
  evidence: EvidenceReference[];
  dataTimestamp?: number;
  engineVersions: Record<string, string>;
  risk: string;
  limitations: string[];
  confidence: number;
  proposedBy: string;
  proposedAt: number;
}

// ─── Transparency builder ──────────────────────────────────────────────────────
export function buildTransparency(output: StructuredOutput, proposedAction?: ProposedAction): RecommendationTransparency {
  return {
    recommendation: output.decision,
    why: output.analysis.join(" ") || "See analysis.",
    evidence: output.evidence,
    dataTimestamp: output.provenance.dataTimestamp,
    engineVersions: output.provenance.engineVersions,
    risk: output.risks.join(" ") || "See risks.",
    limitations: output.limitations,
    confidence: output.provenance.model === "default" ? 0.8 : 0.9,
    proposedBy: output.provenance.agentId,
    proposedAt: output.provenance.dataTimestamp,
  };
}

// ─── Transparency for approval ─────────────────────────────────────────────────
export function buildApprovalTransparency(action: ProposedAction): RecommendationTransparency {
  return {
    recommendation: `Approve ${action.type}`,
    why: action.reason,
    evidence: action.evidence,
    dataTimestamp: action.proposedAt,
    engineVersions: {},
    risk: `Risk level: ${action.riskLevel}. Permission required: ${action.permissionRequired}.`,
    limitations: ["This action has not been executed yet. Approval only authorizes the action."],
    confidence: action.confidence,
    proposedBy: "Agent", // the agent id would be injected by the runtime
    proposedAt: action.proposedAt,
  };
}
