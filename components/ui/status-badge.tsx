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
  live: "bg-success-muted text-success-foreground border-success/30",
  active: "bg-accent-muted text-accent border-accent/30",
  positive: "bg-success-muted text-success-foreground border-success/30",
  negative: "bg-destructive-muted text-destructive-foreground border-destructive/30",
  warning: "bg-warning-muted text-warning-foreground border-warning/30",
  info: "bg-info-muted text-info-foreground border-info/30",
  neutral: "bg-surface-muted text-text-secondary border-border",
  stale: "bg-warning-muted text-warning-foreground border-warning/30",
  offline: "bg-surface-muted text-text-muted border-border",
  error: "bg-destructive-muted text-destructive-foreground border-destructive/30",
  pending: "bg-warning-muted text-warning-foreground border-warning/30",
  connected: "bg-success-muted text-success-foreground border-success/30",
  expired: "bg-surface-muted text-text-muted border-border",
  profitable: "bg-success-muted text-success-foreground border-success/30",
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
        "inline-flex h-5 items-center gap-1.5 rounded-pill border px-2 py-0.5 text-meta font-medium whitespace-nowrap",
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