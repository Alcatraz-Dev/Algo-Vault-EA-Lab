import { AISignal } from "./types";
import { adminDatabase } from "@/lib/firebase-admin";
import { notifyUser } from "@/lib/notifications";

/**
 * Signal lifecycle notifications.
 *
 * Every notification is keyed by a unique (signalId, eventType) pair and is
 * never re-sent once the marker exists. Preferences live at
 * `signalPreferences/{uid}/<eventType>` (default: enabled). Recipients are
 * the user who generated the signal plus anyone who has followed it
 * (reverse index maintained at `signalFollowers/{signalId}/{uid}`).
 */

export const SIGNAL_NOTIFY_EVENTS = [
    "NEW_SIGNAL",
    "ENTRY_APPROACHING",
    "ENTRY_TRIGGERED",
    "TP1_HIT",
    "TP2_HIT",
    "TP3_HIT",
    "STOP_LOSS_HIT",
    "SIGNAL_EXPIRED",
] as const;

export type SignalNotifyEvent = (typeof SIGNAL_NOTIFY_EVENTS)[number];

const LEVEL: Record<SignalNotifyEvent, "info" | "success" | "warning" | "error"> = {
    NEW_SIGNAL: "success",
    ENTRY_APPROACHING: "info",
    ENTRY_TRIGGERED: "info",
    TP1_HIT: "success",
    TP2_HIT: "success",
    TP3_HIT: "success",
    STOP_LOSS_HIT: "error",
    SIGNAL_EXPIRED: "warning",
};

function buildTitle(eventType: SignalNotifyEvent, signal: AISignal): string {
    switch (eventType) {
        case "NEW_SIGNAL":
            return `New ${signal.symbol} signal`;
        case "TP1_HIT":
            return `${signal.symbol} TP1 reached`;
        case "TP2_HIT":
            return `${signal.symbol} TP2 reached`;
        case "TP3_HIT":
            return `${signal.symbol} TP3 reached`;
        case "STOP_LOSS_HIT":
            return `${signal.symbol} stop loss hit`;
        case "SIGNAL_EXPIRED":
            return `${signal.symbol} signal expired`;
        default:
            return `${signal.symbol} signal update`;
    }
}

function buildMessage(eventType: SignalNotifyEvent, signal: AISignal): string {
    const base = `${signal.direction} ${signal.symbol} @ M${signal.timeframe} (${signal.tier}) — confidence ${signal.confidence}%`;
    switch (eventType) {
        case "NEW_SIGNAL":
            return `${base}\nEntry: ${signal.entry} | SL: ${signal.stopLoss} | TP1: ${signal.tp1}`;
        case "STOP_LOSS_HIT":
            return `${base}\nPosition hit stop loss.`;
        case "SIGNAL_EXPIRED":
            return `${base}\nSetup validity window closed without activation.`;
        default:
            return `${base}\nLevel achieved — check the signal.`;
    }
}

async function getUserPreferences(uid: string): Promise<Partial<Record<SignalNotifyEvent, boolean>>> {
    try {
        const snap = await adminDatabase.ref(`signalPreferences/${uid}`).get();
        return (snap.val() || {}) as Partial<Record<SignalNotifyEvent, boolean>>;
    } catch {
        return {};
    }
}

async function getRecipientUids(signal: AISignal): Promise<string[]> {
    const uids = new Set<string>();
    if (signal.createdFor) uids.add(signal.createdFor);

    try {
        const snap = await adminDatabase.ref(`signalFollowers/${signal.id}`).get();
        if (snap.exists()) {
            const followers = snap.val() as Record<string, true>;
            Object.keys(followers).forEach((uid) => uids.add(uid));
        }
    } catch {
        // ignore
    }

    return [...uids];
}

async function hasSent(signalId: string, eventType: SignalNotifyEvent, uid: string): Promise<boolean> {
    try {
        const snap = await adminDatabase.ref(`signalNotifications/${signalId}/${eventType}/${uid}`).get();
        return snap.exists();
    } catch {
        return false;
    }
}

async function markSent(signalId: string, eventType: SignalNotifyEvent, uid: string): Promise<void> {
    await adminDatabase.ref(`signalNotifications/${signalId}/${eventType}/${uid}`).set({
        sentAt: Date.now(),
    });
}

/**
 * Notifies each eligible recipient for a signal lifecycle event.
 * Never throws; deduplicated per (signal, event, user).
 */
export async function notifySignalEvent(signal: AISignal, eventType: SignalNotifyEvent): Promise<number> {
    const uids = await getRecipientUids(signal);
    const preferences = await Promise.all(uids.map((uid) => getUserPreferences(uid)));

    let sent = 0;

    for (let i = 0; i < uids.length; i++) {
        const uid = uids[i];
        const prefs = preferences[i];
        const enabled = prefs[eventType] !== false;

        if (!enabled) continue;
        if (await hasSent(signal.id, eventType, uid)) continue;

        try {
            await notifyUser(uid, {
                title: buildTitle(eventType, signal),
                message: buildMessage(eventType, signal),
                level: LEVEL[eventType],
                link: `/signals/${signal.id}`,
            });
            await markSent(signal.id, eventType, uid);
            sent++;
        } catch (err) {
            console.error(`[notifySignalEvent] ${eventType} → ${uid}:`, err);
        }
    }

    return sent;
}