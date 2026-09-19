import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { verifyGatewayToken, resolveGatewayToken } from "@/lib/gateway";
import { findMatchingBots, indexBotTrade, notifyBotEvent, getBot, type UserBot } from "@/lib/bots";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function parseNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const s = String(value ?? "").trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * Closed-trade ingestion from the AlgoVaultTradeGateway EA.
 *
 * Authenticated with a gateway token (the EA's own secret). Each reported deal
 * is attributed to the user's bots by magic/account/symbol/comment and indexed
 * under `bot_trades/{botId}/{ticket}`. The gateway itself is the ONLY source of
 * truth for account facts, so no browser auth is used here. Marketplace trades
 * continue to also be stored via /api/performance/trade — this route is the
 * per-bot attribution layer shared by custom and gateway-run bots.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const gatewayToken = resolveGatewayToken(request.headers.get("authorization"), body);
        const accountNumber = String(body.accountNumber || "").trim();
        const gatewayInstallationId = String(body.gatewayInstallationId || "").trim();
        const trades = Array.isArray(body.trades) ? body.trades : [];
        const bots = Array.isArray(body.bots) ? body.bots : [];

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
        const now = Date.now();
        let attributed = 0;
        const unmatched: string[] = [];

        const reportedBots = new Map<string, UserBot>();
        if (Array.isArray(bots)) {
            for (const raw of bots) {
                if (!raw || typeof raw !== "object") continue;
                const id = String((raw as Record<string, unknown>).botId || "").trim();
                if (!id) continue;
                const bot = await getBot(userId, id);
                if (bot) reportedBots.set(id, bot);
            }
        }

        for (const raw of trades) {
            if (!raw || typeof raw !== "object") continue;
            const t = raw as Record<string, unknown>;
            const ticket = String(t.ticket || "");
            if (!ticket) continue;

            const magicNum = t.magic;
            const symbol = String(t.symbol || "");
            const comment = String(t.comment || "");

            const matches = await findMatchingBots(userId, accountNumber, magicNum, symbol, comment);
            let target: UserBot | null = matches[0]?.bot || null;

            // If the gateway explicitly reported which bot this belongs to, trust that.
            const explicitBotId = String(t.botId || "").trim();
            if (explicitBotId && reportedBots.has(explicitBotId)) {
                target = reportedBots.get(explicitBotId) || target;
            }

            if (!target) {
                unmatched.push(ticket);
                continue;
            }

            const tradeId = `${target.id}_${ticket}`;
            await indexBotTrade(target.id, {
                ticket,
                tradeId,
                symbol,
                type: String(t.type || ""),
                volume: parseNumber(t.volume) ?? 0,
                openPrice: parseNumber(t.openPrice) ?? 0,
                closePrice: parseNumber(t.closePrice) ?? 0,
                profit: parseNumber(t.profit) ?? 0,
                commission: parseNumber(t.commission) ?? 0,
                swap: parseNumber(t.swap) ?? 0,
                magic: String(magicNum ?? ""),
                comment,
                mt5Account: accountNumber,
                accountId: `gateway_${accountNumber}`,
                openedAt: parseNumber(t.openedAt) ?? now,
                closedAt: parseNumber(t.closedAt) ?? now,
                gatewayInstallationId: gatewayInstallationId || null,
            });
            attributed += 1;

            void notifyBotEvent(target, {
                title: `Trade Closed · ${symbol}`,
                message: `${typeLabel(t.type)} ${String(t.volume ?? "")} lots @ ${String(t.closePrice ?? "")}\nProfit: ${formatPnl(t.profit)}`,
                level: (parseNumber(t.profit) ?? 0) >= 0 ? "success" : "error",
            });
        }

        // Optionally mark bots as having been seen by the gateway this cycle.
        if (bots.length > 0) {
            for (const raw of bots) {
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
        }

        return NextResponse.json(
            { success: true, attributed, unmatched, total: trades.length },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[bots/gateway/trades POST]", error);
        return NextResponse.json(
            { success: false, error: "Unable to process trades." },
            { status: 500, headers: corsHeaders }
        );
    }
}

function typeLabel(value: unknown): string {
    if (value === 0 || value === "0" || String(value).toUpperCase() === "BUY") return "BUY";
    if (value === 1 || value === "1" || String(value).toUpperCase() === "SELL") return "SELL";
    return String(value || "");
}

function formatPnl(value: unknown): string {
    const n = Number(value || 0);
    return `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`;
}