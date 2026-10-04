// Sieve scrape API — durable run persistence (Firebase RTDB).
//
// Reuses the repo's RTDB convention (see lib/integrations/erpnext/sync-state.ts
// and lib/marketing-agent/storage.ts) — no second database or queue. The
// session_id is written the moment POST /api/scrapes returns it, so a crash
// resumes polling instead of starting a duplicate (credit-spending) run.

import { adminDatabase } from "@/lib/firebase-admin";
import type { SieveFile, SieveSchemaConformance } from "./types";

const RUNS_PATH = "sieveRuns";

export interface SieveRunRecord {
  sessionId: string;
  instruction: string;
  status: string;
  turns: number;
  targetUrls?: string[];
  summary?: string;
  files?: SieveFile[];
  schemaConformance?: SieveSchemaConformance;
  result?: unknown;
  refusalCode?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export async function saveSieveRun(record: SieveRunRecord): Promise<void> {
  await adminDatabase.ref(`${RUNS_PATH}/${record.sessionId}`).set({
    sessionId: record.sessionId,
    instruction: record.instruction,
    status: record.status,
    turns: record.turns,
    targetUrls: record.targetUrls ?? null,
    summary: record.summary ?? null,
    files: record.files ?? null,
    schemaConformance: record.schemaConformance ?? null,
    result: record.result ?? null,
    refusalCode: record.refusalCode ?? null,
    errorCode: record.errorCode ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export async function getSieveRun(sessionId: string): Promise<SieveRunRecord | null> {
  const snap = await adminDatabase.ref(`${RUNS_PATH}/${sessionId}`).get();
  if (!snap.exists()) return null;
  return snap.val() as SieveRunRecord;
}

export async function updateSieveRun(
  sessionId: string,
  patch: Partial<Omit<SieveRunRecord, "sessionId" | "createdAt">>,
): Promise<void> {
  // RTDB rejects `undefined` values, and callers legitimately omit fields
  // (e.g. `result` when a run has none). Drop them rather than throwing.
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) clean[key] = value;
  }
  await adminDatabase.ref(`${RUNS_PATH}/${sessionId}`).update({
    ...clean,
    updatedAt: new Date().toISOString(),
  });
}

/** Unsettled runs, so a cron/worker can resume polling without restarting. */
export async function listActiveSieveRuns(): Promise<SieveRunRecord[]> {
  const snap = await adminDatabase.ref(RUNS_PATH).get();
  if (!snap.exists()) return [];
  const value = snap.val() as Record<string, SieveRunRecord>;
  return Object.values(value).filter(
    (run) => run.status !== "done" && run.status !== "refused",
  );
}
