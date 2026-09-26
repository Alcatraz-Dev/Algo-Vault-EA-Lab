import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function MarketIntelligenceStrategyLabPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Strategy Lab" subtitle="Build · Backtest · Optimize · Validate · Deploy" maxWidth="max-w-[1600px]">
      <div className="rounded-2xl border border-border/30 bg-card/40 p-8 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-black tracking-tight">Strategy Lab</h1>
          <Badge variant="outline">Phase 1</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Visual strategy builder integrated with Trading Studio — not a replacement.</p>

        <div className="grid md:grid-cols-5 gap-3 text-xs">
          {["Strategies", "Templates", "Backtests", "Optimizations", "Deployments"].map((s) => (
            <div key={s} className="rounded-xl border border-border/20 bg-background p-3 text-center font-semibold">{s}</div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-border/30 p-6 text-center text-sm text-muted-foreground">
          Strategy nodes (Market, Indicator, Structure, Liquidity, FVG, Order Block, Session, MTF, Condition, Entry, Exit, Risk) wired to Trading Studio via adapter. Builds can trigger backtest pipeline when rules defined.
        </div>
      </div>
    </AppShell>
  );
}
