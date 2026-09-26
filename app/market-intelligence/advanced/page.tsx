"use client";

import Link from "next/link";
import { ArrowUpRight, Activity, ShieldCheck, Database } from "lucide-react";

export default function AdvancedAnalysisPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Advanced Market Intelligence</h1>
          <div className="text-sm text-muted-foreground">Market Intelligence / Advanced</div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><Activity className="w-5 h-5 text-amber-600" /> Technical Analysis</h3>
          <p className="text-sm text-muted-foreground">Uses existing indicator engine, chart adapters, and market data services. No fabricated indicators.</p>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-blue-600" /> Smart Money & Liquidity</h3>
          <p className="text-sm text-muted-foreground">Integrates with existing Smart Money engine (structure, liquidity zones, FVG, order blocks, premium/discount).</p>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><Database className="w-5 h-5 text-emerald-600" /> Multi-Timeframe Context</h3>
          <p className="text-sm text-muted-foreground">Uses existing workspace context and MTF alignment patterns. No invented timeframe scores.</p>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h3 className="font-semibold mb-2">AI Research</h3>
          <p className="text-sm text-muted-foreground">AI receives structured market context from existing components. It explains observed conditions only.</p>
          <Link href="/market-intelligence/scalping" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mt-2">
            AI Scalping Terminal <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </main>
    </div>
  );
}
