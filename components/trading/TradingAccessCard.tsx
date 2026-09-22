"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Zap, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TradingAccessLicense {
  id: string;
  status: "active" | "expired" | "revoked";
  plan: string;
  maxAccounts: number;
  startedAt: number;
  expiresAt: number;
}

function currentTimestamp(): number {
  return Date.now();
}

function formatDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function TradingAccessCard({
  license,
  loading,
  onActivate,
}: {
  license: TradingAccessLicense | null;
  loading: boolean;
  onActivate: () => void;
}) {
  if (loading) {
    return (
      <Card className="animate-pulse">
        <CardContent className="flex items-center gap-3 py-6">
          <div className="h-10 w-10 rounded bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-3 w-48 rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!license || license.status === "revoked") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Shield size={24} className="text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">Trading Access is not active.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Activate trading access to connect your MT5 account and start trading.
            </p>
          </div>
          <Button onClick={onActivate}>
            <Zap size={14} />
            Activate Trading Access
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (license.status === "expired") {
    return (
      <Card className="border-yellow-500/30">
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-500/10">
            <AlertTriangle size={24} className="text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <p className="text-sm font-semibold">Trading Access Expired</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your {license.plan} plan expired on {formatDate(license.expiresAt)}.
            </p>
          </div>
          <Button onClick={onActivate}>
            <Zap size={14} />
            Renew Trading Access
          </Button>
        </CardContent>
      </Card>
    );
  }

  const daysLeft = Math.max(
    0,
    Math.ceil((license.expiresAt - currentTimestamp()) / (1000 * 60 * 60 * 24))
  );

  return (
    <Card className="border-emerald-500/30">
      <CardContent className="py-6">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
              <Shield size={20} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">Trading Access Active</p>
              <p className="text-xs text-muted-foreground">
                {license.plan} Plan
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Started</span>
            <span className="text-sm font-mono tabular-nums">{formatDate(license.startedAt)}</span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Expires</span>
            <span className="text-sm font-mono tabular-nums">{formatDate(license.expiresAt)}</span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Days Left</span>
            <span
              className={cn(
                "text-sm font-mono font-semibold tabular-nums",
                daysLeft <= 7 ? "text-yellow-600 dark:text-yellow-400" : "text-foreground"
              )}
            >
              {daysLeft} day{daysLeft === 1 ? "" : "s"}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Max Accounts</span>
            <span className="text-sm font-mono tabular-nums">{license.maxAccounts}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
