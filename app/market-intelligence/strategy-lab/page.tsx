"use client";

import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function MarketIntelligenceStrategyLabPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Trading Studio" subtitle="Analyze → Build → Backtest → Replay → AI → Modify" maxWidth="max-w-[1600px]">
      <div className="rounded-lg border border-border bg-card p-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-base font-semibold tracking-tight">Trading Studio Workspace</h1>
          <Badge variant="outline">Phase 5.5</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Unified market-intelligence workspace: React Flow strategy graph + chart + Smart Money + indicators + replay + AI + backtest — all connected, none replaced.</p>

        <div className="grid lg:grid-cols-3 gap-4 mb-6">
          <div className="rounded-lg border border-border/20 bg-background p-4">
            <h3 className="font-bold text-sm mb-2">Node Library</h3>
            <ul className="text-xs space-y-1 text-muted-foreground">
              <li>Market · Indicators</li>
              <li>Smart Money (BOS / MSS / FVG / OB / Sweep)</li>
              <li>Sessions · MTF</li>
              <li>Logic (AND / OR / NOT)</li>
              <li>Entry · Exit · Risk</li>
            </ul>
          </div>
          <div className="rounded-lg border border-border/20 bg-background p-4">
            <h3 className="font-bold text-sm mb-2">Cross-Highlighting</h3>
            <ul className="text-xs space-y-1 text-muted-foreground">
              <li>Node click → Chart focus</li>
              <li>Event → Timeline + Chart</li>
              <li>Trade → Entry/SL/TP markers</li>
              <li>AI evidence → Source event</li>
            </ul>
          </div>
          <div className="rounded-lg border border-border/20 bg-background p-4">
            <h3 className="font-bold text-sm mb-2">Integration</h3>
            <ul className="text-xs space-y-1 text-muted-foreground">
              <li>Backtest → Real metrics</li>
              <li>Replay → Smart Money visible</li>
              <li>AI Copilot → Proposals validated</li>
              <li>Generator → StrategyDefinition</li>
            </ul>
          </div>
        </div>

        <div className="rounded-lg border border-warning/20 bg-warning/5 p-4 text-xs text-warning-foreground mb-6">
          <strong>Trading Studio preserved.</strong> React Flow canvas, Strategy Lab, Workflow Automation, and existing chart components remain intact. The adapter connects them rather than replacing them.
        </div>

        <div className="rounded-lg border border-dashed border-border/30 p-6 text-center text-sm text-muted-foreground">
          Phase 5.5 — Professional trading research terminal. All engines (Market Data · Indicators · Smart Money · Sessions · Backtest · Replay · AI) feed into one coherent workspace.
        </div>
      </div>
    </AppShell>
  );
}
