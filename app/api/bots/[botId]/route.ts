import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { getBot, deleteBot, loadBotTrades, loadBotPositions, computeBotStats, upsertBot } from "@/lib/bots";

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

export async function PATCH(
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

        const existing = await getBot(token.uid, botId);
        if (!existing) {
            return NextResponse.json({ success: false, error: "Bot not found." }, { status: 404 });
        }

        const body = await request.json();
        const { name, symbol, timeframe, magicNumber, commentFilter, description, mt5Account } = body;

        const updated = await upsertBot({
            id: existing.id,
            ownerId: existing.ownerId,
            type: existing.type,
            name: name ?? existing.name,
            platform: existing.platform,
            symbol: symbol ?? existing.symbol,
            timeframe: timeframe ?? existing.timeframe,
            magicNumber: magicNumber ?? existing.magicNumber,
            commentFilter: commentFilter ?? existing.commentFilter,
            productId: existing.productId,
            licenseId: existing.licenseId,
            mt5Account: mt5Account ?? existing.mt5Account,
            gatewayInstallationId: existing.gatewayInstallationId,
            mapping: existing.mapping,
            status: existing.status,
            online: existing.online,
            lastHeartbeatAt: existing.lastHeartbeatAt,
            description: description ?? existing.description,
        });

        return NextResponse.json({ success: true, bot: updated });
    } catch (error) {
        console.error("[bots/[botId] PATCH]", error);
        return NextResponse.json({ success: false, error: "Unable to update bot." }, { status: 500 });
    }
}

export async function DELETE(
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

        const deleted = await deleteBot(token.uid, botId);
        if (!deleted) {
            return NextResponse.json({ success: false, error: "Bot not found." }, { status: 404 });
        }

        return NextResponse.json({ success: true, botId });
    } catch (error) {
        console.error("[bots/[botId] DELETE]", error);
        return NextResponse.json({ success: false, error: "Unable to delete bot." }, { status: 500 });
    }
}