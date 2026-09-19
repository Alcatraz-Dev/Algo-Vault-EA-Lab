/**
 * AlgoVault Pro Signal Intelligence - Duplicate Signal Fingerprint Detector
 */

import crypto from "crypto";
import type { ProSignal } from "../types";

export interface DuplicateCheckResult {
    isDuplicate: boolean;
    fingerprint: string;
    existingSignalId?: string;
}

/**
 * Computes a deterministic SHA256 fingerprint for signal deduplication.
 * Time bucket is rounded to 10-minute windows.
 */
export function computeSignalFingerprint(
    symbol: string,
    direction: string,
    entryMin: number,
    entryMax: number,
    stopLoss: number,
    tpPrices: Array<number | null>,
    sourceId: string,
    timestamp: number = Date.now()
): string {
    const timeWindowBucket = Math.floor(timestamp / (10 * 60 * 1000));
    const sortedTps = [...tpPrices].map((p) => (p === null ? "OPEN" : p.toString())).join(",");

    const payload = `${sourceId.toLowerCase()}:${symbol.toUpperCase()}:${direction.toUpperCase()}:${entryMin}:${entryMax}:${stopLoss}:${sortedTps}:${timeWindowBucket}`;

    return crypto.createHash("sha256").update(payload).digest("hex").substring(0, 16);
}

export function checkDuplicateSignal(
    newFingerprint: string,
    existingSignals: ProSignal[]
): DuplicateCheckResult {
    const match = existingSignals.find((s) => s.fingerprint === newFingerprint);

    if (match) {
        return {
            isDuplicate: true,
            fingerprint: newFingerprint,
            existingSignalId: match.id,
        };
    }

    return {
        isDuplicate: false,
        fingerprint: newFingerprint,
    };
}
