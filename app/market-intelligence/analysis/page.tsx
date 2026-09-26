import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function MarketIntelligenceAnalysisPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Advanced Analysis" subtitle="Indicators · Smart Money · MTF" maxWidth="max-w-[1600px]">
      <div className="rounded-2xl border border-border/30 bg-card/40 p-8 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-black tracking-tight">Advanced Analysis</h1>
          <Badge variant="outline">Phase 1</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Indicators (real adapter) · Smart Money Engine (Phase 2) · MTF · Sessions. See docs/smart-money-methodology.md for exact detection rules.</p>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border/20 bg-background p-4 min-h-[200px]">
            <h3 className="font-bold text-sm mb-2">Indicators</h3>
            <p className="text-xs text-muted-foreground">RSI, EMA, MACD, Bollinger, ATR, Supertrend — configurable parameters only. No hardcoded values.</p>
          </div>
          <div className="rounded-xl border border-border/20 bg-background p-4 min-h-[200px]">
            <h3 className="font-bold text-sm mb-2">Smart Money</h3>
            <p className="text-xs text-muted-foreground">Structure, Liquidity, FVG, Order Blocks — proxies only. Only returned when real candle analysis supports it.</p>
          </div>
          <div className="rounded-xl border border-border/20 bg-background p-4 min-h-[200px]">
            <h3 className="font-bold text-sm mb-2">MTF Matrix</h3>
            <p className="text-xs text-muted-foreground">Interactive multi-timeframe view linking M1 through W1. Click cell to focus chart.</p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-dashed border-border/30 p-6 text-center text-sm text-muted-foreground">
          Smart Money calculations delegate to lib/analytics/ (structure, liquidity, market-structure) when historical data is available. No invented scores.
        </div>
      </div>
    </AppShell>
  );
}
