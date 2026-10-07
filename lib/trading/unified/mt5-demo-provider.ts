/**
 * MT5 DEMO provider adapter.
 *
 * Transport: the EXISTING `MQL5/AlgoVaultTradeGateway` EA protocol. No second
 * protocol is introduced.
 *
 *   Provider ──reads──▶  trading_accounts/{uid}/gateway_{login}   (register + heartbeat)
 *                  ──▶  trading_positions/{uid}/{accountId}      (snapshot)
 *                  ──▶  trading_orders/{uid}/{accountId}         (snapshot)
 *   Provider ──writes─▶  trading_order_requests/{uid}/{clientRequestId}  (command queue)
 *                  ──▶  trading_unified_accounts projection        (account + audit)
 *
 * The EA polls `/api/trading/gateway/commands` (and the commands array on
 * `/api/trading/gateway/heartbeat`), executes the order, and reports the
 * outcome to `/api/trading/gateway/execution`. This adapter therefore treats
 * execution as ASYNCHRONOUS: it queues the command, waits for the report
 * within a bounded timeout, and then VERIFIES the resulting ticket against
 * `trading_positions` / `trading_orders` before reporting success.
 *
 * Capabilities this adapter does NOT implement are reported as
 * `UNSUPPORTED_OPERATION`, never faked: MT5 symbol specs, MT5 quotes, MT5
 * candles and MT5 deal history are not part of the gateway snapshot today.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { brokerLimitsFromAccount } from "@/lib/risk/risk-engine";
import type {
    TradingAccount,
    TradingCandle,
    TradingConnection,
    TradingDeal,
    TradingEnvironment,
    TradingExecutionResult,
    TradingHistory,
    TradingOrder,
    TradingOrderKind,
    TradingOrderState,
    TradingPosition,
    TradingProvider,
    TradingQuote,
    TradingSymbol,
} from "./domain";
import { mapMt5Retcode, tradingError } from "./errors";
import type { AdapterExecutionInput, TradingProviderAdapter, TradingResult } from "./adapter";

export const MT5_PROVIDER: TradingProvider = "MT5";

/** MT5 gateway account ids are minted as `gateway_{login}`. */
export const MT5_ACCOUNT_PREFIX = "gateway_";

export function isMt5AccountId(accountId: string): boolean {
    return accountId.startsWith(MT5_ACCOUNT_PREFIX);
}

const num = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const str = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text === "" ? null : text;
};

/**
 * Demo/live classification.
 *
 * Deliberately asymmetric and identical in spirit to `deriveAccountMode`
 * (lib/terminal/account.ts): an account is only DEMO when the record itself
 * says so. Everything else classifies as LIVE, which the unified service
 * refuses to execute against.
 */
export function classifyMt5Environment(record: Record<string, unknown>): TradingEnvironment {
    const explicit = str(record.environment)?.toUpperCase();
    if (explicit === "DEMO" || explicit === "LIVE") return explicit;
    if (record.demo === true) return "DEMO";
    if (record.demo === false) return "LIVE";
    const haystack = [record.server, record.broker, record.company, record.type]
        .map((value) => String(value ?? ""))
        .join(" ");
    return /\b(demo|trial|practice|simulation|cent-?demo)\b/i.test(haystack) ? "DEMO" : "LIVE";
}

function sideOf(value: unknown): "BUY" | "SELL" {
    return String(value ?? "").toUpperCase() === "SELL" ? "SELL" : "BUY";
}

/** Gateway order type string → neutral order kind + side. */
function decodeOrderType(value: unknown): { kind: TradingOrderKind; side: "BUY" | "SELL" } | null {
    const type = String(value ?? "").toUpperCase();
    switch (type) {
        case "BUY_LIMIT":
            return { kind: "LIMIT", side: "BUY" };
        case "SELL_LIMIT":
            return { kind: "LIMIT", side: "SELL" };
        case "BUY_STOP":
            return { kind: "STOP", side: "BUY" };
        case "SELL_STOP":
            return { kind: "STOP", side: "SELL" };
        case "BUY_STOP_LIMIT":
            return { kind: "STOP_LIMIT", side: "BUY" };
        case "SELL_STOP_LIMIT":
            return { kind: "STOP_LIMIT", side: "SELL" };
        default:
            return null;
    }
}

/** Gateway execution status (written by /api/trading/gateway/execution). */
function decodeExecutionState(value: unknown): TradingOrderState {
    const status = String(value ?? "").toLowerCase();
    if (status === "filled") return "FILLED";
    if (status === "partially_filled") return "PARTIALLY_FILLED";
    if (status === "rejected" || status === "failed") return "REJECTED";
    if (status === "queued" || status === "executing") return "SUBMITTED";
    if (status === "cancelled") return "CANCELLED";
    return "UNKNOWN";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface Mt5DemoProviderConfig {
    /** Heartbeat age after which the connection is considered stale (default 90s). */
    heartbeatStaleMs: number;
    /** Heartbeat age after which the connection is DEGRADED (default 45s). */
    heartbeatDegradedMs: number;
    /** Max time to wait for the EA execution report (default 20s). */
    executionTimeoutMs: number;
    pollIntervalMs: number;
    /**
     * Extra window (on top of executionTimeoutMs) granted to the RTDB snapshot
     * sync after a provider-confirmed fill. The EA reports the fill immediately;
     * its NEXT snapshot (30s cadence) is what makes the ticket appear in
     * `trading_positions`. Default 12s keeps total worst-case latency bounded
     * while absorbing the normal report→snapshot gap.
     */
    verificationTimeoutMs: number;
    clock: () => number;
}

export function mt5DemoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Mt5DemoProviderConfig {
    const int = (name: string, fallback: number) => {
        const parsed = Number(env[name]);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    return {
        heartbeatStaleMs: int("UNIFIED_TRADING_HEARTBEAT_STALE_MS", 90_000),
        heartbeatDegradedMs: int("UNIFIED_TRADING_HEARTBEAT_DEGRADED_MS", 45_000),
        executionTimeoutMs: int("UNIFIED_TRADING_EXECUTION_TIMEOUT_MS", 20_000),
        pollIntervalMs: int("UNIFIED_TRADING_EXECUTION_POLL_MS", 750),
        verificationTimeoutMs: int("UNIFIED_TRADING_VERIFICATION_TIMEOUT_MS", 12_000),
        clock: () => Date.now(),
    };
}

export class Mt5DemoProvider implements TradingProviderAdapter {
    readonly provider: TradingProvider = MT5_PROVIDER;

    readonly descriptor = {
        provider: MT5_PROVIDER,
        environments: ["DEMO"] as TradingEnvironment[],
        available: true,
        operational: true,
        label: "MetaTrader 5 (Demo)",
        note: "Executes through the AlgoVaultTradeGateway EA command queue. Demo accounts only.",
    };

    constructor(private readonly config: Mt5DemoProviderConfig = mt5DemoConfigFromEnv()) {}

    matchesAccountId(accountId: string): boolean {
        return isMt5AccountId(accountId);
    }

    private async rawAccount(userId: string, accountId: string): Promise<Record<string, unknown> | null> {
        const snap = await adminDatabase.ref(`trading_accounts/${userId}/${accountId}`).get();
        if (!snap.exists()) return null;
        const value = snap.val();
        return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
    }

    private connectionState(lastHeartbeatAt: number | null): {
        state: TradingConnection["state"];
        status: TradingAccount["providerStatus"];
    } {
        if (!lastHeartbeatAt || lastHeartbeatAt <= 0) return { state: "DISCONNECTED", status: "OFFLINE" };
        const age = this.config.clock() - lastHeartbeatAt;
        if (age > this.config.heartbeatStaleMs) return { state: "STALE", status: "STALE" };
        if (age > this.config.heartbeatDegradedMs) return { state: "DEGRADED", status: "ONLINE" };
        return { state: "CONNECTED", status: "ONLINE" };
    }

    private projectAccount(userId: string, accountId: string, record: Record<string, unknown>): TradingAccount {
        const lastHeartbeatAt = num(record.lastHeartbeatAt);
        const connection = this.connectionState(lastHeartbeatAt);
        const environment = classifyMt5Environment(record);
        const balance = num(record.balance);
        const equity = num(record.equity);
        const margin = num(record.margin);
        const freeMargin = num(record.freeMargin);

        return {
            id: accountId,
            userId,
            provider: MT5_PROVIDER,
            environment,
            externalAccountId: str(record.mt5Account),
            brokerName: str(record.broker) ?? str(record.company),
            serverName: str(record.server),
            currency: str(record.currency),
            leverage: num(record.leverage),
            connection: connection.state,
            providerStatus: connection.status,
            metrics: {
                balance,
                equity,
                margin,
                freeMargin,
                marginLevel: num(record.marginLevel),
                floatingPnl: equity !== null && balance !== null ? Number((equity - balance).toFixed(2)) : null,
                positionsCount: num(record.positionsCount),
                ordersCount: num(record.pendingOrdersCount),
                currency: str(record.currency),
                updatedAt: lastHeartbeatAt,
            },
            connectedAt: num(record.connectedAt),
            lastHeartbeatAt,
            lastSyncAt: lastHeartbeatAt,
            connectionError: connection.state === "CONNECTED" || connection.state === "DEGRADED"
                ? null
                : connection.state === "STALE"
                  ? tradingError("PROVIDER_STALE", "The MetaTrader 5 gateway heartbeat is stale.")
                  : connection.status === "OFFLINE"
                    ? tradingError("ACCOUNT_NOT_CONNECTED", "The MetaTrader 5 gateway is not connected.")
                    : null,
            gatewayVersion: str(record.gatewayVersion),
        };
    }

    // ── reads ────────────────────────────────────────────────────────────────

    async healthCheck(): Promise<TradingResult<{ status: TradingAccount["providerStatus"]; checkedAt: number }>> {
        return { ok: true, value: { status: "ONLINE", checkedAt: this.config.clock() } };
    }

    async getConnectionStatus(userId: string, accountId: string): Promise<TradingResult<TradingConnection>> {
        const record = await this.rawAccount(userId, accountId);
        if (!record) {
            return { ok: false, error: tradingError("ACCOUNT_NOT_FOUND", "Account is not registered for this user.") };
        }
        const account = this.projectAccount(userId, accountId, record);
        return {
            ok: true,
            value: {
                accountId,
                userId,
                provider: MT5_PROVIDER,
                environment: account.environment,
                state: account.connection,
                providerStatus: account.providerStatus,
                lastHeartbeatAt: account.lastHeartbeatAt,
                lastSyncAt: account.lastSyncAt,
                brokerName: account.brokerName,
                serverName: account.serverName,
                externalAccountId: account.externalAccountId,
                error: account.connectionError,
            },
        };
    }

    async getAccount(userId: string, accountId: string): Promise<TradingResult<TradingAccount>> {
        const record = await this.rawAccount(userId, accountId);
        if (!record) {
            return { ok: false, error: tradingError("ACCOUNT_NOT_FOUND", "Account is not registered for this user.") };
        }
        return { ok: true, value: this.projectAccount(userId, accountId, record) };
    }

    async getPositions(userId: string, accountId: string): Promise<TradingResult<TradingPosition[]>> {
        const snap = await adminDatabase.ref(`trading_positions/${userId}/${accountId}`).get();
        const data = snap.val();
        if (!data || typeof data !== "object") return { ok: true, value: [] };
        const positions: TradingPosition[] = [];
        for (const [key, raw] of Object.entries(data as Record<string, unknown>)) {
            if (!raw || typeof raw !== "object") continue;
            const p = raw as Record<string, unknown>;
            const ticket = str(p.ticket) ?? key;
            positions.push({
                id: ticket,
                accountId,
                provider: MT5_PROVIDER,
                symbol: str(p.symbol) ?? "",
                side: sideOf(p.type),
                volume: num(p.volume) ?? 0,
                entryPrice: num(p.openPrice) ?? 0,
                currentPrice: num(p.currentPrice),
                stopLoss: num(p.sl),
                takeProfit: num(p.tp),
                profit: num(p.profit),
                swap: num(p.swap),
                commission: null,
                openedAt: num(p.openedAt),
                magicNumber: num(p.magic),
                comment: str(p.comment),
                providerRef: ticket,
            });
        }
        return { ok: true, value: positions };
    }

    async getOrders(userId: string, accountId: string): Promise<TradingResult<TradingOrder[]>> {
        const snap = await adminDatabase.ref(`trading_orders/${userId}/${accountId}`).get();
        const data = snap.val();
        if (!data || typeof data !== "object") return { ok: true, value: [] };
        const orders: TradingOrder[] = [];
        for (const [key, raw] of Object.entries(data as Record<string, unknown>)) {
            if (!raw || typeof raw !== "object") continue;
            const o = raw as Record<string, unknown>;
            const ticket = str(o.ticket) ?? key;
            const decoded = decodeOrderType(o.type);
            if (!decoded) continue;
            orders.push({
                id: ticket,
                accountId,
                provider: MT5_PROVIDER,
                symbol: str(o.symbol) ?? "",
                kind: decoded.kind,
                side: decoded.side,
                volume: num(o.volume) ?? 0,
                price: num(o.price),
                stopLoss: num(o.sl),
                takeProfit: num(o.tp),
                state: (str(o.status) === "cancelled" ? "CANCELLED" : "PENDING") as TradingOrderState,
                createdAt: num(o.createdAt) ?? num(o.updatedAt),
                filledAt: null,
                magicNumber: num(o.magic),
                comment: str(o.comment),
                providerRef: ticket,
            });
        }
        return { ok: true, value: orders };
    }

    /**
     * NOT IMPLEMENTED for MT5: the gateway snapshot does not report deals.
     * Reported honestly so no surface can render an empty-but-successful
     * history as "no deals on this account".
     */
    async getDeals(_userId: string, _accountId: string): Promise<TradingResult<TradingDeal[]>> {
        return {
            ok: false,
            error: tradingError(
                "UNSUPPORTED_OPERATION",
                "MT5 deal history is not reported by the AlgoVaultTradeGateway yet."
            ),
        };
    }

    /** Verified execution history from the gateway execution reports. */
    async getHistory(userId: string, accountId: string, since = 0): Promise<TradingResult<TradingHistory>> {
        const orders = await this.getOrders(userId, accountId);
        if (!orders.ok) return orders;

        const requestsSnap = await adminDatabase.ref(`trading_order_requests/${userId}`).get();
        const raw = requestsSnap.val();
        const requests = raw && typeof raw === "object" ? (raw as Record<string, Record<string, unknown>>) : {};
        const executed: TradingOrder[] = [];

        for (const [id, request] of Object.entries(requests)) {
            if (!request || typeof request !== "object") continue;
            if (str(request.accountId) !== accountId) continue;
            const state = decodeExecutionState(request.status);
            if (state === "UNKNOWN" || state === "SUBMITTED") continue;
            const executedAt = num(request.executedAt) ?? num(request.createdAt) ?? 0;
            if (executedAt < since) continue;
            const kind = str(request.action)?.toUpperCase() ?? "";
            executed.push({
                id,
                accountId,
                provider: MT5_PROVIDER,
                symbol: str(request.symbol) ?? "",
                kind: kind.includes("LIMIT") ? "LIMIT" : kind.includes("STOP") ? "STOP" : "MARKET",
                side: sideOf(kind),
                volume: num(request.volume) ?? 0,
                price: num(request.executionPrice) ?? num(request.price),
                stopLoss: num(request.sl),
                takeProfit: num(request.tp),
                state,
                createdAt: num(request.createdAt),
                filledAt: state === "FILLED" ? executedAt : null,
                magicNumber: null,
                comment: null,
                providerRef: str(request.mt5Ticket),
            });
        }
        executed.sort((a, b) => (b.filledAt ?? b.createdAt ?? 0) - (a.filledAt ?? a.createdAt ?? 0));

        return { ok: true, value: { deals: [], orders: executed, truncated: false } };
    }

    async getSymbols(_userId: string, _accountId: string): Promise<TradingResult<TradingSymbol[]>> {
        return {
            ok: false,
            error: tradingError(
                "UNSUPPORTED_OPERATION",
                "MT5 symbol specifications are not reported by the AlgoVaultTradeGateway yet."
            ),
        };
    }

    async getQuote(_userId: string, _accountId: string, _symbol: string): Promise<TradingResult<TradingQuote>> {
        return {
            ok: false,
            error: tradingError(
                "UNSUPPORTED_OPERATION",
                "MT5 tick data is not reported by the AlgoVaultTradeGateway yet."
            ),
        };
    }

    async getQuotes(userId: string, accountId: string, symbols: string[]): Promise<TradingResult<TradingQuote[]>> {
        const first = await this.getQuote(userId, accountId, symbols[0] ?? "");
        if (!first.ok) return first;
        return { ok: true, value: [] };
    }

    async getCandles(
        _userId: string,
        _accountId: string,
        _symbol: string,
        _timeframe: string
    ): Promise<TradingResult<TradingCandle[]>> {
        return {
            ok: false,
            error: tradingError(
                "UNSUPPORTED_OPERATION",
                "MT5 candles are not reported by the AlgoVaultTradeGateway yet."
            ),
        };
    }

    // ── execution ────────────────────────────────────────────────────────────

    async execute(input: AdapterExecutionInput): Promise<TradingResult<TradingExecutionResult>> {
        const { request } = input;
        const now = this.config.clock();
        const envelope = {
            clientRequestId: request.clientRequestId,
            correlationId: request.correlationId,
            accountId: request.accountId,
            provider: MT5_PROVIDER,
            environment: request.environment,
            executionType: request.executionType,
            duplicate: false,
            createdAt: now,
        };
        const finish = (
            partial: Omit<Partial<TradingExecutionResult>, "status"> &
                Pick<TradingExecutionResult, "status">
        ): TradingResult<TradingExecutionResult> => ({
            ok: true,
            value: {
                clientRequestId: envelope.clientRequestId,
                correlationId: envelope.correlationId,
                accountId: envelope.accountId,
                provider: envelope.provider,
                environment: envelope.environment,
                executionType: envelope.executionType,
                duplicate: false,
                createdAt: envelope.createdAt,
                providerRef: null,
                filledVolume: null,
                filledPrice: null,
                order: null,
                position: null,
                error: null,
                ...partial,
                completedAt: this.config.clock(),
            },
        });

        const account = await this.rawAccount(request.userId, request.accountId);
        if (!account) {
            return finish({
                status: "REJECTED",
                error: tradingError("ACCOUNT_NOT_FOUND", "Account is not registered for this user."),
            });
        }
        const connection = this.connectionState(num(account.lastHeartbeatAt));
        if (connection.state === "STALE") {
            return finish({
                status: "REJECTED",
                error: tradingError(
                    "PROVIDER_STALE",
                    "The MetaTrader 5 gateway heartbeat is stale; execution is blocked."
                ),
            });
        }
        if (connection.state === "DISCONNECTED") {
            return finish({
                status: "REJECTED",
                error: tradingError("ACCOUNT_NOT_CONNECTED", "The MetaVault gateway is offline."),
            });
        }

        const command = this.buildCommand(request, input);
        if (!command) {
            return finish({
                status: "REJECTED",
                error: tradingError("UNSUPPORTED_OPERATION", "This MT5 command is not supported."),
            });
        }

        // Enqueue on the EXISTING gateway command queue. The EA picks queued
        // commands up on its next poll.
        await adminDatabase
            .ref(`trading_order_requests/${request.userId}/${request.clientRequestId}`)
            .set({ ...command, clientRequestId: request.clientRequestId, correlationId: request.correlationId, status: "queued", createdAt: now, updatedAt: now });

        const report = await this.awaitExecutionReport(request.userId, request.clientRequestId);
        if (!report) {
            return finish({
                status: "FAILED",
                error: tradingError(
                    "EXECUTION_TIMEOUT",
                    "The MetaTrader 5 gateway did not confirm the execution in time."
                ),
            });
        }

        const state = decodeExecutionState(report.status);
        if (state === "REJECTED") {
            const retcode = num(report.errorCode) ?? num(report.retcode) ?? 0;
            return finish({
                status: "REJECTED",
                providerRef: str(report.mt5Ticket),
                error: tradingError(
                    retcode > 0 ? mapMt5Retcode(retcode) : "ORDER_REJECTED",
                    str(report.errorMessage) ?? "The MetaTrader 5 gateway rejected the command.",
                    { providerRetcode: retcode > 0 ? retcode : null }
                ),
            });
        }

        // Provider confirmed the fill — now verify against SYNCED state.
        // The snapshot may not have arrived yet (the EA reports fills
        // immediately but positions sync on its snapshot cadence), so this
        // POLLS the synced state instead of checking it exactly once.
        const verified = await this.verifyInSyncedState(
            request.userId,
            request.accountId,
            str(report.mt5Ticket),
            state
        );

        if (verified.ok) {
            return finish({
                status: "SUCCEEDED",
                providerRef: str(report.mt5Ticket),
                filledVolume: num(report.volume) ?? input.volume ?? null,
                filledPrice: num(report.executionPrice),
                order: verified.order,
                position: verified.position,
            });
        }

        // The provider (the EA itself) confirmed the trade executed, but the
        // synced snapshot has not caught up within the verification window.
        // This is NOT a failure: returning FAILED here is exactly the race
        // that used to turn real MT5 trades into fake 502s. The dedicated
        // EXECUTED_PENDING_SYNC status tells the terminal the trade is real
        // and the position mirror will appear on the next snapshot.
        return finish({
            status: "EXECUTED_PENDING_SYNC",
            providerRef: str(report.mt5Ticket),
            filledVolume: num(report.volume) ?? input.volume ?? null,
            filledPrice: num(report.executionPrice),
            error: tradingError(
                "EXECUTION_TIMEOUT",
                "Executed on the broker but the account snapshot has not synced yet. The position will appear shortly."
            ),
        });
    }

    /** Maps the neutral execution onto the gateway EA's existing command schema. */
    private buildCommand(
        request: AdapterExecutionInput["request"],
        input: AdapterExecutionInput
    ): Record<string, unknown> | null {
        const accountId = request.accountId;
        switch (request.executionType) {
            case "PLACE_ORDER": {
                const side = request.side;
                const kind = request.kind ?? "MARKET";
                if (!side || !request.symbol) return null;
                const action =
                    kind === "MARKET"
                        ? side === "BUY"
                            ? "BUY"
                            : "SELL"
                        : kind === "LIMIT"
                          ? side === "BUY"
                              ? "BUY_LIMIT"
                              : "SELL_LIMIT"
                          : side === "BUY"
                            ? "BUY_STOP"
                            : "SELL_STOP";
                return {
                    userId: request.userId,
                    accountId,
                    symbol: request.symbol,
                    action,
                    volume: input.volume ?? request.volume ?? null,
                    price: kind === "MARKET" ? 0 : request.price ?? null,
                    sl: request.stopLoss ?? null,
                    tp: request.takeProfit ?? null,
                    source: "unified",
                    correlationId: request.correlationId,
                };
            }
            case "MODIFY_POSITION": {
                const ticket = input.position?.providerRef ?? input.position?.id;
                if (!ticket) return null;
                return {
                    userId: request.userId,
                    accountId,
                    action: "MODIFY",
                    ticket: Number(ticket) || ticket,
                    sl: request.stopLoss ?? 0,
                    tp: request.takeProfit ?? 0,
                    source: "unified",
                    correlationId: request.correlationId,
                };
            }
            case "CLOSE_POSITION": {
                const ticket = input.position?.providerRef ?? input.position?.id;
                if (!ticket) return null;
                return {
                    userId: request.userId,
                    accountId,
                    action: "CLOSE",
                    ticket: Number(ticket) || ticket,
                    volume: 0,
                    source: "unified",
                    correlationId: request.correlationId,
                };
            }
            case "PARTIAL_CLOSE": {
                const ticket = input.position?.providerRef ?? input.position?.id;
                if (!ticket || !input.volume) return null;
                return {
                    userId: request.userId,
                    accountId,
                    action: "PARTIAL_CLOSE",
                    ticket: Number(ticket) || ticket,
                    // Volume, never a P/L amount: the EA closes this many lots.
                    volume: input.volume,
                    source: "unified",
                    correlationId: request.correlationId,
                };
            }
            case "CANCEL_ORDER": {
                const ticket = input.order?.providerRef ?? input.order?.id;
                if (!ticket) return null;
                return {
                    userId: request.userId,
                    accountId,
                    action: "CANCEL",
                    ticket: Number(ticket) || ticket,
                    source: "unified",
                    correlationId: request.correlationId,
                };
            }
            default:
                return null;
        }
    }

    /** Waits for /api/trading/gateway/execution to write the report. */
    private async awaitExecutionReport(
        userId: string,
        clientRequestId: string
    ): Promise<Record<string, unknown> | null> {
        const ref = adminDatabase.ref(`trading_order_requests/${userId}/${clientRequestId}`);
        const deadline = this.config.clock() + this.config.executionTimeoutMs;
        while (this.config.clock() < deadline) {
            const snap = await ref.get();
            const value = snap.val();
            if (value && typeof value === "object") {
                const record = value as Record<string, unknown>;
                const state = decodeExecutionState(record.status);
                if (state === "FILLED" || state === "PARTIALLY_FILLED" || state === "REJECTED" || state === "CANCELLED") {
                    return record;
                }
            }
            await sleep(this.config.pollIntervalMs);
        }
        return null;
    }

    /**
     * Confirms the reported ticket exists in the provider's SYNCED state,
     * polling until the snapshot catches up or the verification window closes.
     *
     * Race this fixes: the EA reports a fill to /gateway/execution the moment
     * CTrade returns, but `trading_positions` only updates on the EA's next
     * snapshot (30s cadence). A single-shot check used to run BEFORE that
     * snapshot landed and mis-verified a real fill as a failure. Reads are
     * capped: at most ceil(window/pollInterval) position/order reads per
     * execution, with a short extra settle delay after the first attempt.
     *
     * A report we can never verify is still a failure — never a fabricated
     * success.
     */
    private async verifyInSyncedState(
        userId: string,
        accountId: string,
        mt5Ticket: string | null,
        state: TradingOrderState
    ): Promise<
        | { ok: true; order: TradingOrder | null; position: TradingPosition | null }
        | { ok: false }
    > {
        if (!mt5Ticket) {
            // No ticket: nothing to verify. CANCELLED/REJECTED reports are
            // final states that need no verification; anything else is
            // unverifiable.
            return state === "REJECTED" || state === "CANCELLED" ? { ok: true, order: null, position: null } : { ok: false };
        }

        const deadline = this.config.clock() + this.config.verificationTimeoutMs;
        let attempt = 0;
        while (true) {
            attempt += 1;
            const [positions, orders] = await Promise.all([
                this.getPositions(userId, accountId),
                this.getOrders(userId, accountId),
            ]);
            const position = positions.ok
                ? positions.value.find((p) => p.providerRef === mt5Ticket || p.id === mt5Ticket) ?? null
                : null;
            const order = orders.ok
                ? orders.value.find((o) => o.providerRef === mt5Ticket || o.id === mt5Ticket) ?? null
                : null;

            if (position || order) return { ok: true, order, position };
            if (state === "REJECTED" || state === "CANCELLED") return { ok: true, order, position };
            if (this.config.clock() >= deadline) return { ok: false };

            // After the first miss, give the snapshot writer a short head start
            // before the second read; subsequent polls use the plain interval.
            const delayMs = attempt === 1 ? Math.max(this.config.pollIntervalMs, 2_000) : this.config.pollIntervalMs;
            const nextCheck = this.config.clock() + delayMs;
            if (nextCheck > deadline) return { ok: false };
            await sleep(delayMs);
        }
    }
}

export { brokerLimitsFromAccount };