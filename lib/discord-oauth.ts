import crypto from "crypto";
import { adminDatabase } from "@/lib/firebase-admin";

const DISCORD_API = "https://discord.com/api/v10";

// Manage Webhooks permission
const MANAGE_WEBHOOKS = 536870912;

export type DiscordConfig = {
    clientId: string;
    clientSecret: string;
    botToken: string;
    redirectUri: string;
};

type DiscordTokenResponse = {
    access_token: string;
    token_type: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
};

type DiscordUser = {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
};

type DiscordGuild = {
    id: string;
    name: string;
    icon?: string | null;
    owner?: boolean;
    permissions?: string;
    features?: string[];
};

type DiscordChannel = {
    id: string;
    name: string;
    type: number;
    guild_id?: string;
    position?: number;
};

type DiscordWebhook = {
    id: string;
    url: string;
    channel_id: string;
    name?: string;
};

/**
 * Get Discord configuration.
 *
 * IMPORTANT:
 *
 * NEXT_PUBLIC_APP_URL must be the exact public URL of your application.
 *
 * Example:
 *
 * NEXT_PUBLIC_APP_URL=https://yourdomain.com
 *
 * The resulting callback will be:
 *
 * https://yourdomain.com/api/discord/callback
 *
 * This exact URL must also exist in:
 *
 * Discord Developer Portal
 * -> Your Application
 * -> OAuth2
 * -> Redirects
 */
export function getDiscordConfig(): DiscordConfig | null {
    const clientId =
        process.env.DISCORD_CLIENT_ID ||
        process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID ||
        "";

    const clientSecret = process.env.DISCORD_CLIENT_SECRET || "";
    const botToken = process.env.DISCORD_BOT_TOKEN || "";

    if (!clientId || !clientSecret || !botToken) {
        return null;
    }

    const rawAppUrl =
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const appUrl = rawAppUrl
        .trim()
        .replace(/\/+$/, "");

    const redirectUri = `${appUrl}/api/discord/callback`;

    return {
        clientId,
        clientSecret,
        botToken,
        redirectUri,
    };
}

/**
 * Get the OAuth2 URL used to connect/login with Discord.
 *
 * This is NOT the bot invite URL.
 *
 * Scopes:
 * - identify -> Discord user profile
 * - guilds   -> servers the user belongs to
 */
export function getDiscordOAuthUrl(state: string): string | null {
    const cfg = getDiscordConfig();

    if (!cfg) {
        return null;
    }

    if (!state) {
        throw new Error("Discord OAuth state is required.");
    }

    const params = new URLSearchParams({
        client_id: cfg.clientId,
        response_type: "code",
        redirect_uri: cfg.redirectUri,
        scope: "identify guilds",
        state,
    });

    return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

/**
 * Generate the URL used to add the Discord bot to a server.
 *
 * NOTE:
 * This is separate from the normal Discord OAuth login flow.
 */
export function getBotInviteUrl(): string | null {
    const cfg = getDiscordConfig();

    if (!cfg) {
        return null;
    }

    const params = new URLSearchParams({
        client_id: cfg.clientId,
        permissions: String(MANAGE_WEBHOOKS),
        scope: "bot",
    });

    return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

/**
 * Create secure OAuth state.
 *
 * The state is stored server-side and expires after 10 minutes.
 */
export async function createOAuthState(uid: string): Promise<string> {
    if (!uid) {
        throw new Error("User ID is required.");
    }

    const state = crypto.randomBytes(32).toString("hex");

    await adminDatabase
        .ref(`discord_oauth_states/${state}`)
        .set({
            uid,
            expiresAt: Date.now() + 10 * 60 * 1000,
            createdAt: Date.now(),
        });

    return state;
}

/**
 * Consume OAuth state.
 *
 * State is deleted immediately so it cannot be reused.
 */
export async function consumeOAuthState(
    state: string
): Promise<string | null> {
    if (!state) {
        return null;
    }

    const ref = adminDatabase.ref(`discord_oauth_states/${state}`);

    const snap = await ref.get();

    const data = snap.val();

    // Always consume/delete the state.
    await ref.remove();

    if (!data?.uid) {
        return null;
    }

    const expiresAt = Number(data.expiresAt || 0);

    if (!expiresAt || expiresAt < Date.now()) {
        return null;
    }

    return String(data.uid);
}

/**
 * Exchange Discord OAuth authorization code for access token.
 */
export async function exchangeDiscordCode(
    code: string
): Promise<DiscordTokenResponse> {
    const cfg = getDiscordConfig();

    if (!cfg) {
        throw new Error(
            "Discord is not configured on the server."
        );
    }

    if (!code) {
        throw new Error("Discord authorization code is missing.");
    }

    const body = new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: cfg.redirectUri,
    });

    const res = await fetch(
        `${DISCORD_API}/oauth2/token`,
        {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded",
            },
            body: body.toString(),
            cache: "no-store",
        }
    );

    const rawText = await res.text();

    let data: Record<string, unknown> = {};

    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch {
        data = {};
    }

    if (!res.ok) {
        const message =
            typeof data.message === "string"
                ? data.message
                : typeof data.error_description === "string"
                    ? data.error_description
                    : typeof data.error === "string"
                        ? data.error
                        : "Discord token exchange failed.";

        throw new Error(
            `Discord token exchange failed: ${message}`
        );
    }

    if (!data.access_token) {
        throw new Error(
            "Discord did not return an access token."
        );
    }

    return data as DiscordTokenResponse;
}

/**
 * Get the currently authenticated Discord user.
 */
export async function getDiscordUser(
    accessToken: string
): Promise<DiscordUser> {
    if (!accessToken) {
        throw new Error("Discord access token is missing.");
    }

    const res = await fetch(
        `${DISCORD_API}/users/@me`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            cache: "no-store",
        }
    );

    if (!res.ok) {
        const error = await res
            .json()
            .catch(() => ({})) as {
                message?: string;
            };

        throw new Error(
            error.message ||
            "Failed to fetch Discord profile."
        );
    }

    return (await res.json()) as DiscordUser;
}

/**
 * Get Discord servers for the authenticated user.
 *
 * Requires the "guilds" OAuth scope.
 */
export async function getUserGuilds(
    accessToken: string
): Promise<DiscordGuild[]> {
    if (!accessToken) {
        throw new Error("Discord access token is missing.");
    }

    const res = await fetch(
        `${DISCORD_API}/users/@me/guilds`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            cache: "no-store",
        }
    );

    if (!res.ok) {
        const error = await res
            .json()
            .catch(() => ({})) as {
                message?: string;
            };

        throw new Error(
            error.message ||
            "Failed to fetch Discord servers."
        );
    }

    return (await res.json()) as DiscordGuild[];
}

/**
 * Check whether the bot is inside a specific guild.
 *
 * This is the safest way to determine whether our bot
 * has already been installed in a particular server.
 */
export async function isBotInGuild(
    guildId: string
): Promise<boolean> {
    const cfg = getDiscordConfig();

    if (!cfg) {
        return false;
    }

    if (!guildId) {
        return false;
    }

    const res = await fetch(
        `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}`,
        {
            headers: {
                Authorization: `Bot ${cfg.botToken}`,
            },
            cache: "no-store",
        }
    );

    return res.ok;
}

/**
 * Get guild information using the bot token.
 *
 * Returns null when the bot isn't in the guild
 * or doesn't have access to it.
 */
export async function getBotGuild(
    guildId: string
): Promise<DiscordGuild | null> {
    const cfg = getDiscordConfig();

    if (!cfg || !guildId) {
        return null;
    }

    const res = await fetch(
        `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}`,
        {
            headers: {
                Authorization: `Bot ${cfg.botToken}`,
            },
            cache: "no-store",
        }
    );

    if (!res.ok) {
        return null;
    }

    return (await res.json()) as DiscordGuild;
}

/**
 * Get text channels from a guild.
 */
export async function getGuildTextChannels(
    guildId: string
): Promise<DiscordChannel[]> {
    const cfg = getDiscordConfig();

    if (!cfg) {
        throw new Error(
            "Discord is not configured."
        );
    }

    if (!guildId) {
        throw new Error(
            "Discord guild ID is required."
        );
    }

    const res = await fetch(
        `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/channels`,
        {
            headers: {
                Authorization: `Bot ${cfg.botToken}`,
            },
            cache: "no-store",
        }
    );

    if (!res.ok) {
        const error = await res
            .json()
            .catch(() => ({})) as {
                message?: string;
                code?: number;
            };

        throw new Error(
            error.message ||
            "Bot is not in that server or lacks permissions."
        );
    }

    const channels =
        (await res.json()) as DiscordChannel[];

    // Discord channel type 0 = Guild Text Channel
    return channels
        .filter((channel) => channel.type === 0)
        .sort(
            (a, b) =>
                Number(a.position || 0) -
                Number(b.position || 0)
        );
}

/**
 * Create a webhook in a Discord text channel.
 */
export async function createChannelWebhook(
    channelId: string,
    username: string
): Promise<DiscordWebhook> {
    const cfg = getDiscordConfig();

    if (!cfg) {
        throw new Error(
            "Discord is not configured."
        );
    }

    if (!channelId) {
        throw new Error(
            "Discord channel ID is required."
        );
    }

    const safeUsername =
        String(username || "User")
            .trim()
            .slice(0, 60);

    const webhookName =
        `AlgoVault — ${safeUsername}`
            .slice(0, 80);

    const res = await fetch(
        `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/webhooks`,
        {
            method: "POST",
            headers: {
                Authorization: `Bot ${cfg.botToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name: webhookName,
            }),
            cache: "no-store",
        }
    );

    const rawText = await res.text();

    let data: Record<string, unknown> = {};

    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch {
        data = {};
    }

    if (!res.ok) {
        const message =
            typeof data.message === "string"
                ? data.message
                : "Failed to create Discord webhook.";

        throw new Error(message);
    }

    if (
        typeof data.id !== "string" ||
        typeof data.url !== "string" ||
        typeof data.channel_id !== "string"
    ) {
        throw new Error(
            "Discord returned an invalid webhook response."
        );
    }

    return data as DiscordWebhook;
}

/**
 * Delete a webhook.
 */
export async function deleteWebhook(
    webhookId: string
): Promise<void> {
    const cfg = getDiscordConfig();

    if (!cfg || !webhookId) {
        return;
    }

    await fetch(
        `${DISCORD_API}/webhooks/${encodeURIComponent(webhookId)}`,
        {
            method: "DELETE",
            headers: {
                Authorization: `Bot ${cfg.botToken}`,
            },
            cache: "no-store",
        }
    ).catch(() => undefined);
}

/**
 * Optional helper:
 * Send a message through a webhook URL.
 */
export async function sendWebhookMessage(
    webhookUrl: string,
    content: string,
    options?: {
        username?: string;
        avatar_url?: string;
    }
): Promise<void> {
    if (!webhookUrl) {
        throw new Error(
            "Discord webhook URL is required."
        );
    }

    if (!content) {
        return;
    }

    const body: Record<string, unknown> = {
        content,
    };

    if (options?.username) {
        body.username = options.username;
    }

    if (options?.avatar_url) {
        body.avatar_url = options.avatar_url;
    }

    const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
    });

    if (!res.ok) {
        const error = await res
            .json()
            .catch(() => ({})) as {
                message?: string;
            };

        throw new Error(
            error.message ||
            "Failed to send Discord webhook message."
        );
    }
}