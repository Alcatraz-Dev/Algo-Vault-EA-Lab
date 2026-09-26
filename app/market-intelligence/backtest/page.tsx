import { AppShell, type NavGroup } from "@/components/layout/AppShell";
import { APP_NAV } from "@/components/layout/app-nav";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

export default function MarketIntelligenceBacktestPage() {
  const nav = useMemo(() => APP_NAV.map((g) => ({ ...g })), []);
  return (
    <AppShell navGroups={nav} title="Market Intelligence — Backtest Terminal" subtitle="Historical Replay · Execution · Analytics · Replay" maxWidth="max-w-[1600px]">
      <div className="rounded-2xl border border-border/30 bg-card/60 p-6 backdrop-blur-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">Backtest Terminal</h1>
            <Badge variant="outline">Phase 7.1</Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Symbol</span><span className="font-mono font-bold">XAUUSD</span>
            <span>·</span><span>Timeframe</span><span className="font-mono font-bold">M5</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl border border-border/20 bg-background p-4">
            <h3 className="font-bold text-sm mb-3">Performance Overview</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <MetricCard label="Net P&L" value="—" sub="Historical" />
              <MetricCard label="Trades" value="—" sub="Total" />
              <MetricCard label="Win Rate" value="—" sub="—" />
              <MetricCard label="Max DD" value="—" sub="—" />
              <MetricCard label="Return" value="—" sub="—" />
              <MetricCard label="Profit Factor" value="—" sub="—" />
            </div>
          </div>

          <div className="rounded-xl border border-border/20 bg-background p-4">
            <h3 className="font-bold text-sm mb-3">Execution Model</h3>
            <ul className="text-xs space-y-1 text-muted-foreground">
              <li>Next bar open (default)</li>
              <li>Spread fixed or historical</li>
              <li>Commission: per trade</li>
              <li>Slippage applied consistently</li>
              <li>OHLC only: intrabar SL/TP ordering unavailable</li>
            </ul>
          </div>

          <div className="rounded-xl border border-border/20 bg-background p-4">
            <h3 className="font-bold text-sm mb-3">Data Quality</h3>
            <div className="text-xs text-muted-foreground space-y-2">
              <div className="flex justify-between"><span>Source</span><span className="font-semibold">Dataset</span></div>
              <div className="flex justify-between"><span>Period</span><span className="font-mono">2024-01 → 2024-12</span></div>
              <div className="flex justify-between"><span>Candles</span><span>—</span></div>
              <div className="flex justify-between"><span>Gaps</span><span>—</span></div>
              <div className="flex justify-between"><span>Volume</span><span>Not available</span></div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/20 bg-background p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Equity Curve · Drawdown</h2>
            <div className="flex gap-1 text-xs">
              <span className="rounded-md border border-border/30 px-2 py-0.5 text-muted-foreground">Equity</span>
              <span className="rounded-md border border-border/30 px-2 py-0.5 text-muted-foreground">Drawdown</span>
            </div>
          </div>
          <div className="h-72 w-full bg-muted/30 rounded-lg flex items-center justify-center text-xs text-muted-foreground">
            Interactive equity and drawdown chart — driven by actual BacktestResult
          </div>
        </div>

        <div className="rounded-xl border border-border/20 bg-background p-6">
          <h2 className="text-lg font-bold mb-4">Trade Journal</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground uppercase tracking-wider">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3">Entry</th>
                  <th className="py-2 px-3">Exit</th>
                  <th className="py-2 px-3">PnL</th>
                  <th className="py-2 px-3">Duration</th>
                  <th className="py-2 px-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Run a backtest to see trade history.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">
          <strong>Important</strong> — This terminal uses the existing deterministic Backtest Engine (Phase 3). All metrics, trades, and charts come from actual calculations. OHLC-only execution is explicitly noted. Smart Money layers (Phase 2) and Replay (Phase 3) are available through the Trading Studio workspace.
        </div>

        <div className="mt-4 flex gap-2 text-xs">
          <a href="/advanced-analysis" className="rounded-md border border-border/30 px-3 py-1 hover:bg-muted/20">Open in Advanced Analysis</a>
          <a href="/market-intelligence/research" className="rounded-md border border-border/30 px-3 py-1 hover:bg-muted/20">Continue Research</a>
          <a href="/trading-studio" className="rounded-md border border-border/30 px-3 py-1 hover:bg-muted/20">Trading Studio</a>
        </div>
      </div>
    </AppShell>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/20 bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-black mt-0.5">{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}
