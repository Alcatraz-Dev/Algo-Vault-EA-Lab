import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getBot, loadBotTrades, loadBotPositions, computeBotStats } from "@/lib/bots";

export const runtime = "nodejs";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ botId: string }> }
) {
    try {
        const token = await authenticate(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
        }

        const { botId } = await params;
        if (!botId) {
            return NextResponse.json({ success: false, error: "Bot ID is required." }, { status: 400 });
        }

        const bot = await getBot(token.uid, botId);
        if (!bot) {
            return NextResponse.json({ success: false, error: "Bot not found." }, { status: 404 });
        }

        const [trades, positions] = await Promise.all([
            loadBotTrades(botId),
            loadBotPositions(botId),
        ]);

        const stats = computeBotStats(trades, positions);

        return NextResponse.json({
            success: true,
            bot,
            stats,
            positions,
            trades: trades.sort(
                (a, b) => Number(b.updatedAt || b.closedAt || 0) - Number(a.updatedAt || a.closedAt || 0)
            ),
        });
    } catch (error) {
        console.error("[bots/[botId] GET]", error);
        return NextResponse.json({ success: false, error: "Unable to load bot." }, { status: 500 });
    }
}