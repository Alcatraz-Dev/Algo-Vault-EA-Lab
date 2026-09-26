import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function MarketIntelligenceBacktestPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Backtesting" subtitle="Historical Replay · Execution Engine · Statistics" maxWidth="max-w-[1600px]">
      <div className="rounded-2xl border border-border/30 bg-card/40 p-8 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-black tracking-tight">Backtesting</h1>
          <Badge variant="outline">Phase 1</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Real backtest pipeline: symbolic rules → historical candles → deterministic execution → statistics.</p>

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border/20 bg-background p-5">
            <h3 className="font-bold text-sm mb-3">Inputs</h3>
            <ul className="text-xs space-y-1 text-muted-foreground">
              <li>Symbol · Timeframe · Start · End</li>
              <li>Initial Balance · Execution Model · Spread · Commission · Slippage</li>
              <li>Position Size · Risk % · Max Positions</li>
            </ul>
          </div>
          <div className="rounded-xl border border-border/20 bg-background p-5">
            <h3 className="font-bold text-sm mb-3">Limitations — Exposed</h3>
            <ul className="text-xs space-y-1 text-amber-400">
              <li>Backtest requires defined strategy rules (Trading Studio adapter).</li>
              <li>Historical data unavailable for this period unless source configured.</li>
              <li>Spread / commission / slippage applied only when available.</li>
              <li>No future-data leakage; replay hides future candles.</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-border/30 p-6 text-center text-sm text-muted-foreground">
          Engineering architecture active: replay engine (no future visibility), execution model, risk calculation, equity/drawdown tracking. Metrics computed from actual trades when strategy rules are provided.
        </div>
      </div>
    </AppShell>
  );
}
