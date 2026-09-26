import { adminDatabase } from "@/lib/firebase-admin";
import { ServerValue } from "firebase-admin/database";
import type { ERPNextEvent } from "./events";

export interface SyncStateRecord {
  syncId: string;
  sourceSystem: string;
  sourceId: string;
  targetSystem: string;
  targetId?: string;
  entityType: string;
  status: "pending" | "processing" | "synced" | "failed";
  attemptCount: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  correlationId?: string;
  idempotencyKey: string;
  createdAt: string;
}

export async function recordSyncState(record: SyncStateRecord): Promise<void> {
  await adminDatabase.ref(`erpnextSync/${record.syncId}`).set({
    syncId: record.syncId,
    sourceSystem: record.sourceSystem,
    sourceId: record.sourceId,
    targetSystem: record.targetSystem,
    targetId: record.targetId ?? null,
    entityType: record.entityType,
    status: record.status,
    attemptCount: record.attemptCount,
    lastAttemptAt: record.lastAttemptAt ?? null,
    lastSuccessAt: record.lastSuccessAt ?? null,
    lastError: record.lastError ?? null,
    correlationId: record.correlationId ?? null,
    idempotencyKey: record.idempotencyKey,
    createdAt: record.createdAt,
  });
}

export async function getSyncState(syncId: string): Promise<SyncStateRecord | null> {
  const snap = await adminDatabase.ref(`erpnextSync/${syncId}`).get();
  if (!snap.exists()) return null;
  return snap.val() as SyncStateRecord;
}

export async function updateSyncStatus(syncId: string, status: SyncStateRecord["status"], error?: string): Promise<void> {
  await adminDatabase.ref(`erpnextSync/${syncId}/status`).set(status);
  await adminDatabase.ref(`erpnextSync/${syncId}/attemptCount`).set(ServerValue.increment(1));
  if (error) await adminDatabase.ref(`erpnextSync/${syncId}/lastError`).set(error);
  await adminDatabase.ref(`erpnextSync/${syncId}/lastAttemptAt`).set(new Date().toISOString());
  if (status === "synced") await adminDatabase.ref(`erpnextSync/${syncId}/lastSuccessAt`).set(new Date().toISOString());
}
