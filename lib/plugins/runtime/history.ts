import { listUserBots, loadBotTrades, loadBotPositions } from "@/lib/bots";

/**
 * Trading-history loader for the plugin runtime.
 *
 * Plugins access trade/position history ONLY through these functions and
 * ONLY when their manifest declares `trading_history` / `portfolio_data`
 * permissions. The runtime passes a permission gate before calling this.
 */

export type RuntimeTrade = {
    ticket: string;
    botId: string;
    botName: string;
    symbol: string;
    direction: "buy" | "sell";
    volume: number;
    openPrice: number;
    closePrice: number;
    profit: number;
    commission: number;
    swap: number;
    net: number;
    openedAt: number;
    closedAt: number;
    holdingMs: number;
};

export type RuntimePosition = {
    ticket: string;
    botId: string;
    symbol: string;
    type: string;
    volume: number;
    profit: number;
    openPrice: number;
    currentPrice: number;
    openedAt: number;
    comment: string;
};

export type HistoryContext = {
    trades: RuntimeTrade[];
    positions: RuntimePosition[];
    botCount: number;
    symbols: string[];
};

function normalizeTrade(raw: Record<string, unknown>, botId: string, botName: string): RuntimeTrade | null {
    const ticket = String(raw.ticket || "");
    if (!ticket) return null;
    const openedAt = Number(raw.openedAt || 0);
    const closedAt = Number(raw.closedAt || 0);
    const open = Number(raw.openPrice ?? raw.price ?? raw.open ?? 0);
    const close = Number(raw.closePrice ?? raw.close ?? raw.closedPrice ?? open);
    const profit = Number(raw.profit || 0);
    const commission = Number(raw.commission || 0);
    const swap = Number(raw.swap || 0);
    const volume = Number(raw.volume || 0);

    return {
        ticket,
        botId,
        botName,
        symbol: String(raw.symbol || ""),
        direction: String(raw.type || raw.direction || "").toLowerCase().startsWith("sell") ? "sell" : "buy",
        volume,
        openPrice: open,
        closePrice: close,
        profit,
        commission,
        swap,
        net: profit + commission + swap,
        openedAt,
        closedAt,
        holdingMs: openedAt > 0 && closedAt > openedAt ? closedAt - openedAt : 0,
    };
}

export async function loadHistoryContext(userId: string): Promise<HistoryContext> {
    const bots = await listUserBots(userId);
    const trades: RuntimeTrade[] = [];
    const positions: RuntimePosition[] = [];

    await Promise.all(
        bots.map(async (bot) => {
            const [botTrades, botPositions, rawPositions] = await Promise.all([
                loadBotTrades(bot.id),
                loadBotPositions(bot.id),
                Promise.resolve([]),
            ]);
            void rawPositions;
            for (const raw of botTrades) {
                const t = normalizeTrade(raw, bot.id, bot.name);
                if (t) trades.push(t);
            }
            for (const p of botPositions) {
                positions.push({
                    ticket: p.ticket,
                    botId: bot.id,
                    symbol: p.symbol,
                    type: p.type,
                    volume: p.volume,
                    profit: p.profit,
                    openPrice: p.openPrice,
                    currentPrice: p.currentPrice,
                    openedAt: p.openedAt,
                    comment: p.comment,
                });
            }
        })
    );

    trades.sort((a, b) => a.closedAt - b.closedAt);
    return {
        trades,
        positions,
        botCount: bots.length,
        symbols: Array.from(new Set(trades.map((t) => t.symbol).filter(Boolean))),
    };
}

export { listUserBots };