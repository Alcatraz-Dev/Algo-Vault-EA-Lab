import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * ChartContainer — canonical frame for chart surfaces.
 * Provides the toolbar slot an optional truthful data-state footer
 * (live / stale / unavailable). Never misrepresents data freshness.
 */
export function ChartContainer({
  toolbar,
  children,
  className,
  bodyClassName,
  dataState,
  height,
}: {
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  dataState?: "live" | "stale" | "offline" | "unavailable";
  height?: number | string;
}) {
  const stateLabel =
    dataState === "live"
      ? "Live data"
      : dataState === "stale"
        ? "Stale data"
        : dataState === "offline"
          ? "Disconnected"
          : undefined;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        className
      )}
    >
      {toolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-2">
          {toolbar}
        </div>
      ) : null}
      <div
        className={cn("relative", bodyClassName)}
        style={height != null ? { height } : undefined}
      >
        {children}
      </div>
      {stateLabel ? (
        <div className="flex items-center justify-end border-t border-border px-3 py-1.5">
          <StatusBadge
            tone={dataState === "live" ? "live" : dataState === "stale" ? "stale" : "offline"}
            label={stateLabel}
            dot
            pulse={dataState === "live"}
          />
        </div>
      ) : null}
    </div>
  );
}