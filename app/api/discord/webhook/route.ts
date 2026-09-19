import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { createChannelWebhook, deleteWebhook } from "@/lib/discord-oauth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const channelId = String(body.channelId || "").trim();
    const guildId = String(body.guildId || "").trim();

    if (!channelId) {
        return NextResponse.json({ error: "channelId is required." }, { status: 400 });
    }

    try {
        const userSnap = await adminDatabase.ref(`users/${token.uid}`).get();
        const user = userSnap.val() || {};
        const username = String(user.discordUsername || user.displayName || "Trader");

        if (user.discordWebhookId) {
            await deleteWebhook(String(user.discordWebhookId));
        }

        const webhook = await createChannelWebhook(channelId, username);

        await adminDatabase.ref(`users/${token.uid}`).update({
            discordWebhook: webhook.url,
            discordWebhookId: webhook.id,
            discordChannelId: webhook.channel_id,
            discordGuildId: guildId || null,
            discordConnectedAt: Date.now(),
            updatedAt: Date.now(),
        });

        await adminDatabase.ref(`discord_connect/${token.uid}`).remove();

        return NextResponse.json({
            success: true,
            webhookUrl: webhook.url,
            channelId: webhook.channel_id,
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to create webhook." },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const userSnap = await adminDatabase.ref(`users/${token.uid}`).get();
    const user = userSnap.val() || {};

    if (user.discordWebhookId) {
        await deleteWebhook(String(user.discordWebhookId));
    }

    await adminDatabase.ref(`users/${token.uid}`).update({
        discordWebhook: null,
        discordWebhookId: null,
        discordChannelId: null,
        discordGuildId: null,
        updatedAt: Date.now(),
    });

    return NextResponse.json({ success: true });
}
