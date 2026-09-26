/**
 * Trade Journal Adapter — maps from actual BacktestTrade.
 */
export interface TradeRow {
  id: string;
  time: string;
  side: "long" | "short" | string;
  entry: string;
  exit?: string;
  pnl: string;
  duration?: string;
  reason?: string;
}

export function formatTradeRow(trade: any, index: number): TradeRow {
  return {
    id: String(index + 1),
    time: trade.entryTime ? new Date(trade.entryTime).toISOString() : "—",
    side: trade.direction ?? "—",
    entry: trade.entryPrice != null ? String(trade.entryPrice.toFixed(2)) : "—",
    exit: trade.exitPrice != null ? String(trade.exitPrice.toFixed(2)) : "—",
    pnl: trade.profit != null ? (trade.profit > 0 ? `+${trade.profit.toFixed(2)}` : String(trade.profit.toFixed(2))) : "—",
    duration: trade.exitTime && trade.entryTime ? `${Math.round((trade.exitTime - trade.entryTime) / 60000)}m` : "—",
    reason: trade.status ?? "—",
  };
}
