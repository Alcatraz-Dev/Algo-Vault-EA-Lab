import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * MetricCard — canonical metric display. No gradients, no glow.
 * The value always renders in mono (trading numbers) unless overridden.
 */
export function MetricCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  footnote,
  icon,
  className,
  valueClassName,
  mono = true,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: "up" | "down" | "neutral" | "warning";
  footnote?: ReactNode;
  icon?: ReactNode;
  className?: string;
  valueClassName?: string;
  mono?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </div>
      <div
        className={cn(
          "mt-1.5 text-lg font-semibold tracking-tight text-foreground",
          mono && "font-numeric",
          valueClassName
        )}
      >
        {value}
      </div>
      {delta ? (
        <div
          className={cn(
            "mt-1 text-xs",
            deltaTone === "up" && "text-positive",
            deltaTone === "down" && "text-negative",
            deltaTone === "warning" && "text-warning",
            deltaTone === "neutral" && "text-muted-foreground"
          )}
        >
          {delta}
        </div>
      ) : null}
      {footnote ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{footnote}</div>
      ) : null}
    </div>
  );
}