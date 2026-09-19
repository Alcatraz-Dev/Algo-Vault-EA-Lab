import { AISignal, SignalStatus, SignalTimelineEvent } from "./types";
import { formatPrice } from "./symbol-specs";
import { calculateSignalResult } from "./results";
import { notifySignalEvent } from "./notify";
import { adminDatabase } from "@/lib/firebase-admin";

export async function monitorSignal(signal: AISignal): Promise<{
    signal: AISignal;
    statusChanged: boolean;
    newEvents: SignalTimelineEvent[];
}> {
    const newEvents: SignalTimelineEvent[] = [];
    let statusChanged = false;
    const updated = { ...signal };

    if (signal.status === "CANCELLED" || signal.status === "EXPIRED" || signal.status === "STOPPED" || signal.status === "COMPLETED") {
        return { signal: updated, statusChanged: false, newEvents: [] };
    }

    if (Date.now() > signal.expiresAt && !isInActiveProgress(signal.status)) {
        updated.status = "EXPIRED";
        updated.statusMessage = "Signal expired — setup no longer valid";
        updated.completedAt = Date.now();
        statusChanged = true;
        newEvents.push(createEvent(signal.id, "SIGNAL_EXPIRED", "Signal expired"));
        void notifySignalEvent(updated, "SIGNAL_EXPIRED");

        const outcome = calculateSignalResult(updated);
        updated.result = outcome.result;
        updated.resultR = outcome.resultR;
        updated.profitPoints = outcome.profitPoints;
    }

    if (updated.status === "ACTIVE" && signal.currentPrice > 0) {
        const entry = signal.entry;
        const sl = signal.stopLoss;
        const tp1 = signal.tp1;
        const tp2 = signal.tp2;
        const tp3 = signal.tp3;
        const origStatus = signal.status;

        if (tp1 && isPriceHit(signal.direction, signal.currentPrice, tp1)) {
            if (origStatus !== "TP1_HIT" && origStatus !== "TP2_HIT" && origStatus !== "TP3_HIT") {
                updated.status = "TP1_HIT";
                updated.statusMessage = "TP1 hit — consider moving SL to break-even";
                updated.tp1Hit = true;
                updated.tp1HitAt = Date.now();
                updated.tp1HitPrice = tp1;
                statusChanged = true;
                newEvents.push(createEvent(signal.id, "TP1_HIT", `TP1 reached at ${formatPrice(tp1, signal.symbol)}`));
                void notifySignalEvent(updated, "TP1_HIT");
            }
        }

        if (tp2 && isPriceHit(signal.direction, signal.currentPrice, tp2)) {
            if (origStatus === "ACTIVE" || origStatus === "TP1_HIT") {
                updated.status = "TP2_HIT";
                updated.statusMessage = "TP2 hit — lock in profit";
                updated.tp2Hit = true;
                updated.tp2HitAt = Date.now();
                updated.tp2HitPrice = tp2;
                statusChanged = true;
                newEvents.push(createEvent(signal.id, "TP2_HIT", `TP2 reached at ${formatPrice(tp2, signal.symbol)}`));
                void notifySignalEvent(updated, "TP2_HIT");
            }
        }

        if (tp3 && isPriceHit(signal.direction, signal.currentPrice, tp3)) {
            updated.status = "TP3_HIT";
            updated.statusMessage = "TP3 hit — runner active";
            updated.tp3Hit = true;
            updated.tp3HitAt = Date.now();
            updated.tp3HitPrice = tp3;
            statusChanged = true;
            newEvents.push(createEvent(signal.id, "TP3_HIT", `TP3 reached at ${formatPrice(tp3, signal.symbol)}`));
            void notifySignalEvent(updated, "TP3_HIT");
        }

        if (isPriceHit(signal.direction === "BUY" ? "SELL" : "BUY", signal.currentPrice, sl)) {
            updated.status = "STOPPED";
            updated.statusMessage = "Stop loss hit";
            updated.completedAt = Date.now();
            statusChanged = true;
            newEvents.push(createEvent(signal.id, "SL_HIT", `SL hit at ${formatPrice(sl, signal.symbol)}`));
            void notifySignalEvent(updated, "STOP_LOSS_HIT");
        }
    }

    if (updated.status === "TP3_HIT") {
        updated.status = "RUNNER";
        updated.statusMessage = "Runner active — trail stop";
        statusChanged = true;
    }

    // Resolve the deterministic result whenever we reach a traded terminal state.
    const terminalTradedStates: SignalStatus[] = ["STOPPED", "TP3_HIT", "RUNNER", "COMPLETED"];
    if (terminalTradedStates.includes(updated.status)) {
        const outcome = calculateSignalResult(updated);
        updated.result = outcome.result;
        updated.resultR = outcome.resultR;
        updated.profitPoints = outcome.profitPoints;
    }

    updated.lastCheckedAt = Date.now();
    updated.updatedAt = Date.now();

    return { signal: updated, statusChanged, newEvents };
}

function isPriceHit(direction: string, currentPrice: number, target: number): boolean {
    if (direction === "BUY") {
        return currentPrice >= target;
    } else {
        return currentPrice <= target;
    }
}

function isInActiveProgress(status: SignalStatus): boolean {
    return ["ACTIVE", "TP1_HIT", "TP2_HIT", "TP3_HIT", "RUNNER"].includes(status);
}

function createEvent(signalId: string, type: SignalTimelineEvent["type"], message: string): SignalTimelineEvent {
    return {
        id: `${signalId}_${type}_${Date.now()}`,
        timestamp: Date.now(),
        type,
        message,
    };
}

export async function monitorAllActiveSignals(): Promise<{
    checked: number;
    statusChanges: number;
    events: SignalTimelineEvent[];
}> {
    const snap = await adminDatabase.ref("aiSignals").get();
    let checked = 0;
    let statusChanges = 0;
    const allEvents: SignalTimelineEvent[] = [];

    const activeStatuses = ["READY", "ACTIVE", "TP1_HIT", "TP2_HIT"];

    const activeSignals: AISignal[] = [];
    snap.forEach((child) => {
        const signal = child.val() as AISignal;
        if (activeStatuses.includes(signal.status)) {
            checked++;
            activeSignals.push(signal);
        }
    });

    for (const signal of activeSignals) {
        const result = await monitorSignal(signal);
        if (result.statusChanged) {
            statusChanges++;

            const updates: Record<string, unknown> = {
                status: result.signal.status,
                statusMessage: result.signal.statusMessage,
                completedAt: result.signal.completedAt,
                lastCheckedAt: result.signal.lastCheckedAt,
                updatedAt: result.signal.updatedAt,
            };

            if (result.signal.tp1Hit !== signal.tp1Hit) {
                updates.tp1Hit = result.signal.tp1Hit;
                updates.tp1HitAt = result.signal.tp1HitAt;
                updates.tp1HitPrice = result.signal.tp1HitPrice;
            }
            if (result.signal.tp2Hit !== signal.tp2Hit) {
                updates.tp2Hit = result.signal.tp2Hit;
                updates.tp2HitAt = result.signal.tp2HitAt;
                updates.tp2HitPrice = result.signal.tp2HitPrice;
            }
            if (result.signal.tp3Hit !== signal.tp3Hit) {
                updates.tp3Hit = result.signal.tp3Hit;
                updates.tp3HitAt = result.signal.tp3HitAt;
                updates.tp3HitPrice = result.signal.tp3HitPrice;
            }

            const terminalStates: SignalStatus[] = ["STOPPED", "EXPIRED", "TP3_HIT", "RUNNER", "COMPLETED", "CANCELLED"];
            if (terminalStates.includes(result.signal.status)) {
                updates.result = result.signal.result;
                updates.resultR = result.signal.resultR;
                updates.profitPoints = result.signal.profitPoints;
            }

            await adminDatabase.ref(`aiSignals/${signal.id}`).update(updates);

            for (const event of result.newEvents) {
                await adminDatabase.ref(`signalEvents/${signal.id}/${event.id}`).set(event);
                allEvents.push(event);
            }
        }
    }

    return { checked, statusChanges, events: allEvents };
}
