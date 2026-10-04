// Sieve scrape API — status interpretation + polling.
//
// Status handling is kept pure so the tests exercise the real decision logic:
//   running/queued → keep polling
//   done           → read summary/files/schema_conformance/result
//   refused        → terminal; the run never started (refusal.code says why)
//   anything else  → error (never silently treated as success)

import { SieveError } from "./errors";
import { getScrape } from "./client";
import type { SieveRun, SieveSchemaConformance } from "./types";

export type SieveRunPhase = "running" | "done" | "refused" | "unknown";

export function interpretRunStatus(status: unknown): SieveRunPhase {
  if (typeof status !== "string") return "unknown";
  switch (status.trim().toLowerCase()) {
    case "queued":
    case "running":
      return "running";
    case "done":
      return "done";
    case "refused":
      return "refused";
    default:
      return "unknown";
  }
}

/** Exponential backoff from `initialMs` up to `maxMs`. */
export function nextPollDelay(previousDelayMs: number, initialMs: number, maxMs: number): number {
  if (!Number.isFinite(previousDelayMs) || previousDelayMs <= 0) return initialMs;
  return Math.min(maxMs, Math.max(initialMs, Math.round(previousDelayMs * 1.5)));
}

/** A follow-up turn is only readable once `turns` has advanced past the prior value. */
export function hasTurnAdvanced(previousTurns: number, currentTurns: number | undefined): boolean {
  const current = typeof currentTurns === "number" ? currentTurns : 0;
  return current > (Number.isFinite(previousTurns) ? previousTurns : 0);
}

export interface SchemaConformanceVerdict {
  status: SieveSchemaConformance["status"] | "unknown";
  /** Safe to present as clean, validated data. */
  clean: boolean;
  /** Operator-facing note. Never says "clean" for a failed run. */
  note: string;
}

/** Never presents "fail" (or an unknown status) as clean data. */
export function describeSchemaConformance(
  conformance: SieveSchemaConformance | undefined,
): SchemaConformanceVerdict {
  const status = conformance?.status;
  switch (status) {
    case "pass":
      return { status, clean: true, note: "Output conforms to the requested schema." };
    case "partial":
      return {
        status,
        clean: false,
        note: "No schema violations, but declared columns are missing from the output.",
      };
    case "fail":
      return {
        status,
        clean: false,
        note: "Output is still non-conforming after repair — do NOT treat it as clean data.",
      };
    case "not_checkable":
      return { status, clean: false, note: "No output_schema was supplied; the result was not checked." };
    case "no_artifact":
      return { status, clean: false, note: "No artifact was produced to check." };
    default:
      return { status: "unknown", clean: false, note: "Schema conformance is unknown." };
  }
}

export interface PollOptions {
  /** Injected for tests; defaults to real timers. */
  sleep?: (ms: number) => Promise<void>;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Hard stop after this many polls (defensive; runs can take a while). */
  maxPolls?: number;
  /** Called after each poll (telemetry/hooks). Must not throw. */
  onPoll?: (run: SieveRun, delayMs: number) => void;
  getScrape?: (sessionId: string) => Promise<SieveRun>;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a run until it settles. Does not start or restart anything — safe to
 * call after a crash to resume polling from a persisted session_id.
 */
export async function pollScrapeUntilSettled(
  sessionId: string,
  options: PollOptions = {},
): Promise<SieveRun> {
  const sleep = options.sleep ?? realSleep;
  const initial = options.initialDelayMs ?? 5_000;
  const max = options.maxDelayMs ?? 30_000;
  const maxPolls = options.maxPolls ?? 0; // 0 = unbounded
  const fetchRun = options.getScrape ?? ((id: string) => getScrape(id));

  let delay = initial;
  let polls = 0;

  for (;;) {
    const run = await fetchRun(sessionId);
    polls += 1;
    const phase = interpretRunStatus(run.status);

    if (phase === "unknown") {
      throw new SieveError(
        "INVALID_STATUS",
        `Sieve returned an unrecognized run status: ${String(run.status)}`,
        { body: run },
      );
    }
    if (phase === "refused") {
      throw new SieveError(
        "RUN_REFUSED",
        `Sieve refused the run: ${run.refusal?.code ?? "unknown"}.`,
        { body: run },
      );
    }
    if (phase === "done") return run;

    options.onPoll?.(run, delay);
    if (maxPolls > 0 && polls >= maxPolls) {
      throw new SieveError("TIMEOUT", `Sieve run did not settle within ${maxPolls} polls.`);
    }
    await sleep(delay);
    delay = nextPollDelay(delay, initial, max);
  }
}

/**
 * Follow-up flow: record the turn, then poll until status is "done" AND `turns`
 * has advanced past `previousTurns`. A 409 means a turn is already in flight —
 * wait and resend.
 */
export async function followUpUntilAdvanced(
  sessionId: string,
  previousTurns: number,
  send: () => Promise<unknown>,
  options: PollOptions & { conflictRetryDelayMs?: number } = {},
): Promise<SieveRun> {
  const sleep = options.sleep ?? realSleep;
  const fetchRun = options.getScrape ?? ((id: string) => getScrape(id));

  for (;;) {
    try {
      await send();
      break;
    } catch (err) {
      if (err instanceof SieveError && err.code === "TURN_IN_FLIGHT") {
        await sleep(options.conflictRetryDelayMs ?? 5_000);
        continue;
      }
      throw err;
    }
  }

  const initial = options.initialDelayMs ?? 5_000;
  const max = options.maxDelayMs ?? 30_000;
  let delay = initial;

  for (;;) {
    const run = await fetchRun(sessionId);
    const phase = interpretRunStatus(run.status);
    if (phase === "unknown") {
      throw new SieveError(
        "INVALID_STATUS",
        `Sieve returned an unrecognized run status: ${String(run.status)}`,
        { body: run },
      );
    }
    // The turn is only readable once BOTH the run is done and turns advanced.
    if (phase === "done" && hasTurnAdvanced(previousTurns, run.turns)) return run;
    if (phase === "refused") {
      throw new SieveError("RUN_REFUSED", `Sieve refused the follow-up: ${run.refusal?.code ?? "unknown"}.`, {
        body: run,
      });
    }
    await sleep(delay);
    delay = nextPollDelay(delay, initial, max);
  }
}
