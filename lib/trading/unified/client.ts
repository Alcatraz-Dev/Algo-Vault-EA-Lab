"use client";

/**
 * Pro Terminal → Unified Trading API client.
 *
 * The ONLY execution path the Pro Terminal uses. Every call goes to
 * `POST /api/trading/execute` and therefore through UnifiedTradingService —
 * never to the legacy `/api/trading/orders` queue.
 *
 * Responsibilities (and nothing more):
 *   • mint a unique clientRequestId per logical order (idempotency key),
 *   • render the SERVER's execution states verbatim (no optimistic fills),
 *   • translate normalized error codes into user-facing messages,
 *   • map legacy field names (sl/tp/ticket) onto the unified contract.
 *
 * The server remains authoritative: a state is only ever shown because the
 * server reported it. This module contains no simulation and no `setTimeout`.
 */

import { randomBytes } from "./ids";
import type {
    TradingError,
    TradingExecutionPhase,
    TradingExecutionResult,
    TradingExecutionStatus,
    TradingExecutionType,
} from "./domain";

/** Minted client-side; the server treats it purely as an idempotency key. */
export function newClientRequestId(prefix = "pt"): string {
    return `${prefix}-${Date.now().toString(36)}-${randomBytes(6)}`;
}

export interface UnifiedExecutePayload {
    accountId: string;
    clientRequestId: string;
    executionType: TradingExecutionType;
    symbol?: string;
    side?: "BUY" | "SELL";
    volume?: number;
    percentage?: number;
    kind?: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
    price?: number | null;
    stopLoss?: number | null;
    takeProfit?: number | null;
    positionId?: string;
    orderId?: string;
    source?: string;
}

export interface UnifiedExecuteResponse {
    success: boolean;
    duplicate: boolean;
    result: TradingExecutionResult;
    error?: { code: string; message: string };
}

export class UnifiedExecutionError extends Error {
    readonly code: string;
    readonly status: number;
    readonly result: TradingExecutionResult | null;
    constructor(message: string, options: { code: string; status: number; result: TradingExecutionResult | null }) {
        super(message);
        this.name = "UnifiedExecutionError";
        this.code = options.code;
        this.status = options.status;
        this.result = options.result;
    }
}

/**
 * Submits one execution and returns the server's actual result.
 *
 * There is deliberately no polling and no optimistic success here: the HTTP
 * response already carries the server-side verification outcome (FILLED or
 * EXECUTED_PENDING_SYNC) because the service blocks on the gateway report.
 */
export async function executeUnified(
    payload: UnifiedExecutePayload,
    authToken: string
): Promise<TradingExecutionResult> {
    let response: Response;
    try {
        response = await fetch("/api/trading/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ ...payload, source: payload.source ?? "pro_terminal" }),
        });
    } catch {
        // Transport failure — the request may or may not have reached the
        // server, so the outcome is UNKNOWN (never a failure, never a fill).
        throw new UnifiedExecutionError(
            "Could not confirm the order reached the execution service — check MT5 before retrying.",
            { code: "NETWORK", status: 0, result: null }
        );
    }

    const body = (await response.json().catch(() => null)) as UnifiedExecuteResponse | null;

    if (!body) {
        throw new UnifiedExecutionError(`Execution service returned an unreadable response (${response.status}).`, {
            code: "UNREADABLE_RESPONSE",
            status: response.status,
            result: null,
        });
    }

    // A structured service rejection carries the full result envelope.
    if (body.result && body.result.error) {
        if (body.result.status === "REJECTED" || body.result.status === "FAILED" || body.result.status === "UNKNOWN") {
            throw new UnifiedExecutionError(
                userFacingMessageFor(body.result.error, body.result.error.message),
                { code: body.result.error.code, status: response.status, result: body.result }
            );
        }
        return body.result;
    }

    if (!response.ok || !body.success) {
        throw new UnifiedExecutionError(body.error?.message ?? `Execution failed (${response.status}).`, {
            code: body.error?.code ?? "UNKNOWN_PROVIDER_ERROR",
            status: response.status,
            result: body.result ?? null,
        });
    }

    return body.result;
}

/** Map a normalized TradingError onto the user-facing one-liner. */
export function userFacingMessageFor(error: Pick<TradingError, "code" | "message">, providerDetail?: string | null): string {
    return friendlyMessage(error.code, providerDetail ?? error.message);
}

const FRIENDLY: Record<string, string> = {
    ACCOUNT_NOT_CONNECTED: "Trading account is not connected. Reconnect the MT5 gateway first.",
    ACCOUNT_NOT_FOUND: "Trading account or position was not found on this account.",
    PROVIDER_UNAVAILABLE: "Trading provider is temporarily unavailable. Try again shortly.",
    PROVIDER_STALE: "MT5 Gateway is stale — execution is blocked until the terminal reconnects.",
    INVALID_SYMBOL: "Invalid symbol for this account.",
    INVALID_VOLUME: "Invalid volume for this symbol.",
    INSUFFICIENT_MARGIN: "Insufficient margin for this trade.",
    MARKET_CLOSED: "The market is closed for this symbol.",
    ORDER_REJECTED: "The broker rejected the order.",
    EXECUTION_TIMEOUT: "Execution timed out — the gateway did not confirm in time. Check the MT5 terminal before retrying.",
    DUPLICATE_REQUEST: "This order was already submitted. Wait for the original result.",
    PERMISSION_DENIED: "You do not have permission to trade on this account.",
    LIVE_EXECUTION_DISABLED: "Live execution is disabled. Only demo accounts can trade on AlgoVault.",
    RISK_REJECTED: "The risk engine rejected this request.",
    UNKNOWN_PROVIDER_ERROR: "The provider reported an unexpected error.",
    INVALID_REQUEST: "The order request is invalid.",
    UNSUPPORTED_OPERATION: "This action is not supported by the connected provider.",
    PROVIDER_NOT_CONFIGURED: "No trading provider is configured for this account.",
    TRADING_DISABLED: "Trading is disabled on this platform.",
    NETWORK: "Could not reach the execution service.",
    UNREADABLE_RESPONSE: "The execution service returned an unreadable response.",
};

/** Never exposes stack traces or internals; provider detail is appended only. */
/**
 * Error codes whose outcome is UNKNOWN rather than failed: the order may have
 * executed on the broker even though the client never received a confirmation.
 * A timeout is never a confirmed failure, and these must never be auto-retried.
 */
const UNKNOWN_OUTCOME_CODES: ReadonlySet<string> = new Set([
    "EXECUTION_TIMEOUT",
    "NETWORK",
    "UNREADABLE_RESPONSE",
]);

/** True when the execution may have happened but was not confirmed. */
export function isUnknownOutcome(error: unknown): boolean {
    return error instanceof UnifiedExecutionError && UNKNOWN_OUTCOME_CODES.has(error.code);
}

/**
 * Per-entry-point guard for submissions whose outcome is UNKNOWN.
 *
 * - A key with an unresolved outcome blocks any NEW submission for that key
 *   (duplicate-submission protection). Nothing is ever resent automatically.
 * - `retry` replays the stored payload with its ORIGINAL clientRequestId, so the
 *   server idempotency key deduplicates it. It is only reachable from an explicit
 *   user action.
 * - The lock is released only when the server returns a settled (non-UNKNOWN)
 *   outcome, or a definite error that is not an unknown outcome.
 */
export class ExecutionOutcomeTracker {
    private readonly unresolved = new Map<string, UnifiedExecutePayload>();
    private readonly inFlight = new Set<string>();

    isLocked(key: string): boolean {
        return this.unresolved.has(key) || this.inFlight.has(key);
    }

    /** True when the last submission for this key ended UNKNOWN and is not yet settled. */
    hasUnresolved(key: string): boolean {
        return this.unresolved.has(key);
    }

    /** Submit a new request. Blocked while the key has an unresolved or in-flight outcome. */
    async submit(
        key: string,
        payload: Omit<UnifiedExecutePayload, "clientRequestId">,
        authToken: string
    ): Promise<TradingExecutionResult> {
        if (this.isLocked(key)) {
            throw new UnifiedExecutionError(
                "A previous order for this action is still unconfirmed — confirm it on MT5 or retry it before sending another.",
                { code: "OUTCOME_UNRESOLVED", status: 0, result: null }
            );
        }
        const stored = { ...payload, clientRequestId: newClientRequestId("pt") };
        this.unresolved.set(key, stored);
        return this.send(key, stored, authToken);
    }

    /** Replay the unresolved request with its original clientRequestId (explicit user action only). */
    async retry(key: string, authToken: string): Promise<TradingExecutionResult> {
        const stored = this.unresolved.get(key);
        if (!stored) {
            throw new UnifiedExecutionError("Nothing to retry — no unconfirmed order for this action.", {
                code: "NOTHING_TO_RETRY",
                status: 0,
                result: null,
            });
        }
        if (this.inFlight.has(key)) {
            throw new UnifiedExecutionError("This order is already being confirmed.", {
                code: "OUTCOME_UNRESOLVED",
                status: 0,
                result: null,
            });
        }
        return this.send(key, stored, authToken);
    }

    private async send(
        key: string,
        payload: UnifiedExecutePayload,
        authToken: string
    ): Promise<TradingExecutionResult> {
        this.inFlight.add(key);
        try {
            const result = await executeUnified(payload, authToken);
            if (result.status !== "UNKNOWN") this.unresolved.delete(key);
            return result;
        } catch (error) {
            if (!isUnknownOutcome(error)) this.unresolved.delete(key);
            throw error;
        } finally {
            this.inFlight.delete(key);
        }
    }
}

export function friendlyMessage(code: string, detail?: string | null): string {
    const base = FRIENDLY[code] ?? "The order could not be executed.";
    const extra = detail && detail !== base && detail.length < 200 ? ` (${detail})` : "";
    return `${base}${extra}`;
}

/**
 * Client-side display phase for a submitted request.
 *
 * `SUBMITTING` is the only client-invented state (the request is on the wire);
 * everything afterwards is mapped from the server's terminal status. There is
 * no path that produces FILLED without the server saying so.
 */
export type ClientDisplayPhase = TradingExecutionPhase | "SUBMITTING" | "UNRESOLVED";

export function phaseFromStatus(status: TradingExecutionStatus | null | undefined): ClientDisplayPhase {
    switch (status) {
        case "SUCCEEDED":
            return "FILLED";
        case "EXECUTED_PENDING_SYNC":
            return "EXECUTED_PENDING_SYNC";
        case "REJECTED":
            return "REJECTED";
        case "FAILED":
            return "FAILED";
        case "UNKNOWN":
            return "UNRESOLVED";
        case "DUPLICATE":
            return "FILLED"; // a replayed terminal result — the original outcome
        case "ACCEPTED":
            return "SUBMITTED";
        default:
            return "SUBMITTING";
    }
}

export const PHASE_LABEL: Record<ClientDisplayPhase, string> = {
    VALIDATING: "Validating…",
    QUEUED: "Queued",
    SUBMITTED: "Submitted",
    SUBMITTING: "Submitting…",
    EXECUTING: "Executing…",
    FILLED: "Filled",
    PARTIALLY_FILLED: "Partially filled",
    REJECTED: "Rejected",
    FAILED: "Failed",
    EXECUTED_PENDING_SYNC: "Executed — syncing position",
    CANCELLED: "Cancelled",
    UNRESOLVED: "Outcome unknown — verify in MT5",
};

export const PHASE_TONE: Record<ClientDisplayPhase, "neutral" | "progress" | "good" | "bad" | "warn"> = {
    VALIDATING: "progress",
    QUEUED: "progress",
    SUBMITTED: "progress",
    SUBMITTING: "progress",
    EXECUTING: "progress",
    FILLED: "good",
    PARTIALLY_FILLED: "good",
    REJECTED: "bad",
    FAILED: "bad",
    EXECUTED_PENDING_SYNC: "warn",
    CANCELLED: "neutral",
    UNRESOLVED: "warn",
};
