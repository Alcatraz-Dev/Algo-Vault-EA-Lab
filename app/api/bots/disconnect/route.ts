import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { authenticate } from "@/lib/admin-auth";
import { getBot, type UserBot } from "@/lib/bots";
import { notifyBotEvent } from "@/lib/bots";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const botId = String(body.botId || "").trim();
        if (!botId) {
            return NextResponse.json({ success: false, error: "Bot ID is required." }, { status: 400 });
        }

        const bot = await getBot(token.uid, botId);
        if (!bot) {
            return NextResponse.json({ success: false, error: "Bot not found." }, { status: 404 });
        }

        const now = Date.now();
        const updated: Partial<UserBot> = {
            status: "disconnected",
            online: false,
            updatedAt: now,
        };

        await adminDatabase.ref(`user_bots/${botId}`).update(updated);

        void notifyBotEvent(bot, {
            title: "Bot Disconnected",
            message: "The bot has been disconnected from monitoring.",
            level: "warning",
        });

        return NextResponse.json({ success: true, botId, status: "disconnected" });
    } catch (error) {
        console.error("[bots/disconnect POST]", error);
        return NextResponse.json({ success: false, error: "Unable to disconnect bot." }, { status: 500 });
    }
}