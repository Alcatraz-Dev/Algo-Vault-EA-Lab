"use client";

import { useMemo } from "react";
import {
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Wifi,
  WifiOff,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface TradingAccount {
  accountId: string;
  mt5Account: string;
  broker: string;
  server: string;
  currency: string;
  leverage: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  status: "connected" | "offline" | "unauthorized" | "license_expired" | "disabled";
  lastHeartbeatAt: number;
  gatewayVersion: string;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "Never";
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minute${Math.floor(diff / 60) === 1 ? "" : "s"} ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hour${Math.floor(diff / 3600) === 1 ? "" : "s"} ago`;
  return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) === 1 ? "" : "s"} ago`;
}

function StatusDot({ status, lastHeartbeat }: { status: TradingAccount["status"]; lastHeartbeat: number }) {
  const age = Math.floor((Date.now() - lastHeartbeat) / 1000);
  const isConnected = status === "connected" && age < 120;
  const isUnstable = status === "connected" && age >= 60;
  const isOffline = !isConnected || age > 120;

  const dotClass = isConnected && !isUnstable
    ? "bg-emerald-500"
    : isUnstable
    ? "bg-yellow-500"
    : "bg-rose-500";

  return (
    <span className="relative flex h-2.5 w-2.5">
      {isConnected && !isUnstable && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
      )}
      <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", dotClass)} />
    </span>
  );
}

function StatItem({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold", mono && "font-mono tabular-nums")}>
        {value}
      </span>
    </div>
  );
}

export default function AccountHeader({
  account,
  loading,
}: {
  account: TradingAccount | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card className="animate-pulse">
        <CardContent className="py-4">
          <div className="flex gap-6">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="h-3 w-16 rounded bg-muted" />
                <div className="h-5 w-24 rounded bg-muted" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!account) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-4 text-muted-foreground">
          <WifiOff size={16} />
          <span className="text-sm">No trading account connected.</span>
        </CardContent>
      </Card>
    );
  }

  const statusLabel =
    account.status === "connected"
      ? "Connected"
      : account.status === "offline"
      ? "Offline"
      : account.status === "unauthorized"
      ? "Unauthorized"
      : account.status === "license_expired"
      ? "License Expired"
      : "Disabled";

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-6">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <StatusDot status={account.status} lastHeartbeat={account.lastHeartbeatAt} />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">
                {account.broker}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {account.mt5Account} · {account.server}
              </span>
            </div>
          </div>

          <Separator orientation="vertical" className="h-8" />

          <StatItem label="Balance" value={`$${formatCurrency(account.balance)}`} />
          <StatItem label="Equity" value={`$${formatCurrency(account.equity)}`} />
          <StatItem label="Margin" value={`$${formatCurrency(account.margin)}`} />
          <StatItem label="Free Margin" value={`$${formatCurrency(account.freeMargin)}`} />
          <StatItem
            label="Margin Level"
            value={account.marginLevel > 0 ? `${account.marginLevel.toFixed(1)}%` : "N/A"}
          />

          <Separator orientation="vertical" className="h-8" />

          {/* Meta info */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Last Update</span>
            <span className="flex items-center gap-1.5 text-sm font-mono tabular-nums">
              <Clock size={12} className="text-muted-foreground" />
              {formatRelativeTime(account.lastHeartbeatAt)}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Gateway</span>
            <span className="flex items-center gap-1.5 text-sm">
              <Activity size={12} className="text-muted-foreground" />
              v{account.gatewayVersion}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Leverage</span>
            <span className="text-sm font-mono tabular-nums">1:{account.leverage}</span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Currency</span>
            <span className="text-sm font-mono tabular-nums">{account.currency}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
