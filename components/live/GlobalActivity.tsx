"use client";

/**
 * GlobalActivity — per-country activity share, derived from the shared
 * country clusters so it matches the map and stats exactly.
 */

import { useMemo } from "react";
import type { CountryCluster } from "@/lib/live/live-types";
import { flagFromCountryCode } from "@/lib/live/live-types";

export default function GlobalActivity({ clusters }: { clusters: CountryCluster[] }) {
  const rows = useMemo(() => {
    const total = clusters.reduce((s, c) => s + c.activeUsers, 0) || 1;
    return clusters
      .map((c) => ({ ...c, pct: Math.round((c.activeUsers / total) * 100) }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8);
  }, [clusters]);

  const totalPct = rows.reduce((s, r) => s + r.pct, 0) || 1;

  return (
    <div className="bg-muted/30 border-border rounded-xl p-5 h-full min-h-[220px] flex flex-col">
      <h3 className="text-sm font-bold text-foreground tracking-tight mb-4">GLOBAL ACTIVITY</h3>
      <div className="flex-1 space-y-2.5">
        {rows.map((r) => (
          <div key={r.countryCode + r.country} className="flex items-center gap-3">
            <span aria-hidden className="text-xs leading-none w-5 shrink-0">{r.flag ?? flagFromCountryCode(r.countryCode)}</span>
            <div className="w-24 text-xs font-medium text-muted-foreground truncate">{r.country}</div>
            <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-[width] duration-700"
                style={{ width: `${(r.pct / totalPct) * 100}%` }}
              />
            </div>
            <div className="w-10 text-right text-xs font-mono text-foreground">{r.pct}%</div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">No activity yet.</p>
        )}
      </div>
    </div>
  );
}
