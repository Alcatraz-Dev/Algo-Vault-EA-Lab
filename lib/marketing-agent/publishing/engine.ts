/**
 * Marketing Agent — publishing engine (§29, §31, §55, §56).
 *
 * Reliability rules enforced here:
 *  - idempotency keys are generated once and reused across retries, so a
 *    timeout can never produce a second post;
 *  - every external call is classified (transient / permanent / auth / rate
 *    limit / validation) and only retryable classes are retried, with
 *    exponential backoff and a bounded attempt count;
 *  - a job becomes PUBLISHED only after the platform confirmed it AND the
 *    external id was verified — otherwise PUBLISH_VERIFICATION_REQUIRED;
 *  - if the outcome of a call is uncertain (timeout after submission) the
 *    engine VERIFIES before retrying, so a post is never duplicated.
 *
 * Persistence is injected (`PublishingStore`) so the engine is unit-testable
 * without Firebase (§81). The RTDB implementation lives in `../storage.ts`.
 */

import { MARKETING_AGENT_DEFAULTS, PUBLISHING_TRANSITIONS, type MarketingPlatform, type PublishingState } from "../collections";
import { backoffDelayMs, shouldRetry } from "../cost";
import type { PublishingJob, UtmParameters } from "../types";
import { queuePreconditions, transition } from "./state-machine";
import { getSocialPublisher, registerSocialPublishers, verificationFromGet } from "./providers";
import type { ConnectorResult, CreatePostInput, SocialPublisher } from "./types";

export type PublishingStore = {
  get(id: string): Promise<PublishingJob | null>;
  update(id: string, patch: Partial<PublishingJob>): Promise<void>;
  /** Records an auditable attempt (§62). */
  audit(entry: { jobId: string; action: string; detail: Record<string, unknown> }): Promise<void>;
  /** Global dedup: returns false when this idempotency key already published. */
  claimPublish(key: string): Promise<boolean>;
};

export type PublishContext = {
  approvalGranted: boolean;
  accountConnected: boolean;
  publishingEnabled: boolean;
  qaPassed: boolean;
  now?: number;
};

export type ExecuteResult = {
  ok: boolean;
  jobId: string;
  state: PublishingJob["state"];
  externalId?: string;
  externalUrl?: string;
  attempt: number;
  nextAttemptAt?: number;
  reason: string;
  verificationOk?: boolean;
};

function idempotencyKeyFor(job: PublishingJob): string {
  // Stable across retries: job id + version + platform.
  return `mk_${job.creativeId}_${job.versionId}_${job.platform}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 120);
}

/**
 * States that must never appear as an intermediate step (terminal states, or
 * states whose meaning would be a lie when passed through).
 */
const DEAD_END_STATES = new Set<PublishingState>([
  "CANCELLED",
  "EXPIRED",
  "NOT_SUPPORTED",
  "PUBLISHED",
  "PUBLISH_VERIFICATION_REQUIRED",
  "FAILED",
]);

/**
 * Shortest legal transition path (§28) from → to, or null when unreachable.
 * Every step is validated by the same state machine the UI uses — the engine
 * never invents an edge (a job never jumps READY → PUBLISHED).
 */
function legalPath(from: PublishingState, to: PublishingState): PublishingState[] | null {
  if (from === to) return [];
  const seen = new Set<PublishingState>([from]);
  let frontier: { state: PublishingState; path: PublishingState[] }[] = [{ state: from, path: [] }];
  while (frontier.length > 0) {
    const next: { state: PublishingState; path: PublishingState[] }[] = [];
    for (const node of frontier) {
      for (const step of PUBLISHING_TRANSITIONS[node.state] ?? []) {
        if (seen.has(step)) continue;
        if (DEAD_END_STATES.has(step) && step !== to) continue;
        const path = [...node.path, step];
        if (step === to) return path;
        seen.add(step);
        next.push({ state: step, path });
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Drive the job to `target` through legal intermediate states and persist
 * every step. Returns the state the job actually ended in — when that is not
 * `target`, the caller must NOT claim the operation happened (§91).
 * (Returning the state rather than reading `job.state` afterwards also keeps
 * TypeScript's narrowing at the call site honest, since it cannot see that
 * this function mutates the job.)
 */
function advanceTo(
  store: PublishingStore,
  job: PublishingJob,
  target: PublishingState,
  patch: Partial<PublishingJob> = {}
): PublishingState {
  const path = legalPath(job.state, target);
  if (path === null) {
    void store.audit({ jobId: job.id ?? "", action: "illegal_transition_blocked", detail: { from: job.state, to: target, reason: "No legal transition path." } });
    return job.state;
  }
  if (path.length === 0) {
    applyTransition(store, job, target, patch);
  } else {
    path.forEach((step, i) => applyTransition(store, job, step, i === path.length - 1 ? patch : {}));
  }
  return job.state;
}

function buildCreateInput(job: PublishingJob, accountId: string): CreatePostInput {
  return {
    accountId,
    media: {
      mediaPath: job.mediaUrl,
      mimeType: "video/mp4",
      durationSec: 0,
    },
    title: job.copy.title,
    caption: job.copy.caption,
    description: job.copy.description,
    hashtags: job.copy.hashtags,
    firstComment: job.copy.firstComment,
    destinationUrl: job.destinationUrl,
    idempotencyKey: job.idempotencyKey || idempotencyKeyFor(job),
  };
}

/**
 * Execute (or re-execute) one publishing job exactly once per confirmation.
 * Never throws — every outcome is written back onto the job record.
 */
export async function executePublishingJob(
  store: PublishingStore,
  jobId: string,
  context: PublishContext
): Promise<ExecuteResult> {
  const now = context.now ?? Date.now();
  const job = await store.get(jobId);
  if (!job) {
    return { ok: false, jobId, state: "FAILED", attempt: 0, reason: "Publishing job not found." };
  }

  if (job.state === "PUBLISHED") {
    return { ok: true, jobId, state: "PUBLISHED", externalId: job.externalId, externalUrl: job.externalUrl, attempt: job.attempt, reason: "Already published." };
  }
  if (job.state === "CANCELLED" || job.state === "EXPIRED" || job.state === "NOT_SUPPORTED") {
    return { ok: false, jobId, state: job.state, attempt: job.attempt, reason: `Job is ${job.state}.` };
  }
  if (job.nextAttemptAt && job.nextAttemptAt > now) {
    return { ok: false, jobId, state: job.state, attempt: job.attempt, nextAttemptAt: job.nextAttemptAt, reason: "Waiting for backoff window." };
  }

  const failures = queuePreconditions(job, {
    approvalGranted: context.approvalGranted,
    accountConnected: context.accountConnected,
    publishingEnabled: context.publishingEnabled,
    qaPassed: context.qaPassed,
    scheduleDue: true,
  });
  if (failures.length > 0) {
    applyTransition(store, job, "READY", { lastError: { code: "PRECONDITION", kind: "VALIDATION", message: failures.join(" ") } });
    await store.audit({ jobId, action: "publish_preconditions_failed", detail: { failures } });
    return { ok: false, jobId, state: job.state, attempt: job.attempt, reason: failures.join(" ") };
  }

  registerSocialPublishers();
  const publisher: SocialPublisher | undefined = getSocialPublisher(job.platform as MarketingPlatform);
  if (!publisher) {
    advanceTo(store, job, "NOT_SUPPORTED", { lastError: { code: "NO_CONNECTOR", kind: "PERMANENT", message: `No connector for ${job.platform}.` } });
    return { ok: false, jobId, state: job.state, attempt: job.attempt, reason: `No connector for ${job.platform}.` };
  }
  if (!publisher.capabilities.canPublishVideo) {
    advanceTo(store, job, "NOT_SUPPORTED", { lastError: { code: "NOT_SUPPORTED", kind: "PERMANENT", message: `${job.platform} cannot publish video via its official API.` } });
    return { ok: false, jobId, state: job.state, attempt: job.attempt, reason: `${job.platform} cannot publish video via its official API.` };
  }

  // ── Uncertain outcome → verify before retrying (§57) ──────────────────────
  if (job.attempt > 0 && job.externalId) {
    const pre = await publisher.getPost(job.accountId ?? "", job.externalId);
    if (pre.ok && pre.value.exists) {
      const preState = advanceTo(store, job, "PUBLISHED", {
        platformConfirmed: true,
        externalId: job.externalId,
        externalUrl: pre.value.url ?? job.externalUrl,
        publishedAt: pre.value.publishedAt ?? now,
        verifiedAt: now,
        verification: { ok: true, method: "pre-retry getPost", checkedAt: now },
      });
      if (preState !== "PUBLISHED") {
        return { ok: false, jobId, state: preState, externalId: job.externalId, attempt: job.attempt, reason: "Existing post verified, but the state machine refused PUBLISHED — manual review required." };
      }
      await store.audit({ jobId, action: "publish_verified_before_retry", detail: { externalId: job.externalId } });
      return { ok: true, jobId, state: "PUBLISHED", externalId: job.externalId, attempt: job.attempt, reason: "Existing post verified before retry — duplicate prevented." };
    }
  }

  // ── Idempotency claim (§29) ───────────────────────────────────────────────
  const idempotencyKey = job.idempotencyKey || idempotencyKeyFor(job);
  if (job.attempt === 0 && !(await store.claimPublish(idempotencyKey))) {
    advanceTo(store, job, "PUBLISH_VERIFICATION_REQUIRED", {
      lastError: { code: "DUPLICATE", kind: "VALIDATION", message: "An identical publish request already exists." },
    });
    await store.audit({ jobId, action: "publish_duplicate_blocked", detail: { idempotencyKey } });
    return { ok: false, jobId, state: job.state, attempt: job.attempt, reason: "Duplicate publish blocked by idempotency key." };
  }

  // Enter PUBLISHING through the legal path (§28): READY → QUEUED → PUBLISHING.
  // Nothing is submitted unless the transition actually persisted.
  if (advanceTo(store, job, "PUBLISHING", { idempotencyKey }) !== "PUBLISHING") {
    return { ok: false, jobId, state: job.state, attempt: job.attempt, reason: "State machine refused PUBLISHING — nothing was submitted." };
  }
  await store.audit({ jobId, action: "publish_started", detail: { platform: job.platform, attempt: job.attempt + 1, idempotencyKey } });

  // ── Submit ────────────────────────────────────────────────────────────────
  const attempt = job.attempt + 1;
  const input = buildCreateInput({ ...job, idempotencyKey }, job.accountId ?? "");
  const res = await publisher.createPost(input);

  if (res.ok) {
    // Confirmation from the platform — verify before declaring PUBLISHED (§31).
    const verify = await verifyConfirmation(publisher, job, res.value.externalId);
    if (!verify.ok) {
      applyTransition(store, job, "PUBLISH_VERIFICATION_REQUIRED", {
        attempt,
        idempotencyKey,
        externalId: res.value.externalId,
        externalUrl: res.value.externalUrl,
        platformConfirmed: false,
        verification: { ok: false, method: "getPost", detail: verify.reason, checkedAt: now },
        lastError: { code: "VERIFY_FAILED", kind: "TRANSIENT", message: verify.reason },
        nextAttemptAt: now + backoffDelayMs(attempt),
      });
      await store.audit({ jobId, action: "publish_verification_failed", detail: { externalId: res.value.externalId, reason: verify.reason } });
      return {
        ok: false,
        jobId,
        state: "PUBLISH_VERIFICATION_REQUIRED",
        externalId: res.value.externalId,
        attempt,
        nextAttemptAt: now + backoffDelayMs(attempt),
        reason: verify.reason,
        verificationOk: false,
      };
    }

    const publishedState = advanceTo(store, job, "PUBLISHED", {
      attempt,
      idempotencyKey,
      platformConfirmed: true,
      externalId: res.value.externalId,
      externalUrl: res.value.externalUrl,
      publishedAt: res.value.publishedAt,
      verifiedAt: now,
      verification: { ok: true, method: "getPost", checkedAt: now },
      lastError: undefined,
      nextAttemptAt: undefined,
    });
    if (publishedState !== "PUBLISHED") {
      // §91: never claim a state the system did not actually reach.
      return { ok: false, jobId, state: publishedState, externalId: res.value.externalId, attempt, reason: "Platform confirmed, but the state machine refused PUBLISHED — manual review required." };
    }
    await store.audit({ jobId, action: "publish_verified", detail: { platform: job.platform, externalId: res.value.externalId } });
    return { ok: true, jobId, state: "PUBLISHED", externalId: res.value.externalId, externalUrl: res.value.externalUrl, attempt, reason: "Platform confirmed publication." };
  }

  // ── Failure classification (§56) ──────────────────────────────────────────
  // The connector's own `retryable` verdict wins: connectors classify AUTH
  // only after their credential refresh already failed (§30), so those never
  // re-enter the retry loop — a dead token needs a reconnect, not a retry.
  const decision =
    res.retryable === false
      ? { retry: false, reason: `${res.errorKind} error — not retryable (manual action required).`, delayMs: 0 }
      : shouldRetry({ attempt, maxAttempts: job.maxAttempts || MARKETING_AGENT_DEFAULTS.maxRetries, errorKind: res.errorKind });

  applyTransition(store, job, decision.retry ? "RETRYING" : res.state === "NOT_SUPPORTED" ? "NOT_SUPPORTED" : "FAILED", {
    attempt,
    idempotencyKey,
    nextAttemptAt: decision.retry ? now + decision.delayMs : undefined,
    lastError: { code: res.state, kind: res.errorKind, message: res.reason },
  });
  await store.audit({ jobId, action: decision.retry ? "publish_retry_scheduled" : "publish_failed", detail: { state: res.state, kind: res.errorKind, attempt, reason: res.reason } });

  return {
    ok: false,
    jobId,
    state: decision.retry ? "RETRYING" : res.state === "NOT_SUPPORTED" ? "NOT_SUPPORTED" : "FAILED",
    attempt,
    nextAttemptAt: decision.retry ? now + decision.delayMs : undefined,
    reason: res.reason,
  };
}

async function verifyConfirmation(
  publisher: SocialPublisher,
  job: PublishingJob,
  externalId: string
): Promise<{ ok: boolean; reason: string }> {
  try {
    const get = await publisher.getPost(job.accountId ?? "", externalId);
    const v = verificationFromGet(get, externalId);
    return v.ok ? { ok: true, reason: "verified" } : { ok: false, reason: v.reason };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "verification threw." };
  }
}

function applyTransition(
  store: PublishingStore,
  job: PublishingJob,
  to: PublishingJob["state"],
  patch: Partial<PublishingJob>
): void {
  const result = transition(job, to, patch);
  if (!result.ok) {
    // Illegal transition — record it rather than forcing the state.
    void store.audit({ jobId: job.id ?? "", action: "illegal_transition_blocked", detail: { from: job.state, to, reason: result.reason } });
    return;
  }
  job.state = to;
  Object.assign(job, result.next ?? {});
  void store.update(job.id ?? "", { ...job, updatedAt: Date.now() });
}

/** Manual retry entry point (§29). Resets backoff but never the idempotency key. */
export async function retryPublishingJob(store: PublishingStore, jobId: string, context: PublishContext): Promise<ExecuteResult> {
  const job = await store.get(jobId);
  if (!job) return { ok: false, jobId, state: "FAILED", attempt: 0, reason: "Publishing job not found." };
  if (job.state !== "FAILED" && job.state !== "RETRYING" && job.state !== "PUBLISH_VERIFICATION_REQUIRED") {
    return { ok: false, jobId, state: job.state, attempt: job.attempt, reason: `Cannot retry from ${job.state}.` };
  }
  await store.update(jobId, { nextAttemptAt: 0, updatedAt: Date.now() });
  return executePublishingJob(store, jobId, context);
}

/** Cancel a job (§29). */
export async function cancelPublishingJob(store: PublishingStore, jobId: string): Promise<{ ok: boolean; reason: string }> {
  const job = await store.get(jobId);
  if (!job) return { ok: false, reason: "Publishing job not found." };
  const result = transition(job, "CANCELLED", {});
  if (!result.ok) return { ok: false, reason: result.reason };
  await store.update(jobId, { state: "CANCELLED", updatedAt: Date.now() });
  await store.audit({ jobId, action: "publish_cancelled", detail: { from: job.state } });
  return { ok: true, reason: "Cancelled." };
}

/** Queue every due job for a schedule tick (called by the growth cron). */
export async function queueDueJobs(
  store: PublishingStore,
  jobIds: string[],
  context: PublishContext
): Promise<ExecuteResult[]> {
  const results: ExecuteResult[] = [];
  for (const id of jobIds) {
    results.push(await executePublishingJob(store, id, context));
  }
  return results;
}

export type { ConnectorResult, UtmParameters };
