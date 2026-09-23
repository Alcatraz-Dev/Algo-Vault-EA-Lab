/**
 * Growth Engine — channel adapter registry.
 *
 * Each channel reports its real configuration state. Current native
 * integrations (no third-party SDKs installed):
 *  - EMAIL    → Resend/SendGrid via lib/email when configured + a recipient list.
 *  - DISCORD  → server webhook via DISCORD_WEBHOOK_URL.
 *  - BLOG     → publishes into the platform's own growthContent collection.
 *  - X / INSTAGRAM / FACEBOOK / LINKEDIN / YOUTUBE / TIKTOK → NOT_CONFIGURED
 *    until official APIs + credentials are wired (documented in env.example).
 *
 * Secrets are never exposed to the frontend; status() returns configuration
 * state only.
 */
import { CHANNEL_TYPES, ChannelType } from "../constants";
import { isEmailConfigured } from "@/lib/email";
import { getServerDiscordWebhookUrl } from "@/lib/discord-webhook";
import {
    AnalyticsResult,
    ChannelCapability,
    ChannelStatus,
    MarketingChannelAdapter,
    NOT_CONFIGURED,
    PublishPayload,
    PublishResult,
    ScheduleResult,
} from "./types";

function baseStatus(type: ChannelType, state: "CONFIGURED" | "NOT_CONFIGURED" | "ERROR", capabilities: ChannelCapability[], reason?: string): ChannelStatus {
    return {
        type,
        state,
        configured: state === "CONFIGURED",
        reason,
        capabilities,
    };
}

// ─── X ───────────────────────────────────────────────────────────────────────

class XAdapter implements MarketingChannelAdapter {
    readonly type: ChannelType = "X";
    readonly capabilities: ChannelCapability[] = ["publish", "analytics"];
    status(): ChannelStatus {
        return baseStatus(this.type, "NOT_CONFIGURED", this.capabilities, "No X API credentials configured (X_API_KEY / X_API_SECRET).");
    }
    async publish(): Promise<PublishResult> {
        return NOT_CONFIGURED("X publishing requires X API credentials which are not configured.");
    }
    async analytics(): Promise<AnalyticsResult> {
        return { ok: false, state: "NOT_CONFIGURED", reason: "X analytics requires X API credentials." };
    }
}

// ─── Instagram ───────────────────────────────────────────────────────────────

class InstagramAdapter implements MarketingChannelAdapter {
    readonly type: ChannelType = "INSTAGRAM";
    readonly capabilities: ChannelCapability[] = ["publish", "analytics"];
    status(): ChannelStatus {
        return baseStatus(this.type, "NOT_CONFIGURED", this.capabilities, "No Instagram Graph API credentials configured (INSTAGRAM_ACCESS_TOKEN).");
    }
    async publish(): Promise<PublishResult> {
        return NOT_CONFIGURED("Instagram publishing requires Meta Graph API credentials.");
    }
}

// ─── Facebook ────────────────────────────────────────────────────────────────

class FacebookAdapter implements MarketingChannelAdapter {
    readonly type: ChannelType = "FACEBOOK";
    readonly capabilities: ChannelCapability[] = ["publish", "analytics"];
    status(): ChannelStatus {
        return baseStatus(this.type, "NOT_CONFIGURED", this.capabilities, "No Facebook Graph API credentials configured (FACEBOOK_ACCESS_TOKEN).");
    }
    async publish(): Promise<PublishResult> {
        return NOT_CONFIGURED("Facebook publishing requires Meta Graph API credentials.");
    }
}

// ─── LinkedIn ────────────────────────────────────────────────────────────────

class LinkedInAdapter implements MarketingChannelAdapter {
    readonly type: ChannelType = "LINKEDIN";
    readonly capabilities: ChannelCapability[] = ["publish", "analytics"];
    status(): ChannelStatus {
        return baseStatus(this.type, "NOT_CONFIGURED", this.capabilities, "No LinkedIn API credentials configured (LINKEDIN_ACCESS_TOKEN).");
    }
    async publish(): Promise<PublishResult> {
        return NOT_CONFIGURED("LinkedIn publishing requires LinkedIn API credentials.");
    }
}

// ─── YouTube ─────────────────────────────────────────────────────────────────

class YouTubeAdapter implements MarketingChannelAdapter {
    readonly type: ChannelType = "YOUTUBE";
    readonly capabilities: ChannelCapability[] = ["publish", "analytics"];
    status(): ChannelStatus {
        return baseStatus(this.type, "NOT_CONFIGURED", this.capabilities, "No YouTube Data API credentials configured (YOUTUBE_API_KEY).");
    }
    async publish(): Promise<PublishResult> {
        return NOT_CONFIGURED("YouTube publishing requires the YouTube Data API.");
    }
}

// ─── TikTok ──────────────────────────────────────────────────────────────────

class TikTokAdapter implements MarketingChannelAdapter {
    readonly type: ChannelType = "TIKTOK";
    readonly capabilities: ChannelCapability[] = ["publish", "analytics"];
    status(): ChannelStatus {
        return baseStatus(this.type, "NOT_CONFIGURED", this.capabilities, "No TikTok Content Posting API credentials configured (TIKTOK_ACCESS_TOKEN).");
    }
    async publish(): Promise<PublishResult> {
        return NOT_CONFIGURED("TikTok publishing requires the Content Posting API.");
    }
}

// ─── Discord ─────────────────────────────────────────────────────────────────

class DiscordAdapter implements MarketingChannelAdapter {
    readonly type: ChannelType = "DISCORD";
    readonly capabilities: ChannelCapability[] = ["publish", "delete", "analytics"];
    status(): ChannelStatus {
        const webhook = getServerDiscordWebhookUrl();
        if (!webhook) {
            return baseStatus(this.type, "NOT_CONFIGURED", this.capabilities, "No Discord webhook configured (DISCORD_WEBHOOK_URL).");
        }
        return baseStatus(this.type, "CONFIGURED", this.capabilities);
    }
    async publish(payload: PublishPayload): Promise<PublishResult> {
        const webhook = getServerDiscordWebhookUrl();
        if (!webhook) return NOT_CONFIGURED("No Discord webhook configured.");
        const content = `${payload.title ? `**${payload.title}**\n` : ""}${payload.text ?? ""}${payload.url ? `\n🔗 ${payload.url}` : ""}`.slice(0, 2000);
        try {
            const res = await fetch(webhook, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
                cache: "no-store",
            });
            if (!res.ok) {
                const message = (await res.json().catch(() => ({}))) as { message?: string };
                return { ok: false, state: "ERROR", reason: message.message || `Discord publish failed (${res.status}).` };
            }
            return { ok: true, externalId: `discord_${Date.now().toString(36)}`, publishedAt: Date.now() };
        } catch (err) {
            return { ok: false, state: "ERROR", reason: err instanceof Error ? err.message : "Discord publish failed." };
        }
    }
    async delete(): Promise<{ ok: boolean; reason?: string }> {
        return { ok: false, reason: "Discord message deletion requires the Bot API (not configured)." };
    }
}

// ─── Email ───────────────────────────────────────────────────────────────────

const emailRecipients = (): string[] =>
    String(process.env.GROWTH_EMAIL_RECIPIENTS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

class EmailAdapter implements MarketingChannelAdapter {
    readonly type: ChannelType = "EMAIL";
    readonly capabilities: ChannelCapability[] = ["publish", "schedule", "analytics"];
    status(): ChannelStatus {
        const state = isEmailConfigured() ? "CONFIGURED" : "NOT_CONFIGURED";
        const reason = state === "NOT_CONFIGURED" ? "Email provider not configured (RESEND_API_KEY or SENDGRID_API_KEY)." : undefined;
        return baseStatus(this.type, state, this.capabilities, reason);
    }
    async publish(payload: PublishPayload): Promise<PublishResult> {
        if (!isEmailConfigured()) return NOT_CONFIGURED("Email provider not configured (RESEND_API_KEY or SENDGRID_API_KEY).");
        const recipients = emailRecipients();
        if (recipients.length === 0) {
            return NOT_CONFIGURED("No recipients configured (GROWTH_EMAIL_RECIPIENTS).");
        }
        const { sendEmail } = await import("@/lib/email");
        let lastError = "";
        let sentCount = 0;
        for (const to of recipients) {
            try {
                const out = await sendEmail({
                    to,
                    subject: payload.title || "AlgoVault update",
                    text: payload.text || "",
                    html: payload.text ? payload.text.replace(/\n/g, "<br/>") : "",
                });
                if (out.ok) sentCount += 1;
                else lastError = out.error || "Email send failed.";
            } catch (err) {
                lastError = err instanceof Error ? err.message : "Email send failed.";
            }
        }
        if (sentCount === 0) {
            return { ok: false, state: "ERROR", reason: lastError || "No emails sent." };
        }
        return { ok: true, externalId: `email_${sentCount}_${Date.now().toString(36)}`, publishedAt: Date.now() };
    }
    async schedule(): Promise<ScheduleResult> {
        return NOT_CONFIGURED("Email scheduling requires a campaign provider; queue via a scheduled job instead.");
    }
}

// ─── Blog (platform's own content store) ─────────────────────────────────────

class BlogAdapter implements MarketingChannelAdapter {
    readonly type: ChannelType = "BLOG";
    readonly capabilities: ChannelCapability[] = ["publish", "schedule", "delete", "analytics"];
    status(): ChannelStatus {
        return baseStatus(this.type, "CONFIGURED", this.capabilities);
    }
    async publish(payload: PublishPayload): Promise<PublishResult> {
        // Publishing to the platform blog writes a real growthContent record
        // (the AlgoVault blog store). Idempotency is enforced by the caller.
        const { adminDatabase } = await import("@/lib/firebase-admin");
        const { COLLECTION_PATHS } = await import("../paths");
        const ref = adminDatabase.ref(`${COLLECTION_PATHS.content}`).push();
        const id = ref.key as string;
        const now = Date.now();
        await ref.set({
            id,
            title: payload.title || (payload.text || "").slice(0, 60),
            body: payload.text ?? "",
            url: payload.url ?? "",
            status: "PUBLISHED",
            createdAt: now,
            updatedAt: now,
            createdBy: "growth:publisher",
        });
        return { ok: true, externalId: id, url: payload.url, publishedAt: now };
    }
    async schedule(): Promise<ScheduleResult> {
        return NOT_CONFIGURED("Blog scheduling is handled by the campaign scheduler; use a scheduled job.");
    }
    async delete(externalId: string): Promise<{ ok: boolean; reason?: string }> {
        try {
            const { adminDatabase } = await import("@/lib/firebase-admin");
            const { COLLECTION_PATHS } = await import("../paths");
            await adminDatabase.ref(`${COLLECTION_PATHS.content}/${externalId}`).remove();
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: err instanceof Error ? err.message : "Blog delete failed." };
        }
    }
}

// ─── Registry ────────────────────────────────────────────────────────────────

const ADAPTERS: Record<ChannelType, MarketingChannelAdapter> = {
    X: new XAdapter(),
    INSTAGRAM: new InstagramAdapter(),
    FACEBOOK: new FacebookAdapter(),
    LINKEDIN: new LinkedInAdapter(),
    YOUTUBE: new YouTubeAdapter(),
    TIKTOK: new TikTokAdapter(),
    DISCORD: new DiscordAdapter(),
    EMAIL: new EmailAdapter(),
    BLOG: new BlogAdapter(),
};

export function getAdapter(type: ChannelType): MarketingChannelAdapter {
    return ADAPTERS[type];
}

export function getAllAdapters(): MarketingChannelAdapter[] {
    return CHANNEL_TYPES.map((t) => ADAPTERS[t]);
}

export function channelStatuses(): ChannelStatus[] {
    return getAllAdapters().map((a) => a.status());
}

/** Publish to a channel with a hard timeout so API hangs never block workers. */
export async function publishWithTimeout(adapter: MarketingChannelAdapter, payload: PublishPayload, timeoutMs = 15000): Promise<PublishResult> {
    return Promise.race([
        adapter.publish(payload),
        new Promise<Extract<PublishResult, { ok: false }>>((resolve) =>
            setTimeout(() => resolve({ ok: false, state: "ERROR", reason: `Publish timed out after ${timeoutMs}ms.` }), timeoutMs)
        ),
    ]);
}