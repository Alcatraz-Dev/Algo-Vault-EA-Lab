"use client";

/**
 * ProviderConnectionCard — the "Trading Accounts" connection surface for the
 * Unified Trading Service.
 *
 * Shows every provider in the catalog with its real state. Only MT5 Demo is
 * connectable today; MT4, cTrader and AlgoVault Brokerage are rendered as
 * "Coming Soon" with an explicit NOT IMPLEMENTED note. No provider is ever
 * shown as connected unless the gateway heartbeat proves it.
 */

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
  Server,
  ShieldAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";

type ConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "DEGRADED"
  | "STALE"
  | "ERROR"
  | "DISCONNECTING";

type AccountRow = {
  id: string;
  provider: string;
  environment: "DEMO" | "LIVE";
  brokerName: string | null;
  serverName: string | null;
  externalAccountId: string | null;
  connection: ConnectionState;
  providerStatus: string;
  gatewayVersion: string | null;
  lastHeartbeatAt: number | null;
  metrics: { balance: number | null; equity: number | null; margin: number | null; freeMargin: number | null };
};

type CatalogEntry = {
  provider: string;
  label: string;
  environments: Array<"DEMO" | "LIVE">;
  enabled: boolean;
  operational: boolean;
  status: "CONNECTED_CAPABLE" | "COMING_SOON";
  note: string;
};

const STATE_STYLES: Record<ConnectionState, { dot: string; label: string; icon: typeof Wifi }> = {
  CONNECTED: { dot: "bg-emerald-500", label: "Connected", icon: Wifi },
  DEGRADED: { dot: "bg-amber-500", label: "Degraded", icon: Activity },
  STALE: { dot: "bg-amber-500", label: "Stale heartbeat", icon: Clock },
  CONNECTING: { dot: "bg-sky-500", label: "Connecting", icon: Loader2 },
  DISCONNECTING: { dot: "bg-muted-foreground", label: "Disconnecting", icon: Loader2 },
  DISCONNECTED: { dot: "bg-rose-500", label: "Disconnected", icon: WifiOff },
  ERROR: { dot: "bg-rose-500", label: "Error", icon: AlertTriangle },
};

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relative(timestamp: number | null): string {
  if (!timestamp) return "never";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export default function ProviderConnectionCard({ className }: { className?: string }) {
  const [providers, setProviders] = useState<CatalogEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (token: string) => {
    try {
      const response = await fetch("/api/trading/accounts", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        setError("Unable to load trading accounts.");
        return;
      }
      const data = (await response.json()) as { providers?: CatalogEntry[]; accounts?: AccountRow[] };
      setProviders(data.providers ?? []);
      setAccounts(data.accounts ?? []);
      setError(null);
    } catch {
      setError("Unable to load trading accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        return;
      }
      await load(await user.getIdToken());
      // The gateway heartbeat is 15s; refreshing at 20s keeps the state honest
      // without hammering RTDB.
      if (timer === null) {
        timer = window.setInterval(() => {
          void user.getIdToken().then((token) => load(token));
        }, 20_000);
      }
    });
    return () => {
      unsubscribe();
      if (timer !== null) window.clearInterval(timer);
    };
  }, [load]);

  return (
    <section
      className={cn("rounded-lg border border-border bg-card", className)}
      aria-label="Trading providers"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Server className="size-3.5 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Trading Accounts</h2>
        <span className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
          DEMO ONLY
        </span>
      </header>

      <div className="divide-y divide-border">
        {providers.map((provider) => {
          const linked = accounts.filter((account) => account.provider === provider.provider);
          return (
            <div key={provider.provider} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{provider.label}</span>
                {provider.status === "COMING_SOON" ? (
                  <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                    Coming Soon
                  </span>
                ) : (
                  <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-emerald-500">
                    Demo
                  </span>
                )}
                <span className="ml-auto font-mono text-micro text-muted-foreground">
                  {provider.environments.join(" / ")}
                </span>
              </div>

              <p className="mt-1 text-xs text-muted-foreground">{provider.note}</p>

              {provider.status === "COMING_SOON" ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-micro text-muted-foreground">
                  <CircleDashed className="size-3" />
                  Not implemented. This provider cannot be connected or executed.
                </p>
              ) : linked.length === 0 ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-micro text-muted-foreground">
                  <WifiOff className="size-3" />
                  No account connected. Start the AlgoVault Trade Gateway EA on an MT5 demo terminal.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {linked.map((account) => {
                    const style = STATE_STYLES[account.connection] ?? STATE_STYLES.DISCONNECTED;
                    const Icon = style.icon;
                    return (
                      <li
                        key={account.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-border px-2 py-1.5"
                      >
                        <span className={cn("size-2 shrink-0 rounded-full", style.dot)} aria-hidden />
                        <Icon className="size-3 text-muted-foreground" />
                        <span className="font-mono text-xs">
                          {account.externalAccountId ?? account.id}
                        </span>
                        <span className="text-micro text-muted-foreground">
                          {account.brokerName ?? "Unknown broker"} · {account.serverName ?? "unknown server"}
                        </span>
                        <span className="text-micro text-muted-foreground">{style.label}</span>
                        <span className="ml-auto font-mono text-micro text-muted-foreground">
                          hb {relative(account.lastHeartbeatAt)}
                          {account.gatewayVersion ? ` · v${account.gatewayVersion}` : ""}
                        </span>
                        <span className="w-full font-mono text-micro text-muted-foreground sm:w-auto">
                          bal {money(account.metrics.balance)} · eq {money(account.metrics.equity)} · fm{" "}
                          {money(account.metrics.freeMargin)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <footer className="flex items-start gap-2 border-t border-border px-3 py-2 text-micro text-muted-foreground">
        {error ? (
          <>
            <ShieldAlert className="mt-0.5 size-3 text-amber-500" />
            <span>{error}</span>
          </>
        ) : loading ? (
          <>
            <Loader2 className="mt-0.5 size-3 animate-spin" />
            <span>Loading connected accounts…</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="mt-0.5 size-3 text-emerald-500" />
            <span>
              Live (real-money) execution is disabled platform-wide. Broker credentials are never sent to the
              browser.
            </span>
          </>
        )}
      </footer>
    </section>
  );
}