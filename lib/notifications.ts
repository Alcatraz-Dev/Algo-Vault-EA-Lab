import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { isEmailConfigured, sendEmail } from "@/lib/email";

export type NotifyPayload = {
    title: string;
    message: string;
    level?: "info" | "success" | "warning" | "error";
    link?: string;
};

export type NotifyChannel = "discord" | "telegram" | "email";

type NotifPrefs = {
    email?: string;
    emailTradeAlerts?: boolean;
    emailWeeklyDigest?: boolean;
    emailSecurityAlerts?: boolean;
    discordUsername?: string;
    telegramUsername?: string;
    discordWebhook?: string;
    telegramChatId?: string;
};

export type NotifyDeliveryResult = {
    channel: NotifyChannel;
    ok: boolean;
    source?: "user_webhook" | "server_webhook" | "bot" | "email";
    error?: string;
};

export type NotifyAudit = {
    status: "delivered" | "failed" | "no_channel";
    channels: string[];
    results: NotifyDeliveryResult[];
};

const LEVEL_EMOJI: Record<Exclude<NotifyPayload["level"], undefined>, string> = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "🔴",
};

// Cache of resolved Telegram chat IDs per username (avoid hammering getUpdates).
const chatCache = new Map<string, { chatId: number; expiresAt: number }>();
const CHAT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function formatText(payload: NotifyPayload) {
    const emoji = LEVEL_EMOJI[payload.level ?? "info"];
    let text = `${emoji} ${payload.title}\n\n${payload.message}`;
    if (payload.link) text += `\n\n🔗 ${payload.link}`;
    return text;
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function renderEmailHtml(payload: NotifyPayload) {
    const emoji = LEVEL_EMOJI[payload.level ?? "info"];
    const link = payload.link
        ? `<p style="margin:16px 0 0"><a href="${escapeHtml(payload.link)}" style="color:#7c3aed">${escapeHtml(payload.link)}</a></p>`
        : "";
    return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 12px;font-size:18px;color:#111827">${emoji} ${escapeHtml(payload.title)}</h2>
  <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;white-space:pre-line">${escapeHtml(payload.message)}</p>
  ${link}
  <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
  <p style="margin:0;font-size:12px;color:#9ca3af">AlgoVault Alerts</p>
</div>`;
}

/**
 * Resolves a Telegram chat ID for a @username.
 *
 * The bot can only message users who have started a chat with it. We look the
 * username up in the bot's recent updates and reuse the discovered chat ID so
 * username-only connections work without asking for a numeric chat ID.
 *
 * Returns the chat id number or null when the user hasn't started the bot yet.
 */
async function resolveTelegramChatId(
    token: string,
    username: string
): Promise<number | null> {
    const normalized = username.replace(/^@/, "").toLowerCase();
    if (!normalized) return null;

    const cached = chatCache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) return cached.chatId;

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timeout: 0, limit: 100 }),
            cache: "no-store",
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { ok: boolean; result?: Array<{ message?: { chat?: { id?: number } } }> };

        if (!data.ok) return null;

        for (const update of data.result ?? []) {
            const chat = update.message?.chat;
            if (chat && chat.id) {
                chatCache.set(normalized, { chatId: chat.id, expiresAt: Date.now() + CHAT_CACHE_TTL_MS });
                return chat.id;
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Sends a Telegram message. Uses an explicit chat ID when provided, otherwise
 * resolves the user's chat from their @username.
 *
 * Returns { ok, reason } — reason explains why delivery failed so the audit
 * trail stays useful ("bot token missing", "start the bot first", etc.).
 */
async function sendTelegram(chatId: string, username: string, payload: NotifyPayload) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        return { ok: false, reason: "TELEGRAM_BOT_TOKEN not configured on the server." };
    }

    let target = chatId.trim();
    let sent = false;

    if (target) {
        sent = true;
    } else {
        const resolved = await resolveTelegramChatId(token, username);
        if (resolved) {
            target = String(resolved);
            sent = true;
        }
    }

    if (!sent) {
        return { ok: false, reason: "@" + username.replace(/^@/, "") + " hasn't started the bot yet." };
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: target, text: formatText(payload) }),
        cache: "no-store",
    });

    if (!res.ok) {
        const message = (await res.json().catch(() => ({}))) as { description?: string };
        return { ok: false, reason: message.description || `Telegram send failed (${res.status}).` };
    }

    return { ok: true, reason: "" };
}

async function sendDiscord(webhookUrl: string, payload: NotifyPayload) {
    const emoji = LEVEL_EMOJI[payload.level ?? "info"];
    const content = `${emoji} **${payload.title}**\n${payload.message}${payload.link ? `\n🔗 ${payload.link}` : ""}`;

    const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        cache: "no-store",
    });

    if (!res.ok) {
        const message = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(message.message || `Discord send failed (${res.status}).`);
    }
}

export function getServerDiscordWebhookUrl() {
    return String(process.env.DISCORD_WEBHOOK_URL || process.env.DISCROD_WEBHOOK_URL || "").trim();
}

/**
 * Server-side notification dispatcher.
 *
 * Reads the user's notification settings (users/{uid}) and delivers the
 * payload through every connected channel:
 *  - Discord: uses the user's Discord webhook URL, falling back to the
 *    server webhook in DISCORD_WEBHOOK_URL / DISCROD_WEBHOOK_URL.
 *  - Telegram: uses the Telegram bot (TELEGRAM_BOT_TOKEN) and the user's
 *    chat ID or @username.
 *
 * Also records and returns a delivery audit so it can be verified from the
 * settings page. Never throws — all failures are logged.
 */
export async function notifyUser(
    uid: string,
    payload: NotifyPayload,
    options?: { channels?: NotifyChannel[] }
): Promise<NotifyAudit> {
    const results: NotifyDeliveryResult[] = [];
    const allowed = options?.channels;

    const shouldSend = (channel: NotifyChannel): boolean =>
        !allowed || allowed.includes(channel);

    try {
        const snapshot = await adminDatabase.ref(`users/${uid}`).once("value");
        const prefs = (snapshot.val() || {}) as NotifPrefs;

        const userDiscordWebhook = String(prefs.discordWebhook || "").trim();
        const serverDiscordWebhook = getServerDiscordWebhookUrl();
        const discordWebhook = userDiscordWebhook || serverDiscordWebhook;
        const telegramChat = String(prefs.telegramChatId || "").trim();
        const telegramUsername = String(prefs.telegramUsername || "").trim();
        const hasTelegramTarget = Boolean(telegramChat || telegramUsername);

        if (shouldSend("discord") && discordWebhook) {
            try {
                await sendDiscord(discordWebhook, payload);
                results.push({
                    channel: "discord",
                    ok: true,
                    source: userDiscordWebhook ? "user_webhook" : "server_webhook",
                });
            } catch (err) {
                results.push({
                    channel: "discord",
                    ok: false,
                    source: userDiscordWebhook ? "user_webhook" : "server_webhook",
                    error: err instanceof Error ? err.message : "Discord send failed.",
                });
            }
        } else if (prefs.discordUsername) {
            results.push({
                channel: "discord",
                ok: false,
                error: "Only the username is set — Discord needs a webhook URL to deliver alerts.",
            });
        }

        if (shouldSend("telegram") && hasTelegramTarget) {
            if (!process.env.TELEGRAM_BOT_TOKEN) {
                results.push({
                    channel: "telegram",
                    ok: false,
                    source: "bot",
                    error: "TELEGRAM_BOT_TOKEN not configured on the server.",
                });
            } else {
                try {
                    const out = await sendTelegram(telegramChat, telegramUsername, payload);
                    results.push({
                        channel: "telegram",
                        ok: out.ok,
                        source: "bot",
                        error: out.ok ? undefined : out.reason,
                    });
                } catch (err) {
                    results.push({
                        channel: "telegram",
                        ok: false,
                        source: "bot",
                        error: err instanceof Error ? err.message : "Telegram send failed.",
                    });
                }
            }
        }

        // Email: only when explicitly requested by the caller, otherwise gated
        // behind the user's master "emailTradeAlerts" preference.
        const emailRequested = allowed ? allowed.includes("email") : prefs.emailTradeAlerts === true;
        if (emailRequested) {
            let recipient = String(prefs.email || "").trim();
            if (!recipient) {
                try {
                    const firebaseUser = await adminAuth.getUser(uid);
                    recipient = String(firebaseUser.email || "").trim();
                } catch {
                    // fall through to the "no address" result below
                }
            }

            if (!recipient) {
                results.push({
                    channel: "email",
                    ok: false,
                    source: "email",
                    error: "No email address is on file for this account.",
                });
            } else if (!isEmailConfigured()) {
                results.push({
                    channel: "email",
                    ok: false,
                    source: "email",
                    error: "Email is not configured on the server (set RESEND_API_KEY or SENDGRID_API_KEY).",
                });
            } else {
                try {
                    const out = await sendEmail({
                        to: recipient,
                        subject: `${LEVEL_EMOJI[payload.level ?? "info"]} ${payload.title}`,
                        text: formatText(payload),
                        html: renderEmailHtml(payload),
                    });
                    results.push({
                        channel: "email",
                        ok: out.ok,
                        source: "email",
                        error: out.ok ? undefined : out.error,
                    });
                } catch (err) {
                    results.push({
                        channel: "email",
                        ok: false,
                        source: "email",
                        error: err instanceof Error ? err.message : "Email send failed.",
                    });
                }
            }
        }
    } catch (error) {
        console.error("[notifyUser]", error);
    }

    const channels = results.map((r) => r.channel);
    const anySent = results.some((r) => r.ok);

    try {
        const eventRef = adminDatabase.ref(`notifications/${uid}`).push();
        if (eventRef.key) {
            await eventRef.set({
                title: payload.title,
                message: payload.message,
                level: payload.level ?? "info",
                link: payload.link || "",
                channels,
                status: results.length === 0 ? "no_channel" : anySent ? "sent" : "failed",
                results: results.map((r) => ({
                    channel: r.channel,
                    source: r.source || "",
                    status: r.ok ? "sent" : "failed",
                    error: r.error || "",
                })),
                createdAt: Date.now(),
            });
        }
    } catch (error) {
        console.error("[notifyUser:audit]", error);
    }

    return {
        status: results.length === 0 ? "no_channel" : anySent ? "delivered" : "failed",
        channels,
        results,
    };
}
