import type { ERPNextEvent } from "./events";

export interface SyncStatus {
  eventId: string;
  status: "pending" | "retrying" | "synced" | "failed";
  attempts: number;
  lastAttemptAt?: string;
  completedAt?: string;
  errorCode?: string;
}

export interface SyncState {
  enabled: boolean;
  pendingEvents: number;
  failedEvents: number;
  lastSyncAt?: string;
  events: SyncStatus[];
}

// In-memory persistence for sync state per process.
// Production should use Firebase RTDB / Firestore or a persistent queue.
const syncStates = new Map<string, SyncState>();

export function getSyncKey(tenant?: string): string {
  return tenant ?? "default";
}

export function getSyncState(tenant?: string): SyncState {
  const key = getSyncKey(tenant);
  if (!syncStates.has(key)) {
    syncStates.set(key, {
      enabled: false,
      pendingEvents: 0,
      failedEvents: 0,
      events: [],
    });
  }
  return syncStates.get(key)!;
}

export function recordEvent(event: ERPNextEvent, tenant?: string): void {
  const state = getSyncState(tenant);
  state.events.push({
    eventId: event.eventId,
    status: event.status,
    attempts: event.attempts,
    lastAttemptAt: event.lastAttemptAt,
    completedAt: event.completedAt,
    errorCode: event.errorCode,
  });
  state.pendingEvents = state.events.filter((e) => e.status === "pending" || e.status === "retrying").length;
  state.failedEvents = state.events.filter((e) => e.status === "failed").length;
}

export function updateEventStatus(
  eventId: string,
  status: SyncStatus["status"],
  attempts?: number,
  errorCode?: string,
  tenant?: string
): void {
  const state = getSyncState(tenant);
  const evt = state.events.find((e) => e.eventId === eventId);
  if (evt) {
    evt.status = status;
    if (attempts !== undefined) evt.attempts = attempts;
    if (errorCode !== undefined) evt.errorCode = errorCode;
    if (status === "synced") evt.completedAt = new Date().toISOString();
    evt.lastAttemptAt = new Date().toISOString();
  }
  state.pendingEvents = state.events.filter((e) => e.status === "pending" || e.status === "retrying").length;
  state.failedEvents = state.events.filter((e) => e.status === "failed").length;
  state.lastSyncAt = new Date().toISOString();
}
