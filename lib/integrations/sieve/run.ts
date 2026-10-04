// Sieve scrape API — run orchestration.
//
// `startScrapeRun` persists the session_id BEFORE anything else so a crash
// resumes polling instead of spending credits on a duplicate. `resumeScrapeRun`
// never POSTs — it only reads the persisted session and polls.

import { createScrape, sendMessage } from "./client";
import { isSieveConfigured, loadSieveConfig } from "./config";
import { SieveError, SieveNotConfiguredError } from "./errors";
import { followUpUntilAdvanced, pollScrapeUntilSettled } from "./polling";
import type { PollOptions } from "./polling";
import { getSieveRun, saveSieveRun, updateSieveRun, type SieveRunRecord } from "./store";
import type { SieveFollowUpInput, SieveStartRunInput } from "./types";

function assertConfigured(): void {
  if (!isSieveConfigured(loadSieveConfig())) throw new SieveNotConfiguredError();
}

function recordFromRun(
  base: SieveRunRecord,
  run: { status: string; turns?: number; summary?: string; files?: SieveRunRecord["files"]; schema_conformance?: SieveRunRecord["schemaConformance"]; result?: unknown; refusal?: { code?: string } },
): SieveRunRecord {
  return {
    ...base,
    status: run.status,
    turns: typeof run.turns === "number" ? run.turns : base.turns,
    summary: run.summary ?? base.summary,
    files: run.files ?? base.files,
    schemaConformance: run.schema_conformance ?? base.schemaConformance,
    result: run.result ?? base.result,
    refusalCode: run.refusal?.code ?? base.refusalCode,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Start a run. The 202 response is persisted immediately; only then does the
 * caller (or a later cron tick) poll. POST is never retried after a timeout or
 * network error because the first call may already have created a run.
 */
export async function startScrapeRun(
  input: SieveStartRunInput,
  options: { complianceMode?: string } = {},
): Promise<SieveRunRecord> {
  assertConfigured();

  const accepted = await createScrape({
    ...input,
    compliance_mode: (input.compliance_mode ?? options.complianceMode ?? "regular") as SieveStartRunInput["compliance_mode"],
  });

  const now = new Date().toISOString();
  const record: SieveRunRecord = {
    sessionId: accepted.session_id,
    instruction: input.instruction,
    status: accepted.status ?? "queued",
    turns: 0,
    targetUrls: input.target_urls,
    createdAt: now,
    updatedAt: now,
  };
  // Persist BEFORE polling: a crash here resumes polling, never a duplicate run.
  await saveSieveRun(record);
  return record;
}

/** Resume polling a run from its persisted session_id. Never starts a new run. */
export async function resumeScrapeRun(
  sessionId: string,
  options: PollOptions = {},
): Promise<SieveRunRecord> {
  assertConfigured();
  const existing = await getSieveRun(sessionId);
  if (!existing) {
    throw new SieveError("NOT_FOUND", `No persisted Sieve run for session ${sessionId}.`, {
      status: 404,
    });
  }
  if (existing.status === "done" || existing.status === "refused") return existing;

  try {
    const run = await pollScrapeUntilSettled(sessionId, options);
    const updated = recordFromRun(existing, run);
    await updateSieveRun(sessionId, {
      status: updated.status,
      turns: updated.turns,
      summary: updated.summary,
      files: updated.files,
      schemaConformance: updated.schemaConformance,
      result: updated.result,
    });
    return updated;
  } catch (err) {
    if (err instanceof SieveError && err.code === "RUN_REFUSED") {
      const body = err.body as { refusal?: { code?: string } } | undefined;
      await updateSieveRun(sessionId, {
        status: "refused",
        refusalCode: body?.refusal?.code ?? "unknown",
      });
    }
    throw err;
  }
}

/**
 * Follow-up: record a turn, then poll until the run is done AND `turns` has
 * advanced past the persisted value. A 409 is retried (wait, then resend).
 */
export async function followUpScrapeRun(
  sessionId: string,
  input: SieveFollowUpInput,
  options: PollOptions & { conflictRetryDelayMs?: number } = {},
): Promise<SieveRunRecord> {
  assertConfigured();
  const existing = await getSieveRun(sessionId);
  if (!existing) {
    throw new SieveError("NOT_FOUND", `No persisted Sieve run for session ${sessionId}.`, {
      status: 404,
    });
  }

  const run = await followUpUntilAdvanced(
    sessionId,
    existing.turns,
    () => sendMessage(sessionId, input),
    options,
  );

  const updated = recordFromRun(existing, run);
  await updateSieveRun(sessionId, {
    status: updated.status,
    turns: updated.turns,
    summary: updated.summary,
    files: updated.files,
    schemaConformance: updated.schemaConformance,
    result: updated.result,
  });
  return updated;
}
