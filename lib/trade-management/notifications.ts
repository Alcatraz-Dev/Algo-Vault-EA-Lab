import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { isEmailConfigured, sendEmail as sendEmailViaProvider } from "@/lib/email";
import { NotificationPayload, NotificationResult, NotificationChannel } from "./types";

// ============================================
// NOTIFICATION SERVICE ABSTRACTION
// ============================================
// This service is channel-agnostic.
// Add new channels by implementing the send function.

type SendFn = (userId: string, payload: NotificationPayload) => Promise<NotificationResult>;

const channelSenders: Record<NotificationChannel, SendFn> = {
    in_app: sendInApp,
    discord: sendDiscord,
    telegram: sendTelegram,
    email: sendEmail,
    push: sendPush,
};

export async function sendNotification(
    payload: NotificationPayload
): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    for (const channel of payload.channels) {
        try {
            const sender = channelSenders[channel];
            if (!sender) {
                results.push({ channelId: channel, status: "skipped", error: "Channel not implemented" });
                continue;
            }
            const result = await sender(payload.userId, payload);
            results.push(result);
        } catch (err) {
            results.push({
                channelId: channel,
                status: "failed",
                error: err instanceof Error ? err.message : "Unknown error",
            });
        }
    }

    // Always save to in-app if not already included
    if (!payload.channels.includes("in_app")) {
        try {
            const result = await sendInApp(payload.userId, payload);
            results.push(result);
        } catch {}
    }

    return results;
}

// ============================================
// IN-APP NOTIFICATION
// ============================================

async function sendInApp(userId: string, payload: NotificationPayload): Promise<NotificationResult> {
    try {
        const notifRef = adminDatabase.ref(`notifications/${userId}`).push();
        await notifRef.set({
            notificationId: notifRef.key,
            title: payload.title,
            message: payload.message,
            severity: payload.severity,
            link: payload.link || "/alerts",
            event: payload.event,
            symbol: payload.symbol,
            direction: payload.direction,
            metadata: payload.metadata || {},
            read: false,
            createdAt: Date.now(),
        });

        return { channelId: "in_app", status: "sent" };
    } catch (err) {
        return { channelId: "in_app", status: "failed", error: String(err) };
    }
}

// ============================================
// DISCORD NOTIFICATION
// ============================================

async function sendDiscord(userId: string, payload: NotificationPayload): Promise<NotificationResult> {
    try {
        // Read user's Discord webhook
        const userSnap = await adminDatabase.ref(`users/${userId}`).get();
        const userData = userSnap.val();
        const webhookUrl = userData?.discordWebhook || process.env.DISCORD_WEBHOOK_URL;

        if (!webhookUrl) {
            return { channelId: "discord", status: "skipped", error: "No webhook configured" };
        }

        const color = payload.severity === "success" ? 0x10b981
            : payload.severity === "warning" ? 0xf59e0b
            : payload.severity === "error" ? 0xef4444
            : 0x8b5cf6;

        const embed = {
            title: payload.title,
            description: payload.message,
            color,
            fields: [],
            timestamp: new Date().toISOString(),
        };

        if (payload.symbol) {
            (embed.fields as Array<{ name: string; value: string; inline: boolean }>).push(
                { name: "Symbol", value: payload.symbol, inline: true },
                { name: "Direction", value: payload.direction || "N/A", inline: true }
            );
        }

        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed] }),
        });

        return { channelId: "discord", status: res.ok ? "sent" : "failed", error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (err) {
        return { channelId: "discord", status: "failed", error: String(err) };
    }
}

// ============================================
// TELEGRAM NOTIFICATION
// ============================================

async function sendTelegram(userId: string, payload: NotificationPayload): Promise<NotificationResult> {
    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) return { channelId: "telegram", status: "skipped", error: "No bot token" };

        const userSnap = await adminDatabase.ref(`users/${userId}`).get();
        const userData = userSnap.val();
        const chatId = userData?.telegramChatId;

        if (!chatId) return { channelId: "telegram", status: "skipped", error: "No chat ID" };

        const text = `*${payload.title}*\n\n${payload.message}`;
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
        });

        return { channelId: "telegram", status: res.ok ? "sent" : "failed" };
    } catch (err) {
        return { channelId: "telegram", status: "failed", error: String(err) };
    }
}

// ============================================
// EMAIL NOTIFICATION
// ============================================

async function sendEmail(userId: string, payload: NotificationPayload): Promise<NotificationResult> {
    try {
        if (!isEmailConfigured()) {
            return { channelId: "email", status: "skipped", error: "Email provider not configured" };
        }

        const userSnap = await adminDatabase.ref(`users/${userId}`).get();
        const userData = userSnap.val();
        let to = String(userData?.email || "").trim();
        if (!to) {
            try {
                const firebaseUser = await adminAuth.getUser(userId);
                to = String(firebaseUser.email || "").trim();
            } catch {}
        }
        if (!to) {
            return { channelId: "email", status: "skipped", error: "No email address on file" };
        }

        const result = await sendEmailViaProvider({
            to,
            subject: payload.title,
            text: payload.message + (payload.link ? `\n\n${payload.link}` : ""),
        });

        return {
            channelId: "email",
            status: result.ok ? "sent" : "failed",
            error: result.ok ? undefined : result.error,
        };
    } catch (err) {
        return { channelId: "email", status: "failed", error: String(err) };
    }
}

// ============================================
// PUSH NOTIFICATION (STUB)
// ============================================

async function sendPush(userId: string, payload: NotificationPayload): Promise<NotificationResult> {
    // TODO: Integrate with FCM or Web Push
    return { channelId: "push", status: "skipped", error: "Not yet implemented" };
}
