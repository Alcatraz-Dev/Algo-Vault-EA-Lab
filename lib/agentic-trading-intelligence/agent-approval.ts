/** AlgoVault Agentic Trading Intelligence — Agent Approval (Phase 14 §29)

 * For sensitive actions, the agent proposes, the user sees what, why, evidence,
 * risk, expected effect, limitations, and then confirms or rejects.
 */

import type { AgentPermission, AgentRiskLevel, ProposedAction, StructuredOutput } from "./contracts";


// ─── Approval request ──────────────────────────────────────────────────────────
export interface ApprovalRequest {
  actionId: string;
  type: string;
  payload: Record<string, unknown>;
  reason: string;
  evidence: Array<{ id: string; sourceType: string; sourceId: string; timestamp?: number; value?: unknown }>;
  riskLevel: AgentRiskLevel;
  permissionRequired: AgentPermission;
  expectedEffect: string;
  limitations: string[];
  confidence: number;
  proposedBy: string;
  proposedAt: number;
  expiresAt: number;
}

// AgentReport is re-exported from contracts.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface AgentReport {}


// ─── Approval decision ─────────────────────────────────────────────────────────
export type ApprovalDecision = "approved" | "rejected" | "expired" | "blocked";

export interface ApprovalDecisionRecord {
  actionId: string;
  decision: ApprovalDecision;
  decidedBy: string;
  decidedAt: number;
  reason?: string;
  correlationId?: string;
  causationId?: string;
}

// ─── Approval workflow ─────────────────────────────────────────────────────────
export class AgentApprovalWorkflow {
  constructor(private readonly approvalRequests: Map<string, ApprovalRequest> = new Map()) {}

  /** Propose an action that requires approval. */
  propose(request: ApprovalRequest): void {
    this.approvalRequests.set(request.actionId, request);
  }

  /** Approve an action. */
  approve(actionId: string, decidedBy: string, reason?: string, correlationId?: string, causationId?: string): ApprovalDecisionRecord {
    const request = this.approvalRequests.get(actionId);
    if (!request) throw new Error(`Approval request '${actionId}' not found.`);
    if (Date.now() > request.expiresAt) {
      throw new Error(`Approval request '${actionId}' has expired.`);
    }
    const decision: ApprovalDecisionRecord = {
      actionId,
      decision: "approved",
      decidedBy,
      decidedAt: Date.now(),
      reason,
      correlationId,
      causationId,
    };
    this.approvalRequests.delete(actionId);
    return decision;
  }

  /** Reject an action. */
  reject(actionId: string, decidedBy: string, reason?: string, correlationId?: string, causationId?: string): ApprovalDecisionRecord {
    const request = this.approvalRequests.get(actionId);
    if (!request) throw new Error(`Approval request '${actionId}' not found.`);
    const decision: ApprovalDecisionRecord = {
      actionId,
      decision: "rejected",
      decidedBy,
      decidedAt: Date.now(),
      reason,
      correlationId,
      causationId,
    };
    this.approvalRequests.delete(actionId);
    return decision;
  }

  /** Get pending approval requests. */
  pending(): ApprovalRequest[] {
    const now = Date.now();
    return Array.from(this.approvalRequests.values()).filter((r) => now < r.expiresAt);
  }

  /** Get an approval request by id. */
  get(actionId: string): ApprovalRequest | undefined {
    return this.approvalRequests.get(actionId);
  }

  /** Check if an action requires approval. */
  static requiresApproval(action: ProposedAction): boolean {
    return action.requiresConfirmation || action.riskLevel === "user_confirmation" || action.riskLevel === "high_risk" || action.riskLevel === "live_trading";
  }

  /** Build the information a user should see before approving/rejecting. */
  static buildApprovalInfo(action: ProposedAction): ApprovalInfo {
    return {
      actionId: action.id,
      type: action.type,
      payload: action.payload,
      reason: action.reason,
      evidence: action.evidence,
      riskLevel: action.riskLevel,
      permissionRequired: action.permissionRequired,
      expectedEffect: "", // populated by the agent
      limitations: [], // populated by the agent
      confidence: action.confidence,
      proposedBy: "", // populated by the agent
      proposedAt: action.proposedAt,
      expiresAt: action.proposedAt + 300_000, // 5 minutes
    };
  }
}

// ─── Approval info (what the user sees) ────────────────────────────────────────
export interface ApprovalInfo {
  actionId: string;
  type: string;
  payload: Record<string, unknown>;
  reason: string;
  evidence: Array<{ id: string; sourceType: string; sourceId: string; timestamp?: number; value?: unknown }>;
  riskLevel: AgentRiskLevel;
  permissionRequired: AgentPermission;
  expectedEffect: string;
  limitations: string[];
  confidence: number;
  proposedBy: string;
  proposedAt: number;
  expiresAt: number;
}
