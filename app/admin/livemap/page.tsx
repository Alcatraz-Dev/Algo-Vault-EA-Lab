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
import AdminShell from "@/components/admin/AdminShell";

export default function AdminLiveMapPage() {
  const [hoveredCountry, setHoveredCountry] = useState<string | undefined>(undefined);
  const [dark, setDark] = useState(false);
  const activities = useMemo(() => generateDemoActivities(60), []);

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    setDark(document.documentElement.classList.contains("dark"));
    return () => observer.disconnect();
  }, []);

  return (
    <AdminShell title="Live Map" subtitle="Global trading intelligence dashboard">
      <div className="space-y-6">
        <div className="rounded-2xl border border-border bg-muted/30 p-6 md:p-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition">
                <ArrowLeft size={14} /> Admin
              </Link>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-foreground leading-[1.1]">
              AlgoVault <span className="text-[#2563eb]">Live Map</span>
            </h1>
            <p className="text-sm md:text-base text-muted-foreground max-w-2xl leading-relaxed mt-2">
              Real-time aggregated trading intelligence across countries and markets.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted/50 border border-border rounded-full px-3 py-1.5">
            <Globe className="w-3.5 h-3.5 text-[#ff4d00]" />
            Interactive world view
          </div>
        </div>

        <LiveStatsRow />

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


      </div>
    </AdminShell>
  );
}
