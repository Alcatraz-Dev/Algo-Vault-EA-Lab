import { NextRequest, NextResponse } from "next/server";
import { adminDatabase } from "@/lib/firebase-admin";
import { verifyGatewayToken, resolveGatewayToken } from "@/lib/gateway";
import { isCopiedLedgerPosition, mirrorMasterClose, mirrorMasterOrder, recordMasterPerformance } from "@/lib/copy-trading";
import { getBotOwnedMagics, findMatchingBots, indexBotPosition, clearBotPositions, indexBotTrade } from "@/lib/bots";

export const runtime = "nodejs";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function normalizePositionType(value: unknown): string {
    const s = String(value ?? "").trim().toUpperCase();
    if (s === "BUY" || s === "OP_BUY" || s === "0") return "BUY";
    if (s === "SELL" || s === "OP_SELL" || s === "1") return "SELL";
    return s;
}

/**
 * True when the position belongs to this account but originated from a copy
 * signal (either already acked into mt5_orders, or still queued/executing in
 * trading_order_requests). Prevents copy-of-copy recursion when a gateway
 * account that is itself being copied also acts as a master.
 */
async function isCopiedSnapshotPosition(
    userId: string,
    accountNumber: string,
    ticket: string
): Promise<boolean> {
    if (await isCopiedLedgerPosition(accountNumber, ticket)) return true;

    const reqsSnap = await adminDatabase
        .ref(`trading_order_requests/${userId}`)
        .get();
    const reqs = reqsSnap.val() || {};
    for (const key of Object.keys(reqs)) {
        const cmd = reqs[key];
        if (!cmd || String(cmd.source ?? "") !== "copy_follower") continue;
        if (
            String(key) === ticket ||
            String(cmd.ticket ?? "") === ticket ||
            String(cmd.mt5Ticket ?? "") === ticket ||
            String(cmd.clientOrderId ?? "") === ticket
        ) {
            return true;
        }
    }
    return false;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const gatewayToken = resolveGatewayToken(request.headers.get("authorization"), body);
        const accountNumber = String(body.accountNumber || "").trim();
        const positions = Array.isArray(body.positions) ? body.positions : [];
        const orders = Array.isArray(body.orders) ? body.orders : [];

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
        const accountId = `gateway_${accountNumber}`;
        const now = Date.now();

        const prevSnap = await adminDatabase
            .ref(`trading_positions/${userId}/${accountId}`)
            .get();
        const prevPositions = (prevSnap.val() || {}) as Record<string, unknown>;

        const positionsData: Record<string, unknown> = {};
        for (const pos of positions) {
            const p = pos as Record<string, unknown>;
            const ticket = String(p.ticket || "");
            if (ticket) {
                positionsData[ticket] = {
                    ticket,
                    symbol: String(p.symbol || ""),
                    type: normalizePositionType(p.type),
                    volume: Number(p.volume || 0),
                    openPrice: Number(p.openPrice || 0),
                    currentPrice: Number(p.currentPrice || 0),
                    sl: Number(p.sl || 0),
                    tp: Number(p.tp || 0),
                    profit: Number(p.profit || 0),
                    swap: Number(p.swap || 0),
                    magic: Number(p.magic || 0),
                    comment: String(p.comment || ""),
                    openedAt: Number(p.openedAt || 0),
                    updatedAt: now,
                };
            }
        }

        await adminDatabase
            .ref(`trading_positions/${userId}/${accountId}`)
            .set(positionsData);

        const ordersData: Record<string, unknown> = {};
        for (const ord of orders) {
            const o = ord as Record<string, unknown>;
            const ticket = String(o.ticket || "");
            if (ticket) {
                ordersData[ticket] = {
                    ticket,
                    symbol: String(o.symbol || ""),
                    type: String(o.type || ""),
                    volume: Number(o.volume || 0),
                    price: Number(o.price || 0),
                    sl: Number(o.sl || 0),
                    tp: Number(o.tp || 0),
                    status: String(o.status || ""),
                    updatedAt: now,
                };
            }
        }

        await adminDatabase
            .ref(`trading_orders/${userId}/${accountId}`)
            .set(ordersData);

        // ── Copy trading: mirror master opens / closes ────────────────────
        // The gateway EA reports every position on each snapshot, so diffing
        // against the previous snapshot yields newly opened masters (mirror
        // open) and positions that disappeared (mirror close). Positions that
        // were themselves copied are skipped to avoid copy-of-copy recursion.
        const openedTickets = Object.keys(positionsData).filter(
            (t) => !(t in prevPositions)
        );
        const removedTickets = Object.keys(prevPositions).filter(
            (t) => !(t in positionsData)
        );

        // Magics claimed by this user's registered bots (custom + marketplace).
        // Positions carrying one of these belong to a bot and are never pushed
        // into the live marketplace mirror/copy pipeline. The same positions
        // ARE indexed under bot_positions/{botId}/{ticket} so each bot has an
        // exact open-position set.
        const ownedMagics = await getBotOwnedMagics(userId, accountNumber);
        const perBotTickets = new Map<string, string[]>();

        for (const [ticket, posRaw] of Object.entries(positionsData)) {
            const pos = posRaw as Record<string, unknown>;
            const magic = String(pos.magic ?? "");
            if (magic === "" || !ownedMagics.includes(magic)) continue;

            const matches = await findMatchingBots(
                userId,
                accountNumber,
                magic,
                String(pos.symbol || ""),
                String((pos as Record<string, unknown>).comment || "")
            );
            const target = matches[0]?.bot;
            if (!target) continue;

            await indexBotPosition(target.id, pos);

            const tickets = perBotTickets.get(target.id) || [];
            tickets.push(ticket);
            perBotTickets.set(target.id, tickets);
        }

        for (const [botId, tickets] of perBotTickets) {
            await clearBotPositions(botId, tickets);
        }

        const isBotOwned = (pos: Record<string, unknown> | undefined) => {
            if (!pos) return false;
            const magic = String(pos.magic ?? "");
            return magic !== "" && ownedMagics.includes(magic);
        };

        for (const ticket of openedTickets) {
            if (await isCopiedSnapshotPosition(userId, accountNumber, ticket)) continue;
            const pos = positionsData[ticket] as Record<string, unknown>;
            if (isBotOwned(pos)) continue;
            await mirrorMasterOrder({
                masterId: accountId,
                masterMt5Account: accountNumber,
                order: {
                    ticket,
                    symbol: String(pos.symbol || ""),
                    type: String(pos.type || "BUY"),
                    volume: Number(pos.volume || 0.01),
                    openPrice: Number(pos.openPrice || 0),
                    stopLoss: Number(pos.sl || 0) || null,
                    takeProfit: Number(pos.tp || 0) || null,
                },
                notify: true,
            });
        }

        for (const ticket of removedTickets) {
            if (await isCopiedSnapshotPosition(userId, accountNumber, ticket)) continue;

            const closedPos = prevPositions[ticket] as Record<string, unknown> | undefined;
            if (isBotOwned(closedPos)) {
                // Bot-owned position closed: index a trade so the bot's stats
                // reflect realized P/L. Profit is the last floating value the
                // gateway observed (MT5 doesn't expose close prices here).
                const magic = String(closedPos?.magic ?? "");
                const symbol = String(closedPos?.symbol || "");
                const matches = await findMatchingBots(userId, accountNumber, magic, symbol, String(closedPos?.comment || ""));
                const target = matches[0]?.bot;
                if (target) {
                    void indexBotTrade(target.id, {
                        ticket,
                        symbol,
                        type: String(closedPos?.type || ""),
                        volume: Number(closedPos?.volume || 0),
                        openPrice: Number(closedPos?.openPrice || 0),
                        closePrice: Number(closedPos?.currentPrice || 0),
                        profit: Number(closedPos?.profit || 0),
                        swap: Number(closedPos?.swap || 0),
                        magic,
                        comment: String(closedPos?.comment || ""),
                        mt5Account: accountNumber,
                        accountId,
                        openedAt: Number(closedPos?.openedAt || 0),
                        closedAt: now,
                        closeSource: "gateway_snapshot",
                    });
                }
                continue;
            }

            await recordMasterPerformance({
                accountId,
                realizedProfit: Number(closedPos?.profit || 0),
                closedAt: now,
            });

            await mirrorMasterClose({
                masterId: accountId,
                masterMt5Account: accountNumber,
                masterTicket: ticket,
                notify: true,
            });
        }

        return NextResponse.json(
            {
                success: true,
                positionsCount: Object.keys(positionsData).length,
                ordersCount: Object.keys(ordersData).length,
                mirroredOpens: openedTickets.length,
                mirroredCloses: removedTickets.length,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error("[trading/gateway/snapshot POST]", error);
        return NextResponse.json(
            { success: false, error: "Snapshot failed." },
            { status: 500, headers: corsHeaders }
        );
    }
}
