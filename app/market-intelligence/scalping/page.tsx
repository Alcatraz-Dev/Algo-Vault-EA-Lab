"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Activity, ShieldCheck, Clock, AlertTriangle } from "lucide-react";
import { WorkspaceContext, isValidSymbol, isValidTimeframe } from "@/components/market-intelligence/workspace-context";
import { validateContext } from "@/components/market-intelligence/workspace-context";
import { AITeamsEntryCard } from "@/components/ai-trading-teams/entry-card";
import { ChallengeContextBar } from "@/components/performance-arena/ChallengeContextBar";
import ResearchEvidencePanel from "@/components/strategy-research/ResearchEvidencePanel";

export default function AIScalpingPage() {
  const [ctx, setCtx] = useState<WorkspaceContext>({ symbol: "XAUUSD", timeframe: "M5" });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header bar matching AlgoVault compact design */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-semibold tracking-tight">AI Scalping Terminal</h1>
            <span className="inline-flex items-center rounded-full border border-positive/30 bg-positive/10 px-2.5 py-0.5 text-xs font-medium text-positive-foreground">Active</span>
          </div>
          <div className="text-sm text-muted-foreground">Market Intelligence / Scalping</div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance Arena challenge context (rendered only with an active attempt) */}
        <div className="lg:col-span-3"><ChallengeContextBar /></div>

        {/* Left: Context + Timeframe */}
        <section className="lg:col-span-1 space-y-4">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-muted-foreground" /> Market Context</h2>
            <div className="text-xs text-muted-foreground mb-3">Symbol: <span className="font-medium text-foreground">{ctx.symbol || "Not selected"}</span></div>
            <div className="text-xs text-muted-foreground mb-3">Timeframe: <span className="font-medium text-foreground">{ctx.timeframe || "Not selected"}</span></div>
            <div className="text-xs text-muted-foreground">Status: <span className="font-medium">Observing existing data sources</span></div>
          </div>

          <ResearchEvidencePanel symbol={ctx.symbol ?? "XAUUSD"} />

          <AITeamsEntryCard context="Scalping Terminal" />

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-muted-foreground" /> MTF Alignment</h2>
            <div className="text-xs text-muted-foreground mb-2">MTF states are derived deterministically. No invented alignment scores.</div>
            <div className="text-xs text-muted-foreground mb-2">States: aligned · mixed · conflicting · insufficient_data · unavailable</div>
            <div className="space-y-1 text-xs">
              {["M1","M3","M5","M15","H1","H4"].map(tf => (
                <div key={tf} className="flex justify-between">
                  <span>{tf}</span>
                  <span className="text-muted-foreground">Available if structure data exists</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Center: Main analysis */}
        <section className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-base font-semibold mb-4">Current Analysis</h2>
            <div className="text-sm text-muted-foreground mb-2">AI receives structured market context from existing market intelligence components.</div>
            <div className="rounded-lg bg-muted/50 border border-border p-4 text-sm text-foreground space-y-3">
              <div><span className="font-semibold text-foreground">Observed</span> — What engines detected (unavailable if missing).</div>
              <div><span className="font-semibold text-foreground">Derived</span> — Deterministic calculations from observed data.</div>
              <div><span className="font-semibold text-foreground">Historical</span> — Existing backtest/replay (unavailable if no session).</div>
              <div><span className="font-semibold text-foreground">AI Interpretation</span> — Explanation of structured evidence only.</div>
              <div className="pt-2 border-t"><strong>Market Bias:</strong> Not available — requires existing structured signal.</div>
              <div><strong>Setup Context:</strong> Not available — requires confirmed Smart Money / liquidity events.</div>
              <div><strong>Invalidation:</strong> Not available — requires confirmed structural levels.</div>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">AI does not invent market conditions. It explains observed structured data.</div>
          </div>

          <div className="rounded-lg border border-border bg-card p-6">
            <h3 className="font-semibold mb-3">Historical Context</h3>
            <p className="text-sm text-muted-foreground">Historical replay uses the existing backtest/replay infrastructure.</p>
            <Link href="/market-intelligence/backtest" className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2">
              Open Backtest Terminal <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
