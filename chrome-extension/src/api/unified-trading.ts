/**
 * AlgoVault Unified Trading API — Extension client.
 *
 * This is the ONLY execution surface the Chrome Extension uses:
 *
 *   TradingView / Extension UI
 *     → this client
 *     → POST /api/trading/execute
 *     → UnifiedTradingService
 *     → Provider adapter (MT5 demo gateway)
 *
 * It is also the ONLY history surface: Execution History reads through
 * `getUnifiedTradingHistory` → `GET /api/trading/history` →
 * `UnifiedTradingService.getHistory()`. The legacy gateway order queue is
 * never read by this Extension.
 *
 * The Extension deliberately knows nothing about the provider:
 *   • no provider name is ever sent (the server resolves it from the account
 *     id namespace),
 *   • no environment / live-demo flag is ever sent (the server enforces
 *     DEMO-only and rejects a hostile `environment: "LIVE"`),
 *   • no MT5 ticket is ever used as an execution command (positions/orders are
 *     addressed by their unified `positionId` / `orderId`),
 *   • no authoritative execution price or lot rounding is computed here — the
 *     server decides, the Extension renders the server's result verbatim,
 *   • no `userId` is ever sent (identity comes from the verified auth token).
 *
 * IDEMPOTENCY (Phase 4): every request carries a `clientRequestId`, which is
 * the existing Unified Trading idempotency key (8–128 chars). A retry of the
 * SAME logical user action MUST resend the SAME id — never a new one — so the
 * server's idempotency claim protects the user from a double trade.
 *
 * No response is ever invented: a status is only shown because the server
 * reported it. There is no `setTimeout(... success)` anywhere in this module.
 */
import { getAlgoVaultUrl } from "@/config/environment";
import { getAuthToken } from "@/storage/storage";
import { EXECUTION_UNCONFIRMED_MESSAGE } from "@/types/execution";

/** Origin marker the server records in its audit trail. */
export const EXTENSION_EXECUTION_SOURCE = "chrome_extension";

/* ── contract types (mirror of lib/trading/unified/domain.ts) ───────── */

export type UnifiedExecutionType =
  | "PLACE_ORDER"
  | "MODIFY_POSITION"
  | "CLOSE_POSITION"
  | "PARTIAL_CLOSE"
  | "CANCEL_ORDER";

export type UnifiedOrderKind = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";

export type UnifiedExecutionStatus =
  | "ACCEPTED"
  | "SUCCEEDED"
  | "REJECTED"
  | "DUPLICATE"
  | "FAILED"
  | "EXECUTED_PENDING_SYNC";

export interface UnifiedTradingErrorBody {
  code: string;
  message: string;
}

/** Exactly the fields the Unified Trading contract accepts from a client. */
export interface UnifiedExecutionPayload {
  accountId: string;
  clientRequestId: string;
  executionType: UnifiedExecutionType;
  symbol?: string;
  side?: "BUY" | "SELL";
  volume?: number;
  /** 0–100, percentage of the CURRENT POSITION VOLUME for a partial close. */
  percentage?: number;
  kind?: UnifiedOrderKind;
  price?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  positionId?: string;
  orderId?: string;
}

export interface UnifiedExecutionResult {
  clientRequestId: string;
  correlationId: string;
  accountId: string;
  provider: string;
  environment: string;
  executionType: UnifiedExecutionType;
  status: UnifiedExecutionStatus;
  /** Provider reference (e.g. the MT5 ticket) once execution is confirmed. */
  providerRef: string | null;
  filledVolume: number | null;
  filledPrice: number | null;
  order: unknown | null;
  position: unknown | null;
  error: UnifiedTradingErrorBody | null;
  duplicate: boolean;
  createdAt: number;
  completedAt: number | null;
}

interface UnifiedExecuteResponse {
  success: boolean;
  duplicate?: boolean;
  result?: UnifiedExecutionResult | null;
  error?: string | UnifiedTradingErrorBody | null;
}

/**
 * The server answered, so the request reached AlgoVault and the outcome is a
 * decision. Transport failures use status 0 and are reported as uncertain.
 */
export class UnifiedTradingError extends Error {
  readonly code: string;
  readonly status: number;
  readonly result: UnifiedExecutionResult | null;
  constructor(
    message: string,
    options: { code: string; status: number; result?: UnifiedExecutionResult | null }
  ) {
    super(message);
    this.name = "UnifiedTradingError";
    this.code = options.code;
    this.status = options.status;
    this.result = options.result ?? null;
  }
}

/* ── idempotency key ────────────────────────────────────────────────── */

/**
 * Mints a Unified-Trading-compatible client request id (8–128 chars).
 *
 * It is created ONCE per logical user action and reused on every retry of that
 * action. Never call this again for a retry.
 */
export function newClientRequestId(prefix = "ext"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/* ── request builders (pure: no provider, no environment, no userId) ── */

export function placeOrderRequest(params: {
  accountId: string;
  clientRequestId: string;
  symbol: string;
  side: "BUY" | "SELL";
  volume: number;
  kind?: UnifiedOrderKind;
  price?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): UnifiedExecutionPayload {
  const kind = params.kind ?? "MARKET";
  const isPending = kind === "LIMIT" || kind === "STOP" || kind === "STOP_LIMIT";
  return {
    accountId: params.accountId,
    clientRequestId: params.clientRequestId,
    executionType: "PLACE_ORDER",
    symbol: params.symbol.trim().toUpperCase(),
    side: params.side,
    volume: params.volume,
    kind,
    price: isPending ? params.price ?? null : null,
    stopLoss: params.stopLoss ?? null,
    takeProfit: params.takeProfit ?? null,
  };
}

export function modifyPositionRequest(params: {
  accountId: string;
  clientRequestId: string;
  positionId: string;
  symbol?: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): UnifiedExecutionPayload {
  return {
    accountId: params.accountId,
    clientRequestId: params.clientRequestId,
    executionType: "MODIFY_POSITION",
    positionId: params.positionId,
    symbol: params.symbol,
    stopLoss: params.stopLoss ?? null,
    takeProfit: params.takeProfit ?? null,
  };
}

/** Full close of a position. */
export function closePositionRequest(params: {
  accountId: string;
  clientRequestId: string;
  positionId: string;
  symbol?: string;
}): UnifiedExecutionPayload {
  return {
    accountId: params.accountId,
    clientRequestId: params.clientRequestId,
    executionType: "CLOSE_POSITION",
    positionId: params.positionId,
    symbol: params.symbol,
  };
}

/**
 * Partial close. The percentage is the percentage of the CURRENT POSITION
 * VOLUME — the Extension never converts it to lots or rounds it: the server's
 * volume planner owns lot-step rounding, dust closing and full-close promotion.
 */
export function partialClosePositionRequest(params: {
  accountId: string;
  clientRequestId: string;
  positionId: string;
  percentage: number;
  symbol?: string;
}): UnifiedExecutionPayload {
  return {
    accountId: params.accountId,
    clientRequestId: params.clientRequestId,
    executionType: "PARTIAL_CLOSE",
    positionId: params.positionId,
    percentage: params.percentage,
    symbol: params.symbol,
  };
}

export function cancelOrderRequest(params: {
  accountId: string;
  clientRequestId: string;
  orderId: string;
  symbol?: string;
}): UnifiedExecutionPayload {
  return {
    accountId: params.accountId,
    clientRequestId: params.clientRequestId,
    executionType: "CANCEL_ORDER",
    orderId: params.orderId,
    symbol: params.symbol,
  };
}

/* ── transport ──────────────────────────────────────────────────────── */

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * The route answers with either a plain string (401/400 wrappers) or a
 * `{ code, message }` envelope. `code` is null when the server sent no code,
 * so the caller can supply the correct default for the HTTP status.
 */
function normalizeServerError(
  error: UnifiedExecuteResponse["error"]
): { code: string | null; message: string } | null {
  if (!error) return null;
  if (typeof error === "string") return { code: null, message: error };
  if (typeof error === "object" && typeof error.message === "string") {
    return { code: String(error.code || "UNKNOWN_PROVIDER_ERROR"), message: error.message };
  }
  return null;
}

/**
 * Submits one execution to the Unified Trading API and returns the server's
 * actual result envelope.
 *
 * Throws `UnifiedTradingError` when the server rejected the request or the
 * call never produced a verdict (transport failure → status 0, uncertain).
 */
export async function executeUnifiedTrading(
  payload: UnifiedExecutionPayload
): Promise<UnifiedExecutionResult> {
  const base = await getAlgoVaultUrl();

  let response: Response;
  try {
    response = await fetch(`${base}/api/trading/execute`, {
      method: "POST",
      headers: await authHeaders(),
      // `source` is the only extra field; the server ignores anything else.
      body: JSON.stringify({ ...payload, source: EXTENSION_EXECUTION_SOURCE }),
    });
  } catch (err) {
    // The request may or may not have reached the server. The outcome is
    // unknown; the caller must retry the SAME clientRequestId.
    throw new UnifiedTradingError(
      err instanceof Error ? err.message : "network_error",
      { code: "NETWORK", status: 0, result: null }
    );
  }

  const body = (await response.json().catch(() => null)) as UnifiedExecuteResponse | null;

  if (!body || typeof body !== "object") {
    throw new UnifiedTradingError(`Execution service returned an unreadable response (${response.status}).`, {
      code: "UNREADABLE_RESPONSE",
      status: response.status,
      result: null,
    });
  }

  const result = body.result ?? null;

  // A structured service rejection carries the full result envelope.
  if (result && result.error && (result.status === "REJECTED" || result.status === "FAILED")) {
    throw new UnifiedTradingError(result.error.message, {
      code: result.error.code,
      status: response.status,
      result,
    });
  }

  // Authentication / authorization refusals never reached the provider.
  if (response.status === 401 || response.status === 403) {
    const serverError = normalizeServerError(body.error);
    throw new UnifiedTradingError(serverError?.message ?? "Authentication is required.", {
      code: serverError?.code ?? "PERMISSION_DENIED",
      status: response.status,
      result,
    });
  }

  if (!response.ok || !body.success || !result) {
    const serverError = normalizeServerError(body.error);
    throw new UnifiedTradingError(
      serverError?.message ?? `Execution failed (${response.status}).`,
      {
        code: serverError?.code ?? "UNKNOWN_PROVIDER_ERROR",
        status: response.status,
        result,
      }
    );
  }

  return result;
}

/* ── execution history (read-only) ────────────────────────────────── */

/**
 * One execution-history entry, exactly as `GET /api/trading/history`
 * returns it (mirror of `lib/trading/unified/history.ts`).
 *
 * Two truths are preserved side by side and never merged:
 *   • `state`   — the reconciled provider-side view (a late EA fill is
 *     FILLED here, with ticket, execution price and volume),
 *   • `result`  — the immutable canonical execution result (a timeout stays
 *     FAILED even after the late fill).
 * Fields the source model does not carry are `null` — never invented.
 */
export interface UnifiedHistoryEntry {
  /** The execution's idempotency key — the strongest history identity. */
  clientRequestId: string;
  accountId: string;
  symbol: string | null;
  side: "BUY" | "SELL" | null;
  kind: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" | null;
  executionType: UnifiedExecutionType | null;
  volume: number | null;
  filledVolume: number | null;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  providerRef: string | null;
  state: string;
  result: UnifiedExecutionStatus | null;
  errorMessage: string | null;
  createdAt: number | null;
  executedAt: number | null;
}

interface UnifiedHistoryResponse {
  success: boolean;
  accountId: string;
  entries?: UnifiedHistoryEntry[];
  truncated?: boolean;
  error?: string | UnifiedTradingErrorBody | null;
}

/**
 * Reads the authenticated user's execution history for ONE account from the
 * Unified Trading history API (read-only; the server resolves identity from
 * the token and enforces account ownership).
 *
 * Throws `UnifiedTradingError` on auth refusal, transport failure or an
 * unreadable response — an unavailable history is never rendered as an empty
 * history by this client.
 */
export async function getUnifiedTradingHistory(options: {
  accountId: string;
  since?: number;
}): Promise<UnifiedHistoryEntry[]> {
  const base = await getAlgoVaultUrl();
  const params = new URLSearchParams({ accountId: options.accountId });
  if (options.since !== undefined) params.set("since", String(options.since));

  let response: Response;
  try {
    response = await fetch(`${base}/api/trading/history?${params.toString()}`, {
      method: "GET",
      headers: await authHeaders(),
    });
  } catch (err) {
    throw new UnifiedTradingError(
      err instanceof Error ? err.message : "network_error",
      { code: "NETWORK", status: 0, result: null }
    );
  }

  const body = (await response.json().catch(() => null)) as UnifiedHistoryResponse | null;
  if (!body || typeof body !== "object") {
    throw new UnifiedTradingError(`History service returned an unreadable response (${response.status}).`, {
      code: "UNREADABLE_RESPONSE",
      status: response.status,
      result: null,
    });
  }

  if (!response.ok || !body.success) {
    const serverError = normalizeServerError(body.error);
    throw new UnifiedTradingError(
      serverError?.message ?? `History request failed (${response.status}).`,
      {
        code:
          serverError?.code ??
          (response.status === 401 || response.status === 403
            ? "PERMISSION_DENIED"
            : "UNKNOWN_PROVIDER_ERROR"),
        status: response.status,
        result: null,
      }
    );
  }

  return Array.isArray(body.entries) ? body.entries : [];
}

/* ── outcome normalization (Phase 10 UX vocabulary) ─────────────────── */

export type UnifiedOutcomeStatus = UnifiedExecutionStatus | "UNKNOWN";

export interface UnifiedExecutionOutcome {
  status: UnifiedOutcomeStatus;
  /** True only for a provider-confirmed outcome (SUCCEEDED / PENDING_SYNC). */
  ok: boolean;
  duplicate: boolean;
  /** The provider confirmed execution but the synced position is not visible yet. */
  pendingSync: boolean;
  /** The outcome could not be determined — resend the SAME clientRequestId. */
  uncertain: boolean;
  /** User-facing message derived from the server's own words. */
  message: string;
  result: UnifiedExecutionResult | null;
}

/**
 * Codes that mean "the outcome is genuinely unknown" rather than a refusal:
 * the request passed every server gate and the provider failed to confirm.
 */
const UNCERTAIN_CODES = new Set(["EXECUTION_TIMEOUT"]);
const PENDING_SYNC_MESSAGE = "Order executed — syncing position";
const IN_FLIGHT_MESSAGE = "Order accepted — waiting for broker confirmation";
const IN_FLIGHT_CODES = new Set(["DUPLICATE_REQUEST"]);

/** The message a user sees for a server result envelope. */
export function userMessageForUnifiedResult(result: UnifiedExecutionResult): string {
  switch (result.status) {
    case "SUCCEEDED":
      return "Order executed";
    case "EXECUTED_PENDING_SYNC":
      return PENDING_SYNC_MESSAGE;
    case "ACCEPTED":
      return IN_FLIGHT_MESSAGE;
    case "REJECTED":
    case "FAILED":
      return result.error?.message || "The order could not be executed.";
    case "DUPLICATE":
      return result.error?.message || "This order was already submitted.";
    default:
      return EXECUTION_UNCONFIRMED_MESSAGE;
  }
}

/** The message a user sees for a transport/service failure. */
export function userMessageForUnifiedError(error: UnifiedTradingError): string {
  switch (error.code) {
    case "NETWORK":
    case "UNREADABLE_RESPONSE":
      return EXECUTION_UNCONFIRMED_MESSAGE;
    case "EXECUTION_TIMEOUT":
      return `${EXECUTION_UNCONFIRMED_MESSAGE} (${error.message})`;
    case "DUPLICATE_REQUEST":
      return IN_FLIGHT_MESSAGE;
    default:
      return error.message || "The order could not be executed.";
  }
}

function outcomeFromResult(
  status: UnifiedOutcomeStatus,
  result: UnifiedExecutionResult | null,
  message?: string
): UnifiedExecutionOutcome {
  return {
    status,
    ok: status === "SUCCEEDED" || status === "EXECUTED_PENDING_SYNC",
    duplicate: result?.duplicate ?? false,
    pendingSync: status === "EXECUTED_PENDING_SYNC",
    uncertain: status === "UNKNOWN",
    message:
      message ?? (result ? userMessageForUnifiedResult(result) : EXECUTION_UNCONFIRMED_MESSAGE),
    result,
  };
}

function outcomeFromError(error: unknown): UnifiedExecutionOutcome {
  if (error instanceof UnifiedTradingError) {
    const result = error.result;

    // A 409 duplicate means "do not retry blindly": either the identical
    // request is still in flight, or the key was reused with a different
    // payload. Both resolve to the in-flight vocabulary; the server's raw
    // reason stays available in `result.error.message`. This must be checked
    // BEFORE the terminal verdict below, because the server envelopes the
    // duplicate as a REJECTED result.
    if (error.status === 409 && IN_FLIGHT_CODES.has(error.code)) {
      return outcomeFromResult("ACCEPTED", result, IN_FLIGHT_MESSAGE);
    }

    // An execution timeout is NOT a failure: the provider never confirmed, so
    // the trade may exist. It must be rendered as unknown, never as FAILED,
    // even though the server envelopes it that way.
    if (UNCERTAIN_CODES.has(error.code)) {
      return outcomeFromResult("UNKNOWN", result, userMessageForUnifiedError(error));
    }

    // The server settled a terminal verdict — render it verbatim.
    if (result && (result.status === "FAILED" || result.status === "REJECTED")) {
      return outcomeFromResult(result.status, result);
    }

    // No verdict: nothing to claim, and a blind retry must reuse the key.
    if (error.status === 0 || error.status >= 500) {
      return outcomeFromResult("UNKNOWN", result, userMessageForUnifiedError(error));
    }

    // A definitive server refusal (auth, license, license/risk/validation).
    return outcomeFromResult("REJECTED", result, userMessageForUnifiedError(error));
  }
  return outcomeFromResult("UNKNOWN", null, EXECUTION_UNCONFIRMED_MESSAGE);
}

/** Injectable so tests never touch the network. */
export type UnifiedExecutionTransport = (
  payload: UnifiedExecutionPayload
) => Promise<UnifiedExecutionResult>;

/**
 * Runs one execution and normalizes BOTH success and failure into a single
 * outcome. It never throws, and it never reports a fill the server did not
 * report.
 */
export async function runUnifiedExecution(
  payload: UnifiedExecutionPayload,
  transport: UnifiedExecutionTransport = executeUnifiedTrading
): Promise<UnifiedExecutionOutcome> {
  try {
    const result = await transport(payload);
    return outcomeFromResult(result.status, result);
  } catch (error) {
    return outcomeFromError(error);
  }
}
