import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function MarketIntelligenceResearchPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Research" subtitle="Parameter Sweep · Deterministic Backtest · Reproducible Results" maxWidth="max-w-[1600px]">
      <div className="rounded-2xl border border-border/30 bg-card/40 p-8 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-black tracking-tight">Parameter Research</h1>
          <Badge variant="outline">Phase 6.4</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Compare configurations across historical backtest, OOS, walk-forward, robustness, and Monte Carlo — no combined score, no optimization claims.</p>

        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl border border-border/20 bg-background p-4">
            <h3 className="font-bold text-sm mb-2">Parameter Space</h3>
            <p className="text-xs text-muted-foreground">Define parameters (e.g., EMA fast 10–30 step 5). Cartesian product generated deterministically. Limits enforced.</p>
          </div>
          <div className="rounded-xl border border-border/20 bg-background p-4">
            <h3 className="font-bold text-sm mb-2">Backtest Integration</h3>
            <p className="text-xs text-muted-foreground">Each configuration runs through existing phase-3 backtest adapter with Smart Money + replay protections.</p>
          </div>
          <div className="rounded-xl border border-border/20 bg-background p-4">
            <h3 className="font-bold text-sm mb-2">Results</h3>
            <p className="text-xs text-muted-foreground">Real metrics only (net PnL, drawdown, win rate, trades). No fabricated scores. Config inspector available.</p>
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-border/30 p-6 text-center text-sm text-muted-foreground">
          Phase 6.1 — Deterministic parameter research completed. Trading Studio integration and result preview/apply flow ready. Phase 6.2 (validation / out-of-sample) not implemented.
        </div>
      </div>
    </AppShell>
  );
}
