"use client";

/**
 * Admin — Trading Providers.
 *
 * Operational visibility for the Unified Trading Service using the existing
 * admin shell and auth pattern: provider catalog + feature flags, connected
 * demo accounts with heartbeat age, recent execution events and failed
 * executions. Gateway tokens and broker credentials are never fetched here.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Server, XCircle } from "lucide-react";
import AdminShell from "@/components/admin/AdminShell";
import { auth } from "@/lib/firebase";
import { cn } from "@/lib/utils";

type FlagSnapshot = Record<string, boolean | string>;

type ProviderRow = {
  provider: string;
  label: string;
  environments: string[];
  enabled: boolean;
  operational: boolean;
  status: "CONNECTED_CAPABLE" | "COMING_SOON";
  note: string;
};

type AccountRow = {
  userId: string;
  accountId: string;
  provider: string;
  environment: string;
  connection: string;
  providerStatus: string;
  brokerName: string | null;
  serverName: string | null;
  externalAccountId: string | null;
  gatewayVersion: string | null;
  balance: number | null;
  equity: number | null;
  lastHeartbeatAt: number | null;
  heartbeatAgeMs: number | null;
  connectionError: { code: string; message: string } | null;
};

type EventRow = {
  eventId: string;
  userId: string;
  accountId: string | null;
  provider: string | null;
  action: string;
  symbol: string | null;
  volume: number | null;
  result: string | null;
  errorCode: string | null;
  timestamp: number;
};

type ResultRow = {
  clientRequestId: string;
  correlationId: string;
  accountId: string;
  executionType: string;
  status: string;
  providerRef: string | null;
  createdAt: number;
  error?: { code: string } | null;
};

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ago(timestamp: number | null): string {
  if (!timestamp) return "never";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function StateBadge({ state }: { state: string }) {
  const healthy = state === "CONNECTED";
  const warn = state === "DEGRADED" || state === "STALE";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-micro font-semibold",
        healthy
          ? "border-positive/40 bg-positive/10 text-positive"
          : warn
            ? "border-warning/40 bg-warning/10 text-warning"
            : "border-negative/40 bg-negative/10 text-negative"
      )}
    >
      {healthy ? <CheckCircle2 className="size-2.5" /> : warn ? <Clock className="size-2.5" /> : <XCircle className="size-2.5" />}
      {state}
    </span>
  );
}

export default function AdminTradingProvidersPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [flags, setFlags] = useState<FlagSnapshot>({});
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [executions, setExecutions] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (token: string) => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/trading/providers", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Failed to load trading providers");
      const data = await response.json();
      setProviders(Array.isArray(data?.providers) ? data.providers : []);
      setFlags((data?.flags ?? {}) as FlagSnapshot);
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
      setEvents(Array.isArray(data?.executionEvents) ? data.executionEvents : []);
      setExecutions(Array.isArray(data?.recentExecutions) ? data.recentExecutions : []);
      setError(null);
    } catch {
      setError("Failed to load trading providers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      try {
        const token = await user.getIdToken();
        const idTokenResult = await user.getIdTokenResult();
        if (idTokenResult.claims.role !== "admin") {
          router.replace("/account");
          return;
        }
        void load(token);
      } catch {
        router.replace("/account");
      }
    });
    return () => unsubscribe();
  }, [router, load]);

  const refresh = async () => {
    const user = auth.currentUser;
    if (!user) return;
    await load(await user.getIdToken());
  };

  return (
    <AdminShell title="Trading Providers">
      <div className="space-y-6">
        <header className="flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Unified Trading — Providers &amp; Execution</h1>
          <button
            type="button"
            onClick={refresh}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            Refresh
          </button>
        </header>

        {error ? (
          <p className="flex items-center gap-2 border border-negative/30 bg-negative/5 px-3 py-2 text-xs text-negative">
            <AlertTriangle className="size-3.5" />
            {error}
          </p>
        ) : null}

        <section>
          <h2 className="mb-2 text-sm font-semibold">Capability flags</h2>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(flags).map(([key, value]) => (
              <span
                key={key}
                className={cn(
                  "rounded border px-1.5 py-0.5 font-mono text-micro",
                  value === true
                    ? "border-positive/40 bg-positive/10 text-positive"
                    : value === false
                      ? "border-border bg-muted text-muted-foreground"
                      : "border-info/40 bg-info/10 text-info"
                )}
              >
                {key}={String(value)}
              </span>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Providers</h2>
          <div className="overflow-x-auto border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Environments</th>
                  <th className="px-3 py-2">Operational</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((provider) => (
                  <tr key={provider.provider} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{provider.label}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">
                      {provider.environments.join(" / ")}
                    </td>
                    <td className="px-3 py-2">
                      <StateBadge state={provider.status} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{provider.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Connected demo accounts ({accounts.length})</h2>
          <div className="overflow-x-auto border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Env</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Heartbeat</th>
                  <th className="px-3 py-2">Balance</th>
                  <th className="px-3 py-2">Equity</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-muted-foreground">
                      No unified trading accounts registered yet.
                    </td>
                  </tr>
                ) : (
                  accounts.map((account) => (
                    <tr
                      key={`${account.userId}/${account.accountId}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 font-mono">{account.externalAccountId ?? account.accountId}</td>
                      <td className="px-3 py-2">{account.provider}</td>
                      <td className="px-3 py-2 font-mono">{account.environment}</td>
                      <td className="px-3 py-2">
                        <StateBadge state={account.connection} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{ago(account.lastHeartbeatAt)}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">{money(account.balance)}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">{money(account.equity)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {account.connectionError?.code ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Recent executions ({executions.length})</h2>
          <div className="overflow-x-auto border border-border">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Provider ref</th>
                  <th className="px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {executions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                      No executions recorded yet.
                    </td>
                  </tr>
                ) : (
                  executions.map((execution) => (
                    <tr
                      key={execution.clientRequestId}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 text-muted-foreground">{ago(execution.createdAt)}</td>
                      <td className="px-3 py-2 font-mono">{execution.executionType}</td>
                      <td className="px-3 py-2 font-mono">{execution.accountId}</td>
                      <td className="px-3 py-2">
                        <StateBadge
                          state={execution.status === "SUCCEEDED" ? "CONNECTED" : "ERROR"}
                        />
                        <span className="ml-1.5 font-mono text-micro">{execution.status}</span>
                      </td>
                      <td className="px-3 py-2 font-mono">{execution.providerRef ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{execution.error?.code ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Execution events</h2>
          <div className="max-h-96 overflow-y-auto border border-border">
            {events.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">No audit events yet.</p>
            ) : (
              events.map((event) => (
                <div
                  key={event.eventId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-micro last:border-0"
                >
                  <Activity className="size-2.5 text-muted-foreground" />
                  <span className="font-mono text-muted-foreground">{ago(event.timestamp)}</span>
                  <span className="font-medium">{event.action}</span>
                  <span className="font-mono text-muted-foreground">{event.provider ?? "—"}</span>
                  {event.symbol ? <span className="font-mono">{event.symbol}</span> : null}
                  {typeof event.volume === "number" ? (
                    <span className="font-mono text-muted-foreground">{event.volume}</span>
                  ) : null}
                  {event.errorCode ? <span className="text-negative">{event.errorCode}</span> : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}