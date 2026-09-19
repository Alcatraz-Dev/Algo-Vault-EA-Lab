/**
 * AlgoVault Pro Signal Intelligence - Signal Lifecycle State Machine
 * Supports progressive break-even rules & lifecycle event logging.
 */

import type {
    ProSignal,
    SignalEvent,
    SignalStatus,
    TakeProfitTarget,
} from "../types";

export interface StateTransitionResult {
    updatedSignal: ProSignal;
    newEvent: SignalEvent | null;
    transitioned: boolean;
}

export function transitionSignalState(
    signal: ProSignal,
    eventType:
        | "TRIGGER_ENTRY"
        | "HIT_TP"
        | "MOVE_SL"
        | "MOVE_BE"
        | "HIT_SL"
        | "EXPIRE"
        | "CANCEL"
        | "CLOSE_SIGNAL"
        | "CLOSE_HALF",
    eventData?: {
        price?: number;
        tpIndex?: number;
        newStopLoss?: number;
        reason?: string;
    }
): StateTransitionResult {
    const now = Date.now();
    let newStatus: SignalStatus = signal.status;
    let transitioned = false;

    // Terminal check: if already closed, stopped, expired, or cancelled, no state changes allowed unless unclose
    const isTerminal = ["CLOSED", "STOPPED", "EXPIRED", "CANCELLED"].includes(signal.status);
    if (isTerminal && eventType !== "CLOSE_SIGNAL") {
        return { updatedSignal: signal, newEvent: null, transitioned: false };
    }

    const updatedTps: TakeProfitTarget[] = signal.takeProfits.map((tp) => ({ ...tp }));
    let updatedStopLoss = signal.stopLoss;

    switch (eventType) {
        case "TRIGGER_ENTRY":
            if (signal.status === "CREATED" || signal.status === "PENDING_ENTRY") {
                newStatus = "ENTRY_TRIGGERED";
                transitioned = true;
            }
            break;

        case "HIT_TP": {
            const tpIndex = eventData?.tpIndex || 1;
            const targetTp = updatedTps.find((t) => t.index === tpIndex);
            if (targetTp) {
                targetTp.hit = true;
                targetTp.hitAt = now;
            }

            if (tpIndex === 1) {
                newStatus = "TP1_HIT";
                // Progressive BE: Move SL to Entry Midpoint on TP1 Hit (§16)
                updatedStopLoss = signal.entry || (signal.entryMin + signal.entryMax) / 2;
            } else if (tpIndex === 2) {
                newStatus = "TP2_HIT";
                // Progressive BE: Move SL to TP1 on TP2 Hit
                const tp1 = updatedTps.find((t) => t.index === 1);
                if (tp1?.price) updatedStopLoss = tp1.price;
            } else if (tpIndex === 3) {
                newStatus = "TP3_HIT";
                // Progressive BE: Move SL to TP2 on TP3 Hit
                const tp2 = updatedTps.find((t) => t.index === 2);
                if (tp2?.price) updatedStopLoss = tp2.price;
            } else if (tpIndex === 4) {
                newStatus = "TP4_HIT";
            } else if (tpIndex >= 5 || targetTp?.type === "OPEN") {
                newStatus = "TP5_OPEN_RUNNER";
            }

            // If all numeric price TPs hit, mark signal as CLOSED
            const allPriceTpHit = updatedTps
                .filter((t) => t.type === "PRICE")
                .every((t) => t.hit);

            if (allPriceTpHit && updatedTps.length > 0 && !signal.openTarget) {
                newStatus = "CLOSED";
            }
            transitioned = true;
            break;
        }

        case "MOVE_BE":
            newStatus = "BE_PROFIT_LOCK";
            updatedStopLoss = signal.entry || (signal.entryMin + signal.entryMax) / 2;
            transitioned = true;
            break;

        case "MOVE_SL":
            if (eventData?.newStopLoss) {
                updatedStopLoss = eventData.newStopLoss;
                transitioned = true;
            }
            break;

        case "HIT_SL":
            newStatus = "STOPPED";
            transitioned = true;
            break;

        case "CLOSE_SIGNAL":
            newStatus = "CLOSED";
            transitioned = true;
            break;

        case "CANCEL":
            newStatus = "CANCELLED";
            transitioned = true;
            break;

        case "EXPIRE":
            // Expiration only applies if trade has NOT entered
            if (signal.status === "CREATED" || signal.status === "PENDING_ENTRY") {
                newStatus = "EXPIRED";
                transitioned = true;
            }
            break;
    }

    if (!transitioned) {
        return { updatedSignal: signal, newEvent: null, transitioned: false };
    }

    const eventId = `evt_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const newEvent: SignalEvent = {
        id: eventId,
        signalId: signal.id,
        type: eventType,
        timestamp: now,
        price: eventData?.price ?? null,
        metadata: {
            fromStatus: signal.status,
            toStatus: newStatus,
            tpIndex: eventData?.tpIndex,
            newStopLoss: updatedStopLoss,
            reason: eventData?.reason,
        },
    };

    const updatedSignal: ProSignal = {
        ...signal,
        status: newStatus,
        stopLoss: updatedStopLoss,
        takeProfits: updatedTps,
        events: [...signal.events, newEvent],
        lastUpdateAt: now,
    };

    return { updatedSignal, newEvent, transitioned: true };
}
