/**
 * Unified Trading execution history — the READ model. (Server-only by
 * convention; never import this from a client component.)
 *
 * The Extension's Execution History and any future history surface read
 * through here instead of the legacy `/api/trading/orders` queue. The route
 * is deliberately the smallest read-only surface in the trading namespace:
 *
 *   Firebase auth  → userId resolved server-side from the verified token
 *   → Account ownership (the account must belong to the caller)
 *   → UnifiedTradingService.getHistory()   (canonical, provider-neutral)
 *   → tradingExecutionResults/{uid}        (immutable canonical results)
 *   → one merged entry per clientRequestId
 *
 * Two complementary truths are merged, never overwritten (§6b of
 * UNIFIED_TRADING.md — "one clientRequestId, two truths"):
 *
 *   • `state` — the RECONCILED provider-side view `getHistory()` derives from
 *     the command node. A late EA fill shows here as FILLED with the ticket,
 *     execution price and volume.
 *   • `result` — the original canonical execution result (immutable). A
 *     timeout stays FAILED/EXECUTION_TIMEOUT here even after the late fill.
 *
 * Guarantees: reads ONLY — this module never enqueues a command, never calls
 * `execute()`, never claims an idempotency key, never writes to RTDB, and
 * never exposes raw command-queue internals to a client. Entries
 * are deduplicated by `clientRequestId`, the strongest identity the domain
 * contract carries (never symbol + timestamp).
 */

import { NextRequest, NextResponse } from "next/server";
import type { TradingResult } from "./adapter";
import type {
    TradingExecutionResult,
    TradingExecutionStatus,
    TradingExecutionType,
    TradingHistory,
    TradingOrder,
    TradingOrderKind,
    TradingOrderState,
    TradingSide,
} from "./domain";
import { httpStatusForTradingError } from "./errors";

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── Application-level history response ──────────────────────────────────────

/**
 * One execution-history entry. Stable application vocabulary — the client
 * never sees RTDB paths, raw queue rows or provider payloads. Fields the
 * source model does not carry stay `null`; nothing is fabricated.
 */
export interface UnifiedHistoryEntry {
    /** The execution's idempotency key — the strongest history identity. */
    clientRequestId: string;
    accountId: string;
    symbol: string | null;
    side: TradingSide | null;
    /** Order kind (MARKET / LIMIT / STOP). */
    kind: TradingOrderKind | null;
    /** Execution verb (PLACE_ORDER / CLOSE_POSITION / …) when a canonical result exists. */
    executionType: TradingExecutionType | null;
    /** Reported/requested volume. */
    volume: number | null;
    /** Actual filled volume, when known. */
    filledVolume: number | null;
    /** Actual execution price when reported, else the requested price. */
    price: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    /** Provider ticket / reference (e.g. the MT5 ticket). */
    providerRef: string | null;
    /** Reconciled provider-side state — a late EA fill shows as FILLED here. */
    state: TradingOrderState;
    /** The immutable canonical execution result, when one exists. */
    result: TradingExecutionStatus | null;
    /** Rejection/failure reason from the canonical result; never on a fill. */
    errorMessage: string | null;
    createdAt: number | null;
    executedAt: number | null;
}

export interface UnifiedHistoryResponse {
    success: true;
    accountId: string;
    entries: UnifiedHistoryEntry[];
    /** True when the provider truncated the result (older history not read). */
    truncated: boolean;
}

// ─── Injectable dependencies (tests substitute fakes) ───────────────────────

/** Minimal RTDB surface this module reads through (admin SDK compatible). */
export interface HistoryDatabase {
    ref(path: string): {
        get(): Promise<{ exists(): boolean; val(): unknown }>;
    };
}

export interface HistoryIdentity {
    uid: string;
}

export interface UnifiedHistoryRequestDeps {
    database: HistoryDatabase;
    /** Verifies the Firebase ID token; `null` = unauthenticated. */
    authenticate(request: NextRequest): Promise<HistoryIdentity | null>;
    /** Canonical history read — in production `UnifiedTradingService.getHistory`. */
    getHistory(userId: string, accountId: string, since?: number): Promise<TradingResult<TradingHistory>>;
}

// ─── Server-authoritative reads ──────────────────────────────────────────────

/**
 * Account ownership. The history read itself is already scoped to the
 * caller's uid namespace, so an arbitrary accountId can never surface another
 * user's rows — this check additionally refuses an account the caller does
 * not own with a definitive 404 instead of an ambiguous empty list.
 */
export async function accountOwnedBy(
    database: HistoryDatabase,
    userId: string,
    accountId: string
): Promise<boolean> {
    const [gatewayAccount, projectedAccount] = await Promise.all([
        database.ref(`trading_accounts/${userId}/${accountId}`).get(),
        database.ref(`tradingUnifiedAccounts/${userId}/${accountId}`).get(),
    ]);
    return gatewayAccount.exists() || projectedAccount.exists();
}

/**
 * The user's canonical execution results — the service persists one
 * immutable record per clientRequestId, keyed by clientRequestId. Read-only;
 * the records themselves are never modified here.
 */
export async function listExecutionResults(
    database: HistoryDatabase,
    userId: string
): Promise<TradingExecutionResult[]> {
    const snap = await database.ref(`tradingExecutionResults/${userId}`).get();
    const data = snap.val();
    if (!data || typeof data !== "object") return [];
    return Object.values(data as Record<string, unknown>).filter(
        (record): record is TradingExecutionResult =>
            !!record && typeof record === "object"
    );
}

// ─── Merge: one entry per provider execution ─────────────────────────────────

/**
 * Composes the reconciled history (`getHistory()`) with the immutable
 * canonical results into ONE entry per clientRequestId:
 *
 *   state    ← history order (reconciled; late fills win visually)
 *   result   ← canonical execution result (never revised)
 *   price    ← filledPrice (canonical) ?? order price (execution ?? requested)
 *   providerRef ← canonical providerRef ?? reconciled ticket (late fill)
 *   errorMessage ← canonical error, suppressed on fills (a reconciled FILLED
 *                   row must not render the original timeout as a failure)
 *
 * A duplicate key can never produce a duplicate entry: the first occurrence
 * wins. Symbol + timestamp are never used as identity.
 */
export function buildUnifiedHistoryEntries(
    history: TradingHistory,
    results: TradingExecutionResult[]
): UnifiedHistoryEntry[] {
    const resultById = new Map<string, TradingExecutionResult>();
    for (const result of results) {
        if (result.clientRequestId) resultById.set(result.clientRequestId, result);
    }

    const seen = new Set<string>();
    const entries: UnifiedHistoryEntry[] = [];
    for (const order of history.orders) {
        if (!order.id || seen.has(order.id)) continue;
        seen.add(order.id);
        entries.push(toHistoryEntry(order, resultById.get(order.id)));
    }
    return entries;
}

function toHistoryEntry(
    order: TradingOrder,
    result: TradingExecutionResult | undefined
): UnifiedHistoryEntry {
    const executed =
        order.state === "FILLED" || order.state === "PARTIALLY_FILLED";
    return {
        clientRequestId: order.id,
        accountId: order.accountId,
        symbol: order.symbol || null,
        side: order.side,
        kind: order.kind,
        executionType: result?.executionType ?? null,
        volume: order.volume,
        filledVolume:
            result?.filledVolume ?? (executed ? order.volume : null),
        price: result?.filledPrice ?? order.price,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        providerRef: result?.providerRef ?? order.providerRef,
        state: order.state,
        result: result?.status ?? null,
        errorMessage: executed ? null : (result?.error?.message ?? null),
        createdAt: order.createdAt,
        executedAt: order.filledAt,
    };
}

// ─── Request handler ─────────────────────────────────────────────────────────

function respond(body: Record<string, unknown>, status: number): NextResponse {
    return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

/**
 * `GET /api/trading/history?accountId=…[&since=…]` — read-only.
 *
 * Never executes anything, never enqueues a command, never mutates execution
 * state, never trusts a client-supplied userId, and never crosses another
 * user's namespace: every read is prefixed with the verified token's uid.
 */
export async function handleUnifiedHistoryRequest(
    request: NextRequest,
    deps: UnifiedHistoryRequestDeps
): Promise<NextResponse> {
    const token = await deps.authenticate(request);
    if (!token) {
        return respond({ success: false, error: "Unauthorized." }, 401);
    }

    try {
        const url = new URL(request.url);
        const accountId = (url.searchParams.get("accountId") || "").trim();
        const sinceRaw = url.searchParams.get("since");

        if (!accountId) {
            return respond(
                { success: false, error: "accountId query parameter is required." },
                400
            );
        }
        // Structural RTDB key characters would make the ownership probe and
        // the provider's order read ambiguous — refuse instead of guessing.
        if (/[\/.#$[\]]/.test(accountId)) {
            return respond(
                { success: false, error: "accountId is not a valid account reference." },
                400
            );
        }

        let since: number | undefined;
        if (sinceRaw !== null && sinceRaw !== "") {
            since = Number(sinceRaw);
            if (!Number.isFinite(since) || since < 0) {
                return respond(
                    { success: false, error: "since must be a non-negative epoch-ms number." },
                    400
                );
            }
        }

        const owned = await accountOwnedBy(deps.database, token.uid, accountId);
        if (!owned) {
            return respond(
                { success: false, error: "Account not found or not owned by you." },
                404
            );
        }

        const history = await deps.getHistory(token.uid, accountId, since);
        if (!history.ok) {
            return respond(
                { success: false, error: history.error },
                httpStatusForTradingError(history.error)
            );
        }

        const results = (await listExecutionResults(deps.database, token.uid)).filter(
            (result) => result.accountId === accountId
        );
        const entries = buildUnifiedHistoryEntries(history.value, results);

        return respond(
            {
                success: true,
                accountId,
                entries,
                truncated: history.value.truncated,
            },
            200
        );
    } catch (error) {
        console.error("[trading/history GET]", error);
        return respond(
            { success: false, error: "Failed to load execution history." },
            500
        );
    }
}
