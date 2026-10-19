import "server-only";
import { adminDatabase } from "@/lib/firebase-admin";

/**
 * Writes one closed MT5 deal to `trading_history/{userId}/{accountId}/{ticket}`.
 * Keyed by the position id so a deal reported both immediately and again in a
 * snapshot resolves to the same row (idempotent).
 */
export async function writeClosedDealHistory(
    userId: string,
    accountId: string,
    deal: Record<string, unknown>
): Promise<string | null> {
    const positionId = String(deal.positionId || deal.position || "").trim();
    const ticket = positionId || String(deal.dealTicket || deal.ticket || "").trim();
    if (!ticket) return null;

    const openPrice = Number(deal.openPrice || 0);
    const closePrice = Number(deal.closePrice || 0);
    const direction = String(deal.type || "BUY").toUpperCase() === "SELL" ? -1 : 1;
    const priceMovePct =
        openPrice > 0 && closePrice > 0
            ? Math.round(((closePrice - openPrice) / openPrice) * 100 * direction * 100) / 100
            : null;

    await adminDatabase
        .ref(`trading_history/${userId}/${accountId}/${ticket}`)
        .set({
            ticket,
            symbol: String(deal.symbol || ""),
            type: String(deal.type || "BUY"),
            volume: Number(deal.volume || 0),
            openPrice,
            closePrice,
            profit: Number(deal.profit || 0),
            swap: Number(deal.swap || 0),
            magic: String(deal.magic || ""),
            comment: String(deal.comment || ""),
            openedAt: Number(deal.openedAt || 0),
            closedAt: Number(deal.closedAt || Date.now()),
            closeSource: "mt5_deal",
            priceMovePct,
        });

    return ticket;
}
