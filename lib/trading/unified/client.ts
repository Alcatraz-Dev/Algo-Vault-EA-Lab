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
        // Transport failure — the outcome is unknown, never a fill.
        throw new UnifiedExecutionError(
            "Could not reach the execution service — nothing was sent.",
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
        if (body.result.status === "REJECTED" || body.result.status === "FAILED") {
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
export type ClientDisplayPhase = TradingExecutionPhase | "SUBMITTING";

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
};
