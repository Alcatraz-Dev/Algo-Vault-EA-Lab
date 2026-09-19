import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { listUserBots, loadBotTrades, loadBotPositions, computeBotStats, type UserBot } from "@/lib/bots";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const bots = await listUserBots(token.uid);

        const withStats = await Promise.all(
            bots.map(async (bot: UserBot) => {
                const [trades, positions] = await Promise.all([
                    loadBotTrades(bot.id),
                    loadBotPositions(bot.id),
                ]);
                return {
                    ...bot,
                    stats: computeBotStats(trades, positions),
                    openPositions: positions,
                };
            })
        );

        return NextResponse.json({ success: true, bots: withStats });
    } catch (error) {
        console.error("[bots GET]", error);
        return NextResponse.json({ success: false, error: "Unable to load bots." }, { status: 500 });
    }
}