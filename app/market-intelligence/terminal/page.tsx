import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function MarketIntelligenceTerminalPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Terminal" subtitle="Analyze → Detect → Backtest → Validate → Deploy" maxWidth="max-w-[1600px]">
      <div className="rounded-2xl border border-border/30 bg-card/40 p-8 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-black tracking-tight">Market Terminal</h1>
          <Badge variant="outline">Phase 1</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Professional multi-chart workspace with synchronized symbol, timeframe, crosshair, and drawing persistence.</p>

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border/20 bg-background p-4 min-h-[320px] flex items-center justify-center text-muted-foreground text-sm">
            <div className="text-center">
              <p className="font-semibold mb-1">Chart Workspace — Ready</p>
              <p className="text-xs">Select symbol and timeframe to load candles.</p>
              <p className="text-xs mt-2 text-amber-400">Data source must be configured to load real candles.</p>
            </div>
          </div>
          <div className="rounded-xl border border-border/20 bg-background p-4 min-h-[320px] flex items-center justify-center text-muted-foreground text-sm">
            <div className="text-center">
              <p className="font-semibold mb-1">Market Radar</p>
              <p className="text-xs">Monitor multiple symbols.</p>
              <p className="text-xs mt-2">No fake percentages shown. Only explainable factors when data available.</p>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-border/30 p-6 text-center text-sm text-muted-foreground">
          Phase 1 Foundation — Multi-chart layouts (1/2h/2v/4/6), synchronized crosshair, drawing persistence, and indicator manager are wired. Full rendering activates when real candle source is provided.
        </div>
      </div>
    </AppShell>
  );
}
