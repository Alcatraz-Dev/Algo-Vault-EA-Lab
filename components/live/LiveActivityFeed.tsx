"use client";

import { useMemo } from "react";
import { generateDemoActivities } from "@/lib/live/live-aggregator";
import { Zap } from "lucide-react";

export default function LiveActivityFeed() {
  const feed = useMemo(() => generateDemoActivities(12), []);
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-5 h-full min-h-[320px] flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <h3 className="text-sm font-bold text-foreground tracking-tight">LIVE ACTIVITY</h3>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {feed.map((item) => (
          <div
            key={item.id}
            className="group flex items-start gap-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/60 transition p-2.5 -mx-2.5"
          >
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${item.direction === "bullish" ? "bg-emerald-400" : item.direction === "bearish" ? "bg-red-400" : "bg-blue-400"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-bold text-sm text-foreground tracking-tight">{item.market}</span>
                <span className="text-[10px] text-muted-foreground font-medium">{item.activityType.replace("_", " ")}</span>
              </div>
              <div className="text-xs text-muted-foreground truncate">{item.country}</div>
              <div className="text-[10px] text-muted-foreground/70 mt-0.5">just now</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
