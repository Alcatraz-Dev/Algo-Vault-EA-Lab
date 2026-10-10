"use client";

import { useState } from "react";
import { AlertTriangle, Check, Clock, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isApprovalExpired, isApprovalPending } from "@/lib/candel/approvals";
import { timeAgo } from "@/components/candel/role-visuals";
import type { CandelApprovalRequest } from "@/lib/candel/types";

const ACTION_LABELS: Record<string, string> = {
  createOrder: "Create order",
  modifyOrder: "Modify order",
  closePosition: "Close position",
  cancelOrder: "Cancel order",
};

/** Payload keys shown on the card, in reading order, before the rest is elided. */
const PAYLOAD_ORDER = [
  "accountId",
  "symbol",
  "side",
  "orderType",
  "size",
  "lotSize",
  "entry",
  "price",
  "stop",
  "stopLoss",
  "takeProfit",
  "positionId",
  "orderId",
];

function payloadRows(payload: Record<string, unknown>): [string, string][] {
  const keys = [
    ...PAYLOAD_ORDER.filter((key) => payload[key] !== undefined),
    ...Object.keys(payload).filter((key) => !PAYLOAD_ORDER.includes(key)),
  ];
  return keys.slice(0, 8).map((key) => {
    const value = payload[key];
    return [
      key,
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value),
    ];
  });
}

function expiryLabel(request: CandelApprovalRequest): string {
  if (request.decision) return "decided";
  if (isApprovalExpired(request)) return "expired";
  const minutes = Math.max(0, Math.round((request.expiresAt - Date.now()) / 60000));
  if (minutes < 60) return `${minutes}m left`;
  return `${Math.round(minutes / 60)}h left`;
}

/**
 * An approval card is the human gate made visible: what the Candel wants to do,
 * against which bound account, with the evidence it cited — and one explicit
 * decision. Approving records intent; it does not submit an order.
 */
export function ApprovalCard({
  request,
  onDecide,
  busy = false,
  className,
}: {
  request: CandelApprovalRequest;
  onDecide: (approvalId: string, decision: "approved" | "rejected", reason: string) => void;
  busy?: boolean;
  className?: string;
}) {
  const [reason, setReason] = useState("");
  const pending = isApprovalPending(request);
  const expired = isApprovalExpired(request);
  const rows = payloadRows(request.payload ?? {});

  return (
    <div
      className={cn(
        "rounded-lg border bg-card",
        pending ? "border-warning/40" : "border-border",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <AlertTriangle
          className={cn("size-3.5", pending ? "text-warning" : "text-muted-foreground")}
        />
        <span className="text-sm font-medium text-foreground">
          {ACTION_LABELS[request.actionType] ?? request.actionType}
        </span>
        {pending ? (
          <Badge variant="warning">live trading · approval required</Badge>
        ) : request.decision === "approved" ? (
          <Badge variant="success">
            <Check className="size-3" /> approved
          </Badge>
        ) : request.decision === "rejected" ? (
          <Badge variant="destructive">
            <X className="size-3" /> rejected
          </Badge>
        ) : (
          <Badge variant="outline">{expired ? "expired" : "closed"}</Badge>
        )}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" />
          {expiryLabel(request)}
        </span>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        <p className="text-sm text-foreground">{request.summary}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            permission <code className="font-mono text-foreground">{request.permissionRequired}</code>
          </span>
          {request.targetId ? (
            <span>
              account <code className="font-mono text-foreground">{request.targetId}</code>
            </span>
          ) : null}
          <span>requested {timeAgo(request.createdAt)}</span>
        </div>

        {rows.length > 0 ? (
          <dl className="grid gap-x-4 gap-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 sm:grid-cols-[auto_1fr]">
            {rows.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-xs text-muted-foreground">{key}</dt>
                <dd className="truncate font-mono text-xs text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {request.evidence.length > 0 ? (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {request.evidence.slice(0, 4).map((item) => (
              <li key={`${item.sourceType}:${item.sourceId}`}>
                evidence · <span className="font-mono text-foreground">{item.sourceType}</span>
                {item.sourceId ? ` · ${item.sourceId}` : ""}
              </li>
            ))}
          </ul>
        ) : null}

        {request.decision ? (
          <p className="text-xs text-muted-foreground">
            {request.decision === "approved" ? "Approved" : "Rejected"} {timeAgo(request.decidedAt)}
            {request.reason ? ` — “${request.reason}”` : ""}
          </p>
        ) : null}
      </div>

      {pending ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Optional note (recorded with your decision)"
            className="h-8 min-w-48 flex-1 text-xs"
            disabled={busy}
          />
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide(request.id, "rejected", reason)}
          >
            <X className="size-3" /> Reject
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={busy}
            onClick={() => onDecide(request.id, "approved", reason)}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />}
            Approve
          </Button>
        </div>
      ) : null}
    </div>
  );
}
