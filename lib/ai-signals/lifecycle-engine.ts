import { adminDatabase } from "@/lib/firebase-admin";
import { SignalStatus, SignalTimelineEvent, SignalEvent, AISignal } from "@/lib/ai-signals/types";
import type { ProSignal, SignalEvent as ProSignalEvent } from "@/features/telegram-signals/types";
import { recordSignalEvent } from "./events";

export type LifecycleEventType =
    | "SIGNAL_CREATED"
    | "SIGNAL_UPDATED"
    | "NEW_SIGNAL"
    | "ENTRY_TRIGGERED"
    | "TP1_REACHED"
    | "TP2_REACHED"
    | "TP3_REACHED"
    | "TP4_REACHED"
    | "TP5_REACHED"
    | "SL_HIT"
    | "BREAKEVEN"
    | "PROFIT_LOCK"
    | "SIGNAL_EXPIRED"
    | "SIGNAL_CANCELLED"
    | "SIGNAL_CLOSED"
    | "SIGNAL_INVALIDATED"
    | "SIGNAL_STALE";

export interface LifecycleTransition {
    fromStatus: SignalStatus | SignalStatus[];
    eventType: LifecycleEventType;
    toStatus: SignalStatus;
    timestamp?: number;
    metadata?: Record<string, unknown>;
}

export interface LifecycleStateResult {
    signal: AISignal;
    transition: {
        from: SignalStatus;
        to: SignalStatus;
        eventType: LifecycleEventType;
        timestamp: number;
        succeeded: boolean;
    };
    newEvent?: SignalTimelineEvent;
}

const LIFECYCLE_RULES: LifecycleTransition[] = [
    { fromStatus: ["NEW", "READY"], eventType: "ENTRY_TRIGGERED", toStatus: "ENTRY_TRIGGERED" },
    { fromStatus: "ENTRY_TRIGGERED", eventType: "NEW_SIGNAL", toStatus: "ACTIVE" },
    { fromStatus: "ACTIVE", eventType: "TP1_REACHED", toStatus: "TP1_REACHED" },
    { fromStatus: "TP1_REACHED", eventType: "TP2_REACHED", toStatus: "TP2_REACHED" },
    { fromStatus: "TP2_REACHED", eventType: "TP3_REACHED", toStatus: "TP3_REACHED" },
    { fromStatus: "TP3_REACHED", eventType: "TP4_REACHED", toStatus: "TP4_REACHED" },
    { fromStatus: "TP4_REACHED", eventType: "TP5_REACHED", toStatus: "TP5_REACHED" },
    { fromStatus: "TP1_REACHED", eventType: "BREAKEVEN", toStatus: "ACTIVE" },
    { fromStatus: "TP2_REACHED", eventType: "PROFIT_LOCK", toStatus: "ACTIVE" },
    { fromStatus: "ACTIVE", eventType: "SIGNAL_STALE", toStatus: "STALE" },
    { fromStatus: ["ACTIVE", "TP1_REACHED", "TP2_REACHED", "TP3_REACHED", "TP4_REACHED", "TP5_REACHED", "STALE"], eventType: "SIGNAL_INVALIDATED", toStatus: "INVALIDATED" },
    { fromStatus: ["ACTIVE", "TP1_REACHED", "TP2_REACHED", "TP3_REACHED", "TP4_REACHED", "TP5_REACHED", "STALE", "INVALIDATED"], eventType: "SIGNAL_EXPIRED", toStatus: "EXPIRED" },
    { fromStatus: ["ACTIVE", "TP1_REACHED", "TP2_REACHED", "TP3_REACHED", "TP4_REACHED", "TP5_REACHED", "STALE", "INVALIDATED", "EXPIRED"], eventType: "SL_HIT", toStatus: "STOPPED_OUT" },
    { fromStatus: ["ACTIVE", "TP1_REACHED", "TP2_REACHED", "TP3_REACHED", "TP4_REACHED", "TP5_REACHED", "STALE", "INVALIDATED", "EXPIRED", "STOPPED_OUT"], eventType: "SIGNAL_CLOSED", toStatus: "CLOSED" },
    { fromStatus: ["NEW", "READY", "PENDING_ENTRY"], eventType: "SIGNAL_CANCELLED", toStatus: "CANCELLED" },
    { fromStatus: "PENDING_ENTRY", eventType: "ENTRY_TRIGGERED", toStatus: "ACTIVE" },
];

const TERMINAL_STATUSES: SignalStatus[] = [
    "CLOSED", "STOPPED_OUT", "EXPIRED", "CANCELLED", "INVALIDATED", "OUTCOME_AMBIGUOUS",
];

export function isTerminalStatus(status: SignalStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
}

export async function transitionSignalLifecycle(
    signal: AISignal,
    eventType: LifecycleEventType,
    metadata?: Record<string, unknown>
): Promise<LifecycleStateResult> {
    const now = Date.now();

    if (isTerminalStatus(signal.status) && eventType !== "SIGNAL_UPDATED") {
        return {
            signal,
            transition: {
                from: signal.status,
                to: signal.status,
                eventType,
                timestamp: now,
                succeeded: false,
            },
        };
    }

    const validTransitions = LIFECYCLE_RULES.filter(
        (rule) =>
            rule.eventType === eventType &&
            (Array.isArray(rule.fromStatus)
                ? rule.fromStatus.includes(signal.status)
                : rule.fromStatus === signal.status)
    );

    if (validTransitions.length === 0) {
        return {
            signal,
            transition: {
                from: signal.status,
                to: signal.status,
                eventType,
                timestamp: now,
                succeeded: false,
            },
        };
    }

    const rule = validTransitions[0];
    const prevStatus = signal.status;

    const event: SignalTimelineEvent = {
        id: `evt_${signal.id}_${eventType}_${now}`,
        timestamp: now,
        // The timeline type taxonomy and LifecycleEventType overlap but are not
        // identical; the event string is intentionally preserved as-is.
        type: eventType as unknown as SignalTimelineEvent["type"],
        message: `${eventType}: ${prevStatus} → ${rule.toStatus}`,
        metadata: {
            signalId: signal.id,
            fromStatus: prevStatus,
            toStatus: rule.toStatus,
            ...metadata,
        },
    };

    const updated: AISignal = {
        ...signal,
        status: rule.toStatus,
        updatedAt: now,
        timeline: [...(signal.timeline || []), event],
    };

    if (eventType === "ENTRY_TRIGGERED") {
        updated.entryTriggeredAt = now;
    }

    if (eventType === "TP1_REACHED") {
        updated.tp1Hit = true;
        updated.tp1HitAt = now;
        updated.tp1HitPrice = metadata?.price as number;
    }
    if (eventType === "TP2_REACHED") {
        updated.tp2Hit = true;
        updated.tp2HitAt = now;
        updated.tp2HitPrice = metadata?.price as number;
    }
    if (eventType === "TP3_REACHED") {
        updated.tp3Hit = true;
        updated.tp3HitAt = now;
        updated.tp3HitPrice = metadata?.price as number;
    }
    if (eventType === "SL_HIT") {
        updated.stopLossReachedAt = now;
        updated.closedAt = now;
    }
    if (eventType === "SIGNAL_CLOSED") {
        updated.closedAt = now;
    }
    if (eventType === "SIGNAL_EXPIRED") {
        updated.expiredAt = now;
    }
    if (eventType === "SIGNAL_CANCELLED") {
        updated.cancelledAt = now;
    }
    if (eventType === "SIGNAL_INVALIDATED") {
        updated.invalidatedAt = now;
    }
    if (eventType === "SIGNAL_STALE") {
        updated.statusMessage = "Signal marked stale — market data aged beyond threshold";
    }

    if (eventType === "BREAKEVEN") {
        updated.timeline = updated.timeline.map((t) =>
            t.type === "STATUS_CHANGE" && t.timestamp === now
                ? { ...t, message: "SL moved to breakeven" }
                : t
        );
    }

    if (eventType === "PROFIT_LOCK") {
        updated.timeline = updated.timeline.map((t) =>
            t.type === "STATUS_CHANGE" && t.timestamp === now
                ? { ...t, message: "Profit lock activated" }
                : t
        );
    }

    await adminDatabase.ref(`aiSignals/${signal.id}`).update({
        status: rule.toStatus,
        updatedAt: now,
        entryTriggeredAt: updated.entryTriggeredAt,
        actualEntryPrice: updated.actualEntryPrice,
        tp1Hit: updated.tp1Hit,
        tp1HitAt: updated.tp1HitAt,
        tp2Hit: updated.tp2Hit,
        tp2HitAt: updated.tp2HitAt,
        tp3Hit: updated.tp3Hit,
        tp3HitAt: updated.tp3HitAt,
        stopLossReachedAt: updated.stopLossReachedAt,
        closedAt: updated.closedAt,
        expiredAt: updated.expiredAt,
        cancelledAt: updated.cancelledAt,
        invalidatedAt: updated.invalidatedAt,
        statusMessage: updated.statusMessage,
        timeline: updated.timeline,
    });

    await recordSignalEvent(
        { id: signal.id },
        // Stored event log uses its own taxonomy; preserve the lifecycle string.
        eventType as unknown as SignalEvent["eventType"],
        metadata?.price as number,
        metadata
    );

    return {
        signal: updated,
        transition: {
            from: prevStatus,
            to: rule.toStatus,
            eventType,
            timestamp: now,
            succeeded: true,
        },
        newEvent: event,
    };
}

export async function transitionProSignalLifecycle(
    signal: ProSignal,
    eventType: string,
    eventData?: { price?: number; tpIndex?: number; newStopLoss?: number; reason?: string }
): Promise<{ updatedSignal: ProSignal; newEvent: ProSignalEvent | null; transitioned: boolean }> {
    const now = Date.now();
    let newStatus = signal.status;
    let transitioned = false;
    let newEvent: ProSignalEvent | null = null;

    const isTerminal = ["CLOSED", "STOPPED", "EXPIRED", "CANCELLED"].includes(signal.status);
    if (isTerminal && eventType !== "CLOSE_SIGNAL") {
        return { updatedSignal: signal, newEvent: null, transitioned: false };
    }

    switch (eventType) {
        case "TRIGGER_ENTRY":
            if (signal.status === "CREATED" || signal.status === "PENDING_ENTRY") {
                newStatus = "ENTRY_TRIGGERED";
                transitioned = true;
            }
            break;
        case "HIT_TP": {
            const tpIndex = eventData?.tpIndex || 1;
            if (signal.takeProfits) {
                const targetTp = signal.takeProfits.find((t) => t.index === tpIndex);
                if (targetTp) {
                    targetTp.hit = true;
                    targetTp.hitAt = now;
                }
            }
            if (tpIndex === 1) newStatus = "TP1_HIT";
            else if (tpIndex === 2) newStatus = "TP2_HIT";
            else if (tpIndex === 3) newStatus = "TP3_HIT";
            else if (tpIndex === 4) newStatus = "TP4_HIT";
            else if (tpIndex >= 5) newStatus = "TP5_OPEN_RUNNER";
            if (signal.takeProfits?.every((t) => t.hit)) newStatus = "CLOSED";
            transitioned = true;
            break;
        }
        case "MOVE_BE":
            newStatus = "BE_PROFIT_LOCK";
            transitioned = true;
            break;
        case "MOVE_SL":
            if (eventData?.newStopLoss) {
                signal.stopLoss = eventData.newStopLoss;
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
    newEvent = {
        id: eventId,
        signalId: signal.id,
        type: eventType,
        timestamp: now,
        price: eventData?.price ?? null,
        metadata: {
            fromStatus: signal.status,
            toStatus: newStatus,
            tpIndex: eventData?.tpIndex,
            newStopLoss: eventData?.newStopLoss,
            reason: eventData?.reason,
        },
    };

    const updatedSignal = {
        ...signal,
        status: newStatus,
        lastUpdateAt: now,
        events: [...(signal.events || []), newEvent],
    };

    return { updatedSignal, newEvent, transitioned: true };
}