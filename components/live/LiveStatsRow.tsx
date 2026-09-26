"use client";

import { useEffect, useState } from "react";
import { getLiveStats } from "@/lib/live/live-aggregator";
import { Activity, TrendingUp, Bot, Signal } from "lucide-react";

function AnimatedCounter({ value, label, icon: Icon }: { value: number; label: string; icon: React.ComponentType<{ className?: string; size?: number }> }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    // Small increment for demo feel
    const timer = setInterval(() => {
      setDisplay((v) => v + Math.floor(Math.random() * 3));
    }, 3000);
    return () => clearInterval(timer);
  }, []);
  const formatted = display.toLocaleString();
  return (
    <div className="flex flex-col gap-1 min-w-[140px]">
      <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground tracking-wide uppercase">
        <Icon className="w-3.5 h-3.5 text-[#ff4d00]" />
        {label}
      </div>
      <div className="text-2xl md:text-3xl font-extrabold text-foreground leading-none tracking-tight tabular-nums">
        {formatted}
        <span className="inline-flex items-center gap-1 ml-2 text-[11px] font-bold text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
        </span>
      </div>
    </div>
  );
}

export default function LiveStatsRow() {
  const stats = getLiveStats();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 py-6 border-y border-border bg-muted/30 backdrop-blur-sm rounded-xl px-4 md:px-6">
      <AnimatedCounter value={stats.activeUsers} label="Active Traders" icon={Activity} />
      <AnimatedCounter value={stats.activeMarkets} label="Markets Active" icon={TrendingUp} />
      <AnimatedCounter value={stats.aiAnalyses} label="AI Analyses" icon={Bot} />
      <AnimatedCounter value={stats.liveSignals} label="Live Signals" icon={Signal} />
    </div>
  );
}
