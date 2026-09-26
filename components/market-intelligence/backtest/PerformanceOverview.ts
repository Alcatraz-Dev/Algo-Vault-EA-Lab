/**
 * Performance Overview — renders from actual BacktestResult metrics.
 */
export interface MetricCard {
  label: string;
  value: string;
  sub?: string;
  status: "positive" | "negative" | "neutral";
  available: boolean;
}

export function buildPerformanceCards(metrics?: any, dataQuality?: any): MetricCard[] {
  const cards: MetricCard[] = [];
  const m = metrics ?? {};
  const dq = dataQuality ?? {};
  const hasData = dq?.status === "complete" || dq?.status === "incomplete";

  cards.push({ label: "Net P&L", value: m.netProfit != null ? (m.netProfit > 0 ? `+${m.netProfit}` : `${m.netProfit}`) : "—", sub: "Historical backtest", status: m.netProfit > 0 ? "positive" : (m.netProfit < 0 ? "negative" : "neutral"), available: m.netProfit != null });
  cards.push({ label: "Trades", value: m.totalTrades != null ? String(m.totalTrades) : "—", sub: "Total executed", status: "neutral", available: m.totalTrades != null });
  cards.push({ label: "Win Rate", value: m.winRate != null ? `${m.winRate}%` : "—", sub: "Percentage", status: "neutral", available: m.winRate != null });
  cards.push({ label: "Max Drawdown", value: m.maxDrawdown != null ? `-${m.maxDrawdown}%` : "—", sub: "Peak-to-trough", status: m.maxDrawdown ? "negative" : "neutral", available: m.maxDrawdown != null });
  cards.push({ label: "Profit Factor", value: m.profitFactor != null ? String(m.profitFactor) : "—", sub: "Gross profit / gross loss", status: m.profitFactor > 1 ? "positive" : (m.profitFactor < 1 ? "negative" : "neutral"), available: m.profitFactor != null });
  cards.push({ label: "Return", value: m.returnPct != null ? `${m.returnPct}%` : "—", sub: "On initial balance", status: m.returnPct > 0 ? "positive" : (m.returnPct < 0 ? "negative" : "neutral"), available: m.returnPct != null });
  return cards;
}
