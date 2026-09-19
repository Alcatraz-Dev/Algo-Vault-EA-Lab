import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getGuildTextChannels } from "@/lib/discord-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const token = await authenticate(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const guildId = String(new URL(request.url).searchParams.get("guildId") || "").trim();
    if (!guildId) {
        return NextResponse.json({ error: "guildId is required." }, { status: 400 });
    }

    try {
        const channels = await getGuildTextChannels(guildId);
        return NextResponse.json({
            channels: channels.map((c) => ({ id: c.id, name: c.name })),
        });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to load channels." },
            { status: 500 }
        );
    }
}
