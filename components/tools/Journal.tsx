"use client";

import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, BookOpen, TrendingDown, TrendingUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface JournalEntry {
    symbol: string;
    strategy: string;
    outcome: "win" | "loss" | "breakeven";
    pnl: number;
    lots: string;
    date: string;
    notes: string;
    entry: string;
    exit: string;
}

const mockEntries: JournalEntry[] = [
    { symbol: "EURUSD", strategy: "London Breakout", outcome: "win", pnl: 120, lots: "1.5", date: "Sep 12", notes: "**Followed plan**, good execution. *No emotions involved.*\n\n```\nEntry: 1.0850\nExit: 1.0910\n```", entry: "1.0850", exit: "1.0910" },
    { symbol: "GBPUSD", strategy: "Mean Reversion", outcome: "loss", pnl: -85, lots: "2.0", date: "Sep 11", notes: "Moved stop too tight. **Lesson:** Don't move stops against you.", entry: "1.2650", exit: "1.2565" },
    { symbol: "XAUUSD", strategy: "Trend Follower", outcome: "win", pnl: 200, lots: "0.5", date: "Sep 10", notes: "Trend caught nicely. ![Chart](https://via.placeholder.com/400x200/10b981/fff?text=XAUUSD+Trend)", entry: "2450", exit: "2470" },
    { symbol: "BTCUSD", strategy: "Scalping 1M", outcome: "win", pnl: 320, lots: "0.1", date: "Sep 09", notes: "Quick scalp, clean entry.\n\n- Tight spread\n- High volume\n- Clean breakout", entry: "44200", exit: "44520" },
    { symbol: "ETHUSD", strategy: "London Breakout", outcome: "breakeven", pnl: 0, lots: "1.0", date: "Sep 08", notes: "Choppy session, flat. *Wait for clearer setup next time.*", entry: "2350", exit: "2350" },
    { symbol: "EURUSD", strategy: "NY Scalp", outcome: "win", pnl: 95, lots: "1.5", date: "Sep 07", notes: "Good momentum trade.", entry: "1.0820", exit: "1.0875" },
    { symbol: "USDJPY", strategy: "Mean Reversion", outcome: "loss", pnl: -120, lots: "2.0", date: "Sep 06", notes: "False breakout. [Review setup](https://example.com)", entry: "149.50", exit: "148.30" },
    { symbol: "XAUUSD", strategy: "Scalping 1M", outcome: "win", pnl: 150, lots: "0.5", date: "Sep 05", notes: "ATR-based scalp worked.", entry: "2420", exit: "2440" },
    { symbol: "GBPUSD", strategy: "Trend Follower", outcome: "loss", pnl: -60, lots: "1.0", date: "Sep 04", notes: "Against the trend.", entry: "1.2700", exit: "1.2640" },
    { symbol: "BTCUSD", strategy: "London Breakout", outcome: "win", pnl: 280, lots: "0.1", date: "Sep 03", notes: "Strong breakout move.", entry: "44000", exit: "44800" },
    { symbol: "EURUSD", strategy: "NY Scalp", outcome: "win", pnl: 110, lots: "1.5", date: "Sep 02", notes: "Clean execution.", entry: "1.0800", exit: "1.0870" },
    { symbol: "ETHUSD", strategy: "Mean Reversion", outcome: "loss", pnl: -90, lots: "1.0", date: "Sep 01", notes: "Range breakdown.", entry: "2380", exit: "2290" },
];

function MarkdownRenderer({ content }: { content: string }) {
    return (
        <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
    );
}

const outcomeBadge = (outcome: string) => {
    switch (outcome) {
        case "win": return "bg-positive/10 text-positive border-positive/20";
        case "loss": return "bg-negative/10 text-negative border-negative/20";
        case "breakeven": return "bg-warning/10 text-warning border-warning/20";
        default: return "bg-border text-muted-foreground";
    }
};

export default function Journal() {
    const wins = mockEntries.filter((e) => e.outcome === "win").length;
    const losses = mockEntries.filter((e) => e.outcome === "loss").length;
    const breakevens = mockEntries.filter((e) => e.outcome === "breakeven").length;
    const totalPnl = mockEntries.reduce((s, e) => s + e.pnl, 0);
    const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "—";
    const avgWin = wins > 0 ? Math.round(mockEntries.filter((e) => e.outcome === "win").reduce((s, e) => s + e.pnl, 0) / wins) : 0;
    const avgLoss = losses > 0 ? Math.round(mockEntries.filter((e) => e.outcome === "loss").reduce((s, e) => s + e.pnl, 0) / losses) : 0;
    const profitFactor = avgLoss !== 0 ? (Math.abs(avgWin * wins) / Math.abs(avgLoss * losses)).toFixed(2) : "—";
    const expectancy = (avgWin * Number(winRate) / 100) + (avgLoss * (100 - Number(winRate)) / 100);

    return (
        <div className="mx-auto max-w-6xl space-y-6">
            <div>
                <h2 className="text-xl font-bold">Trade Journal</h2>
                <p className="mt-1 text-sm text-muted-foreground">Track your trades, outcomes, and performance over time.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-5">
                <div className="rounded-lg border border-positive/20 bg-positive/10 p-4 text-center">
                    <p className="text-micro uppercase tracking-wider text-positive font-semibold">Wins</p>
                    <p className="mt-1 text-2xl font-bold text-positive">{wins}</p>
                </div>
                <div className="rounded-lg border border-negative/20 bg-negative/10 p-4 text-center">
                    <p className="text-micro uppercase tracking-wider text-negative font-semibold">Losses</p>
                    <p className="mt-1 text-2xl font-bold text-negative">{losses}</p>
                </div>
                <div className="rounded-lg border border-warning/20 bg-warning/10 p-4 text-center">
                    <p className="text-micro uppercase tracking-wider text-warning font-semibold">Flat</p>
                    <p className="mt-1 text-2xl font-bold text-warning">{breakevens}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
                    <p className="text-micro uppercase tracking-wider text-muted-foreground font-semibold">Win Rate</p>
                    <p className="mt-1 text-2xl font-bold text-foreground">{winRate}%</p>
                </div>
                <div className={`rounded-lg border p-4 text-center ${totalPnl >= 0 ? "border-positive/20 bg-positive/10" : "border-negative/20 bg-negative/10"}`}>
                    <p className="text-micro uppercase tracking-wider font-semibold">Total P&L</p>
                    <p className={`mt-1 text-2xl font-bold ${totalPnl >= 0 ? "text-positive" : "text-negative"}`}>
                        {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                    </p>
                </div>
            </div>

            <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                    <h3 className="font-semibold flex items-center gap-2"><BookOpen size={16} /> Trade Log</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                                <th className="py-3 px-5">Date</th>
                                <th className="py-3 px-4">Symbol</th>
                                <th className="py-3 px-4">Strategy</th>
                                <th className="py-3 px-4">Entry</th>
                                <th className="py-3 px-4">Exit</th>
                                <th className="py-3 px-4">Lots</th>
                                <th className="py-3 px-4">Outcome</th>
                                <th className="py-3 px-4">P&L</th>
                                <th className="py-3 px-4">Notes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {mockEntries.map((entry, i) => (
                                <tr key={i} className="hover:bg-muted/30">
                                    <td className="py-3 px-5 text-muted-foreground">{entry.date}</td>
                                    <td className="py-3 px-4 font-medium">{entry.symbol}</td>
                                    <td className="py-3 px-4 text-muted-foreground">{entry.strategy}</td>
                                    <td className="py-3 px-4 font-numeric text-xs">{entry.entry}</td>
                                    <td className="py-3 px-4 font-numeric text-xs">{entry.exit}</td>
                                    <td className="py-3 px-4">{entry.lots}</td>
                                    <td className="py-3 px-4">
                                        <span className={`rounded-full border px-2 py-0.5 text-micro font-semibold ${outcomeBadge(entry.outcome)}`}>
                                            {entry.outcome === "win" ? "WIN" : entry.outcome === "loss" ? "LOSS" : "FLAT"}
                                        </span>
                                    </td>
                                    <td className={`py-3 px-4 font-medium ${entry.pnl >= 0 ? "text-positive" : "text-negative"}`}>
                                        {entry.pnl >= 0 ? "+" : ""}${entry.pnl.toFixed(2)}
                                    </td>
                                    <td className="py-3 px-4">
                                        <MarkdownRenderer content={entry.notes} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-lg border border-border bg-card p-5">
                    <TrendingUp size={14} className="text-positive mb-2" />
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Avg Win</p>
                    <p className="mt-1 text-lg font-bold text-positive">+${avgWin}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-5">
                    <TrendingDown size={14} className="text-negative mb-2" />
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Avg Loss</p>
                    <p className="mt-1 text-lg font-bold text-negative">${avgLoss}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-5">
                    <ArrowUpRight size={14} className="text-primary mb-2" />
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Profit Factor</p>
                    <p className="mt-1 text-lg font-bold text-foreground">{profitFactor}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-5">
                    <ArrowDownRight size={14} className="text-warning mb-2" />
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Expectancy</p>
                    <p className="mt-1 text-lg font-bold text-foreground">
                        ${expectancy.toFixed(2)}/trade
                    </p>
                </div>
            </div>
        </div>
    );
}