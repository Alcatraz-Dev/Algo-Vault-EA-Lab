/**
 * AlgoVault Pro Signal Intelligence - Conflict Detector
 * Aggregates conflicting signals across active sources for the same symbol.
 */

import type { ProSignal, SignalConflictSummary } from "../types";

export function detectSignalConflicts(signals: ProSignal[]): SignalConflictSummary[] {
    const activeSignals = signals.filter(
        (s) => !["CLOSED", "STOPPED", "EXPIRED", "CANCELLED", "INVALID"].includes(s.status)
    );

    const symbolGroups = new Map<string, ProSignal[]>();

    for (const signal of activeSignals) {
        const symbol = signal.symbol.toUpperCase();
        if (!symbolGroups.has(symbol)) {
            symbolGroups.set(symbol, []);
        }
        symbolGroups.get(symbol)!.push(signal);
    }

    const conflicts: SignalConflictSummary[] = [];

    for (const [symbol, group] of symbolGroups.entries()) {
        const buySignals = group.filter((s) => s.direction === "BUY");
        const sellSignals = group.filter((s) => s.direction === "SELL");

        if (buySignals.length > 0 && sellSignals.length > 0) {
            conflicts.push({
                symbol,
                buyCount: buySignals.length,
                sellCount: sellSignals.length,
                signals: group.map((s) => ({
                    id: s.id,
                    direction: s.direction,
                    entryMin: s.entryMin,
                    entryMax: s.entryMax,
                    style: s.style,
                    createdAt: s.createdAt,
                })),
            });
        }
    }

    return conflicts;
}
