"use client";

import { useState, useMemo, useEffect } from "react";
import { ArrowLeft, Sparkles, Globe } from "lucide-react";
import Link from "next/link";
import { generateDemoActivities } from "@/lib/live/live-aggregator";
import LiveWorldMap from "@/components/live/LiveWorldMap";
import LiveStatsRow from "@/components/live/LiveStatsRow";
import LiveActivityFeed from "@/components/live/LiveActivityFeed";
import GlobalActivity from "@/components/live/GlobalActivity";
import MarketActivity from "@/components/live/MarketActivity";
import BarCompareChart from "@/components/charts/BarCompareChart";
import ScalpingTerminal from "@/components/live/ScalpingTerminal";

export default function LivePage() {
  const [hoveredCountry, setHoveredCountry] = useState<string | undefined>(undefined);
  const [dark, setDark] = useState(false);
  const activities = useMemo(() => generateDemoActivities(60), []);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    setDark(document.documentElement.classList.contains("dark"));
    return () => observer.disconnect();
  }, []);

  // Real-time refresh
  useEffect(() => {
    const timer = setInterval(() => {
      // Refresh demo activities periodically to simulate live updates
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Simple top nav with back button */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center gap-4">
          <Link href="/" className="inline-flex items-center gap-2 rounded-lg p-2 hover:bg-muted transition text-muted-foreground hover:text-foreground" aria-label="Back to home">
            <ArrowLeft size={18} />
          </Link>
          <div className="w-px h-6 bg-border" />
          <a href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-[#ff4d00] flex items-center justify-center shadow-lg shadow-[#ff4d00]/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="leading-none">
              <div className="text-sm font-extrabold tracking-tight text-foreground group-hover:text-[#ff4d00] transition">AlgoVault</div>
              <div className="text-[10px] font-medium text-muted-foreground tracking-widest uppercase">Live</div>
            </div>
          </a>
          <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
            <span className="hidden sm:inline">Real-time trading intelligence</span>
            <span className="hidden md:inline">•</span>
            <span className="hidden md:inline">Privacy-safe aggregation</span>
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
              Real-time trading intelligence around the world. See where market analysis, smart money, and AI signals are being generated — aggregated safely at country level.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted border border-border rounded-full px-3 py-1.5">
            <Globe className="w-3.5 h-3.5 text-[#ff4d00]" />
            Interactive world view
          </div>
        </div>

        {/* Stats */}
        <LiveStatsRow />

        {/* Main grid: map + side panels */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-8 relative" aria-label="World activity map">
            <LiveWorldMap activities={activities} hoveredCountry={hoveredCountry} onHoverCountry={setHoveredCountry} light={!dark} />
          </section>
          <aside className="lg:col-span-4 grid grid-cols-1 gap-4">
            <LiveActivityFeed />
            <GlobalActivity />
            <MarketActivity />
          </aside>
        </div>

        <ScalpingTerminal />

        {/* Info cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-border bg-card/60 p-5 min-h-[150px] flex flex-col">
            <h3 className="text-sm font-bold text-foreground mb-3">Market Coverage</h3>
            <div className="space-y-2">
              {[{label:"XAUUSD",v:42},{label:"BTCUSD",v:31},{label:"EURUSD",v:14},{label:"NAS100",v:8}].map(m=>(
                <div key={m.label} className="flex items-center gap-2 text-xs"><span className="w-10 font-mono text-muted-foreground">{m.label}</span><div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full" style={{width:`${m.v}%`}}/></div><span className="w-6 text-right font-mono text-foreground">{m.v}%</span></div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card/60 p-5 min-h-[150px] flex flex-col">
            <h3 className="text-sm font-bold text-foreground mb-3">Global Activity</h3>
            <div className="space-y-2">
              {[{label:"US",v:28},{label:"UK",v:14},{label:"DE",v:9},{label:"SE",v:6}].map(m=>(
                <div key={m.label} className="flex items-center gap-2 text-xs"><span className="w-10 font-mono text-muted-foreground">{m.label}</span><div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full" style={{width:`${m.v}%`}}/></div><span className="w-6 text-right font-mono text-foreground">{m.v}%</span></div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card/60 p-5 min-h-[150px] flex flex-col">
            <h3 className="text-sm font-bold text-foreground mb-3">AI Analyses</h3>
            <div className="space-y-2">
              {[{label:"Smart Money",v:55},{label:"Signals",v:20},{label:"Scalping",v:15},{label:"Analysis",v:10}].map(m=>(
                <div key={m.label} className="flex items-center gap-2 text-xs"><span className="w-16 font-mono text-muted-foreground">{m.label}</span><div className="flex-1 h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full" style={{width:`${m.v}%`}}/></div><span className="w-6 text-right font-mono text-foreground">{m.v}%</span></div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card/60 p-5 min-h-[150px] flex flex-col">
            <h3 className="text-sm font-bold text-foreground mb-3">Live Status</h3>
            <div className="flex items-baseline gap-2 text-2xl font-extrabold text-foreground"><span>Live</span><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"/></div>
            <p className="text-xs text-muted-foreground mt-1">Aggregated • Real-time • Privacy-safe</p>
          </div>
        </div>

        {/* Bottom info */}
        <section className="rounded-2xl border border-border bg-gradient-to-r from-muted/40 to-muted/30 p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-foreground mb-1">AlgoVault Live Intelligence</h2>
            <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
              All activity is aggregated by country and market. No individual user data, IP addresses, or precise coordinates are exposed.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/market-intelligence" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#ff4d00] text-white text-sm font-bold hover:bg-[#e64400] transition shadow-lg shadow-[#ff4d00]/20">Market Intelligence</Link>
            <Link href="/analysis" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-muted text-foreground border border-border text-sm font-bold hover:bg-muted/60 transition">AI Analysis</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
