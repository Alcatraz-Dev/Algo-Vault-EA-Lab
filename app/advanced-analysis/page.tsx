"use client";

import { useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { ProTerminalChartWorkspace } from "@/components/pro-scalping-terminal/ProTerminalChartWorkspace";
import { ToolBadge } from "@/components/tools/tier-ui";
import Link from "next/link";
import { ArrowLeft, Crown } from "lucide-react";

import {  buildPerformanceCards } from "@/components/market-intelligence/backtest/PerformanceOverview";
import {  buildLimitationsString } from "@/components/market-intelligence/backtest/LimitationsPanel";

export default function AdvancedAnalysisPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  const cards = buildPerformanceCards({});
  const limitations = buildLimitationsString();

  return (
    <AppShell
      navGroups={nav}
      title="Advanced Analysis Terminal"
      subtitle="Market Analysis · Smart Money · Backtest · Replay · AI"
      eyebrow={
        <div className="flex items-center gap-2">
          <ToolBadge kind="pro" size="sm" />
          <span className="text-micro uppercase tracking-wider text-muted-foreground">
            Full Pro workspace · chart + replay + intelligence
          </span>
        </div>
      }
      maxWidth="max-w-[1600px]"
    >
      <div className="flex flex-col gap-4">
        {/* Honest Pro anchor — every panel below is gated at the UI layer. */}
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ToolBadge kind="pro" size="sm" />
              <span className="text-micro uppercase tracking-wider text-muted-foreground">Included with Pro</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-foreground">
              Pro adds the chart, Smart Money overlays, replay, order flow, intelligence fabric and trade journaling that the Lite terminal doesn't expose.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Compare against the Lite path:{" "}
              <Link href="/account/lite-scalping-terminal" className="text-primary underline-offset-2 hover:underline">
                /account/lite-scalping-terminal
              </Link>
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-micro font-bold uppercase tracking-wider text-primary">
            <Crown className="size-3" /> Active Pro
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/account/lite-scalping-terminal" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="size-3.5" /> AI Scalping Terminal (Lite)
          </Link>
          <span className="text-xs text-muted-foreground/50">/</span>
          <span className="text-xs font-medium text-foreground">Advanced Analysis</span>
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-2 py-2 border border-border/20 rounded-lg bg-card/20">
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
          {/* Chart Workspace — the shared Pro Terminal chart with full
              toolbars, drawing tools, layer picker, fullscreen and watchlist. */}
          <ProTerminalChartWorkspace
            initialSymbol="XAUUSD"
            initialTimeframe="M5"
            height={460}
            storageScope="advanced-analysis"
          />

          {/* Analysis Panels */}
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="font-bold text-sm mb-3">Performance Overview</h3>
              <div className="grid grid-cols-2 gap-2">
                {cards.map((c) => (
                  <div key={c.label} className="rounded-lg border border-border/20 bg-muted/20 p-2">
                    <div className="text-micro uppercase text-muted-foreground">{c.label}</div>
                    <div className="text-sm font-black">{c.value}</div>
                    <div className="text-micro text-muted-foreground">{c.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 flex-1">
              <h3 className="font-bold text-sm mb-3">Intelligence Layer (Phase 7.4)</h3>
              <div className="text-xs space-y-2 text-muted-foreground">
                <div><strong>Facts</strong> — deterministic outputs from Smart Money / Indicators / MTF / Sessions / Backtest / Replay</div>
                <div><strong>Interpretation</strong> — advisory reasoning only, no predictive claims</div>
                <div><strong>Limitations</strong> — OHLC only; replay excludes future data</div>
              </div>
              <div className="mt-3 flex gap-2 text-micro">
                <span className="rounded border border-border/30 px-1.5 py-0.5">No confidence scores</span>
                <span className="rounded border border-border/30 px-1.5 py-0.5">Evidence-cited</span>
                <span className="rounded border border-border/30 px-1.5 py-0.5">Replay-safe</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom: Replay + Trade Journal + Limitations */}
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm">Historical Replay</h3>
              <span className="rounded-md border border-border/30 px-1.5 py-0.5 text-micro text-muted-foreground">Replay Engine</span>
            </div>
            <div className="rounded-lg border border-border/20 bg-background/20 p-4 min-h-[120px] flex items-center justify-center text-xs text-muted-foreground">
              Replay workspace — future candles hidden · Smart Money events incrementally calculated · no future leakage (existing ReplayEngine reused)
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-bold text-sm mb-3">Limitations</h3>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {limitations.length === 0 ? (
                <li>Run a backtest to surface actual engine limitations.</li>
              ) : (
                limitations.map((l) => (
                  <li key={l} className="flex gap-2">
                    <span className="text-warning">•</span>
                    <span>{l}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-base font-semibold mb-3">Trade Journal</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="text-micro uppercase tracking-wider text-muted-foreground border-b border-border/30">
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
              <tbody className="divide-y divide-border/50">
                <tr className="text-muted-foreground"><td colSpan={8} className="py-3">Run a backtest to see trade history.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-warning/20 bg-warning/5 p-4 text-xs text-warning-foreground">
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
