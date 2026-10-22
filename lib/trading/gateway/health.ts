/**
 * Gateway reachability — ONE definition, shared by the bot API and the
 * terminal so both agree on whether execution is actually possible.
 *
 * The gateway account record is written by `POST /api/trading/gateway/heartbeat`
 * (`status: "connected"`, `lastHeartbeatAt: <ms>`). A stale or missing
 * heartbeat means the EA is not polling, so a queued command would never be
 * claimed. Treating that as "connected" is how a UI ends up promising
 * execution it cannot deliver.
 */

/** A heartbeat older than this cannot be considered a live gateway. */
export const GATEWAY_FRESH_MS = 90_000;

export interface GatewayAccountState {
    status?: unknown;
    lastHeartbeatAt?: unknown;
}

/**
 * True only when the account reports `connected` AND its last heartbeat is
 * within {@link GATEWAY_FRESH_MS}. Missing data is offline, never optimistic.
 */
export function isGatewayConnected(account: GatewayAccountState | null | undefined, now: number): boolean {
    if (!account || typeof account !== "object") return false;
    if (String(account.status ?? "") !== "connected") return false;
    const heartbeat = Number(account.lastHeartbeatAt);
    if (!Number.isFinite(heartbeat) || heartbeat <= 0) return false;
    return now - heartbeat <= GATEWAY_FRESH_MS;
}
