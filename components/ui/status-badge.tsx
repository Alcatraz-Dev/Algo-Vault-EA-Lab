import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone =
  | "live"
  | "active"
  | "positive"
  | "negative"
  | "warning"
  | "info"
  | "neutral"
  | "stale"
  | "offline"
  | "error"
  | "pending"
  | "connected"
  | "expired"
  | "profitable";

const TONE_CLASSES: Record<StatusTone, string> = {
  live: "bg-positive-muted text-positive border-positive/30",
  active: "bg-primary/10 text-foreground border-primary/40",
  positive: "bg-positive-muted text-positive border-positive/30",
  negative: "bg-negative-muted text-negative border-negative/30",
  warning: "bg-warning-muted text-warning border-warning/30",
  info: "bg-info-muted text-info border-info/30",
  neutral: "bg-muted text-muted-foreground border-border",
  stale: "bg-warning-muted text-warning border-warning/30",
  offline: "bg-muted text-muted-foreground border-border",
  error: "bg-negative-muted text-negative border-negative/30",
  pending: "bg-warning-muted text-warning border-warning/30",
  connected: "bg-positive-muted text-positive border-positive/30",
  expired: "bg-muted text-muted-foreground border-border",
  profitable: "bg-positive-muted text-positive border-positive/30",
};

export function StatusBadge({
  tone = "neutral",
  label,
  dot = false,
  pulse = false,
  className,
  icon,
}: {
  tone?: StatusTone;
  label: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-pill border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className
      )}
    >
      {dot ? (
        <span className="relative flex h-1.5 w-1.5">
          {pulse ? (
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
                "bg-current"
              )}
            />
          ) : null}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      ) : null}
      {icon}
      {label}
    </span>
  );
}