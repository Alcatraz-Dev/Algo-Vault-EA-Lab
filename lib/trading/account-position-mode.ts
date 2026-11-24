/**
 * AlgoVault — authoritative account position accounting.
 *
 * The gateway reports MT5's `ACCOUNT_MARGIN_MODE` on registration and on every
 * heartbeat. It is persisted with the account record (`trading_accounts/…`)
 * exactly as reported; this module is the only reader bots use.
 *
 * Rules:
 *   • Nothing is inferred from open positions, broker names or the demo/real
 *     trade mode.
 *   • A missing, malformed or unsupported value is UNKNOWN, and UNKNOWN is
 *     never treated as hedge-capable.
 *   • Read failures surface as UNKNOWN with an error flag — never as HEDGING.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { accountKey } from "@/lib/risk/account-state";
import { normalizePositionMode, type TradingPositionMode } from "./position-mode";

export interface AccountPositionModeRecord {
    mode: TradingPositionMode;
    /** When the terminal last reported a value (epoch ms), if ever. */
    reportedAt: number | null;
    /** EA version that reported it, when present. */
    gatewayVersion: string | null;
    /** True when the record could not be read at all (fail closed). */
    unavailable: boolean;
}

const UNKNOWN_RECORD: AccountPositionModeRecord = {
    mode: "UNKNOWN",
    reportedAt: null,
    gatewayVersion: null,
    unavailable: false,
};

/**
 * Pure projection of a persisted account record onto its position mode.
 *
 * `positionMode` is written normalised by the gateway routes; it is
 * re-normalised here so a hand-edited or legacy record still fails closed.
 */
export function positionModeFromAccountRecord(
    record: Record<string, unknown> | null | undefined,
): AccountPositionModeRecord {
    if (!record || typeof record !== "object") return { ...UNKNOWN_RECORD };

    const reportedAt = Number(record.positionModeReportedAt);
    const gatewayVersion =
        typeof record.gatewayVersion === "string" && record.gatewayVersion.trim()
            ? record.gatewayVersion.trim()
            : null;

    return {
        mode: normalizePositionMode(record.positionMode),
        reportedAt: Number.isFinite(reportedAt) && reportedAt > 0 ? reportedAt : null,
        gatewayVersion,
        unavailable: false,
    };
}

/** Read the account's authoritative position mode (never guesses). */
export async function loadAccountPositionMode(
    userId: string,
    accountId: string,
): Promise<AccountPositionModeRecord> {
    const key = accountKey(accountId);
    try {
        const snap = await adminDatabase.ref(`trading_accounts/${userId}/${key}`).get();
        if (!snap.exists()) return { ...UNKNOWN_RECORD };
        return positionModeFromAccountRecord(snap.val() as Record<string, unknown>);
    } catch {
        return { ...UNKNOWN_RECORD, unavailable: true };
    }
}
