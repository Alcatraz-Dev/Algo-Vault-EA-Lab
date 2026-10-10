"use client";

/**
 * MarketActivity — market share rows derived from the shared activity feed.
 */

import { useMemo } from "react";
import type { LiveActivity } from "@/lib/live/live-types";

export default function MarketActivity({ activities }: { activities: LiveActivity[] }) {
  const shares = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of activities) {
      if (!a.market) continue;
      counts.set(a.market, (counts.get(a.market) ?? 0) + 1);
    }
    const total = activities.filter((a) => a.market).length || 1;
    return [...counts.entries()]
      .map(([market, n]) => ({ market, share: Math.round((n / total) * 100) }))
      .sort((a, b) => b.share - a.share)
      .slice(0, 6);
  }, [activities]);

  return (
    <div className="bg-muted/30 border-border rounded-lg p-5 h-full min-h-[220px] flex flex-col">
      <h3 className="text-sm font-bold text-foreground tracking-tight mb-4">MARKET ACTIVITY</h3>
      <div className="flex-1 space-y-3">
        {shares.map((m) => (
          <div key={m.market} className="flex items-center gap-3">
            <div className="w-16 text-xs font-numeric font-bold text-foreground">{m.market}</div>
            <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-warning rounded-full transition-[width] duration-700"
                style={{ width: `${m.share}%` }}
              />
            </div>
            <div className="w-10 text-right text-xs font-numeric text-muted-foreground">{m.share}%</div>
          </div>
        ))}
        {shares.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
      </div>
    </div>
  );
}
