"use client";

/**
 * AlgoVault Live — public real-time intelligence surface.
 *
 * One shared rolling feed (`useLiveActivities`) powers the stats, the world
 * map and every side panel, so all numbers agree. The market ticker polls the
 * real quotes endpoint and degrades gracefully when it's unreachable.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Sparkles, Globe, Radio } from "lucide-react";
import Link from "next/link";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onSubscriptionChange } from "@/lib/subscription";
import { useLiveActivities } from "@/hooks/useLiveActivities";
import { useLivePrices } from "@/hooks/useLivePrices";
import { MARKET_UNIVERSE, flagFromCountryCode } from "@/lib/live/live-types";
import LiveWorldMap from "@/components/live/LiveWorldMap";
import LiveStatsRow from "@/components/live/LiveStatsRow";
import LiveActivityFeed from "@/components/live/LiveActivityFeed";
import GlobalActivity from "@/components/live/GlobalActivity";
import MarketActivity from "@/components/live/MarketActivity";
import ModernPageHeader from "@/components/ui/modern-page-header";
import ScalpingTerminal from "@/components/live/ScalpingTerminal";

function LiveTicker() {
  const symbols = [...MARKET_UNIVERSE];
  const [user, setUser] = useState<FirebaseUser | null>(null);
  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);
  // Quotes require auth — only poll for signed-in visitors.
  const { prices, isLive } = useLivePrices(user ? symbols : [], { intervalMs: 12_000 });

  const rows = useMemo(
    () =>
      [...MARKET_UNIVERSE]
        .map((s) => ({ symbol: s, price: prices[s] }))
        .filter((r) => r.price),
    [prices]
  );

  if (rows.length === 0) {
    return null; // no quotes yet — render nothing rather than fake data
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="flex items-center">
        <div className="flex shrink-0 items-center gap-1.5 border-r border-border bg-background/60 px-3 py-2 text-micro font-bold uppercase tracking-widest text-muted-foreground">
          <Radio size={11} className={isLive ? "text-positive" : "text-muted-foreground"} />
          Live
        </div>
        <div className="overflow-hidden">
          <div className="ticker-track">
            {[...rows, ...rows].map((r, i) => (
              <span key={`${r.symbol}-${i}`} className="flex items-center gap-2 px-4 py-2 text-xs">
                <span className="font-numeric font-bold text-foreground">{r.symbol}</span>
                <span className="font-numeric text-muted-foreground tabular-nums">
                  {r.price >= 100 ? r.price.toFixed(2) : r.price.toFixed(4)}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function UpdatedBadge({ lastTick }: { lastTick: number }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, []);
  const secs = lastTick && now ? Math.max(0, Math.round((now - lastTick) / 1000)) : 0;
  return (
    <div className="shrink-0 flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted border border-border rounded-full px-3 py-1.5">
      <Globe className="w-3.5 h-3.5 text-primary" />
      {lastTick ? `Updated ${secs}s ago` : "Connecting…"}
    </div>
  );
}

export default function LivePage() {
  const [hoveredCountry, setHoveredCountry] = useState<string | undefined>(undefined);
  const [dark, setDark] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [hasPro, setHasPro] = useState(false);
  const { activities, clusters, sessions, lastTick, refresh } = useLiveActivities(60, 15_000);

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { hasSubscription } = await onSubscriptionChange(user.uid);
        if (!cancelled) setHasPro(hasSubscription);
      } catch {
        if (!cancelled) setHasPro(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const topClusters = clusters.slice(0, 5);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-8 md:py-10 space-y-8">
        <ModernPageHeader
            backHref="/"
            backLabel="Back to home"
            eyebrow="Live Intelligence"
            title="AlgoVault Live"
            subtitle="Real-time trading intelligence around the world. See where market analysis, smart money, and AI signals are being generated — aggregated safely at country level."
            actions={
                <div className="flex items-center gap-2">
                    {sessions.length > 0 && (
                        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-positive/20 bg-positive/10 px-3 py-1 text-micro font-semibold text-positive">
                            <span className="h-1.5 w-1.5 rounded-full bg-positive animate-pulse" />
                            {sessions.join(" + ")} open
                        </span>
                    )}
                    <UpdatedBadge lastTick={lastTick} />
                    <button type="button" onClick={refresh} className="rounded-full border border-border px-3 py-1 text-micro font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">Refresh</button>
                </div>
            }
        />

        <LiveTicker />

        {/* Stats */}
        <LiveStatsRow activities={activities} />

        {/* Main grid: map + side panels */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-12 relative" aria-label="World activity map">
            <LiveWorldMap
              clusters={clusters}
              hoveredCountry={hoveredCountry}
              onHoverCountry={setHoveredCountry}
              light={!dark}
              sessions={sessions}
            />
            <p className="mt-2 text-micro text-muted-foreground">
              Hover a country for its aggregated breakdown.
            </p>
          </section>
          <aside className="lg:col-span-12 grid grid-cols-1 gap-4">
            <LiveActivityFeed activities={activities} />
            <GlobalActivity clusters={clusters} />
            <MarketActivity activities={activities} />
          </aside>
        </div>

        {/* Top countries strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {topClusters.map((c) => (
            <button
              key={c.countryCode + c.country}
              type="button"
              onMouseEnter={() => setHoveredCountry(c.country)}
              onMouseLeave={() => setHoveredCountry(undefined)}
              onFocus={() => setHoveredCountry(c.country)}
              onBlur={() => setHoveredCountry(undefined)}
              className={`text-left rounded-lg border p-4 transition-colors ${
                hoveredCountry === c.country
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-card/60 hover:border-border hover:bg-muted/40"
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

        {/* Bottom info */}
        <section className="rounded-xl border border-border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-foreground mb-1">
              AlgoVault Live Intelligence
            </h2>
            <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
              All activity is aggregated by country and market. No individual user data, IP addresses,
              or precise coordinates are exposed.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/market-intelligence"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/80 transition-colors"
            >
              Market Intelligence
            </Link>
            <Link
              href="/account/analysis"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted text-foreground border border-border text-sm font-bold hover:bg-muted/60 transition-colors"
            >
              AI Analysis
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
