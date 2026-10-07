/**
 * Unified Trading Service.
 *
 * The single execution pipeline every channel uses:
 *
 *   Trading Request
 *     → Authentication        (the caller must already be authenticated)
 *     → Account Ownership     (server-side; never a client account id)
 *     → Provider Status       (feature flag + adapter availability)
 *     → Demo Environment      (hard: LIVE is not executable in this phase)
 *     → Connection State      (stale heartbeats block execution)
 *     → Risk Engine           (canonical lib/risk/risk-engine)
 *     → Idempotency           (one clientRequestId → at most one trade)
 *     → Provider Execution
 *     → Verification          (adapters verify; the service re-checks)
 *     → Audit Log
 *
 * The service is provider-neutral: it never branches on MT5 vs cTrader. It
 * only asks the registry for the adapter and fails closed when it is absent.
 */

import crypto from "crypto";
import { evaluateOrder, type AccountRiskState, type RiskLimits } from "@/lib/risk/risk-engine";
import type {
    TradingAccount,
    TradingAuditAction,
    TradingAuditEvent,
    TradingConnection,
    TradingEnvironment,
    TradingError,
    TradingExecutionRequest,
    TradingExecutionResult,
    TradingExecutionType,
    TradingOrder,
    TradingPosition,
    TradingProvider,
} from "./domain";
import { tradingError } from "./errors";
import type { TradingProviderAdapter, TradingProviderDescriptor, TradingProviderRegistry, TradingResult } from "./adapter";
import { planPartialClose, VolumeError } from "./volume";
import {
    claimExecutionRequest,
    hashRequest,
    saveExecutionResult,
    saveUnifiedAccount,
    appendAuditEvent,
} from "./store";
import { isUnifiedTradingEnabled, isMt5DemoEnabled, isDemoExecutionMode } from "../feature-flags";
import { hasActiveTradingLicense } from "@/lib/gateway";

export interface UnifiedExecutionOutcome {
    result: TradingExecutionResult;
    httpStatus: number;
}

function ok<T>(value: T): TradingResult<T> {
    return { ok: true, value };
}

function fail<T>(error: TradingError): TradingResult<T> {
    return { ok: false, error };
}

export interface UnifiedTradingDeps {
    registry: TradingProviderRegistry;
    /** Injectable for tests; defaults to the RTDB-backed implementations. */
    idempotency?: typeof claimExecutionRequest;
    persistResult?: typeof saveExecutionResult;
    persistAccount?: typeof saveUnifiedAccount;
    audit?: typeof appendAuditEvent;
    /** Trading-access entitlement probe; defaults to `hasActiveTradingLicense`. */
    entitlement?: (userId: string) => Promise<boolean>;
    now?: () => number;
}

/** Fields a client may set. Everything else is derived server-side. */
export interface ExecuteInput {
    userId: string;
    clientRequestId: string;
    executionType: TradingExecutionType;
    accountId: string;
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
    correlationId?: string;
    source?: string;
    /**
     * Ignored for validation on purpose: the client never chooses the
     * environment. It is accepted only so a hostile `environment: "LIVE"`
     * is explicitly rejected rather than silently ignored.
     */
    environment?: string;
}

export class UnifiedTradingService {
    private readonly idempotency: typeof claimExecutionRequest;
    private readonly persistResult: typeof saveExecutionResult;
    private readonly persistAccount: typeof saveUnifiedAccount;
    private readonly audit: typeof appendAuditEvent;
    private readonly entitlement: (userId: string) => Promise<boolean>;
    private readonly now: () => number;

    constructor(private readonly deps: UnifiedTradingDeps) {
        this.idempotency = deps.idempotency ?? claimExecutionRequest;
        this.persistResult = deps.persistResult ?? saveExecutionResult;
        this.persistAccount = deps.persistAccount ?? saveUnifiedAccount;
        this.audit = deps.audit ?? appendAuditEvent;
        this.entitlement = deps.entitlement ?? hasActiveTradingLicense;
        this.now = deps.now ?? (() => Date.now());
    }

    // ── reads ────────────────────────────────────────────────────────────────

    listProviders(): TradingProviderDescriptor[] {
        return this.deps.registry.list();
    }

    /**
     * Resolves the adapter that owns an account id.
     *
     * The caller never names a provider: the namespace of `accountId` decides.
     * An account id no adapter owns is `PROVIDER_NOT_CONFIGURED`, never a
     * silent fallback to a provider that happens to be available.
     */
    private resolveAdapter(accountId: string): TradingResult<TradingProviderAdapter> {
        const adapter = this.deps.registry.resolveForAccount(accountId);
        if (!adapter || !adapter.descriptor.available) {
            return fail(
                tradingError("PROVIDER_NOT_CONFIGURED", "No trading provider is configured for this account.")
            );
        }
        return ok(adapter);
    }

    async getAccount(userId: string, accountId: string): Promise<TradingResult<TradingAccount>> {
        if (!isUnifiedTradingEnabled()) {
            return fail(tradingError("TRADING_DISABLED", "Unified trading is disabled on this platform."));
        }
        if (!userId || !accountId) {
            return fail(tradingError("INVALID_REQUEST", "userId and accountId are required."));
        }
        const adapter = this.resolveAdapter(accountId);
        if (!adapter.ok) return adapter;
        const result = await adapter.value.getAccount(userId, accountId);
        if (result.ok) await this.projectAccount(result.value);
        return result;
    }

    async getPositions(userId: string, accountId: string): Promise<TradingResult<TradingPosition[]>> {
        if (!isUnifiedTradingEnabled()) {
            return fail(tradingError("TRADING_DISABLED", "Unified trading is disabled on this platform."));
        }
        const adapter = this.resolveAdapter(accountId);
        if (!adapter.ok) return adapter;
        return adapter.value.getPositions(userId, accountId);
    }

    async getOrders(userId: string, accountId: string): Promise<TradingResult<TradingOrder[]>> {
        if (!isUnifiedTradingEnabled()) {
            return fail(tradingError("TRADING_DISABLED", "Unified trading is disabled on this platform."));
        }
        const adapter = this.resolveAdapter(accountId);
        if (!adapter.ok) return adapter;
        return adapter.value.getOrders(userId, accountId);
    }

    async getHistory(userId: string, accountId: string, since?: number) {
        if (!isUnifiedTradingEnabled()) {
            return fail(tradingError("TRADING_DISABLED", "Unified trading is disabled on this platform."));
        }
        const adapter = this.resolveAdapter(accountId);
        if (!adapter.ok) return adapter;
        return adapter.value.getHistory(userId, accountId, since);
    }

    async getConnection(userId: string, accountId: string): Promise<TradingResult<TradingConnection>> {
        if (!isUnifiedTradingEnabled()) {
            return fail(tradingError("TRADING_DISABLED", "Unified trading is disabled on this platform."));
        }
        const adapter = this.resolveAdapter(accountId);
        if (!adapter.ok) return adapter;
        return adapter.value.getConnectionStatus(userId, accountId);
    }

    /** Persists the provider-neutral projection the unified UI reads. */
    private async projectAccount(account: TradingAccount): Promise<void> {
        try {
            await this.persistAccount({
                id: account.id,
                userId: account.userId,
                provider: account.provider,
                environment: account.environment,
                externalAccountId: account.externalAccountId,
                brokerName: account.brokerName,
                serverName: account.serverName,
                gatewayVersion: account.gatewayVersion,
                connection: account.connection,
                providerStatus: account.providerStatus,
                metrics: account.metrics,
                connectedAt: account.connectedAt,
                lastHeartbeatAt: account.lastHeartbeatAt,
                lastSyncAt: account.lastSyncAt,
                connectionError: account.connectionError,
                updatedAt: this.now(),
            });
        } catch (error) {
            console.error("[trading/unified] account projection failed", {
                error: error instanceof Error ? error.message : "unknown",
            });
        }
    }

    private async writeAudit(event: Omit<TradingAuditEvent, "eventId" | "timestamp">): Promise<void> {
        await this.audit(event);
    }

    // ── execution ────────────────────────────────────────────────────────────

    async execute(input: ExecuteInput): Promise<UnifiedExecutionOutcome> {
        const startedAt = this.now();
        const correlationId = input.correlationId?.trim() || crypto.randomUUID();
        const baseAudit = {
            userId: input.userId,
            accountId: input.accountId ?? null,
            provider: null as TradingProvider | null,
            environment: null as TradingEnvironment | null,
            clientRequestId: input.clientRequestId ?? null,
            correlationId,
            action: "EXECUTION_REQUESTED" as TradingAuditAction,
            symbol: input.symbol ?? null,
            volume: input.volume ?? null,
            requestStatus: null,
            providerStatus: null,
            result: null,
            errorCode: null as TradingAuditEvent["errorCode"],
            source: input.source ?? null,
            executionType: input.executionType ?? null,
            requestedPercentage: input.percentage ?? null,
        };

        const reject = (
            error: TradingError,
            action: TradingAuditAction = "EXECUTION_REJECTED"
        ): UnifiedExecutionOutcome => {
            void this.writeAudit({ ...baseAudit, action, errorCode: error.code });
            return {
                result: this.emptyResult(input, correlationId, startedAt, "REJECTED", error),
                httpStatus: errorCodeToStatus(error),
            };
        };

        // 1. Platform capabilities.
        if (!isUnifiedTradingEnabled()) {
            return reject(tradingError("TRADING_DISABLED", "Unified trading is disabled on this platform."));
        }
        if (input.environment && input.environment.toUpperCase() === "LIVE") {
            return reject(
                tradingError("LIVE_EXECUTION_DISABLED", "Live execution is not permitted on AlgoVault."),
                "CONNECTION_REJECTED"
            );
        }

        // 2. Request shape + idempotency key.
        if (!input.userId) {
            return reject(tradingError("PERMISSION_DENIED", "Authentication is required."), "CONNECTION_REJECTED");
        }
        if (!input.accountId) {
            return reject(tradingError("ACCOUNT_NOT_FOUND", "An accountId is required."), "CONNECTION_REJECTED");
        }
        if (!input.clientRequestId || input.clientRequestId.length < 8 || input.clientRequestId.length > 128) {
            return reject(
                tradingError(
                    "INVALID_REQUEST",
                    "clientRequestId must be a 8–128 character idempotency key."
                )
            );
        }
        const provider = this.providerForAccount(input.accountId);

        // 3. Provider feature flag + registry. The adapter is chosen by the
        //    account id namespace, never by the caller.
        if (provider === "MT5" && !isMt5DemoEnabled()) {
            return reject(tradingError("PROVIDER_UNAVAILABLE", "MT5 demo execution is disabled."));
        }
        if (!isDemoExecutionMode()) {
            // Fail closed: a deployment that is not configured demo-only
            // executes nothing rather than guessing which mode it is in.
            return reject(
                tradingError("LIVE_EXECUTION_DISABLED", "This deployment is not configured for demo-only execution.")
            );
        }

        const adapterResult = this.resolveAdapter(input.accountId);
        if (!adapterResult.ok) {
            return reject(adapterResult.error, "CONNECTION_REJECTED");
        }
        const adapter = adapterResult.value;

        // 3b. Trading access / license gate — the same entitlement the legacy
        //     /api/trading/orders route and the gateway EA enforce. Executed
        //     server-side so a Pro Terminal client can never bypass it.
        const licensed = await this.entitlement(input.userId);
        if (!licensed) {
            return reject(
                tradingError("PERMISSION_DENIED", "No active trading access license."),
                "CONNECTION_REJECTED"
            );
        }
        const auditBase: typeof baseAudit = { ...baseAudit, provider };

        // 4. Ownership + account state (server-side read, not client-supplied).
        const accountResult = await adapter.getAccount(input.userId, input.accountId);
        if (!accountResult.ok) {
            void this.writeAudit({ ...auditBase, action: "CONNECTION_REJECTED", errorCode: accountResult.error.code });
            return {
                result: this.emptyResult(input, correlationId, startedAt, "REJECTED", accountResult.error, provider),
                httpStatus: errorCodeToStatus(accountResult.error),
            };
        }
        const account = accountResult.value;
        await this.projectAccount(account);

        // 5. Demo-only enforcement. The client cannot choose.
        if (account.environment !== "DEMO") {
            const error = tradingError(
                "LIVE_EXECUTION_DISABLED",
                "Only MetaTrader 5 demo accounts can be executed. This account is not a verified demo account."
            );
            void this.writeAudit({
                ...auditBase,
                action: "CONNECTION_REJECTED",
                environment: account.environment,
                providerStatus: account.providerStatus,
                errorCode: error.code,
            });
            return {
                result: this.emptyResult(input, correlationId, startedAt, "REJECTED", error, provider, account.environment),
                httpStatus: errorCodeToStatus(error),
            };
        }

        // 6. Connection state — fail closed on stale/unknown providers.
        if (account.connection === "STALE") {
            const error = tradingError(
                "PROVIDER_STALE",
                "The provider connection is stale. Execution is blocked until the gateway reconnects."
            );
            void this.writeAudit({
                ...auditBase,
                environment: account.environment,
                providerStatus: account.providerStatus,
                action: "CONNECTION_REJECTED",
                errorCode: error.code,
            });
            return {
                result: this.emptyResult(input, correlationId, startedAt, "REJECTED", error, provider, account.environment),
                httpStatus: errorCodeToStatus(error),
            };
        }
        if (account.connection === "DISCONNECTED" || account.connection === "ERROR") {
            const error = tradingError("ACCOUNT_NOT_CONNECTED", "The trading account is not connected.");
            void this.writeAudit({
                ...auditBase,
                environment: account.environment,
                providerStatus: account.providerStatus,
                action: "CONNECTION_REJECTED",
                errorCode: error.code,
            });
            return {
                result: this.emptyResult(input, correlationId, startedAt, "REJECTED", error, provider, account.environment),
                httpStatus: errorCodeToStatus(error),
            };
        }

        const request: TradingExecutionRequest = {
            clientRequestId: input.clientRequestId,
            correlationId,
            userId: input.userId,
            accountId: input.accountId,
            provider,
            environment: "DEMO",
            executionType: input.executionType,
            symbol: input.symbol,
            side: input.side,
            volume: input.volume,
            percentage: input.percentage,
            kind: input.kind,
            price: input.price,
            stopLoss: input.stopLoss,
            takeProfit: input.takeProfit,
            positionId: input.positionId,
            orderId: input.orderId,
            source: input.source,
            timestamp: startedAt,
        };

        // 7. Idempotency. A replayed key never reaches the provider.
        const claim = await this.idempotency({
            clientRequestId: request.clientRequestId,
            correlationId,
            userId: request.userId,
            accountId: request.accountId,
            provider,
            environment: "DEMO",
            status: "ACCEPTED",
            createdAt: startedAt,
            completedAt: null,
            requestHash: hashRequest({
                userId: request.userId,
                accountId: request.accountId,
                provider,
                environment: "DEMO",
                executionType: request.executionType,
                symbol: input.symbol,
                side: input.side,
                volume: input.volume,
                percentage: input.percentage,
                positionId: input.positionId,
                orderId: input.orderId,
            }),
        });

        if (claim.kind === "CONFLICT") {
            const error = tradingError(
                "DUPLICATE_REQUEST",
                "This clientRequestId was already used with a different payload."
            );
            void this.writeAudit({ ...auditBase, action: "EXECUTION_DUPLICATE", errorCode: error.code });
            return {
                result: this.emptyResult(input, correlationId, startedAt, "REJECTED", error, provider, account.environment),
                httpStatus: errorCodeToStatus(error),
            };
        }

        if (claim.kind === "REPLAY") {
            const stored = claim.result;
            if (stored && stored.status !== "ACCEPTED") {
                void this.writeAudit({
                    ...auditBase,
                    action: "EXECUTION_DUPLICATE",
                    environment: "DEMO",
                    requestStatus: stored.status,
                    result: stored.status,
                });
                return { result: { ...stored, duplicate: true }, httpStatus: 200 };
            }
            const error = tradingError(
                "DUPLICATE_REQUEST",
                "An identical request is already in flight. Wait for the original result."
            );
            void this.writeAudit({ ...auditBase, action: "EXECUTION_DUPLICATE", errorCode: error.code });
            return {
                result: this.emptyResult(input, correlationId, startedAt, "REJECTED", error, provider, account.environment),
                httpStatus: errorCodeToStatus(error),
            };
        }

        void this.writeAudit({
            ...auditBase,
            action: "EXECUTION_ACCEPTED",
            environment: "DEMO",
            providerStatus: account.providerStatus,
            requestStatus: "ACCEPTED",
        });

        // 8. Resolve the target object + compute provider-safe volume.
        let position: TradingPosition | null = null;
        let order: TradingOrder | null = null;
        let volume: number | null = input.volume ?? null;

        try {
            const resolved = await this.resolveTarget(adapter, request);
            if (!resolved.ok) {
                const error = resolved.error;
                const outcome = await this.settle(request, correlationId, startedAt, "REJECTED", error, provider, null, null, null);
                return { result: outcome, httpStatus: errorCodeToStatus(error) };
            }
            position = resolved.value.position;
            order = resolved.value.order;
            volume = resolved.value.volume;
        } catch (error) {
            if (error instanceof VolumeError) {
                const normalized = tradingError(error.code, error.message);
                const outcome = await this.settle(request, correlationId, startedAt, "REJECTED", normalized, provider, null, null, null);
                return { result: outcome, httpStatus: errorCodeToStatus(normalized) };
            }
            throw error;
        }

        // 9. Risk engine. Management actions are always protective.
        const isEntry = request.executionType === "PLACE_ORDER";
        if (isEntry) {
            const limits = this.riskLimits();
            const state: AccountRiskState = {
                balance: account.metrics.balance ?? undefined,
                openPositionsCount: account.metrics.positionsCount ?? undefined,
            };
            // SL/TP geometry can only be validated against a real entry
            // reference. When none is known the provider validates it on fill
            // and reports INVALID_SL / MARKET_CLOSED — we never invent a price.
            const referencePrice = await this.resolveEntryReferencePrice(adapter, request);
            const geometryKnown = referencePrice > 0;
            const decision = evaluateOrder(
                {
                    symbol: request.symbol ?? "",
                    direction: request.side === "SELL" ? "SELL" : "BUY",
                    entryKind: riskEntryKind(request.kind),
                    price: referencePrice,
                    volume: volume ?? undefined,
                    sl: geometryKnown ? request.stopLoss ?? null : null,
                    tp: geometryKnown ? request.takeProfit ?? null : null,
                    protective: false,
                },
                limits,
                state,
                this.now()
            );
            if (!decision.approved) {
                const error = tradingError("RISK_REJECTED", decision.reason ?? "Rejected by the risk engine.");
                const outcome = await this.settle(request, correlationId, startedAt, "REJECTED", error, provider, null, position, order);
                return { result: outcome, httpStatus: errorCodeToStatus(error) };
            }
            volume = decision.volume ?? volume;
        }

        // 10. Provider execution.
        const executed = await adapter.execute({
            request,
            account,
            position,
            order,
            volume,
        });

        if (!executed.ok) {
            const outcome = await this.settle(request, correlationId, startedAt, "FAILED", executed.error, provider, null, position, order);
            return { result: outcome, httpStatus: errorCodeToStatus(executed.error) };
        }

        const result = executed.value;
        const action: TradingAuditAction =
            result.status === "SUCCEEDED"
                ? "EXECUTION_SUCCEEDED"
                : result.status === "EXECUTED_PENDING_SYNC"
                  ? "EXECUTION_PENDING_SYNC"
                  : result.status === "REJECTED"
                    ? "EXECUTION_REJECTED"
                    : "EXECUTION_FAILED";

        await this.persistResult(request.userId, result);
        void this.writeAudit({
            ...auditBase,
            action,
            environment: "DEMO",
            volume: result.filledVolume ?? input.volume ?? null,
            requestStatus: "ACCEPTED",
            result: result.status,
            errorCode: result.error?.code ?? null,
            providerRef: result.providerRef ?? null,
        });

        return {
            result,
            // EXECUTED_PENDING_SYNC is an outcome, not an error: the provider
            // confirmed the fill and only the local mirror is late. 200 with
            // the status payload keeps retries (which idempotency already
            // absorbs) from ever re-submitting a confirmed trade.
            httpStatus: result.status === "SUCCEEDED" || result.status === "EXECUTED_PENDING_SYNC"
                ? 200
                : errorCodeToStatus(result.error ?? tradingError("ORDER_REJECTED", "Order rejected.")),
        };
    }

    private async resolveTarget(
        adapter: TradingProviderAdapter,
        request: TradingExecutionRequest
    ): Promise<
        TradingResult<{
            position: TradingPosition | null;
            order: TradingOrder | null;
            volume: number | null;
        }>
    > {
        const limits = this.riskLimits();

        if (request.executionType === "PLACE_ORDER") {
            if (!request.symbol || !request.side) {
                return fail(tradingError("INVALID_REQUEST", "symbol and side are required for orders."));
            }
            const requested = request.volume;
            if (requested === undefined || requested === null) {
                return fail(tradingError("INVALID_VOLUME", "volume is required for orders."));
            }
            if (!Number.isFinite(requested) || requested <= 0) {
                return fail(tradingError("INVALID_VOLUME", "volume must be greater than 0."));
            }
            return ok({ position: null, order: null, volume: requested });
        }

        if (request.executionType === "CANCEL_ORDER") {
            if (!request.orderId) return fail(tradingError("INVALID_REQUEST", "orderId is required."));
            const orders = await adapter.getOrders(request.userId, request.accountId);
            if (!orders.ok) return orders;
            const found = orders.value.find((o) => o.id === request.orderId || o.providerRef === request.orderId);
            if (!found) return fail(tradingError("ACCOUNT_NOT_FOUND", "Order not found on this account."));
            return ok({ position: null, order: found, volume: null });
        }

        if (!request.positionId) return fail(tradingError("INVALID_REQUEST", "positionId is required."));
        const positions = await adapter.getPositions(request.userId, request.accountId);
        if (!positions.ok) return positions;
        const position = positions.value.find((p) => p.id === request.positionId || p.providerRef === request.positionId);
        if (!position) return fail(tradingError("ACCOUNT_NOT_FOUND", "Position not found on this account."));

        if (request.executionType === "PARTIAL_CLOSE") {
            const percentage = request.percentage;
            if (percentage === undefined || percentage === null) {
                return fail(
                    tradingError("INVALID_REQUEST", "percentage is required for a partial close (1–100).")
                );
            }
            const plan = planPartialClose({ openVolume: position.volume, percentage, limits });
            return ok({ position, order: null, volume: plan.closeVolume });
        }

        return ok({ position, order: null, volume: null });
    }

    /**
     * Broker limits for the risk engine.
     *
     * The AlgoVault gateway does not publish MT5 symbol specifications yet, so
     * there are no per-account lot limits to enforce here: the engine then
     * applies only volume sanity and SL/TP geometry, and the provider itself
     * rejects out-of-spec volumes. When the adapter starts returning
     * `TradingSymbol.minVolume/maxVolume/volumeStep`, this is where they plug
     * in — no other part of the pipeline changes.
     */
    private riskLimits(): RiskLimits {
        return {};
    }

    /**
     * Entry reference price for risk geometry.
     *
     * Order of preference: the caller-supplied limit/stop price, then a live
     * provider quote. Returns 0 when neither is available, which disables
     * SL/TP geometry validation (the provider then rejects invalid stops at
     * fill time) instead of validating against a fabricated price.
     */
    private async resolveEntryReferencePrice(
        adapter: TradingProviderAdapter,
        request: TradingExecutionRequest
    ): Promise<number> {
        const supplied = Number(request.price ?? 0);
        if (Number.isFinite(supplied) && supplied > 0) return supplied;
        if (!request.symbol) return 0;
        try {
            const quote = await adapter.getQuote(request.userId, request.accountId, request.symbol);
            if (quote.ok && Number.isFinite(quote.value.bid) && quote.value.bid > 0) {
                return request.side === "SELL" ? quote.value.bid : quote.value.ask;
            }
        } catch {
            // A provider that cannot quote does not block execution.
        }
        return 0;
    }

    private async settle(
        request: TradingExecutionRequest,
        correlationId: string,
        startedAt: number,
        status: TradingExecutionResult["status"],
        error: TradingError,
        provider: TradingProvider,
        providerRef: string | null,
        position: TradingPosition | null,
        order: TradingOrder | null
    ): Promise<TradingExecutionResult> {
        const result: TradingExecutionResult = {
            clientRequestId: request.clientRequestId,
            correlationId,
            accountId: request.accountId,
            provider,
            environment: request.environment,
            executionType: request.executionType,
            status,
            providerRef,
            filledVolume: null,
            filledPrice: null,
            order,
            position,
            error,
            duplicate: false,
            createdAt: startedAt,
            completedAt: this.now(),
        };
        await this.persistResult(request.userId, result);
        void this.writeAudit({
            userId: request.userId,
            accountId: request.accountId,
            provider,
            environment: request.environment,
            clientRequestId: request.clientRequestId,
            correlationId,
            action:
                status === "SUCCEEDED"
                    ? "EXECUTION_SUCCEEDED"
                    : status === "FAILED"
                      ? "EXECUTION_FAILED"
                      : "EXECUTION_REJECTED",
            symbol: request.symbol ?? null,
            volume: request.volume ?? null,
            requestStatus: "ACCEPTED",
            providerStatus: null,
            result: status,
            errorCode: error.code,
            source: request.source ?? null,
            executionType: request.executionType,
            requestedPercentage: request.percentage ?? null,
        });
        return result;
    }

    private emptyResult(
        input: ExecuteInput,
        correlationId: string,
        startedAt: number,
        status: TradingExecutionResult["status"],
        error: TradingError,
        provider?: TradingProvider,
        environment: TradingEnvironment = "DEMO"
    ): TradingExecutionResult {
        return {
            clientRequestId: input.clientRequestId ?? "",
            correlationId,
            accountId: input.accountId ?? "",
            provider: provider ?? this.providerForAccount(input.accountId ?? ""),
            environment,
            executionType: input.executionType,
            status,
            providerRef: null,
            filledVolume: null,
            filledPrice: null,
            order: null,
            position: null,
            error,
            duplicate: false,
            createdAt: startedAt,
            completedAt: this.now(),
        };
    }

    /**
     * Derives the provider from the account id namespace.
     *
     * The client cannot pick a provider. When no adapter owns the namespace
     * (e.g. a malformed id) the adapter resolution above has already failed,
     * so this is only used to label audit/rejection envelopes.
     */
    private providerForAccount(accountId: string): TradingProvider {
        return this.deps.registry.resolveForAccount(accountId)?.provider ?? "MT5";
    }
}

/** The canonical risk engine understands MARKET/LIMIT/STOP entries only. */
function riskEntryKind(kind: TradingExecutionRequest["kind"]): "MARKET" | "LIMIT" | "STOP" {
    if (kind === "LIMIT") return "LIMIT";
    if (kind === "STOP" || kind === "STOP_LIMIT") return "STOP";
    return "MARKET";
}

const STATUS_BY_CODE: Record<TradingError["code"], number> = {
    ACCOUNT_NOT_CONNECTED: 409,
    ACCOUNT_NOT_FOUND: 404,
    PROVIDER_UNAVAILABLE: 503,
    PROVIDER_STALE: 409,
    INVALID_SYMBOL: 400,
    INVALID_VOLUME: 400,
    INSUFFICIENT_MARGIN: 422,
    MARKET_CLOSED: 409,
    ORDER_REJECTED: 422,
    EXECUTION_TIMEOUT: 504,
    DUPLICATE_REQUEST: 409,
    PERMISSION_DENIED: 403,
    LIVE_EXECUTION_DISABLED: 403,
    RISK_REJECTED: 422,
    UNKNOWN_PROVIDER_ERROR: 502,
    INVALID_REQUEST: 400,
    UNSUPPORTED_OPERATION: 501,
    PROVIDER_NOT_CONFIGURED: 501,
    TRADING_DISABLED: 403,
};

function errorCodeToStatus(error: TradingError): number {
    return STATUS_BY_CODE[error.code] ?? 500;
}