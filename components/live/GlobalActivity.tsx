"use client";

import { getCountryActivity } from "@/lib/live/live-aggregator";

export default function GlobalActivity() {
  const rows = getCountryActivity();
  const total = rows.reduce((s, r) => s + r.percentage, 0);
  return (
    <div className="bg-muted/30 border-border rounded-xl p-5 h-full min-h-[220px] flex flex-col">
      <h3 className="text-sm font-bold text-foreground tracking-tight mb-4">GLOBAL ACTIVITY</h3>
      <div className="flex-1 space-y-2.5">
        {rows.map((r) => (
          <div key={r.countryCode} className="flex items-center gap-3">
            <div className="w-24 text-xs font-medium text-muted-foreground truncate">{r.country}</div>
            <div className="flex-1 h-1.5 bg-muted/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full"
                style={{ width: `${(r.percentage / total) * 100}%` }}
              />
            </div>
            <div className="w-10 text-right text-xs font-mono text-foreground">{r.percentage}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
