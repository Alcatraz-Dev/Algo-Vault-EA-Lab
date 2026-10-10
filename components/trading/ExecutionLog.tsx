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
        <Badge className="bg-positive/10 text-positive dark:text-positive">
          <Check size={10} className="mr-0.5" />
          Filled
        </Badge>
      );
    case "rejected":
    case "failed":
      return (
        <Badge className="bg-negative/10 text-negative dark:text-negative">
          <X size={10} className="mr-0.5" />
          Rejected
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-warning/10 text-warning dark:text-warning">
          <Clock size={10} className="mr-0.5" />
          Pending
        </Badge>
      );
    case "executing":
    case "queued":
      return (
        <Badge className="bg-info/10 text-info dark:text-info">
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
              <span className="font-numeric text-micro text-muted-foreground tabular-nums">
                {formatTimestamp(log.createdAt)}
              </span>

              {/* Action + Symbol + Volume */}
              <span className="flex items-center gap-1.5 text-sm">
                <span
                  className={cn(
                    "font-semibold",
                    log.action.toUpperCase().includes("BUY") || log.action.toUpperCase() === "BUY"
                      ? "text-positive"
                      : "text-negative"
                  )}
                >
                  {log.action}
                </span>
                <span className="font-semibold">{log.symbol}</span>
                <span className="font-numeric text-muted-foreground tabular-nums">
                  {formatNumber(log.volume)}
                </span>
              </span>

              {/* Status */}
              <StatusBadge status={log.status} />

              {/* MT5 Ticket */}
              {log.mt5Ticket && (
                <span className="font-numeric text-micro text-muted-foreground tabular-nums">
                  #{log.mt5Ticket}
                </span>
              )}

              {/* Execution Price */}
              {log.executionPrice > 0 && (
                <span className="font-numeric text-micro tabular-nums">
                  @ {formatNumber(log.executionPrice, 5)}
                </span>
              )}

              {/* Error */}
              {log.errorMessage && (
                <span className="flex items-center gap-1 text-micro text-negative">
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
