/**
 * In-memory fakes for the Unified Trading Service dependencies.
 *
 * The production implementations live in `lib/trading/unified/store.ts` and
 * write to Firebase RTDB. These fakes implement the SAME function shapes so
 * the service can be tested end-to-end without a database, without weakening
 * the service's contracts (the service depends on the function types).
 */

import type {
    TradingAuditAction,
    TradingAuditEvent,
    TradingEnvironment,
    TradingErrorCode,
    TradingExecutionResult,
    TradingExecutionStatus,
    TradingProvider,
} from "@/lib/trading/unified/domain";
import type { ExecutionRequestRecord, IdempotencyOutcome, UnifiedAccountRecord } from "@/lib/trading/unified/store";

export type AuditEventInput = Omit<TradingAuditEvent, "eventId" | "timestamp"> & { timestamp?: number };

interface StoredRequest {
    record: ExecutionRequestRecord;
    result: TradingExecutionResult | null;
}

export function createFakeStore() {
    const requests = new Map<string, StoredRequest>();
    const results: TradingExecutionResult[] = [];
    const accounts: UnifiedAccountRecord[] = [];
    const audit: Array<Omit<TradingAuditEvent, "eventId"> & { eventId: string }> = [];
    let seq = 0;

    const key = (userId: string, id: string) => `${userId}:${id}`;

    return {
        /** Same signature as the RTDB implementation. */
        async idempotency(record: ExecutionRequestRecord): Promise<IdempotencyOutcome> {
            const k = key(record.userId, record.clientRequestId);
            const existing = requests.get(k);
            if (existing) {
                if (existing.record.requestHash === record.requestHash) {
                    return { kind: "REPLAY", record: existing.record, result: existing.result };
                }
                return { kind: "CONFLICT", record: existing.record, result: null };
            }
            requests.set(k, { record, result: null });
            return { kind: "FRESH", record, result: null };
        },

        /** Marks a request as accepted but not yet resolved (in-flight). */
        markInFlight(userId: string, clientRequestId: string): void {
            const k = key(userId, clientRequestId);
            const existing = requests.get(k);
            requests.set(k, {
                record:
                    existing?.record ??
                    ({
                        clientRequestId,
                        correlationId: "corr",
                        userId,
                        accountId: "mock-account",
                        provider: "MT5",
                        environment: "DEMO",
                        status: "ACCEPTED",
                        createdAt: Date.now(),
                        completedAt: null,
                        requestHash: "seeded",
                    } as ExecutionRequestRecord),
                result: existing?.result ?? null,
            });
        },

        async persistResult(userId: string, result: TradingExecutionResult): Promise<void> {
            results.push(result);
            // Keyed exactly like the RTDB implementation: user + request id.
            const k = key(userId, result.clientRequestId);
            const existing = requests.get(k);
            if (existing) {
                requests.set(k, {
                    record: { ...existing.record, status: result.status, completedAt: result.completedAt },
                    result,
                });
            }
        },

        async persistAccount(account: UnifiedAccountRecord): Promise<void> {
            const index = accounts.findIndex((a) => a.userId === account.userId && a.id === account.id);
            if (index >= 0) accounts[index] = account;
            else accounts.push(account);
        },

        async audit(event: Omit<TradingAuditEvent, "eventId" | "timestamp">): Promise<void> {
            seq += 1;
            audit.push({ ...event, eventId: `evt-${seq}`, timestamp: Date.now() });
        },

        resultLog(): TradingExecutionResult[] {
            return results;
        },
        accountLog(): UnifiedAccountRecord[] {
            return accounts;
        },
        auditLog(): Array<Omit<TradingAuditEvent, "eventId"> & { eventId: string }> {
            return audit;
        },
    };
}

export type { TradingAuditAction, TradingAuditEvent, TradingEnvironment, TradingErrorCode, TradingExecutionStatus, TradingProvider };