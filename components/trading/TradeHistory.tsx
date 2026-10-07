"use client";

// Closed-trade history for a live gateway account. Records are persisted
// server-side by the gateway snapshot diff (a position that disappears from
// an MT5 snapshot is a close), so this table updates in real time via the
// RTDB subscription on `trading_history/{uid}/{accountId}`.

import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ClosedTrade {
  ticket: string;
  symbol: string;
  type: "BUY" | "SELL" | string;
  volume: number;
  openPrice: number;
  closePrice: number;
  profit: number;
  swap: number;
  openedAt: number;
  closedAt: number;
  closeSource: string;
  /** Close % — price move in the trade direction, computed server-side. */
  priceMovePct: number | null;
}

function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatMoneySigned(value: number): string {
  return `${value >= 0 ? "+" : "−"}$${formatNumber(Math.abs(value))}`;
}

function formatDateTime(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(from: number, to: number): string {
  if (!from || !to || to <= from) return "—";
  const s = Math.floor((to - from) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Close % of a closed trade — server value first, deterministic fallback second. */
export function closePercentOf(trade: ClosedTrade): number | null {
  if (
    typeof trade.priceMovePct === "number" &&
    Number.isFinite(trade.priceMovePct)
  ) {
    return trade.priceMovePct;
  }
  const entry = Number(trade.openPrice || 0);
  const exit = Number(trade.closePrice || 0);
  if (entry <= 0 || exit <= 0) return null;
  const direction = String(trade.type).toUpperCase() === "SELL" ? -1 : 1;
  return Math.round(((exit - entry) / entry) * 100 * direction * 100) / 100;
}

function SideLabel({ side }: { side: string }) {
  const isBuy = String(side).toUpperCase() === "BUY";
  return (
    <span
      className={cn(
        "font-semibold",
        isBuy ? "text-emerald-500" : "text-rose-500"
      )}
    >
      {String(side).toUpperCase() === "BUY" ? "BUY" : "SELL"}
    </span>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-numeric text-sm font-semibold tabular-nums",
          tone === "positive" && "text-emerald-500",
          tone === "negative" && "text-rose-500"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function TradeHistory({ trades }: { trades: ClosedTrade[] }) {
  const sorted = useMemo(
    () => [...trades].sort((a, b) => Number(b.closedAt || 0) - Number(a.closedAt || 0)),
    [trades]
  );

  const stats = useMemo(() => {
    const total = sorted.length;
    let wins = 0;
    let losses = 0;
    let net = 0;
    let closePctSum = 0;
    let closePctCount = 0;
    for (const t of sorted) {
      const pnl = Number(t.profit || 0) + Number(t.swap || 0);
      net += pnl;
      if (pnl > 0) wins += 1;
      else if (pnl < 0) losses += 1;
      const pct = closePercentOf(t);
      if (pct !== null) {
        closePctSum += pct;
        closePctCount += 1;
      }
    }
    return {
      total,
      wins,
      losses,
      net,
      winRatePct: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
      avgClosePct: closePctCount > 0 ? closePctSum / closePctCount : null,
    };
  }, [sorted]);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
        <History className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium">No closed trades yet</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Every position this account closes is recorded here in real time with
          its close price, realized P/L and close % — open a position from the
          terminal or your MT5 platform to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Real-time performance summary — computed from the closed-trade ledger. */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <SummaryStat label="Closed trades" value={String(stats.total)} />
        <SummaryStat
          label="Win rate"
          value={
            stats.winRatePct === null ? "—" : `${stats.winRatePct.toFixed(1)}%`
          }
          tone={
            stats.winRatePct === null
              ? "neutral"
              : stats.winRatePct >= 50
                ? "positive"
                : "negative"
          }
        />
        <SummaryStat
          label="Net realized P/L"
          value={formatMoneySigned(stats.net)}
          tone={stats.net >= 0 ? "positive" : "negative"}
        />
        <SummaryStat
          label="Avg close %"
          value={
            stats.avgClosePct === null
              ? "—"
              : `${stats.avgClosePct >= 0 ? "+" : ""}${stats.avgClosePct.toFixed(2)}%`
          }
          tone={
            stats.avgClosePct === null
              ? "neutral"
              : stats.avgClosePct >= 0
                ? "positive"
                : "negative"
          }
        />
        <SummaryStat label="Wins / Losses" value={`${stats.wins} / ${stats.losses}`} />
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead>Closed</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead className="text-right">Entry → Exit</TableHead>
              <TableHead className="text-right">P/L</TableHead>
              <TableHead className="text-right">Close %</TableHead>
              <TableHead className="text-right">Held</TableHead>
              <TableHead className="text-right">Ticket</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.slice(0, 100).map((t) => {
              const pnl = Number(t.profit || 0) + Number(t.swap || 0);
              const pct = closePercentOf(t);
              return (
                <TableRow key={t.ticket}>
                  <TableCell className="whitespace-nowrap font-numeric text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(Number(t.closedAt || 0))}
                  </TableCell>
                  <TableCell className="font-semibold">{t.symbol}</TableCell>
                  <TableCell>
                    <SideLabel side={t.type} />
                  </TableCell>
                  <TableCell className="text-right font-numeric tabular-nums">
                    {formatNumber(Number(t.volume || 0))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-numeric tabular-nums text-muted-foreground">
                    {Number(t.openPrice || 0) > 0
                      ? formatNumber(Number(t.openPrice), 5)
                      : "—"}{" "}
                    →{" "}
                    {Number(t.closePrice || 0) > 0
                      ? formatNumber(Number(t.closePrice), 5)
                      : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-numeric font-semibold tabular-nums",
                      pnl >= 0 ? "text-emerald-500" : "text-rose-500"
                    )}
                  >
                    {formatMoneySigned(pnl)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-numeric font-semibold tabular-nums",
                      pct === null
                        ? "text-muted-foreground"
                        : pct >= 0
                          ? "text-emerald-500"
                          : "text-rose-500"
                    )}
                  >
                    {pct === null
                      ? "—"
                      : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}
                  </TableCell>
                  <TableCell className="text-right font-numeric text-xs tabular-nums text-muted-foreground">
                    {formatDuration(Number(t.openedAt || 0), Number(t.closedAt || 0))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="font-numeric tabular-nums">
                      {t.ticket}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {sorted.length > 100 ? (
        <p className="text-[11px] text-muted-foreground">
          Showing the 100 most recent of {sorted.length} closed trades.
        </p>
      ) : null}
    </div>
  );
}
