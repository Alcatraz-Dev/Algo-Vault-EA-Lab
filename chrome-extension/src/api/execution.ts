/**
 * TradingView Execution Bridge — authenticated API surface.
 *
 * Order submission and order/position management live in
 * `@/api/unified-trading` (`POST /api/trading/execute` → UnifiedTradingService,
 * which enforces the license gate, the risk engine, DEMO-only execution and
 * idempotency server-side). Execution History reads through
 * `getUnifiedTradingHistory` (`GET /api/trading/history`) in
 * `@/api/unified-trading` as well. This module keeps the supporting
 * surfaces: the capability/account probe, the audit trail and the journal
 * sync.
 *
 * Every route here is authenticated with the caller's Firebase ID token; the
 * client-side Pro check below is defense in depth only — it is never the sole
 * gate.
 *
 * SECURITY: this module only ever sends safe order metadata. No passwords,
 * API keys, cookies, tokens (other than the caller's own Firebase auth
 * header) or broker credentials are read, stored or transmitted.
 */
import { getAlgoVaultUrl } from "@/config/environment";
import { getAuthToken } from "@/storage/storage";
import { getProAccess } from "@/api/pro";
import type {
  ExecutionAuditRecord,
  JournalSyncPayload,
} from "@/types/execution";

/* ── shared fetcher ─────────────────────────────────────────────────── */

/**
 * HTTP failure with its status attached. The Execution Bridge needs the
 * status to tell a DEFINITIVE refusal (4xx — the order was never accepted)
 * from an UNCERTAIN outcome (5xx / network — must never be auto-retried).
 */
export class ApiHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const base = await getAlgoVaultUrl();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network-level failure: submission outcome is unknown to the caller.
    throw new ApiHttpError(err instanceof Error ? err.message : "network_error", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiHttpError(data?.error || `API error ${res.status}`, res.status);
  return data;
}

async function getJson<T>(path: string): Promise<T> {
  const base = await getAlgoVaultUrl();
  const res = await fetch(`${base}${path}`, {
    method: "GET",
    headers: await authHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiHttpError(data?.error || `API error ${res.status}`, res.status);
  return data;
}

/* ── Pro entitlement (client-side defense in depth) ─────────────────── */

export class ExecutionEntitlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionEntitlementError";
  }
}

/**
 * Client-side entitlement probe for privileged execution calls. The server
 * independently enforces licensing on every privileged route, so a failure
 * here can never grant access — it only fails closed earlier.
 */
export async function assertExecutionEntitlement(): Promise<void> {
  const access = await getProAccess();
  if (access.access !== "granted") {
    throw new ExecutionEntitlementError(
      "TradingView Execution requires an active AlgoVault Pro entitlement."
    );
  }
}

/* ── capability & account status (server-reported MCP truth) ────────── */

export interface TvAccountStatusResponse {
  success: boolean;
  /** Real OAuth connection record of the installed TradingView MCP. */
  connection: { state: string; authorized: boolean; message?: string };
  /** Live tool discovery — only genuinely listed tools report supported. */
  capabilities: Array<{ id: string; label: string; supported: boolean; read: boolean }>;
  execution: {
    tradingViewMcpExecutionSupported: false;
    gatewayExecutionSupported: boolean;
    reason: string;
  };
  accountState: string;
  timestamp: number;
}

export function fetchTvAccountStatus(): Promise<TvAccountStatusResponse> {
  return getJson<TvAccountStatusResponse>("/api/extension/tv-account");
}

/* ── execution audit log (safe metadata only) ───────────────────────── */

export interface AuditResponse {
  success: boolean;
  auditId: string;
}

export function postExecutionAudit(record: ExecutionAuditRecord): Promise<AuditResponse> {
  // Strip anything that is not plain safe metadata before it leaves the
  // extension — credentials must never reach the audit trail.
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (/password|secret|token|cookie|credential|api[-_]?key|private/i.test(key)) continue;
    if (value === undefined) continue;
    safe[key] = value;
  }
  return postJson<AuditResponse>("/api/extension/execution-audit", safe);
}

/* ── journal sync (RTDB — no Firestore) ─────────────────────────────── */

export interface JournalSyncResponse {
  success: boolean;
  entryId: string;
  message?: string;
}

export function postJournalSync(payload: JournalSyncPayload): Promise<JournalSyncResponse> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/password|secret|token|cookie|credential|api[-_]?key|private/i.test(key)) continue;
    if (value === undefined) continue;
    safe[key] = value;
  }
  return postJson<JournalSyncResponse>("/api/extension/journal-sync", safe);
}

/* ── lifecycle helpers ──────────────────────────────────────────────── */

const TERMINAL_STATUSES = new Set([
  "filled",
  "partially_filled",
  "rejected",
  "failed",
  "cancelled",
  "canceled",
  "timeout",
]);

export function isTerminalOrderStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(String(status || "").toLowerCase());
}
