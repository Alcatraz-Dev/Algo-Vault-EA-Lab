"use client";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";
import { PatternExplorer } from "@/components/market-intelligence/analytics/PatternExplorer";

export default function PatternDiscoveryPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  const samplePatterns = [
    { key: "XAUUSD|M5|LONDON|LIQUIDITY_SWEEP|BOS|BEARISH_FVG", symbol: "XAUUSD", timeframe: "M5", occurrences: 14, triggered: 7, invalidated: 2, firstObserved: 1719000000000, lastObserved: 1750000000000, dataQualityStatus: "partial" },
  ];
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Pattern Discovery" subtitle="Historical Setup Patterns · Evidence Only · No Predictions" maxWidth="max-w-[1400px]">
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
          <h1 className="text-xl font-black tracking-tight">Historical Pattern Discovery</h1>
          <p className="text-xs text-muted-foreground">Phase 11 — analytics layer over Setup Intelligence Memory. Only factual patterns and lifecycle statistics.</p>
        </div>
        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <PatternExplorer patterns={samplePatterns} />
          <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
            <h3 className="font-bold text-sm mb-3">Analytics Limitations</h3>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>Historical occurrence is not predictive.</li>
              <li>Lifecycle statistics describe past setups only.</li>
              <li>Missing historical evidence remains incomplete.</li>
              <li>Backtest / Research must be explicitly requested.</li>
            </ul>
            <div className="mt-3 text-[10px] text-amber-300">No scores. No predictions. No automatic optimization.</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
