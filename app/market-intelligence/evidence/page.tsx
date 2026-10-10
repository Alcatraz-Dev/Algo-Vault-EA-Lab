"use client";
import { AppShell } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { useMemo } from "react";
export default function EvidenceLabPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Evidence Lab" subtitle="Pattern → Evidence Definition → Backtest → OOS → WF → Robustness → Monte Carlo → Report" maxWidth="max-w-[1400px]">
      <div className="flex flex-col gap-4 p-4">
        <h1 className="text-base font-semibold">Pattern Evidence Lab</h1>
        <div className="rounded-lg border border-border/30 bg-card p-4">Evidence Definition — configure conditions from historical pattern (no automatic execution).</div>
        <div className="rounded-lg border border-border/30 bg-card p-4 text-xs text-muted-foreground">Pipeline stages: Definition → Backtest (existing) → OOS (Phase 6.2) → Walk-Forward (existing) → Robustness (Phase 6.3) → Monte Carlo (existing trades only) → Evidence Report. All deterministic. No predictions.</div>
      </div>
    </AppShell>
  );
}
