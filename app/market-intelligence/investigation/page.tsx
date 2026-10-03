"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, ArrowUpRight } from "lucide-react";
import { buildInvestigationContext } from "@/lib/market-intelligence/investigation/context";
import type { InvestigationRoot } from "@/lib/market-intelligence/investigation/types";

export default function InvestigationPage() {
  // useSearchParams() requires a Suspense boundary for static prerendering
  // (missing-suspense-with-csr-bailout).
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background text-foreground">
          <header className="border-b border-border bg-card px-6 py-4">
            <div className="mx-auto max-w-7xl">
              <h1 className="text-xl font-semibold tracking-tight">Intelligence Investigation</h1>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-6">
            <p className="text-sm text-muted-foreground">Loading investigation…</p>
          </main>
        </div>
      }
    >
      <InvestigationContent />
    </Suspense>
  );
}

function InvestigationContent() {
  const params = useSearchParams();
  const type = params.get("type") || "pattern";
  const id = params.get("id") || "unknown";
  const ctx = buildInvestigationContext(type, id);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Intelligence Investigation</h1>
          <div className="text-sm text-muted-foreground">Root: <span className="font-medium text-foreground">{type}:{id}</span></div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 rounded-xl border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold mb-4">Investigation Overview</h2>
          <p className="text-sm text-muted-foreground mb-2">Investigation workspace connects the selected root node through the Phase 13 Knowledge Graph.</p>
          <div className="rounded-lg bg-slate-50 border p-4 text-sm text-slate-700 space-y-1">
            <div><strong>Root:</strong> {type}:{id}</div>
            <div><strong>Mode:</strong> {ctx.mode}</div>
            <div><strong>Workspace:</strong> Symbol / Timeframe preserved where available</div>
          </div>
          <div className="mt-4 text-xs text-muted-foreground">Evidence categories: FACT (observed), INTERPRETATION (derived), LIMITATION (constraints / replay / missing sources).</div>
        </section>

        <section className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
          <h3 className="font-semibold">Lineage & Evidence Sections</h3>
          <div className="text-xs text-muted-foreground space-y-2">
            <p><span className="font-medium">FACT</span> — Lineage relationships from Knowledge Graph.</p>
            <p><span className="font-medium">INTERPRETATION</span> — Deterministic derivations from observed relationships.</p>
            <p><span className="font-medium">LIMITATION</span> — Replay exclusions, missing sources, cycle protection.</p>
          </div>
          <Link href="/market-intelligence/knowledge" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
            Knowledge Graph <ArrowUpRight className="w-3 h-3" />
          </Link>
        </section>
      </main>
    </div>
  );
}
