"use client";

import type { IntelligenceOSContext } from "@/lib/intelligence-os/types";
import { cn } from "@/lib/utils";

export function SystemHealthStrip({ context }: { context: IntelligenceOSContext | null }) {
  if (!context) return null;
  const components = context.system.components;
  const overall = context.system.overall;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px]">
      <span className="text-muted-foreground">System</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {components.map((c) => (
          <SystemChip key={c.id} component={c} />
        ))}
      </div>
      <span className="ml-auto font-medium">{overallLabel(overall)}</span>
    </div>
  );
}

function SystemChip({ component }: { component: IntelligenceOSContext["system"]["components"][0] }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", statusDot(component.status))} />
      <span className="uppercase text-muted-foreground">{component.label}</span>
      <span className={cn("uppercase", statusText(component.status))}>{component.status}</span>
    </span>
  );
}

function statusDot(status: string): string {
  if (status === "live" || status === "healthy") return "bg-emerald-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "stale") return "bg-orange-500";
  if (status === "disconnected" || status === "unavailable") return "bg-red-500";
  return "bg-muted-foreground/40";
}

function statusText(status: string): string {
  if (status === "live" || status === "healthy") return "text-emerald-600 dark:text-emerald-400";
  if (status === "degraded") return "text-amber-600 dark:text-amber-400";
  if (status === "stale") return "text-orange-600 dark:text-orange-400";
  if (status === "disconnected" || status === "unavailable") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function overallLabel(overall: "live" | "degraded" | "unavailable"): string {
  if (overall === "live") return "LIVE";
  if (overall === "degraded") return "DEGRADED";
  return "UNAVAILABLE";
}
