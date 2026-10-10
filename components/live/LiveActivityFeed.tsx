"use client";

/**
 * LiveActivityFeed — newest-first rolling list of activity rows.
 * Consumes the shared live feed so it stays in sync with the map.
 */

import { useEffect, useMemo, useState } from "react";
import type { LiveActivity } from "@/lib/live/live-types";
import { flagFromCountryCode } from "@/lib/live/live-types";

function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const TYPE_LABEL: Record<string, string> = {
  smart_money: "Smart money",
  market_analysis: "Market analysis",
  scalping: "Scalping",
  signal: "Signal",
  ai_analysis: "AI analysis",
};

export default function LiveActivityFeed({
  activities,
  max = 14,
}: {
  activities: LiveActivity[];
  max?: number;
}) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, []);

  const rows = useMemo(() => activities.slice(0, max), [activities, max]);
  // "New" highlight keyed off feed position: the newest row of each rotation
  // gets a subtle entrance animation without tracking refs during render.
  const newestId = rows[0]?.id;

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-5 h-full min-h-[320px] flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <h3 className="text-sm font-bold text-foreground tracking-tight">LIVE ACTIVITY</h3>
        <span className="ml-auto text-micro font-mono text-muted-foreground">{activities.length} events</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 pr-1" aria-live="polite">
        {rows.map((item) => {
          const isNew = item.id === newestId;
          return (
            <div
              key={item.id}
              className={`group flex items-start gap-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/60 transition p-2.5 -mx-2.5 ${
                isNew ? "animate-[page-enter_0.4s_ease-out]" : ""
              }`}
            >
              <span aria-hidden className="text-sm leading-none mt-0.5 shrink-0">
                {flagFromCountryCode(item.countryCode)}
              </span>
              <div
                className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                  item.direction === "bullish"
                    ? "bg-emerald-400"
                    : item.direction === "bearish"
                      ? "bg-red-400"
                      : "bg-blue-400"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-bold text-sm text-foreground tracking-tight">{item.market}</span>
                  <span className="text-micro text-muted-foreground font-medium">
                    {TYPE_LABEL[item.activityType] ?? item.activityType}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground truncate">{item.country}</div>
                <div className="text-micro text-muted-foreground/70 mt-0.5">
                  {now ? relativeTime(item.timestamp, now) : "just now"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
