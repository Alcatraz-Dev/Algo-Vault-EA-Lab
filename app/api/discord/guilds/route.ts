import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import { getBotGuild, getUserGuilds } from "@/lib/discord-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const snap = await adminDatabase.ref(`discord_connect/${token.uid}`).get();
    const session = snap.val();

    if (!session?.accessToken || Number(session.expiresAt || 0) < Date.now()) {
        return NextResponse.json(
            { error: "Discord session expired. Click Connect Discord again." },
            { status: 401 }
        );
    }

    try {
        const userGuilds = await getUserGuilds(String(session.accessToken));
        const botGuildChecks = await Promise.all(
            userGuilds.map(async (guild) => ({
                guild,
                botGuild: await getBotGuild(guild.id),
            }))
        );

        const guilds = botGuildChecks
            .filter((item) => Boolean(item.botGuild))
            .map((item) => ({ id: item.guild.id, name: item.guild.name }));

        return NextResponse.json({ guilds });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to load servers." },
            { status: 500 }
        );
    }
}
