import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function MarketIntelligenceOOSPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Out-of-Sample Validation" subtitle="Validation · Walk-Forward · Reproducibility" maxWidth="max-w-[1600px]">
      <div className="rounded-2xl border border-border/30 bg-card/40 p-8 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-black tracking-tight">OOS Validation</h1>
          <Badge variant="outline">Phase 6.2</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Deterministic out-of-sample validation and walk-forward research. Uses existing Backtest Engine. No duplicate simulators. No AI optimization.</p>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border/20 bg-background p-4 text-xs space-y-2">
            <h3 className="font-bold">OOS</h3>
            <p>Split dataset into training and validation periods. Freeze selected configuration. Validate only.</p>
          </div>
          <div className="rounded-xl border border-border/20 bg-background p-4 text-xs space-y-2">
            <h3 className="font-bold">Walk-Forward</h3>
            <p>Rolling or expanding windows. Per window: train → freeze → validate. Aggregate only from actual results.</p>
          </div>
          <div className="rounded-xl border border-border/20 bg-background p-4 text-xs space-y-2">
            <h3 className="font-bold">Reproducibility</h3>
            <p>Same dataset + same config = same results. No random values in identity. No future leakage.</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
