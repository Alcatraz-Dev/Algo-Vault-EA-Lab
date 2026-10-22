/**
 * RTDB persistence for the Unified Trading Service.
 *
 * Reuses the repository's existing Firebase RTDB conventions (admin-SDK writes,
 * `trading_*` namespaced, user-scoped paths). Firestore is NOT used.
 *
 * New paths (all additive, all user-scoped so the existing rules pattern
 * applies unchanged):
 *   tradingUnifiedAccounts/{userId}/{accountId}
 *   tradingExecutionRequests/{userId}/{clientRequestId}
 *   tradingExecutionResults/{userId}/{clientRequestId}
 *   tradingAudit/{userId}/{eventId}
 *
 * Existing paths the MT5 adapter reads but never rewrites:
 *   trading_accounts/{userId}/{accountId}       (gateway register + heartbeat)
 *   trading_positions/{userId}/{accountId}      (gateway snapshot)
 *   trading_orders/{userId}/{accountId}         (gateway snapshot)
 *   trading_order_requests/{userId}/{id}        (gateway command queue)
 */

import crypto from "crypto";
import { adminDatabase } from "@/lib/firebase-admin";
import type {
    TradingAccount,
    TradingAuditAction,
    TradingAuditEvent,
    TradingEnvironment,
    TradingError,
    TradingExecutionResult,
    TradingProvider,
} from "./domain";

export const UNIFIED_PATHS = {
    accounts: (userId: string) => `tradingUnifiedAccounts/${userId}`,
    account: (userId: string, accountId: string) => `tradingUnifiedAccounts/${userId}/${accountId}`,
    requests: (userId: string) => `tradingExecutionRequests/${userId}`,
    request: (userId: string, id: string) => `tradingExecutionRequests/${userId}/${id}`,
    results: (userId: string) => `tradingExecutionResults/${userId}`,
    result: (userId: string, id: string) => `tradingExecutionResults/${userId}/${id}`,
    audit: (userId: string) => `tradingAudit/${userId}`,
} as const;

/** Idempotency record shape. Kept small; the full result lives in `results`. */
export interface ExecutionRequestRecord {
    clientRequestId: string;
    correlationId: string;
    userId: string;
    accountId: string;
    provider: TradingProvider;
    environment: TradingEnvironment;
    status: TradingExecutionResult["status"];
    createdAt: number;
    completedAt: number | null;
    /** Hash of the request payload; a reused key with a different body is rejected. */
    requestHash: string;
}

export interface IdempotencyOutcome {
    /** "FRESH" — caller should execute. "REPLAY" — return the stored result. */
    kind: "FRESH" | "REPLAY" | "CONFLICT";
    record: ExecutionRequestRecord;
    result: TradingExecutionResult | null;
}

export function hashRequest(input: {
    userId: string;
    accountId: string;
    provider: TradingProvider;
    environment: TradingEnvironment;
    executionType: string;
    symbol?: string;
    side?: string;
    volume?: number;
    percentage?: number;
    positionId?: string;
    orderId?: string;
    /**
     * The trusted bot identity is part of the request body, so two different
     * bots can never collide on one clientRequestId and be mistaken for a
     * replay of each other.
     */
    botAttribution?: { botId: string; executionId: string };
}): string {
    const payload = [
        input.userId,
        input.accountId,
        input.provider,
        input.environment,
        input.executionType,
        input.symbol ?? "",
        input.side ?? "",
        input.volume ?? "",
        input.percentage ?? "",
        input.positionId ?? "",
        input.orderId ?? "",
        input.botAttribution?.botId ?? "",
        input.botAttribution?.executionId ?? "",
    ].join("|");
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/**
 * Claims an idempotency key.
 *
 * RTDB has no cross-process transaction guarantee across read+write, so the
 * write is a `transaction()` on the request node: the first writer wins and
 * every concurrent duplicate resolves to REPLAY/CONFLICT without touching the
 * provider.
 */
export async function claimExecutionRequest(
    record: ExecutionRequestRecord
): Promise<IdempotencyOutcome> {
    const ref = adminDatabase.ref(UNIFIED_PATHS.request(record.userId, record.clientRequestId));
    const now = Date.now();

    let outcome: IdempotencyOutcome | null = null;

    await ref.transaction(
        (current) => {
            if (current && typeof current === "object") {
                const existing = current as ExecutionRequestRecord;
                const sameBody = existing.requestHash === record.requestHash;
                outcome = {
                    kind: sameBody ? "REPLAY" : "CONFLICT",
                    record: existing,
                    result: null,
                };
                // Return undefined → abort the write, leaving the original intact.
                return undefined;
            }
            outcome = { kind: "FRESH", record, result: null };
            return { ...record, updatedAt: now };
        },
        undefined,
        false
    );

    if (outcome) return outcome;

    // Transaction aborted because a record already existed.
    const stored = (await ref.get()).val() as ExecutionRequestRecord | null;
    const existing = stored ?? record;
    const sameBody = existing.requestHash === record.requestHash;
    if (sameBody) {
        const resultSnap = await adminDatabase
            .ref(UNIFIED_PATHS.result(record.userId, record.clientRequestId))
            .get();
        return {
            kind: "REPLAY",
            record: existing,
            result: (resultSnap.val() as TradingExecutionResult | null) ?? null,
        };
    }
    return { kind: "CONFLICT", record: existing, result: null };
}

export async function saveExecutionResult(
    userId: string,
    result: TradingExecutionResult
): Promise<void> {
    const now = Date.now();
    await Promise.all([
        adminDatabase.ref(UNIFIED_PATHS.result(userId, result.clientRequestId)).set(result),
        adminDatabase.ref(UNIFIED_PATHS.request(userId, result.clientRequestId)).update({
            status: result.status,
            completedAt: result.completedAt ?? now,
            updatedAt: now,
        }),
    ]);
}

/**
 * Writes a reconciled outcome over a stored UNKNOWN result — and only over
 * one. Runs as an RTDB transaction so a concurrent reconciler cannot revise a
 * result that has already been settled. Returns the settled result: this call's
 * write, or the winner's when another reconciler settled it first.
 */
export async function resolveUnknownExecutionResult(
    userId: string,
    resolved: TradingExecutionResult
): Promise<TradingExecutionResult | null> {
    const outcome: { written: boolean } = { written: false };
    const txn = await adminDatabase
        .ref(UNIFIED_PATHS.result(userId, resolved.clientRequestId))
        .transaction(
            (current) => {
                const stored = current as TradingExecutionResult | null;
                if (!stored || stored.status !== "UNKNOWN") return undefined;
                outcome.written = true;
                return resolved;
            },
            undefined,
            false
        );
    const settled = (txn.snapshot.val() as TradingExecutionResult | null) ?? null;
    if (outcome.written) {
        await adminDatabase.ref(UNIFIED_PATHS.request(userId, resolved.clientRequestId)).update({
            status: resolved.status,
            completedAt: resolved.completedAt ?? Date.now(),
            updatedAt: Date.now(),
        });
    }
    // The settled value: our write, or the winner's if another reconciler got there first.
    return outcome.written ? resolved : settled;
}

/**
 * Target lock: at most one management action (close / partial close / modify /
 * cancel) per position or order may be outstanding while its previous outcome
 * is UNKNOWN. The owner is the clientRequestId that claimed the target.
 */
function targetLockPath(userId: string, accountId: string, targetKey: string): string {
    const digest = crypto.createHash("sha256").update(targetKey).digest("hex").slice(0, 32);
    return `tradingTargetLocks/${userId}/${accountId}/${digest}`;
}

interface TargetLockRecord {
    clientRequestId: string;
    createdAt: number;
}

export interface TargetLockDeps {
    claim: typeof claimTargetLock;
    release: typeof releaseTargetLock;
    readResult: typeof readExecutionResult;
}

/** Claims the target for `clientRequestId`. Re-claiming by the same owner succeeds. */
export async function claimTargetLock(
    userId: string,
    accountId: string,
    targetKey: string,
    clientRequestId: string
): Promise<{ acquired: boolean; owner: string | null }> {
    const ref = adminDatabase.ref(targetLockPath(userId, accountId, targetKey));
    let acquired = false;
    let owner: string | null = null;
    await ref.transaction(
        (current) => {
            const existing = current as TargetLockRecord | null;
            if (existing && typeof existing === "object" && existing.clientRequestId !== clientRequestId) {
                acquired = false;
                owner = existing.clientRequestId;
                return undefined;
            }
            acquired = true;
            owner = clientRequestId;
            return { clientRequestId, createdAt: Date.now() };
        },
        undefined,
        false
    );
    return { acquired, owner };
}

/** Releases the target only when `clientRequestId` still owns it. */
export async function releaseTargetLock(
    userId: string,
    accountId: string,
    targetKey: string,
    clientRequestId: string
): Promise<void> {
    await adminDatabase.ref(targetLockPath(userId, accountId, targetKey)).transaction(
        (current) => {
            const existing = current as TargetLockRecord | null;
            if (!existing || existing.clientRequestId !== clientRequestId) return undefined;
            return null;
        },
        undefined,
        false
    );
}

export async function readExecutionResult(
    userId: string,
    clientRequestId: string
): Promise<TradingExecutionResult | null> {
    const snap = await adminDatabase.ref(UNIFIED_PATHS.result(userId, clientRequestId)).get();
    return (snap.val() as TradingExecutionResult | null) ?? null;
}

export interface UnifiedAccountRecord {
    id: string;
    userId: string;
    provider: TradingProvider;
    environment: TradingEnvironment;
    externalAccountId: string | null;
    brokerName: string | null;
    serverName: string | null;
    gatewayVersion: string | null;
    connection: TradingAccount["connection"];
    providerStatus: TradingAccount["providerStatus"];
    metrics: TradingAccount["metrics"];
    connectedAt: number | null;
    lastHeartbeatAt: number | null;
    lastSyncAt: number | null;
    connectionError: TradingError | null;
    updatedAt: number;
}

/** Writes the provider-neutral account projection the unified surfaces read. */
export async function saveUnifiedAccount(record: UnifiedAccountRecord): Promise<void> {
    await adminDatabase.ref(UNIFIED_PATHS.account(record.userId, record.id)).set(record);
}

export async function listUnifiedAccounts(userId: string): Promise<UnifiedAccountRecord[]> {
    const snap = await adminDatabase.ref(UNIFIED_PATHS.accounts(userId)).get();
    const data = snap.val();
    if (!data || typeof data !== "object") return [];
    return Object.values(data as Record<string, UnifiedAccountRecord>);
}

export async function getUnifiedAccount(
    userId: string,
    accountId: string
): Promise<UnifiedAccountRecord | null> {
    const snap = await adminDatabase.ref(UNIFIED_PATHS.account(userId, accountId)).get();
    if (!snap.exists()) return null;
    return (snap.val() as UnifiedAccountRecord) ?? null;
}

const AUDIT_RETENTION = 500;

/**
 * Appends one audit event.
 *
 * Secrets are never written here: no tokens, passwords or headers. Only the
 * normalized envelope below is persisted.
 */
export async function appendAuditEvent(
    event: Omit<TradingAuditEvent, "eventId" | "timestamp">
): Promise<void> {
    const ref = adminDatabase.ref(UNIFIED_PATHS.audit(event.userId));
    const eventId = `${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
    const record: TradingAuditEvent = { ...event, eventId, timestamp: Date.now() };

    try {
        await ref.child(eventId).set(record);
        const snap = await ref.orderByChild("timestamp").limitToLast(AUDIT_RETENTION).get();
        const keys = Object.keys(snap.val() ?? {});
        const excess = keys.length - AUDIT_RETENTION;
        if (excess > 0) {
            // Trim only the oldest keys so the newest N stay authoritative.
            await Promise.all(keys.slice(0, excess).map((key) => ref.child(key).remove()));
        }
    } catch (error) {
        // Auditing must never break execution; surface it in the server log.
        console.error("[trading/unified] audit append failed", {
            action: event.action,
            error: error instanceof Error ? error.message : "unknown",
        });
    }
}

export type { TradingAuditAction };