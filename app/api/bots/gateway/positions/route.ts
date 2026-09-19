import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { verifyGatewayToken, resolveGatewayToken } from "@/lib/gateway";
import { findMatchingBots, indexBotPosition, clearBotPositions, getBot, type UserBot } from "@/lib/bots";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export function normalizePositionType(value: unknown): string {
    const s = String(value ?? "").trim().toUpperCase();
    if (s === "BUY" || s === "OP_BUY" || s === "0") return "BUY";
    if (s === "SELL" || s === "OP_SELL" || s === "1") return "SELL";
    return s;
}

/**
 * Open-position ingestion from the MT5 Gateway.
 *
 * The gateway snapshots every open position on the account; positions whose
 * magic belongs to a registered bot (custom or marketplace) are indexed under
 * `bot_positions/{botId}/{ticket}` and stale tickets are removed, keeping each
 * bot's open-position set exact. Copy-trading mirroring is intentionally NOT
 * triggered here — it lives in the existing gateway snapshot route, and the
 * snapshot route now skips bot-owned magics so custom EAs are never mirrored
 * as master opens.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const gatewayToken = resolveGatewayToken(request.headers.get("authorization"), body);
        const accountNumber = String(body.accountNumber || "").trim();
        const gatewayInstallationId = String(body.gatewayInstallationId || "").trim();
        const positions = Array.isArray(body.positions) ? body.positions : [];
        const botsReported = Array.isArray(body.bots) ? body.bots : [];
        const now = Date.now();

        if (!gatewayToken || !accountNumber) {
            return NextResponse.json(
                { success: false, error: "gatewayToken and accountNumber are required." },
                { status: 400, headers: corsHeaders }
            );
        }

        const gatewayUser = await verifyGatewayToken(gatewayToken);
        if (!gatewayUser) {
            return NextResponse.json(
                { success: false, error: "Invalid gateway token." },
                { status: 403, headers: corsHeaders }
            );
        }

        const userId = gatewayUser.userId;

        const reportedBots = new Map<string, UserBot>();
        for (const raw of botsReported) {
            if (!raw || typeof raw !== "object") continue;
            const id = String((raw as Record<string, unknown>).botId || "").trim();
            if (!id) continue;
            const bot = await getBot(userId, id);
            if (bot) reportedBots.set(id, bot);
        }

        const perBotTickets = new Map<string, string[]>();
        let attributed = 0;
        const unmatched: string[] = [];

        for (const raw of positions) {
            if (!raw || typeof raw !== "object") continue;
            const p = raw as Record<string, unknown>;
            const ticket = String(p.ticket || "");
            if (!ticket) continue;

            const magicNum = p.magic;
            const symbol = String(p.symbol || "");
            const comment = String(p.comment || "");

            const matches = await findMatchingBots(userId, accountNumber, magicNum, symbol, comment);
            let target: UserBot | null = matches[0]?.bot || null;

            const explicitBotId = String(p.botId || "").trim();
            if (explicitBotId && reportedBots.has(explicitBotId)) {
                target = reportedBots.get(explicitBotId) || target;
            }

            if (!target) {
                unmatched.push(ticket);
                continue;
            }

            await indexBotPosition(target.id, {
                ticket,
                symbol,
                type: normalizePositionType(p.type),
                volume: Number(p.volume || 0),
                openPrice: Number(p.openPrice || 0),
                currentPrice: Number(p.currentPrice || p.closePrice || 0),
                sl: Number(p.sl || 0),
                tp: Number(p.tp || 0),
                profit: Number(p.profit || 0),
                swap: Number(p.swap || 0),
                magic: String(magicNum ?? ""),
                comment,
                mt5Account: accountNumber,
                accountId: `gateway_${accountNumber}`,
                openedAt: Number(p.openedAt || 0),
                gatewayInstallationId: gatewayInstallationId || null,
            });

            const tickets = perBotTickets.get(target.id) || [];
            tickets.push(ticket);
            perBotTickets.set(target.id, tickets);
            attributed += 1;
        }

        // Remove positions that are no longer open for each bot we wrote to.
        for (const [botIdParam, tickets] of perBotTickets) {
            await clearBotPositions(botIdParam, tickets);
        }

        // Mark reported bots online.
        for (const raw of botsReported) {
            if (!raw || typeof raw !== "object") continue;
            const id = String((raw as Record<string, unknown>).botId || "").trim();
            if (!id || !reportedBots.has(id)) continue;
            const bot = reportedBots.get(id)!;
            await adminDatabase.ref(`user_bots/${bot.id}`).update({
                online: true,
                status: "active",
                lastHeartbeatAt: now,
                gatewayInstallationId: gatewayInstallationId || bot.gatewayInstallationId || null,
                updatedAt: now,
            });
        }

        return NextResponse.json(
            { success: true, attributed, unmatched, total: positions.length },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[bots/gateway/positions POST]", error);
        return NextResponse.json(
            { success: false, error: "Unable to process positions." },
            { status: 500, headers: corsHeaders }
        );
    }
}