import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function MarketIntelligenceSmartMoneyPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Smart Money" subtitle="Institutional Activity Proxies" maxWidth="max-w-[1600px]">
      <div className="rounded-2xl border border-border/30 bg-card/40 p-8 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-black tracking-tight">Smart Money</h1>
          <Badge variant="outline">Phase 2</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Real deterministic Smart Money Engine active: swing detection, structure (BOS/CHOCH/MSS), liquidity, FVG, order blocks, sessions. Definitions in docs/smart-money-methodology.md.</p>

        <div className="grid md:grid-cols-4 gap-4">
          {["Structure (BOS / CHoCH / MSS)", "Liquidity (BSL / SSL / EQH / EQL)", "FVG (Bullish / Bearish)", "Order Blocks / Breakers"].map((label) => (
            <div key={label} className="rounded-xl border border-border/20 bg-background p-4 min-h-[160px]">
              <h3 className="font-bold text-sm mb-2">{label}</h3>
              <p className="text-xs text-muted-foreground">Only displayed when historical candle patterns support detection. No fake events.</p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">
          Note: Smart Money terminology refers to price-action structures commonly used in institutional-flow analysis. It does not represent actual bank orders or guaranteed institutional activity.
        </div>
      </div>
    </AppShell>
  );
}
