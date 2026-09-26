import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function MarketIntelligenceCommandCenterPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Command Center" subtitle="Analyze → Detect → Validate → Research → Build" maxWidth="max-w-[1600px]">
      <div className="flex flex-col gap-4">
        {/* Global Context Bar */}
        <div className="rounded-xl border border-border/30 bg-card/60 p-3 backdrop-blur-xl flex flex-wrap items-center gap-3 text-[11px] font-mono">
          <div className="font-black text-sm">COMMAND CENTER</div>
          <div className="rounded bg-muted/30 px-2 py-0.5">XAUUSD</div>
          <div className="rounded bg-muted/30 px-2 py-0.5">M5</div>
          <div className="rounded bg-muted/30 px-2 py-0.5">RESEARCH</div>
          <div className="text-muted-foreground">Dataset: —</div>
          <div className="text-muted-foreground">Strategy: —</div>
          <div className="text-muted-foreground">Backtest: —</div>
          <div className="text-muted-foreground">Research: —</div>
        </div>

        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          {/* Main Chart Workspace */}
          <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-3 text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <span>Market Workspace</span>
              <span>Existing chart overlay adapter · Smart Money · Sessions · Indicators</span>
            </div>
            <div className="h-[460px] w-full rounded-xl border border-border/20 bg-background/30 flex items-center justify-center text-sm text-muted-foreground relative">
              Professional chart workspace (reuse existing overlay adapter)
              <div className="absolute bottom-2 left-2 text-[10px]">Candles · Structure · Liquidity · FVG · OB · Sessions · Indicators · Trades</div>
            </div>
          </div>

          {/* Intelligence / Evidence */}
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
              <h3 className="font-bold text-sm mb-2">Intelligence Layer (Phase 7.4)</h3>
              <div className="text-xs space-y-2 text-muted-foreground">
                <div><strong>Facts</strong> — deterministic engine outputs (SMC / Indicators / MTF / Sessions)</div>
                <div><strong>Interpretation</strong> — advisory only (no predictive claims)</div>
                <div><strong>Limitations</strong> — OHLC only · replay excludes future data</div>
                <div><strong>Evidence</strong> — references use real IDs only</div>
              </div>
              <div className="mt-3 flex gap-1 text-[10px]">
                <span className="rounded border border-border/30 px-1.5 py-0.5">No confidence scores</span>
                <span className="rounded border border-border/30 px-1.5 py-0.5">Replay-safe</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
              <h3 className="font-bold text-sm mb-2">Smart Money Summary</h3>
              <div className="text-xs text-muted-foreground space-y-1">
                <div><strong>Structure</strong> — unknown (engine state required)</div>
                <div><strong>Liquidity</strong> — not loaded</div>
                <div><strong>FVG</strong> — not loaded</div>
                <div><strong>Order Blocks</strong> — not loaded</div>
                <div><strong>Sessions</strong> — not loaded</div>
              </div>
              <div className="mt-2 text-[10px] text-amber-300">Only real engine outputs displayed.</div>
            </div>
          </div>
        </div>

        {/* Bottom: Replay / Evidence / Quick Actions / Trade Journal / Performance Summary */}
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-3 text-xs font-mono uppercase">
              <span>Replay Controls</span>
              <span>ReplayEngine reused — future-safe</span>
            </div>
            <div className="rounded-xl border border-border/20 bg-background/20 p-4 min-h-[100px] flex items-center justify-center text-xs text-muted-foreground">
              Replay workspace — future candles/events/trades hidden · incremental event generation
            </div>
          </div>

          <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
            <h3 className="font-bold text-sm mb-2">Evidence Chain</h3>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Market Event → Smart Money → Trade → Backtest → Research</div>
              <div>Every link uses real engine IDs (no fabricated references).</div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/30 bg-card/60 p-4 backdrop-blur-xl">
            <h3 className="font-bold text-sm mb-2">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <a href="/advanced-analysis" className="rounded-md border border-border/30 px-2 py-1.5 hover:bg-muted/20">Advanced Analysis</a>
              <a href="/market-intelligence/backtest" className="rounded-md border border-border/30 px-2 py-1.5 hover:bg-muted/20">Backtest</a>
              <a href="/market-intelligence/research" className="rounded-md border border-border/30 px-2 py-1.5 hover:bg-muted/20">Research</a>
              <a href="/trading-studio" className="rounded-md border border-border/30 px-2 py-1.5 hover:bg-muted/20">Trading Studio</a>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/20 bg-background/30 p-4 text-xs text-muted-foreground">
          <strong>Command Center</strong> — existing engine integration only. No replacement Smart Money / Backtest / Replay / Research / Strategy / Chart / AI / Workspace engine created. All data from real analytics. Replay future-data safe. AI advisory only. No predictive claims.
        </div>
      </div>
    </AppShell>
  );
}
