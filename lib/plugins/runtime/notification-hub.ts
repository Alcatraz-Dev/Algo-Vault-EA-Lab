import { adminDatabase } from "@/lib/firebase-admin";
import { notifyUser, NotifyChannel } from "@/lib/notifications";
import { PluginAlert, PluginConfig, PluginNotificationRecord } from "../types";

/**
 * Plugin Notification Hub.
 *
 * Every alert a plugin wants to deliver passes through here. The hub enforces:
 *  - cooldown (min. gap between alerts of the same plugin)
 *  - max alerts per day
 *  - quiet hours (no delivery in a configured window)
 *  - duplicate suppression (same content within the dedupe window is dropped)
 *  - severity levels
 *
 * Delivery reuses the existing AlgoVault notification stack (`notifyUser`):
 * in-app record + Telegram + Discord + email + optional user webhook.
 */

const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

export type DeliverPluginAlertInput = {
    userId: string;
    pluginId: string;
    pluginName: string;
    alert: PluginAlert;
    config: PluginConfig;
    link: string;
};

type DeliveryDecision = {
    allowed: boolean;
    reason: "ok" | "cooldown" | "quiet_hours" | "daily_limit" | "duplicate";
    detail?: string;
};

async function readPrefs(userId: string): Promise<Record<string, unknown>> {
    const snap = await adminDatabase.ref(`users/${userId}`).get();
    return (snap.val() || {}) as Record<string, unknown>;
}

function inQuietHours(config: PluginConfig, now: number): { quiet: boolean; detail: string } {
    const start = String(config.quietHoursStart || "").trim();
    const end = String(config.quietHoursEnd || "").trim();
    if (!start || !end) return { quiet: false, detail: "" };
    const toMin = (t: string) => {
        const [h, m] = t.split(":").map((n) => Number(n));
        return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    const nowMin = (new Date(now).getUTCHours() + 1 * 0) * 60 + new Date(now).getUTCMinutes();
    const s = toMin(start);
    const e = toMin(end);
    if (s === e) return { quiet: false, detail: "" };
    const inRange = s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
    return inRange ? { quiet: true, detail: `Quiet hours ${start}–${end} UTC are active.` } : { quiet: false, detail: "" };
}

function dailyBucket(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

async function shouldDeliver(userId: string, pluginId: string, alert: PluginAlert, config: PluginConfig, now: number): Promise<DeliveryDecision> {
    // Cooldown
    const cooldownMin = Math.max(1, Number(config.cooldownMin || 0));
    if (cooldownMin > 0) {
        const lastSnap = await adminDatabase.ref(`pluginAlertState/${userId}/${pluginId}/lastAlertAt`).get();
        const last = Number(lastSnap.val() || 0);
        if (last > 0 && now - last < cooldownMin * 60000) {
            return { allowed: false, reason: "cooldown", detail: `Cooldown of ${cooldownMin} min is active.` };
        }
    }

    // Quiet hours
    const quiet = inQuietHours(config, now);
    if (quiet.quiet) return { allowed: false, reason: "quiet_hours", detail: quiet.detail };

    // Daily limit
    const maxAlerts = Math.max(0, Number(config.maxAlertsPerDay || 0));
    if (maxAlerts > 0) {
        const countSnap = await adminDatabase.ref(`pluginAlertCounts/${userId}/${pluginId}/${dailyBucket(now)}`).get();
        const count = Number(countSnap.val() || 0);
        if (count >= maxAlerts) {
            return { allowed: false, reason: "daily_limit", detail: `Daily alert limit of ${maxAlerts} reached.` };
        }
    }

    // Duplicate suppression
    const dedupeKey = `${pluginId}:${alert.eventType}:${alert.symbol || ""}:${alert.title}`;
    const dedupeSnap = await adminDatabase.ref(`pluginAlertState/${userId}/${pluginId}/lastDedupe/${alert.eventType || "default"}`).get();
    const lastDedupe = dedupeSnap.val() as { key?: string; at?: number } | null;
    if (lastDedupe && lastDedupe.key === dedupeKey && now - Number(lastDedupe.at || 0) < DEDUPE_WINDOW_MS) {
        return { allowed: false, reason: "duplicate", detail: "Identical alert already sent in the last 30 minutes." };
    }

    return { allowed: true, reason: "ok" };
}

async function markDelivered(userId: string, pluginId: string, pluginName: string, alert: PluginAlert, config: PluginConfig, now: number): Promise<void> {
    const dedupeKey = `${pluginId}:${alert.eventType}:${alert.symbol || ""}:${alert.title}`;
    await adminDatabase.ref(`pluginAlertState/${userId}/${pluginId}`).update({
        lastAlertAt: now,
    });
    await adminDatabase.ref(`pluginAlertState/${userId}/${pluginId}/lastDedupe/${alert.eventType || "default"}`).set({ key: dedupeKey, at: now });
    const bucket = dailyBucket(now);
    const countRef = adminDatabase.ref(`pluginAlertCounts/${userId}/${pluginId}/${bucket}`);
    const current = Number((await countRef.get()).val() || 0);
    await countRef.set(current + 1);
}

async function deliverWebhook(userId: string, rec: PluginNotificationRecord): Promise<void> {
    try {
        const prefs = await readPrefs(userId);
        const url = String(prefs.pluginWebhookUrl || "").trim();
        if (!url || !/^https?:\/\//.test(url)) return;
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-AlgoVault-Source": "plugin" },
            body: JSON.stringify(rec),
            cache: "no-store",
        });
    } catch {
        // Webhook delivery failures are non-fatal; the record still stands.
    }
}

export async function deliverPluginAlert(input: DeliverPluginAlertInput): Promise<{ delivered: boolean; decision: DeliveryDecision; recordId?: string }> {
    const now = Date.now();
    const decision = await shouldDeliver(input.userId, input.pluginId, input.alert, input.config, now);
    if (!decision.allowed) {
        return { delivered: false, decision };
    }

    const channels: NotifyChannel[] = [];
    for (const channel of input.config.notificationChannels || []) {
        if (["telegram", "discord", "email"].includes(channel)) channels.push(channel as NotifyChannel);
    }
    if (channels.length === 0) channels.push("email" as const);

    const title = `${input.alert.severity === "high" ? "🔴" : input.alert.severity === "medium" ? "🟠" : "🟢"} ${input.pluginName}: ${input.alert.title}`;
    const message = `${input.alert.message}${input.alert.symbol ? `\nSymbol: ${input.alert.symbol}` : ""}`;

    const result = await notifyUser(
        input.userId,
        {
            title,
            message,
            level: input.alert.severity === "high" ? "error" : input.alert.severity === "medium" ? "warning" : "info",
            link: input.link,
        },
        channels.length > 0 ? { channels } : undefined
    );

    const record: PluginNotificationRecord = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        pluginId: input.pluginId,
        pluginName: input.pluginName,
        userId: input.userId,
        severity: input.alert.severity,
        eventType: input.alert.eventType,
        title: input.alert.title,
        message: input.alert.message,
        symbol: input.alert.symbol || "",
        link: input.link,
        timestamp: now,
        deliveredChannels: result.channels,
        metadata: input.alert.metadata || undefined,
    };

    await adminDatabase.ref(`pluginNotifications/${input.userId}/${record.id}`).set(record);
    await markDelivered(input.userId, input.pluginId, input.pluginName, input.alert, input.config, now);
    await deliverWebhook(input.userId, record);

    return { delivered: true, decision, recordId: record.id };
}

/** Count notifications related to a plugin for display in My Plugins. */
export async function countPluginNotifications(userId: string, pluginId: string): Promise<number> {
    const snap = await adminDatabase.ref(`pluginNotifications/${userId}`).get();
    const data = (snap.val() || {}) as Record<string, unknown>;
    let count = 0;
    for (const raw of Object.values(data)) {
        if (raw && typeof raw === "object" && (raw as PluginNotificationRecord).pluginId === pluginId) count += 1;
    }
    return count;
}