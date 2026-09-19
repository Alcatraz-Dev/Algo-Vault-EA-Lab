"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  X,
  Clock,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ExecutionLogEntry {
  clientOrderId: string;
  accountId: string;
  action: string;
  symbol: string;
  volume: number;
  status: string;
  mt5Ticket: string;
  executionPrice: number;
  errorCode: number;
  errorMessage: string;
  createdAt: number;
  executedAt: number;
}

function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatTimestamp(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  switch (s) {
    case "filled":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Check size={10} className="mr-0.5" />
          Filled
        </Badge>
      );
    case "rejected":
    case "failed":
      return (
        <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400">
          <X size={10} className="mr-0.5" />
          Rejected
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
          <Clock size={10} className="mr-0.5" />
          Pending
        </Badge>
      );
    case "executing":
    case "queued":
      return (
        <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Zap size={10} className="mr-0.5" />
          Executing
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function ExecutionLog({
  logs,
}: {
  logs: ExecutionLogEntry[];
}) {
  const sorted = [...logs].sort((a, b) => b.createdAt - a.createdAt);

  if (sorted.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Execution Log</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          No execution history.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Log ({sorted.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sorted.map((log) => (
            <div
              key={log.clientOrderId}
              className="flex flex-wrap items-center gap-3 rounded-none border border-border px-3 py-2.5"
            >
              {/* Timestamp */}
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {formatTimestamp(log.createdAt)}
              </span>

              {/* Action + Symbol + Volume */}
              <span className="flex items-center gap-1.5 text-sm">
                <span
                  className={cn(
                    "font-semibold",
                    log.action.toUpperCase().includes("BUY") || log.action.toUpperCase() === "BUY"
                      ? "text-emerald-500"
                      : "text-rose-500"
                  )}
                >
                  {log.action}
                </span>
                <span className="font-semibold">{log.symbol}</span>
                <span className="font-mono text-muted-foreground tabular-nums">
                  {formatNumber(log.volume)}
                </span>
              </span>

              {/* Status */}
              <StatusBadge status={log.status} />

              {/* MT5 Ticket */}
              {log.mt5Ticket && (
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  #{log.mt5Ticket}
                </span>
              )}

              {/* Execution Price */}
              {log.executionPrice > 0 && (
                <span className="font-mono text-[11px] tabular-nums">
                  @ {formatNumber(log.executionPrice, 5)}
                </span>
              )}

              {/* Error */}
              {log.errorMessage && (
                <span className="flex items-center gap-1 text-[11px] text-rose-500">
                  <AlertTriangle size={10} />
                  {log.errorMessage}
                </span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
