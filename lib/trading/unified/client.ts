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

    // A queued command (HTTP 202, status ACCEPTED) is pending, not failed and not
    // settled. Return it as-is so the tracker keeps the lock until a terminal result.
    if (body.result && body.result.status === "ACCEPTED" && !body.result.error) {
        return body.result;
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

/**
 * Reads the stored outcome for one ORIGINAL clientRequestId. Read-only on the
 * server: it never redispatches. Returns null when no outcome is stored yet.
 * Transport failures and unreadable bodies throw, so the caller keeps the lock.
 */
export async function fetchExecutionStatus(
    clientRequestId: string,
    authToken: string
): Promise<TradingExecutionResult | null> {
    const response = await fetch(
        `/api/trading/execute/status?clientRequestId=${encodeURIComponent(clientRequestId)}`,
        {
            method: "GET",
            headers: { Authorization: `Bearer ${authToken}` },
            signal: AbortSignal.timeout(10_000),
        }
    );
    if (response.status === 404) return null;
    const body = (await response.json().catch(() => null)) as { result?: TradingExecutionResult } | null;
    if (!response.ok || !body?.result) {
        throw new UnifiedExecutionError(`Status check failed (${response.status}).`, {
            code: "UNREADABLE_RESPONSE",
            status: response.status,
            result: null,
        });
    }
    return body.result;
}

/**
 * The SHARED target lock key. CLOSE, PARTIAL_CLOSE, MODIFY and CANCEL on the same
 * position or order share one key, whatever their request IDs. Opens with no
 * target are keyed by symbol, side and execution type.
 */
export function targetKeyFor(
    payload: Pick<UnifiedExecutePayload, "executionType" | "positionId" | "orderId" | "symbol" | "side">
): string {
    if (payload.positionId) return `position:${payload.positionId}`;
    if (payload.orderId) return `order:${payload.orderId}`;
    return `open:${payload.executionType}:${payload.symbol ?? ""}:${payload.side ?? ""}`;
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
/** The request that owns a target lock, with the payload it must replay unchanged. */
interface TargetOwner {
    clientRequestId: string;
    payload: UnifiedExecutePayload;
    authToken: string;
    inFlight: boolean;
}

export class ExecutionOutcomeTracker {
    /** Shared target lock: one owner request per target key. */
    private readonly owners = new Map<string, TargetOwner>();
    /** Per-request tracking: clientRequestId -> target key it locks. */
    private readonly requests = new Map<string, string>();
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly polling = new Set<string>();
    private readonly attempts = new Map<string, number>();
    private readonly onChange: (() => void) | undefined;
    private readonly autoPoll: boolean;
    private disposed = false;
    private readonly onVisible = () => {
        if (typeof document === "undefined" || document.visibilityState !== "visible") return;
        for (const key of this.owners.keys()) void this.reconcile(key);
    };

    constructor(options: { onChange?: () => void; autoPoll?: boolean } = {}) {
        this.onChange = options.onChange;
        this.autoPoll = options.autoPoll ?? typeof window !== "undefined";
        if (this.autoPoll && typeof document !== "undefined") {
            document.addEventListener("visibilitychange", this.onVisible);
        }
    }

    /** Cancels all polling. Call on unmount. Unresolved locks are NOT persisted. */
    dispose(): void {
        this.disposed = true;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        if (typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", this.onVisible);
        }
    }

    isLocked(key: string): boolean {
        return this.owners.has(key);
    }

    /** True while the target's owner outcome is unresolved (queued, unknown, or in flight). */
    hasUnresolved(key: string): boolean {
        return this.owners.has(key);
    }

    /** The request ID that currently owns the target lock, if any. */
    ownerOf(key: string): string | null {
        return this.owners.get(key)?.clientRequestId ?? null;
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
        this.owners.set(key, { clientRequestId: stored.clientRequestId, payload: stored, authToken, inFlight: true });
        this.requests.set(stored.clientRequestId, key);
        return this.send(key, stored.clientRequestId);
    }

    /** Replay the unresolved request with its original clientRequestId (explicit user action only). */
    async retry(key: string, authToken: string): Promise<TradingExecutionResult> {
        const owner = this.owners.get(key);
        if (!owner) {
            throw new UnifiedExecutionError("Nothing to retry — no unconfirmed order for this action.", {
                code: "NOTHING_TO_RETRY",
                status: 0,
                result: null,
            });
        }
        if (owner.inFlight) {
            throw new UnifiedExecutionError("This order is already being confirmed.", {
                code: "OUTCOME_UNRESOLVED",
                status: 0,
                result: null,
            });
        }
        owner.authToken = authToken;
        return this.send(key, owner.clientRequestId);
    }

    /**
     * Single entry point for UI actions on a target. No owner: submit fresh. An
     * owner with an IDENTICAL action: replay its original request (same
     * clientRequestId and payload). A DIFFERENT action on the same target is
     * blocked, never sent and never substituted for the owner's request.
     */
    async run(
        key: string,
        payload: Omit<UnifiedExecutePayload, "clientRequestId">,
        authToken: string
    ): Promise<TradingExecutionResult> {
        const owner = this.owners.get(key);
        if (!owner) return this.submit(key, payload, authToken);
        const ownerAction: Record<string, unknown> = { ...owner.payload };
        delete ownerAction.clientRequestId;
        if (JSON.stringify(ownerAction) === JSON.stringify(payload)) {
            return this.retry(key, authToken);
        }
        throw new UnifiedExecutionError(
            "Another action on this position is still unconfirmed — confirm it before sending a different one.",
            { code: "OUTCOME_UNRESOLVED", status: 0, result: null }
        );
    }

    /**
     * Reconciles the owner of `key` by reading its stored outcome. It NEVER
     * redispatches: it queries the status endpoint with the original
     * clientRequestId. The lock is released only on a settled status. Errors,
     * unreadable responses and still-pending statuses keep it. Overlapping calls
     * for the same key are coalesced.
     */
    async reconcile(key: string): Promise<"SETTLED" | "PENDING" | "NONE"> {
        const owner = this.owners.get(key);
        if (!owner) return "NONE";
        if (this.polling.has(key)) return "PENDING";
        const requestId = owner.clientRequestId;
        this.polling.add(key);
        try {
            const status = await fetchExecutionStatus(requestId, owner.authToken);
            // The owner may have changed while the request was in flight.
            if (this.owners.get(key)?.clientRequestId !== requestId) return "NONE";
            if (status && status.status !== "ACCEPTED" && status.status !== "UNKNOWN") {
                this.release(key, requestId);
                this.notify();
                return "SETTLED";
            }
            this.schedule(key);
            return "PENDING";
        } catch {
            // Network error or unreadable response: the outcome is still unknown.
            if (this.owners.get(key)?.clientRequestId === requestId) this.schedule(key);
            return "PENDING";
        } finally {
            this.polling.delete(key);
        }
    }

    /**
     * Manual "Check status" for a held target. Reads the owner's stored outcome by its
     * ORIGINAL clientRequestId. Never redispatches. Returns "NONE" when nothing is held.
     */
    checkStatus(key: string): Promise<"SETTLED" | "PENDING" | "NONE"> {
        return this.reconcile(key);
    }

    /** Schedules the next status read with capped backoff (2s to 30s). Browser-only by default. */
    private schedule(key: string): void {
        if (!this.autoPoll || this.disposed) return;
        const previous = this.timers.get(key);
        if (previous) clearTimeout(previous);
        const attempt = (this.attempts.get(key) ?? 0) + 1;
        this.attempts.set(key, attempt);
        const delay = Math.min(30_000, 2_000 * 2 ** Math.min(attempt - 1, 4));
        const timer = setTimeout(() => {
            this.timers.delete(key);
            // Hidden tabs do not poll; the visibility listener resumes immediately.
            if (typeof document !== "undefined" && document.visibilityState === "hidden") {
                this.schedule(key);
                return;
            }
            void this.reconcile(key);
        }, delay);
        this.timers.set(key, timer);
    }

    /** Releases the target only when `requestId` still owns it. Other owners are untouched. */
    private release(key: string, requestId: string): void {
        this.requests.delete(requestId);
        if (this.owners.get(key)?.clientRequestId !== requestId) return;
        this.owners.delete(key);
        this.attempts.delete(key);
        const timer = this.timers.get(key);
        if (timer) clearTimeout(timer);
        this.timers.delete(key);
    }

    private notify(): void {
        this.onChange?.();
    }

    /**
     * Sends the owner's ORIGINAL payload under its ORIGINAL clientRequestId. The
     * owner is never replaced by this call. Only a settled result or a definite
     * error releases the lock. Unresolved results start reconciliation.
     */
    private async send(key: string, clientRequestId: string): Promise<TradingExecutionResult> {
        const owner = this.owners.get(key);
        if (!owner || owner.clientRequestId !== clientRequestId) {
            throw new UnifiedExecutionError("No unconfirmed order owns this action.", {
                code: "NOTHING_TO_RETRY",
                status: 0,
                result: null,
            });
        }
        owner.inFlight = true;
        try {
            const result = await executeUnified(owner.payload, owner.authToken);
            if (result.status === "UNKNOWN" || result.status === "ACCEPTED") {
                owner.inFlight = false;
                this.schedule(key);
            } else {
                this.release(key, clientRequestId);
            }
            this.notify();
            return result;
        } catch (error) {
            // Unknown outcomes and DUPLICATE_REQUEST (original still pending) keep the lock.
            const pending = error instanceof UnifiedExecutionError && error.code === "DUPLICATE_REQUEST";
            if (isUnknownOutcome(error) || pending) {
                owner.inFlight = false;
                this.schedule(key);
            } else {
                this.release(key, clientRequestId);
            }
            this.notify();
            throw error;
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
