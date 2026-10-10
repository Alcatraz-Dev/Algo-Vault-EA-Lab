/**
 * AlgoVault Candel SDK — Approvals (human-in-the-loop)
 *
 * Candels never execute a live trading action. They can only *ask*: the agent
 * emits an `approval` directive, the server turns it into a durable
 * `CandelApprovalRequest`, and the user decides in the UI. This module holds the
 * whole decision surface as pure functions so the rules are testable without a
 * model, a network or a database:
 *
 *   1. `extractApprovalDirectives` — parse the agent reply. Anything malformed,
 *      unknown or oversized is dropped, never guessed at.
 *   2. `resolveApprovalDirectives` — fail-closed admission: only a Candel whose
 *      template ships an execution-capable tool (or whose role is
 *      approval-gated) may raise a request, and a live action must name a
 *      trading account that is actually bound to this Candel.
 *   3. `applyApprovalDecision` — record exactly one human decision. A request
 *      cannot be re-decided and an expired request cannot be approved.
 *
 * Nothing here grants permission. An approved request is a *record of intent*
 * that the (separate, fail-closed) execution gate still has to honour.
 */

import { getCandelRole } from "./roles";
import type {
  AccountBinding,
  CandelApprovalRequest,
  CandelActionType,
} from "./types";
import type { EffectiveCandelConfig } from "./config";

// ─── Closed vocabulary ──────────────────────────────────────────────────────

/** Live actions a Candel may ask a human to approve. Nothing else is accepted. */
export const APPROVAL_ACTION_TYPES = [
  "createOrder",
  "modifyOrder",
  "closePosition",
  "cancelOrder",
] as const;

export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

/** The permission each action maps to, shown to the user on the approval card. */
export const APPROVAL_ACTION_PERMISSIONS: Record<ApprovalActionType, string> = {
  createOrder: "execution.createOrder",
  modifyOrder: "execution.modifyOrder",
  closePosition: "execution.closePosition",
  cancelOrder: "execution.cancelOrder",
};

/**
 * Every one of these touches a live account, so they are all `live_trading`.
 * There is deliberately no way for the agent to declare a lower risk.
 */
export const APPROVAL_RISK_LEVEL = "live_trading" as const;

export function isApprovalActionType(value: unknown): value is ApprovalActionType {
  return (
    typeof value === "string" &&
    (APPROVAL_ACTION_TYPES as readonly string[]).includes(value)
  );
}

/** Tools that mean "this Candel is allowed to talk about live order actions". */
const EXECUTION_CAPABLE_TOOLS = [
  "prepare_order",
  "submit_live_order",
  "close_position",
  "modify_order",
  "cancel_order",
];

/** How long an unanswered request stays actionable. */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/** Hard caps so a runaway model cannot bloat the database or the UI. */
export const APPROVAL_LIMITS = {
  summary: 280,
  reason: 300,
  payloadBytes: 4_000,
  maxPerTurn: 3,
  maxEvidence: 8,
} as const;

// ─── Directive parsing ──────────────────────────────────────────────────────

/**
 * Evidence attached to an approval request. Mirrors the wire shape stored on
 * `CandelApprovalRequest.evidence` rather than the richer workspace evidence
 * type, so what the agent cites is exactly what the user sees on the card.
 */
export interface ApprovalEvidence {
  sourceType: string;
  sourceId: string;
  timestamp?: number;
  value?: unknown;
}

export interface CandelApprovalDraft {
  actionType: ApprovalActionType;
  summary: string;
  payload: Record<string, unknown>;
  evidence: ApprovalEvidence[];
}

export interface RejectedDirective {
  actionType: string;
  reason: string;
}

const DIRECTIVE_RE = /```approval[^\n]*\n([\s\S]*?)```/g;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanEvidence(value: unknown): ApprovalEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: ApprovalEvidence[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const sourceType = cleanString(record.sourceType, 60);
    const sourceId = cleanString(record.sourceId, 120);
    if (!sourceType || !sourceId) continue;
    out.push({
      sourceType,
      sourceId,
      timestamp: typeof record.timestamp === "number" ? record.timestamp : undefined,
      value: record.value,
    });
    if (out.length >= APPROVAL_LIMITS.maxEvidence) break;
  }
  return out;
}

/**
 * Pull `approval` directives out of an agent reply.
 *
 * Returns the reply with the directive blocks removed (so the user never sees
 * raw JSON in the bubble) plus the drafts that survived validation. A draft is
 * dropped — not repaired — when its action is unknown or its payload is missing
 * or oversized.
 */
export function extractApprovalDirectives(reply: string): {
  clean: string;
  drafts: CandelApprovalDraft[];
  dropped: number;
} {
  const text = typeof reply === "string" ? reply : "";
  const drafts: CandelApprovalDraft[] = [];
  let dropped = 0;

  const clean = text
    .replace(DIRECTIVE_RE, (_match, body: string) => {
      if (drafts.length >= APPROVAL_LIMITS.maxPerTurn) {
        dropped += 1;
        return "";
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.trim());
      } catch {
        dropped += 1;
        return "";
      }
      const record = asRecord(parsed);
      if (!record || !isApprovalActionType(record.actionType)) {
        dropped += 1;
        return "";
      }
      const payload = asRecord(record.payload);
      if (!payload) {
        dropped += 1;
        return "";
      }
      const serialized = JSON.stringify(payload);
      if (serialized.length > APPROVAL_LIMITS.payloadBytes) {
        dropped += 1;
        return "";
      }
      const summary = cleanString(record.summary, APPROVAL_LIMITS.summary);
      if (!summary) {
        dropped += 1;
        return "";
      }
      drafts.push({
        actionType: record.actionType,
        summary,
        payload,
        evidence: cleanEvidence(record.evidence),
      });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { clean, drafts, dropped };
}

// ─── Fail-closed admission ──────────────────────────────────────────────────

export interface ApprovalAdmissionContext {
  config: EffectiveCandelConfig;
  bindings: AccountBinding[];
}

export interface ApprovalAdmission {
  accepted: CandelApprovalDraft[];
  rejected: RejectedDirective[];
}

/**
 * May this Candel raise approval requests at all?
 *
 * True only when its template ships an execution-capable tool *and* that tool is
 * still enabled in the effective config, or when its role is approval-gated. A
 * read-only Candel asking for permission to trade is a bug, not a feature.
 */
export function canRaiseApprovals(config: EffectiveCandelConfig): boolean {
  const enabled = new Set(config.tools);
  const hasExecutionTool = EXECUTION_CAPABLE_TOOLS.some((tool) => enabled.has(tool));
  if (hasExecutionTool) return true;
  return getCandelRole(config.role).riskPosture === "approval_gated";
}

function boundAccountRef(bindings: AccountBinding[], accountId: string): AccountBinding | null {
  return bindings.find((binding) => binding.tradingAccountId === accountId) ?? null;
}

/**
 * Decide which drafts become real approval requests.
 *
 * Every rejection carries a human-readable reason that the caller can append to
 * the reply, so a dropped action is visible to the user instead of vanishing.
 */
export function resolveApprovalDirectives(
  drafts: CandelApprovalDraft[],
  context: ApprovalAdmissionContext,
): ApprovalAdmission {
  const accepted: CandelApprovalDraft[] = [];
  const rejected: RejectedDirective[] = [];

  if (!canRaiseApprovals(context.config)) {
    for (const draft of drafts) {
      rejected.push({
        actionType: draft.actionType,
        reason: "this Candel is read-only and cannot propose live actions",
      });
    }
    return { accepted, rejected };
  }

  for (const draft of drafts) {
    const namedAccount =
      typeof draft.payload.accountId === "string" && draft.payload.accountId.trim()
        ? draft.payload.accountId.trim()
        : "";

    if (context.bindings.length === 0) {
      rejected.push({
        actionType: draft.actionType,
        reason: "no trading account is bound to this Candel",
      });
      continue;
    }

    if (namedAccount && !boundAccountRef(context.bindings, namedAccount)) {
      rejected.push({
        actionType: draft.actionType,
        reason: `account ${namedAccount} is not bound to this Candel`,
      });
      continue;
    }

    // A live action is always tied to exactly one named, bound account. When the
    // agent did not name one, the Candel must not guess: a single bound account
    // is unambiguous, two or more is a refusal.
    const account = namedAccount
      ? boundAccountRef(context.bindings, namedAccount)
      : context.bindings.length === 1
        ? context.bindings[0]
        : null;

    if (!account) {
      rejected.push({
        actionType: draft.actionType,
        reason: "several accounts are bound — name the account explicitly",
      });
      continue;
    }

    if (!account.allowedContexts.includes("execute")) {
      rejected.push({
        actionType: draft.actionType,
        reason: `account ${account.accountRef || account.tradingAccountId} is not bound for execution`,
      });
      continue;
    }

    accepted.push({
      ...draft,
      payload: { ...draft.payload, accountId: account.tradingAccountId },
    });
  }

  return { accepted, rejected };
}

/** Materialize an accepted draft into the durable request the user will decide. */
export function buildApprovalRequest(
  draft: CandelApprovalDraft,
  ids: { id: string; candelId: string; userId: string },
  now: number = Date.now(),
): CandelApprovalRequest {
  return {
    id: ids.id,
    candelId: ids.candelId,
    userId: ids.userId,
    requester: "candel",
    actionType: draft.actionType as CandelActionType,
    targetType: "trading_account",
    targetId: String(draft.payload.accountId ?? ""),
    summary: draft.summary,
    evidence: draft.evidence,
    riskLevel: APPROVAL_RISK_LEVEL,
    permissionRequired: APPROVAL_ACTION_PERMISSIONS[draft.actionType],
    payload: draft.payload,
    expiresAt: now + APPROVAL_TTL_MS,
    createdAt: now,
  };
}

// ─── Decisions ──────────────────────────────────────────────────────────────

export type ApprovalDecisionInput = "approved" | "rejected";

export type ApprovalDecisionErrorCode = "already_decided" | "expired" | "unknown_decision";

export type ApprovalDecisionResult =
  | { ok: true; request: CandelApprovalRequest }
  | { ok: false; code: ApprovalDecisionErrorCode; reason: string };

export function isApprovalPending(
  request: Pick<CandelApprovalRequest, "decision" | "expiresAt">,
  now: number = Date.now(),
): boolean {
  if (request.decision) return false;
  return (request.expiresAt ?? 0) > now;
}

export function isApprovalExpired(
  request: Pick<CandelApprovalRequest, "decision" | "expiresAt">,
  now: number = Date.now(),
): boolean {
  return !request.decision && (request.expiresAt ?? 0) <= now;
}

/**
 * Record exactly one human decision on a request.
 *
 * Refusals are explicit and stable: an already-decided request cannot be
 * re-decided (no approval replay), and an expired request cannot be approved.
 * The returned request is a copy — the caller decides whether to persist it.
 */
export function applyApprovalDecision(
  request: CandelApprovalRequest,
  decision: ApprovalDecisionInput,
  decidedBy: string,
  reason: string = "",
  now: number = Date.now(),
): ApprovalDecisionResult {
  if (decision !== "approved" && decision !== "rejected") {
    return { ok: false, code: "unknown_decision", reason: "decision must be approved or rejected" };
  }
  if (request.decision) {
    return {
      ok: false,
      code: "already_decided",
      reason: `This request was already ${request.decision}.`,
    };
  }
  if (!isApprovalPending(request, now)) {
    return { ok: false, code: "expired", reason: "This request expired before it was decided." };
  }

  const trimmedReason = cleanString(reason, APPROVAL_LIMITS.reason);
  const cleanRequest: CandelApprovalRequest = JSON.parse(JSON.stringify(request));

  return {
    ok: true,
    request: {
      ...cleanRequest,
      decision: decision === "approved" ? "approved" : "rejected",
      decidedBy,
      decidedAt: now,
      reason: trimmedReason,
    },
  };
}
