/**
 * Marketing Agent — publishing state machine (§28, §31).
 *
 * Pure and total: `transition` is the ONLY way a publishing job changes state.
 * The rule that matters most — a job may only become PUBLISHED when the
 * platform actually confirmed success — is enforced here, not in a UI.
 *
 * Pure module: no I/O.
 */

import { PUBLISHING_STATES, PUBLISHING_TERMINAL_STATES, PUBLISHING_TRANSITIONS, type PublishingState } from "../collections";
import type { PublishingJob } from "../types";

export type TransitionCheck =
  | { ok: true; to: PublishingState }
  | { ok: false; reason: string; from: PublishingState; to: PublishingState };

export function canTransition(from: PublishingState, to: PublishingState): TransitionCheck {
  if (from === to) return { ok: true, to };
  const allowed = PUBLISHING_TRANSITIONS[from];
  if (!allowed) return { ok: false, reason: `Unknown source state "${from}".`, from, to };
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Illegal transition ${from} → ${to}. Allowed: ${allowed.join(", ") || "none"}.`, from, to };
  }
  return { ok: true, to };
}

/**
 * Apply a transition with the §31 guard: PUBLISHED requires an external
 * confirmation (external id + timestamp) recorded on the job.
 */
export function transition(
  job: Pick<PublishingJob, "state" | "platformConfirmed" | "externalId" | "publishedAt">,
  to: PublishingState,
  patch: Partial<PublishingJob> = {}
): TransitionCheck & { next?: Partial<PublishingJob> } {
  const check = canTransition(job.state, to);
  if (!check.ok) return check;

  if (to === "PUBLISHED") {
    if (!job.platformConfirmed && !patch.platformConfirmed) {
      return {
        ok: false,
        reason: "Refusing PUBLISHED: the platform has not confirmed publication.",
        from: job.state,
        to,
      };
    }
    const externalId = patch.externalId ?? job.externalId;
    const publishedAt = patch.publishedAt ?? job.publishedAt;
    if (!externalId) {
      return { ok: false, reason: "Refusing PUBLISHED: no external post id was returned.", from: job.state, to };
    }
    if (!publishedAt) {
      return { ok: false, reason: "Refusing PUBLISHED: no publication timestamp.", from: job.state, to };
    }
    return { ok: true, to, next: { ...patch, state: to, platformConfirmed: true, externalId, publishedAt } };
  }

  if (to === "PUBLISH_VERIFICATION_REQUIRED") {
    // Verification failed or could not be performed — downgrade honestly.
    return { ok: true, to, next: { ...patch, state: to, platformConfirmed: false } };
  }

  return { ok: true, to, next: { ...patch, state: to } };
}

export function isTerminal(state: PublishingState): boolean {
  return PUBLISHING_TERMINAL_STATES.includes(state);
}

export function isPublishingActive(state: PublishingState): boolean {
  return ["READY", "SCHEDULED", "QUEUED", "PUBLISHING", "RETRYING"].includes(state);
}

/** States from which a manual retry is meaningful (§29). */
export function canManualRetry(state: PublishingState): boolean {
  return ["FAILED", "RETRYING", "PUBLISH_VERIFICATION_REQUIRED"].includes(state);
}

export function canCancel(state: PublishingState): boolean {
  return ["DRAFT", "READY", "SCHEDULED", "QUEUED", "RETRYING", "FAILED"].includes(state);
}

/**
 * Pre-flight ordering (§55): a job may only enter QUEUED when every
 * prerequisite holds. Returns the failing reasons (empty = clear to queue).
 */
export function queuePreconditions(job: PublishingJob, context: {
  approvalGranted: boolean;
  accountConnected: boolean;
  publishingEnabled: boolean;
  qaPassed: boolean;
  scheduleDue: boolean;
}): string[] {
  const failures: string[] = [];
  if (!context.publishingEnabled) failures.push("Publishing is disabled by an administrator.");
  if (!context.approvalGranted) failures.push("Campaign approval has not been granted.");
  if (!context.accountConnected) failures.push("No connected social account for this platform.");
  if (!context.qaPassed) failures.push("QA has not passed for this creative.");
  if (!context.scheduleDue) failures.push("The schedule is not due.");
  if (!job.mediaUrl) failures.push("No media attached to the publishing job.");
  if (!job.destinationUrl) failures.push("No destination URL.");
  if (!job.utm?.utm_source) failures.push("UTM parameters missing.");
  return failures;
}

export const PUBLISHING_STATE_HELP: Record<PublishingState, string> = Object.fromEntries(
  PUBLISHING_STATES.map((s) => [s, PUBLISHING_TRANSITIONS[s]?.length ? `→ ${PUBLISHING_TRANSITIONS[s].join(", ")}` : "terminal"])
) as Record<PublishingState, string>;
