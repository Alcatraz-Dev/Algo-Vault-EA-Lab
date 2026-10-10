"use client";

// Performance report — rendered from the server-generated PerformanceReport.
// Explains the deterministic PASS/FAILED/EXPIRED reason with full stats.

import { Badge } from "@/components/ui/badge";
import { KV, ArenaDisclaimer } from "./primitives";
import { formatCents } from "@/lib/performance-arena/money";
import type { PerformanceReport } from "@/lib/performance-arena/types";

const STATUS_VARIANT: Record<string, "success" | "destructive" | "warning" | "secondary"> = {
    PASSED: "success",
    FAILED: "destructive",
    EXPIRED: "warning",
    CANCELLED: "secondary",
};

export function AttemptReport({ report }: { report: PerformanceReport }) {
    const fmt = (cents: number) => formatCents(cents);
    return (
        <div className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                <div>
                    <p className="text-xs text-muted-foreground">Performance report · {report.definitionName}</p>
                    <p className="font-numeric text-lg font-semibold">
                        {fmt(report.startingBalanceCents)} → {fmt(report.endingEquityCents)}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[report.status] ?? "secondary"}>{report.status}</Badge>
                    <Badge variant="outline">{report.reasonCode}</Badge>
                </div>
            </div>

            <div className="grid gap-x-6 gap-y-0 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
                <KV label="Total return" value={`${report.totalReturnPct >= 0 ? "+" : ""}${report.totalReturnPct.toFixed(2)}%`} />
                <KV label="Total PnL" value={fmt(report.totalPnLCents)} />
                <KV label="Max drawdown" value={`${report.maxDrawdownPct.toFixed(2)}%`} />
                <KV label="Worst day" value={`${report.worstDailyLossPct.toFixed(2)}%`} />
                <KV label="Trading days" value={`${report.tradingDays} (min ${report.minTradingDays})`} />
                <KV label="Trades" value={report.tradeCount} />
                <KV label="Win rate" value={`${report.winRatePct.toFixed(1)}%`} />
                <KV label="Average trade" value={fmt(report.avgTradeCents)} />
                <KV label="Best / worst trade" value={`${fmt(report.bestTradeCents)} / ${fmt(report.worstTradeCents)}`} />
                <KV label="Trading costs" value={fmt(report.totalFeesCents)} />
                <KV label="Consistency" value={report.consistencyPassed ? "Passed" : "Not met"} />
                <KV label="Rule breaches" value={report.ruleBreachCount} />
                <KV label="Markets" value={report.markets.join(", ") || "—"} />
                <KV label="Symbols" value={report.symbolsTraded.join(", ") || "—"} />
                <KV label="Guardian AI runs" value={report.aiRunsUsed} />
            </div>

            <div className="border-b border-border p-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Daily PnL</p>
                {report.dailyPnl.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No closed trades to chart.</p>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {report.dailyPnl.map((day) => (
                            <span
                                key={day.dayKey}
                                title={`${day.dayKey}: ${fmt(day.pnlCents)}`}
                                className={`rounded px-1.5 py-0.5 font-numeric text-micro tabular-nums ${
                                    day.pnlCents >= 0 ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
                                }`}
                            >
                                {day.dayKey.slice(5)} {fmt(day.pnlCents)}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="border-b border-border p-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Why this result (deterministic)</p>
                <ul className="space-y-1 text-xs">
                    {report.explanation.map((line, index) => (
                        <li key={index} className="text-foreground">• {line}</li>
                    ))}
                </ul>
            </div>

            <ArenaDisclaimer className="p-4">
                {report.disclaimers.join(" ")}
            </ArenaDisclaimer>
        </div>
    );
}
