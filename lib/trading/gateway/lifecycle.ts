/**
 * MT5 gateway command lifecycle — delivery, claim, terminal outcome, recovery.
 *
 * The gateway queue is a single RTDB node per command. Claims are performed by
 * a per-command RTDB `transaction()`, which is the only atomic primitive the
 * storage layer offers: two concurrent consumers cannot both observe
 * `status === "queued"` inside a committed transaction. That guarantees a
 * UNIQUE CLAIM, not exactly-once broker execution:
 *
 *   queued ──claim──▶ executing ──report──▶ filled / partially_filled
 *                        │                   rejected / failed / cancelled
 *                        └──claim expired──▶ uncertain (never re-queued)
 *
 * A claim that expires is never rolled back to `queued`: the consumer may have
 * submitted to the broker before disappearing, so re-delivery would risk a
 * duplicate trade. Expired claims are instead reconciled against authoritative
 * broker state (positions/orders snapshots) and, when no single match exists,
 * retained as explicit `uncertain` commands for safe resolution.
 */

/** A claimed command is considered abandoned after this window. */
export const COMMAND_CLAIM_TTL_MS = 120_000;

/** Upper bound on claims per poll — keeps a poll latency-bounded. */
export const MAX_CLAIMS_PER_POLL = 20;

/**
 * How far back a position snapshot may prove an execution whose report was
 * lost. Older positions are not adopted (they belong to a prior trade).
 */
export const EXECUTION_RECOVERY_WINDOW_MS = 24 * 60 * 60_000;

/** Command statuses that must never be overwritten by a later report. */
const TERMINAL = new Set(["filled", "rejected", "failed", "cancelled"]);

/** Execution-record statuses whose broker outcome is still unknown. */
const AWAITING_BROKER = new Set(["gate_passed", "submitted", "acknowledged", "uncertain"]);

export function isTerminalCommandStatus(status: string): boolean {
    return TERMINAL.has(status);
}

/**
 * True when an execution record has no broker-confirmed outcome yet.
 *
 * Recovery may only refine these states. A record that is already
 * `filled`/`rejected_by_broker`/`executed_pending_sync`/`failed`/`cancelled`
 * carries broker evidence and must never be overwritten by a sweep.
 */
export function isAwaitingBrokerOutcome(status: string): boolean {
    return AWAITING_BROKER.has(status);
}

/**
 * Canonical command status for a report.
 *
 * The gateway reports `unknown` when CTrade could neither confirm nor reject
 * the order. Persisting `unknown` would strand the command outside both the
 * claimable and the reconciliable sets, so it becomes the explicit
 * `uncertain` state (never a fabricated fill or failure).
 */
export function normalizeReportedStatus(status: string): string {
    return status === "unknown" || status === "" ? "uncertain" : status;
}

/**
 * Monotonic merge of a broker report into a command's current status.
 *
 * A duplicate or delayed (out-of-order) report must never downgrade a
 * broker-confirmed result:
 *   filled        → stays filled (a late "unknown"/"rejected" is ignored)
 *   rejected/etc. → stays terminal
 *   partially     → filled only
 * Anything still in-flight accepts the incoming report.
 */
export function nextReportStatus(previous: string, incoming: string): string {
    if (!previous || previous === incoming) return incoming;
    if (previous === "filled") return previous;
    if (isTerminalCommandStatus(previous)) return previous;
    if (previous === "partially_filled") return incoming === "filled" ? "filled" : previous;
    return incoming;
}

/**
 * True when a claimed command's claim has lapsed.
 *
 * Uses `claimExpiresAt` when present; older records written before claims
 * existed fall back to `gatewayRetrievedAt`/`executingAt` + the same TTL.
 */
export function isClaimExpired(command: Record<string, unknown>, now: number): boolean {
    const explicit = Number(command.claimExpiresAt);
    if (Number.isFinite(explicit) && explicit > 0) return explicit <= now;

    // `updatedAt` is the last-resort fallback for commands claimed before
    // claims were recorded. While a command is `executing` nothing else
    // writes to it except the claim itself, so the fallback stays accurate.
    const claimedAt = Number(
        command.gatewayRetrievedAt ?? command.executingAt ?? command.claimedAt ?? command.updatedAt
    );
    if (!Number.isFinite(claimedAt) || claimedAt <= 0) return false;
    return claimedAt + COMMAND_CLAIM_TTL_MS <= now;
}

/**
 * True when broker state may settle this command.
 *
 * A `queued` command was never claimed, so an EA never submitted it: a
 * matching broker position cannot belong to it. A live claim is still owned by
 * the EA and must not be fought by a snapshot. Only an explicitly `uncertain`
 * outcome or an expired claim has an unknown outcome that broker evidence is
 * allowed to resolve.
 */
export function canSettleFromBrokerEvidence(command: Record<string, unknown>, now: number): boolean {
    const status = String(command.status ?? "");
    if (status === "uncertain") return true;
    if (status === "executing") return isClaimExpired(command, now);
    return false;
}

/** The single element of a candidate set, or null when the match is ambiguous. */
export function singleCandidate<T>(candidates: T[]): T | null {
    return candidates.length === 1 ? candidates[0] : null;
}

export type BrokerPositionSide = "BUY" | "SELL";

/** Normalises a gateway position type to the neutral side. */
export function positionSide(type: unknown): BrokerPositionSide {
    const value = String(type ?? "").trim().toUpperCase();
    return value === "SELL" || value === "OP_SELL" || value === "1" ? "SELL" : "BUY";
}

export interface RecoverablePosition {
    ticket: string;
    magic: string;
    symbol: string;
    side: BrokerPositionSide;
    volume: number;
    openPrice: number;
}
