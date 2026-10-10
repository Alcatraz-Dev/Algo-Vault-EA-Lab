"use client";

/**
 * /account/live — the signed-in user's connected MT5 accounts.
 *
 * Reads from /api/account/live (server-side scoping to token.uid) and renders
 * real heartbeats, balances and floating P/L. The AlgoVault Live marketing
 * map lives on /live; this page is deliberately operational.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Bot,
  DollarSign,
  Plug,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import BarCompareChart from "@/components/charts/BarCompareChart";
import type { LiveAccountSnapshot } from "@/lib/live/live-types";

const ONLINE_WINDOW_MS = 90_000;
const POLL_MS = 30_000;

function formatMoney(v: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

function timeAgo(ms?: number | null, now = 0) {
  if (!ms) return "Never";
  const diff = Math.floor((now - ms) / 1000);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function StatusPill({ online }: { online: boolean }) {
  return online ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/20 bg-positive/10 px-2 py-0.5 text-micro font-bold text-positive">
      <Wifi size={10} /> LIVE
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-micro font-bold text-muted-foreground">
      <WifiOff size={10} /> OFFLINE
    </span>
  );
}

export default function AccountLivePage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<LiveAccountSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (u) => setSignedIn(Boolean(u))), []);

  const fetchAccounts = useCallback(async (silent = false): Promise<void> => {
    if (!signedIn) return;
    if (!silent) setLoading(true);
    // Yield so this never completes synchronously inside an effect body.
    await Promise.resolve();
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");
      const res = await fetch("/api/account/live", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { accounts?: LiveAccountSnapshot[]; error?: string }
        | null;
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
      setNow(Date.now());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    // Deferred initial fetch so no state is set synchronously in the effect.
    const t = setTimeout(() => void fetchAccounts(), 0);
    const id = setInterval(() => void fetchAccounts(true), POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [signedIn, fetchAccounts]);

  // Keep the heartbeat-relative clock ticking between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const online = accounts.filter((a) => a.lastHeartbeatAt && now - a.lastHeartbeatAt < ONLINE_WINDOW_MS);
  const totalBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const totalEquity = accounts.reduce((s, a) => s + (a.equity || a.balance || 0), 0);
  const totalFloating = accounts.reduce((s, a) => s + (a.floatingProfit || 0), 0);
  const worstDrawdown = accounts.reduce((m, a) => Math.max(m, a.drawdown || 0), 0);

  const chartData = useMemo(
    () =>
      accounts.map((a) => ({
        label: a.mt5Account ? `#${a.mt5Account}` : a.productName || a.id,
        value: a.equity ?? a.balance ?? 0,
      })),
    [accounts]
  );

  if (!signedIn) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-lg border border-border bg-card/60 p-8 text-center">
          <Plug className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sign in to view your live accounts</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect an MT5 account via a product license to see real-time balance, equity and heartbeats here.
          </p>
          <Link
            href="/login?redirect=/account/live"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-background hover:bg-primary/80 transition"
          >
            Sign in <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AccountShell
      title="Live Accounts"
      subtitle="Real-time heartbeat monitoring across your connected MT5 accounts."
      eyebrow="Your account"
      onBack={() => router.push("/account")}
      headerActions={
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-positive/20 bg-positive/10 px-3 py-1.5 text-xs font-semibold text-positive">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-positive" />
            </span>
            {online.length} live
          </span>
          <button
            type="button"
            onClick={() => void fetchAccounts()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Accounts", value: String(accounts.length), icon: Bot },
            { label: "Total Balance", value: formatMoney(totalBalance), icon: DollarSign },
            {
              label: "Total Equity",
              value: formatMoney(totalEquity),
              icon: TrendingUp,
              sub: totalEquity >= totalBalance ? "above balance" : "below balance",
            },
            {
              label: "Floating P/L",
              value: `${totalFloating >= 0 ? "+" : ""}${formatMoney(totalFloating)}`,
              icon: totalFloating >= 0 ? TrendingUp : TrendingDown,
              tone: totalFloating >= 0 ? "text-positive" : "text-negative",
              sub: `worst DD ${worstDrawdown.toFixed(1)}%`,
            },
          ].map(({ label, value, icon: Icon, tone, sub }) => (
            <div key={label} className="rounded-lg border border-border bg-muted/40 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className={`mt-2 text-2xl font-bold tabular-nums ${tone ?? "text-foreground"}`}>{value}</p>
                  {sub && <p className="mt-1 text-micro text-muted-foreground">{sub}</p>}
                </div>
                <div className="rounded-lg border border-border bg-muted/50 p-2.5">
                  <Icon className="h-5 w-5 text-foreground" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="rounded-lg border border-negative/20 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div>
        )}

        {/* Equity chart */}
        {!loading && accounts.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/40 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Equity by Account</h2>
                <p className="mt-1 text-sm text-muted-foreground">Latest reported equity across your accounts</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted/50">
                <Activity className="h-5 w-5 text-foreground" />
              </div>
            </div>
            <div className="mt-6">
              <BarCompareChart data={chartData} xKey="label" valueKey="value" height={220} colorVar="var(--chart-2)" formatValue={(v) => formatMoney(v)} />
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="rounded-lg border border-border bg-muted/30 p-16 text-center">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Loading accounts...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-16 text-center">
            <Activity className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <h3 className="font-semibold">No live accounts yet</h3>
            <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
              Attach a product license to your MT5 terminal — accounts appear here as soon as the EA sends its first heartbeat.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-4 text-left">Status</th>
                    <th className="px-5 py-4 text-left">Product / Account</th>
                    <th className="px-5 py-4 text-left">Broker</th>
                    <th className="px-5 py-4 text-right">Balance</th>
                    <th className="px-5 py-4 text-right">Equity</th>
                    <th className="px-5 py-4 text-right">Floating P/L</th>
                    <th className="px-5 py-4 text-right">Drawdown</th>
                    <th className="px-5 py-4 text-right">Heartbeat</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => {
                    const isOnline = Boolean(a.lastHeartbeatAt && now - a.lastHeartbeatAt < ONLINE_WINDOW_MS);
                    const fl = a.floatingProfit || 0;
                    const dd = a.drawdown || 0;
                    return (
                      <tr key={a.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                        <td className="px-5 py-4"><StatusPill online={isOnline} /></td>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-foreground">{a.productName || a.productId}</p>
                          <p className="text-xs text-muted-foreground font-numeric mt-0.5">MT5 #{a.mt5Account}</p>
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">
                          <p>{a.broker || "—"}</p>
                          {a.server && <p className="text-xs text-muted-foreground">{a.server}</p>}
                        </td>
                        <td className="px-5 py-4 text-right font-semibold text-foreground tabular-nums">
                          {a.balance != null ? formatMoney(a.balance, a.currency) : "—"}
                        </td>
                        <td className="px-5 py-4 text-right text-foreground tabular-nums">
                          {a.equity != null ? formatMoney(a.equity, a.currency) : "—"}
                        </td>
                        <td className={`px-5 py-4 text-right font-semibold tabular-nums ${fl >= 0 ? "text-positive" : "text-negative"}`}>
                          {fl >= 0 ? "+" : ""}{formatMoney(fl, a.currency)}
                        </td>
                        <td className={`px-5 py-4 text-right tabular-nums ${dd > 20 ? "text-negative font-semibold" : "text-muted-foreground"}`}>
                          {a.drawdown != null ? `${a.drawdown.toFixed(2)}%` : "—"}
                        </td>
                        <td className="px-5 py-4 text-right text-xs text-muted-foreground">{timeAgo(a.lastHeartbeatAt, now)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AccountShell>
  );
}
