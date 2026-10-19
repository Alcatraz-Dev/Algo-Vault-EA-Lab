"use client";

import { Badge } from "@/components/ui/badge";
import { Check, X, Clock, Zap, AlertTriangle } from "lucide-react";
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

function fmtNum(v: number, d = 2) {
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtTime(ts: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  switch (s) {
    case "filled":
      return (
        <Badge className="bg-positive text-background border-positive shadow-none font-semibold">
          <Check size={10} className="mr-0.5" />
          Filled
        </Badge>
      );
    case "rejected":
    case "failed":
    case "error":
      return (
        <Badge className="bg-negative text-background border-negative shadow-none font-semibold">
          <X size={10} className="mr-0.5" />
          Rejected
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-warning text-background border-warning shadow-none font-semibold">
          <Clock size={10} className="mr-0.5" />
          Pending
        </Badge>
      );
    case "executing":
    case "queued":
      return (
        <Badge className="bg-info text-background border-info shadow-none font-semibold">
          <Zap size={10} className="mr-0.5" />
          Executing
        </Badge>
      );
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  }
}

export default function ExecutionLog({
  logs,
  variant = "card",
}: {
  logs: ExecutionLogEntry[];
  variant?: "card" | "bare";
}) {
  const sorted = [...logs].sort((a, b) => b.createdAt - a.createdAt);

  const rows = sorted.map((log) => (
    <div
      key={log.clientOrderId}
      className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card/50 px-2.5 py-1.5"
    >
      <span className="font-numeric text-[11px] text-muted-foreground tabular-nums">
        {fmtTime(log.createdAt)}
      </span>
      <span className={cn("text-xs font-semibold tabular-nums", log.action.toUpperCase().includes("BUY") ? "text-positive" : "text-negative")}>
        {log.action}
      </span>
      <span className="text-xs font-bold">{log.symbol}</span>
      <span className="font-numeric text-[11px] text-muted-foreground tabular-nums">
        {fmtNum(log.volume, 2)}
      </span>
      <StatusBadge status={log.status} />
      {log.mt5Ticket && (
        <span className="font-numeric text-[10px] text-muted-foreground tabular-nums">#{log.mt5Ticket}</span>
      )}
      {log.executionPrice > 0 && (
        <span className="font-numeric text-[10px] tabular-nums text-muted-foreground">@ {fmtNum(log.executionPrice, 5)}</span>
      )}
      {log.errorMessage && (
        <span className="flex items-center gap-0.5 text-[11px] text-warning">
          <AlertTriangle size={9} />{log.errorMessage}
        </span>
      )}
    </div>
  ));

  if (sorted.length === 0) {
    if (variant === "bare") {
      return (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No executions yet.
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-border bg-card shadow-sm p-4 text-center text-sm text-muted-foreground">
        No execution history.
      </div>
    );
  }

  if (variant === "bare") {
    return (
      <div className="flex flex-col gap-1">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold">Execution Log ({sorted.length})</h3>
        </div>
        <div className="flex flex-col gap-1">{rows}</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-4">
      <h3 className="mb-2 text-sm font-semibold">Execution Log ({sorted.length})</h3>
      <div className="flex flex-col gap-2">{rows}</div>
    </div>
  );
}
