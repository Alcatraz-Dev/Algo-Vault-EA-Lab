"use client";

/**
 * /admin/livemap — operator view fusing the public Live intelligence surface
 * (shared rolling feed, world map, panels) with real connected-account stats
 * from /api/admin/live. Public map on top, ops strip beneath.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe, RefreshCw, Wifi, Bot, DollarSign, Activity } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useLiveActivities } from "@/hooks/useLiveActivities";
import { flagFromCountryCode, type LiveAccountSnapshot } from "@/lib/live/live-types";
import LiveWorldMap from "@/components/live/LiveWorldMap";
import LiveStatsRow from "@/components/live/LiveStatsRow";
import LiveActivityFeed from "@/components/live/LiveActivityFeed";
import GlobalActivity from "@/components/live/GlobalActivity";
import MarketActivity from "@/components/live/MarketActivity";
import AdminShell from "@/components/admin/AdminShell";

const ONLINE_WINDOW_MS = 90_000;

function formatMoney(v: number) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
  } catch {
    return `$${Math.round(v)}`;
  }
}

export default function AdminLiveMapPage() {
  const [hoveredCountry, setHoveredCountry] = useState<string | undefined>(undefined);
  const [dark, setDark] = useState(false);
  const [now, setNow] = useState(0);
  const { activities, clusters, sessions, lastTick, refresh } = useLiveActivities(60, 15_000);

  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, []);

  // Real account stats (best-effort — page degrades to the public map only).
  const [accounts, setAccounts] = useState<LiveAccountSnapshot[]>([]);

  useEffect(() => {
    const readDark = () =>
      !document.documentElement.classList.contains("light");
    const observer = new MutationObserver(() => setDark(readDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const t = setTimeout(() => setDark(readDark()), 0);
    return () => {
      observer.disconnect();
      clearTimeout(t);
    };
  }, []);



  const fetchAccounts = useCallback(async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch("/api/admin/live", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as { accounts?: LiveAccountSnapshot[] } | null;
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
      setNow(Date.now());
    } catch {
      // Ops strip is additive; stay silent so the map keeps working.
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void fetchAccounts(), 0);
    const id = setInterval(() => void fetchAccounts(), 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [fetchAccounts]);

  const onlineAccounts = accounts.filter(
    (a) => a.lastHeartbeatAt && now - a.lastHeartbeatAt < ONLINE_WINDOW_MS
  );
  const totalBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0);

  // Attribute connected accounts onto the map by broker country approximation
  // is intentionally avoided (privacy) — instead show a per-session ops strip.
  const opsBySession = useMemo(() => {
    return sessions.map((s) => ({
      session: s,
      online: onlineAccounts.length,
      total: accounts.length,
      balance: totalBalance,
    }));
  }, [sessions, onlineAccounts.length, accounts.length, totalBalance]);

  return (
    <AdminShell title="Live Map" subtitle="Global trading intelligence + connected account operations">
      <div className="space-y-6">
        {/* Header row */}
        <div className="rounded-lg border border-border bg-muted/30 p-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground leading-tight">
              AlgoVault <span className="text-[#2563eb]">Live Map</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
              Aggregated public activity across countries and markets, alongside live heartbeat
              operations for connected MT5 accounts.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <Globe className="w-3.5 h-3.5 text-primary" />
              {lastTick && now ? `Updated ${Math.max(0, Math.round((now - lastTick) / 1000))}s ago` : "Connecting…"}
            </span>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <RefreshCw size={12} /> Refresh feed
            </button>
          </div>
        </div>

        {/* Ops strip: real connected accounts */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Connected Accounts", value: String(accounts.length), icon: Bot, sub: `${onlineAccounts.length} online now` },
            { label: "Online Heartbeats", value: String(onlineAccounts.length), icon: Wifi, sub: "90s window" },
            { label: "Aggregate Balance", value: formatMoney(totalBalance), icon: DollarSign, sub: "all accounts" },
            { label: "Open Sessions", value: sessions.join(" + ") || "Closed", icon: Activity, sub: "FX session clock (UTC)" },
          ].map(({ label, value, icon: Icon, sub }) => (
            <div key={label} className="rounded-lg border border-border bg-muted/40 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="mt-2 text-xl font-bold text-foreground tabular-nums">{value}</p>
                  {sub && <p className="mt-1 text-micro text-muted-foreground">{sub}</p>}
                </div>
                <div className="rounded-lg border border-border bg-muted/50 p-2.5">
                  <Icon className="h-5 w-5 text-foreground" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <LiveStatsRow activities={activities} />

        {/* Map + panels */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-8" aria-label="World activity map">
            <LiveWorldMap
              clusters={clusters}
              hoveredCountry={hoveredCountry}
              onHoverCountry={setHoveredCountry}
              light={!dark}
              sessions={sessions}
            />
          </section>
          <aside className="lg:col-span-4 grid grid-cols-1 gap-4">
            <LiveActivityFeed activities={activities} />
            <GlobalActivity clusters={clusters} />
            <MarketActivity activities={activities} />
          </aside>
        </div>

        {/* Top countries */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {clusters.slice(0, 5).map((c) => (
            <button
              key={c.countryCode + c.country}
              type="button"
              onMouseEnter={() => setHoveredCountry(c.country)}
              onMouseLeave={() => setHoveredCountry(undefined)}
              onFocus={() => setHoveredCountry(c.country)}
              onBlur={() => setHoveredCountry(undefined)}
              className={`text-left rounded-lg border p-4 transition ${
                hoveredCountry === c.country
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-card/60 hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-lg leading-none">{c.flag ?? flagFromCountryCode(c.countryCode)}</span>
                <span className="text-xs font-bold text-foreground truncate">{c.country}</span>
              </div>
              <div className="mt-2 text-xl font-extrabold text-foreground tabular-nums">{c.activeUsers}</div>
              <div className="text-micro uppercase tracking-wider text-muted-foreground">active traders</div>
            </button>
          ))}
        </div>

        {opsBySession.length === 0 && (
          <p className="text-xs text-muted-foreground">All FX sessions currently closed (weekend).</p>
        )}
      </div>
    </AdminShell>
  );
}
