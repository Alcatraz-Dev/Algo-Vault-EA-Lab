"use client";

/**
 * TradingProviderStatus — Pro Terminal panel for the Unified Trading Service.
 *
 * Reads the SAME provider-neutral state as every other surface. It never knows
 * whether the account behind it is MT5, MT4, cTrader or a future AlgoVault
 * broker, and it never optimistically upgrades a stale connection: a stale or
 * disconnected provider disables execution controls and says so.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, Clock, Loader2, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTerminalData } from "./TerminalData";

type ConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "DEGRADED"
  | "STALE"
  | "ERROR"
  | "DISCONNECTING";

type Connection = {
  accountId: string;
  provider: string;
  environment: "DEMO" | "LIVE";
  state: ConnectionState;
  providerStatus: string;
  lastHeartbeatAt: number | null;
  brokerName: string | null;
  serverName: string | null;
  error: { code: string; message: string } | null;
};

const STATE_LABEL: Record<ConnectionState, string> = {
  CONNECTED: "Connected",
  DEGRADED: "Degraded",
  STALE: "Stale",
  DISCONNECTED: "Disconnected",
  CONNECTING: "Connecting",
  DISCONNECTING: "Disconnecting",
  ERROR: "Error",
};

const DOT: Record<ConnectionState, string> = {
  CONNECTED: "bg-positive",
  DEGRADED: "bg-warning",
  STALE: "bg-warning",
  DISCONNECTED: "bg-negative",
  CONNECTING: "bg-info",
  DISCONNECTING: "bg-muted-foreground",
  ERROR: "bg-negative",
};

export function TradingProviderStatus() {
  const { token, account } = useTerminalData();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(false);

  const accountId = account?.accountId ?? "";

  const load = useCallback(async () => {
    if (!token || !accountId) return;
    setLoading(true);
    try {
      const response = await fetch("/api/trading/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accountId }),
        cache: "no-store",
      });
      if (!response.ok) {
        setConnection(null);
        return;
      }
      const data = (await response.json()) as { connection?: Connection };
      setConnection(data.connection ?? null);
    } catch {
      setConnection(null);
    } finally {
      setLoading(false);
    }
  }, [token, accountId]);

  useEffect(() => {
    // Fetching is an external-system read, so it is scheduled rather than
    // performed in the effect body.
    const initial = window.setTimeout(() => void load(), 0);
    // The gateway heartbeats every 15s; poll a little slower than that so the
    // badge reflects reality without re-rendering the workspace constantly.
    const timer = window.setInterval(() => void load(), 20_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  const state: ConnectionState = connection?.state ?? "DISCONNECTED";
  const executable = state === "CONNECTED" || state === "DEGRADED";
  const isDemo = connection?.environment === "DEMO";

  return (
    <div className="border border-border px-3 py-2" aria-label="Trading provider">
      <div className="flex items-center gap-2">
        {loading ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        ) : executable ? (
          <Wifi className="size-3 text-positive" />
        ) : (
          <WifiOff className="size-3 text-negative" />
        )}
        <span className={cn("size-1.5 rounded-full", DOT[state])} aria-hidden />
        <span className="text-micro font-medium">{connection?.provider ?? "NO PROVIDER"}</span>
        <span className="text-micro text-muted-foreground">
          {executable ? STATE_LABEL[state] : STATE_LABEL[state]}
        </span>
        {connection?.environment ? (
          <span
            className={cn(
              "rounded border px-1 py-px text-micro font-semibold tracking-wide",
              isDemo
                ? "border-info/40 bg-info/10 text-info"
                : "border-negative/40 bg-negative/10 text-negative"
            )}
          >
            {connection.environment}
          </span>
        ) : null}
        {loading ? null : (
          <span className="ml-auto flex items-center gap-1 font-numeric text-micro text-muted-foreground">
            <Clock className="size-2.5" />
            {connection?.lastHeartbeatAt
              ? new Date(connection.lastHeartbeatAt).toLocaleTimeString("en-GB")
              : "no heartbeat"}
          </span>
        )}
      </div>

      {connection?.brokerName || connection?.serverName ? (
        <p className="mt-1 truncate text-micro text-muted-foreground">
          {connection.brokerName ?? "Unknown broker"} · {connection.serverName ?? "unknown server"}
        </p>
      ) : null}

      {!executable ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-micro text-warning">
          <ShieldAlert className="mt-px size-3 shrink-0" />
          <span>
            {state === "STALE"
              ? "Provider heartbeat is stale. Execution is blocked until the gateway reconnects."
              : "Provider is not connected. Execution is disabled."}
          </span>
        </p>
      ) : null}

      {!isDemo && connection ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-micro text-negative">
          <ShieldAlert className="mt-px size-3 shrink-0" />
          <span>Live (real-money) execution is disabled platform-wide.</span>
        </p>
      ) : null}

      {connection?.error ? (
        <p className="mt-1 flex items-center gap-1.5 text-micro text-muted-foreground">
          <Activity className="size-2.5" />
          {connection.error.code}
        </p>
      ) : null}
    </div>
  );
}

export default TradingProviderStatus;