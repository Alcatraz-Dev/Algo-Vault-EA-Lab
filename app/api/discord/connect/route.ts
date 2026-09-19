import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { createOAuthState, getDiscordConfig } from "@/lib/discord-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const cfg = getDiscordConfig();
    if (!cfg) {
        return NextResponse.json(
            { error: "Discord integration is not configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and DISCORD_BOT_TOKEN." },
            { status: 503 }
        );
    }

    const state = await createOAuthState(token.uid);
    const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: "code",
        scope: "identify guilds",
        state,
        prompt: "consent",
    });

    return NextResponse.json({
        url: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
    });
}
