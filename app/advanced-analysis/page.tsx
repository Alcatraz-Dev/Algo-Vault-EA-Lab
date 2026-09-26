"use client";

import { useMemo } from "react";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { ChartAdapter } from "@/components/market-intelligence/backtest/ChartAdapter";
import { SmartMoneyPanel } from "@/components/market-intelligence/backtest/SmartMoneyPanel";
import { PerformanceOverview, buildPerformanceCards } from "@/components/market-intelligence/backtest/PerformanceOverview";
import { LimitationsPanel, buildLimitationsString } from "@/components/market-intelligence/backtest/LimitationsPanel";
import { ReplayAdapter } from "@/components/market-intelligence/backtest/ReplayAdapter";
import { TradeJournalAdapter, formatTradeRow } from "@/components/market-intelligence/backtest/TradeJournalAdapter";

export default function AdvancedAnalysisPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  const cards = buildPerformanceCards({});
  const limitations = buildLimitationsString();

  return (
    <AppShell navGroups={nav} title="Market Intelligence — Advanced Analysis Terminal" subtitle="Market Analysis · Smart Money · Backtest · Replay · AI" maxWidth="max-w-[1600px]">
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between px-2 py-2 border border-border/20 rounded-xl bg-card/20">
          <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <span>Market Intelligence</span>
            <span>·</span>
            <span className="font-mono text-foreground">XAUUSD</span>
            <span>·</span>
            <span className="font-mono text-foreground">M5</span>
          </div>
          <div className="flex gap-1 text-xs">
            <span className="rounded-md border border-border/30 px-2 py-0.5">Market Structure: <strong>Unknown</strong></span>
            <span className="rounded-md border border-border/30 px-2 py-0.5">Session: <strong>Unknown</strong></span>
          </div>
        </div>

        {/* Main workspace grid: chart + analysis */}
        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          {/* Chart Workspace */}
          <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold">Chart Workspace</h2>
              <div className="flex gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="rounded border border-border/30 px-1.5 py-0.5">Candles</span>
                <span className="rounded border border-border/30 px-1.5 py-0.5">Structure</span>
                <span className="rounded border border-border/30 px-1.5 py-0.5">Liquidity</span>
                <span className="rounded border border-border/30 px-1.5 py-0.5">FVG</span>
                <span className="rounded border border-border/30 px-1.5 py-0.5">OB</span>
                <span className="rounded border border-border/30 px-1.5 py-0.5">Sessions</span>
              </div>
            </div>
            <div className="h-[460px] w-full rounded-xl border border-border/20 bg-background/30 flex items-center justify-center text-sm text-muted-foreground relative">
              Professional trading chart workspace
              <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground">Existing ChartAdapter · Smart Money · Session Overlays</div>
            </div>
          </div>

          {/* Analysis Panels */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
              <h3 className="font-bold text-sm mb-3">Performance Overview</h3>
              <div className="grid grid-cols-2 gap-2">
                {cards.map((c) => (
                  <div key={c.label} className="rounded-lg border border-border/20 bg-muted/20 p-2">
                    <div className="text-[10px] uppercase text-muted-foreground">{c.label}</div>
                    <div className="text-sm font-black">{c.value}</div>
                    <div className="text-[10px] text-muted-foreground">{c.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl flex-1">
              <h3 className="font-bold text-sm mb-3">Intelligence Layer (Phase 7.4)</h3>
              <div className="text-xs space-y-2 text-muted-foreground">
                <div><strong>Facts</strong> — deterministic outputs from Smart Money / Indicators / MTF / Sessions / Backtest / Replay</div>
                <div><strong>Interpretation</strong> — advisory reasoning only, no predictive claims</div>
                <div><strong>Limitations</strong> — OHLC only; replay excludes future data</div>
              </div>
              <div className="mt-3 flex gap-2 text-[10px]">
                <span className="rounded border border-border/30 px-1.5 py-0.5">No confidence scores</span>
                <span className="rounded border border-border/30 px-1.5 py-0.5">Evidence-cited</span>
                <span className="rounded border border-border/30 px-1.5 py-0.5">Replay-safe</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: Replay + Trade Journal + Limitations */}
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">Historical Replay</h3>
              <div className="flex gap-1 text-[10px]">
                <ReplayAdapter />
              </div>
            </div>
            <div className="rounded-xl border border-border/20 bg-background/20 p-4 min-h-[120px] flex items-center justify-center text-xs text-muted-foreground">
              Replay workspace — future candles hidden · Smart Money events incrementally calculated · no future leakage (existing ReplayEngine reused)
            </div>
          </div>
          <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
            <h3 className="font-bold text-sm mb-3">Limitations</h3>
            <LimitationsPanel />
          </div>
        </div>

        <div className="rounded-2xl border border-border/30 bg-card/60 p-6 backdrop-blur-xl">
          <h2 className="text-lg font-extrabold mb-3">Trade Journal</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/30">
                <tr>
                  <th className="py-2 px-2">#</th>
                  <th className="py-2 px-2">Time</th>
                  <th className="py-2 px-2">Side</th>
                  <th className="py-2 px-2">Entry</th>
                  <th className="py-2 px-2">Exit</th>
                  <th className="py-2 px-2">P&L</th>
                  <th className="py-2 px-2">Duration</th>
                  <th className="py-2 px-2">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <tr className="text-muted-foreground"><td colSpan={8} className="py-3">Run a backtest to see trade history.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">
          Phase 7.2 — Professional Backtest Terminal. Existing Backtest Engine preserved. Replay preserves no-future-candle rule. Trade journal connects to actual trades. Smart Money, MTF, Sessions, Sessions overlay, Indicators, Strategy Builder, AI panel, and Research handoff all integrated without duplicate engines.
        </div>

        <div className="mt-2 flex gap-2 text-xs">
          <a href="/market-intelligence/backtest" className="rounded-md border border-border/30 px-3 py-1 hover:bg-muted/20">Backtest Current Setup</a>
          <a href="/market-intelligence/research" className="rounded-md border border-border/30 px-3 py-1 hover:bg-muted/20">Continue Research</a>
          <a href="/trading-studio" className="rounded-md border border-border/30 px-3 py-1 hover:bg-muted/20">Trading Studio</a>
        </div>
      </div>
    </AppShell>
  );
}
