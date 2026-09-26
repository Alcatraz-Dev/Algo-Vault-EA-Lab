"use client";

import { getMarketShares } from "@/lib/live/live-aggregator";

export default function MarketActivity() {
  const shares = getMarketShares();
  return (
    <div className="bg-muted/30 border-border rounded-xl p-5 h-full min-h-[220px] flex flex-col">
      <h3 className="text-sm font-bold text-foreground tracking-tight mb-4">MARKET ACTIVITY</h3>
      <div className="flex-1 space-y-3">
        {shares.map((m) => (
          <div key={m.market} className="flex items-center gap-3">
            <div className="w-16 text-xs font-mono font-bold text-foreground">{m.market}</div>
            <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden relative">
              <div className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full" style={{ width: `${m.share}%` }} />
            </div>
            <div className="w-10 text-right text-xs font-mono text-muted-foreground">{m.share}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
