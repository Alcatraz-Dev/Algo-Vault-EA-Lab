/**
 * AlgoVault Pro Signal Intelligence - Notification Engine
 * Reuses existing lib/notifications.ts notifyUser for delivery.
 * Implements deduplication, retry handling, and event preference filtering.
 */

import { adminDatabase } from "@/lib/firebase-admin";
import { notifyUser } from "@/lib/notifications";
import { sanitizeForFirebase } from "../utils/firebase";
import type { ProSignal, SignalEvent, UserProSignalSettings } from "../types";

export interface DeliverSignalNotificationInput {
    userId: string;
    signal: ProSignal;
    event: SignalEvent;
    userSettings?: UserProSignalSettings;
}

export async function dispatchSignalNotification(
    input: DeliverSignalNotificationInput
): Promise<{ success: boolean; deliveredChannels: string[] }> {
    const { userId, signal, event, userSettings } = input;
    const deliveredChannels: string[] = [];

    // 1. Check event type preference if user settings are present
    if (userSettings && userSettings.notificationsEnabled === false) {
        return { success: false, deliveredChannels: [] };
    }

    const eventKey = mapEventTypeToSubscriptionKey(event.type);
    if (
        userSettings?.eventSubscriptions &&
        eventKey &&
        userSettings.eventSubscriptions[eventKey] === false
    ) {
        return { success: false, deliveredChannels: [] };
    }

    // 2. Deduplication Check (§30)
    const deliveryId = `${event.id}_${userId}`;
    const deliveryRef = adminDatabase.ref(`telegramNotificationDeliveries/${userId}/${deliveryId}`);
    const existingSnap = await deliveryRef.get();

    if (existingSnap.exists()) {
        const existing = existingSnap.val();
        if (existing.status === "SENT") {
            return { success: true, deliveredChannels: existing.channels || [] };
        }
    }

    // 3. Construct clean user-facing notification payload (§18, §27, §28)
    const title = formatEventTitle(signal, event);
    const message = formatEventBody(signal, event);

    await deliveryRef.set({
        id: deliveryId,
        eventId: event.id,
        signalId: signal.id,
        userId,
        status: "PENDING",
        attempts: 1,
        createdAt: Date.now(),
    });

    try {
        // Dispatch via lib/notifications.ts notifyUser (handles In-App, Telegram Bot, Discord)
        const result = await notifyUser(userId, {
            title,
            message,
            level: event.type.includes("SL") || event.type.includes("CANCEL") ? "warning" : "success",
            link: `/signals/pro?id=${signal.id}`,
        });

        const status = result.status === "delivered" ? "SENT" : "FAILED";

        await deliveryRef.update({
            status,
            channels: result.channels,
            sentAt: Date.now(),
            results: result.results,
        });

        return {
            success: result.status === "delivered",
            deliveredChannels: result.channels,
        };
    } catch (err) {
        console.error("[dispatchSignalNotification]", err);
        await deliveryRef.update({
            status: "FAILED",
            error: err instanceof Error ? err.message : "Notification dispatch failed",
        });

        return { success: false, deliveredChannels: [] };
    }
}

export async function broadcastSignalNotificationToProUsers(
    signal: ProSignal,
    event: SignalEvent
): Promise<{ totalProcessed: number; deliveredCount: number }> {
    const usersSnap = await adminDatabase.ref("users").once("value");
    if (!usersSnap.exists()) {
        return { totalProcessed: 0, deliveredCount: 0 };
    }

    const usersData = usersSnap.val();
    const eligibleUserIds = Object.keys(usersData).filter((uid) => {
        const userData = usersData[uid] || {};
        const sub = userData.subscription || {};
        const isProUser =
            sub.status === "active" && (sub.plan === "pro" || sub.plan === "enterprise");
        const hasBotConnected = Boolean(
            userData.telegramChatId || userData.telegramUsername || userData.discordWebhook
        );
        return isProUser || hasBotConnected;
    });

    const cleanSignal = sanitizeForFirebase(signal);
    let deliveredCount = 0;

    for (const uid of eligibleUserIds) {
        try {
            await adminDatabase.ref(`telegramSignals/${uid}/${cleanSignal.id}`).set(cleanSignal);

            const res = await dispatchSignalNotification({
                userId: uid,
                signal: cleanSignal,
                event,
                userSettings: usersData[uid]?.proSignalSettings,
            });

            if (res.success) {
                deliveredCount++;
            }
        } catch (err) {
            console.error(`[broadcastSignalNotificationToProUsers] user ${uid}`, err);
        }
    }

    return { totalProcessed: eligibleUserIds.length, deliveredCount };
}

function mapEventTypeToSubscriptionKey(
    type: string
): keyof UserProSignalSettings["eventSubscriptions"] | null {
    switch (type) {
        case "CREATED":
            return "NEW_SIGNAL";
        case "TRIGGER_ENTRY":
            return "ENTRY_TRIGGERED";
        case "TP1_HIT":
            return "TP1_HIT";
        case "TP2_HIT":
            return "TP2_HIT";
        case "TP3_HIT":
            return "TP3_HIT";
        case "TP4_HIT":
            return "TP4_HIT";
        case "TP5_OPEN_RUNNER":
            return "TP5_HIT";
        case "HIT_SL":
            return "SL_HIT";
        case "MOVE_BE":
            return "BREAKEVEN";
        case "EXPIRE":
            return "SIGNAL_EXPIRED";
        case "CANCEL":
            return "SIGNAL_CANCELLED";
        default:
            return "SIGNAL_UPDATED";
    }
}

function formatEventTitle(signal: ProSignal, event: SignalEvent): string {
    const directionEmoji = signal.direction === "BUY" ? "🟢" : "🔴";
    switch (event.type) {
        case "CREATED":
            return `AlgoVault Pro Signal: ${directionEmoji} ${signal.symbol} ${signal.direction}`;
        case "TP1_HIT":
            return `🎯 TP1 HIT: ${signal.symbol} ${signal.direction}`;
        case "TP2_HIT":
            return `🎯 TP2 HIT: ${signal.symbol} ${signal.direction}`;
        case "TP3_HIT":
            return `🎯 TP3 HIT: ${signal.symbol} ${signal.direction}`;
        case "HIT_SL":
            return `🛑 Stop Loss Hit: ${signal.symbol} ${signal.direction}`;
        case "MOVE_BE":
            return `🔒 Move SL to Breakeven: ${signal.symbol}`;
        case "EXPIRE":
            return `⏱ Signal Expired: ${signal.symbol}`;
        default:
            return `AlgoVault Pro Update: ${signal.symbol}`;
    }
}

function formatEventBody(signal: ProSignal, event: SignalEvent): string {
    const tpList = signal.takeProfits
        .map(
            (tp) =>
                `TP${tp.index}: ${tp.type === "OPEN" ? "OPEN RUNNER" : tp.price} ${tp.hit ? "✓" : ""}`
        )
        .join("\n");

    return (
        `Entry: ${signal.entryMin}${signal.entryMax !== signal.entryMin ? ` - ${signal.entryMax}` : ""}\n` +
        `SL: ${signal.stopLoss}\n\n` +
        `Targets:\n${tpList}\n\n` +
        `Style: ${signal.style} (${signal.timeframe})`
    );
}

