"use client";
import { AppShell } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { useMemo } from "react";
import { KnowledgePanel } from "@/components/market-intelligence/knowledge/KnowledgePanel";
export default function KnowledgePage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Knowledge Graph" subtitle="Evidence Relationships · Lineage · Traceability" maxWidth="max-w-[1400px]">
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-xl font-black">Knowledge Graph — Phase 13</h1>
        <p className="text-xs text-muted-foreground">Relationship layer over existing evidence. Real source IDs only. No new analytics engine.</p>
        <KnowledgePanel rootType="pattern" rootId="example-pattern-01" />
        <div className="rounded-xl border border-border/20 bg-background/30 p-4 text-xs text-muted-foreground">Lineage: Pattern → Setup → Smart Money Event → Validation → Backtest → OOS → WF → Robustness → Monte Carlo → Evidence Report. All from existing sources.</div>
      </div>
    </AppShell>
  );
}
