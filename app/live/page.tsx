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
    <div className="relative overflow-hidden rounded-xl border border-border bg-muted/30">
      <div className="flex items-center">
        <div className="flex shrink-0 items-center gap-1.5 border-r border-border bg-background/60 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Radio size={11} className={isLive ? "text-emerald-500" : "text-muted-foreground"} />
          Live
        </div>
        <div className="overflow-hidden">
          <div className="ticker-track">
            {[...rows, ...rows].map((r, i) => (
              <span key={`${r.symbol}-${i}`} className="flex items-center gap-2 px-4 py-2 text-xs">
                <span className="font-mono font-bold text-foreground">{r.symbol}</span>
                <span className="font-mono text-muted-foreground tabular-nums">
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
      <Globe className="w-3.5 h-3.5 text-[#ff4d00]" />
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
      {/* Top nav */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg p-2 hover:bg-muted transition text-muted-foreground hover:text-foreground"
            aria-label="Back to home"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="w-px h-6 bg-border" />
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-[#ff4d00] flex items-center justify-center shadow-lg shadow-[#ff4d00]/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="leading-none">
              <div className="text-sm font-extrabold tracking-tight text-foreground group-hover:text-[#ff4d00] transition">
                AlgoVault
              </div>
              <div className="text-[10px] font-medium text-muted-foreground tracking-widest uppercase">Live</div>
            </div>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {sessions.length > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {sessions.join(" + ")} open
              </span>
            )}
            <button
              type="button"
              onClick={refresh}
              className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-8 md:py-10 space-y-8">
        {/* Title */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground leading-[1.1]">
              AlgoVault <span className="text-[#2563eb]">Live</span>
            </h1>
            <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-2xl leading-relaxed">
              Real-time trading intelligence around the world. See where market analysis, smart money,
              and AI signals are being generated — aggregated safely at country level.
            </p>
          </div>
          <UpdatedBadge lastTick={lastTick} />
        </div>

        <LiveTicker />

        {/* Stats */}
        <LiveStatsRow activities={activities} />

        {/* Main grid: map + side panels */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-8 relative" aria-label="World activity map">
            <LiveWorldMap
              clusters={clusters}
              hoveredCountry={hoveredCountry}
              onHoverCountry={setHoveredCountry}
              light={!dark}
              sessions={sessions}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Hover a country for its aggregated breakdown.
            </p>
          </section>
          <aside className="lg:col-span-4 grid grid-cols-1 gap-4">
            <LiveActivityFeed activities={activities} />
            <GlobalActivity clusters={clusters} />
            <MarketActivity activities={activities} />
          </aside>
        </div>

        <ScalpingTerminal pro={hasPro} />

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
              className={`text-left rounded-xl border p-4 transition ${
                hoveredCountry === c.country
                  ? "border-[#ff4d00]/50 bg-[#ff4d00]/5"
                  : "border-border bg-card/60 hover:border-border hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-lg leading-none">{c.flag ?? flagFromCountryCode(c.countryCode)}</span>
                <span className="text-xs font-bold text-foreground truncate">{c.country}</span>
              </div>
              <div className="mt-2 text-xl font-extrabold text-foreground tabular-nums">{c.activeUsers}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">active traders</div>
            </button>
          ))}
        </div>

        {/* Bottom info */}
        <section className="rounded-2xl border border-border bg-gradient-to-r from-muted/40 to-muted/30 p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
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
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#ff4d00] text-white text-sm font-bold hover:bg-[#e64400] transition shadow-lg shadow-[#ff4d00]/20"
            >
              Market Intelligence
            </Link>
            <Link
              href="/analysis"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted text-foreground border border-border text-sm font-bold hover:bg-muted/60 transition"
            >
              AI Analysis
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
