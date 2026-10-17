import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * MetricCard — canonical metric display. FlyonUI `.card` surface with the
 * premium AlgoVault type scale: micro-uppercase label, large tabular value,
 * pill delta, icon tile. The value always renders in mono (trading numbers)
 * unless overridden. Data surfaces stay solid — no gradients, no glow.
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
        "card rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.05)] sm:p-5",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon ? (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-muted/60 text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1.5 text-[22px] font-semibold tracking-tight text-foreground",
          mono && "font-numeric",
          valueClassName
        )}
      >
        {value}
      </div>
      {delta ? (
        <div
          className={cn(
            "mt-2 inline-flex w-fit max-w-full items-start gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-snug font-medium [overflow-wrap:anywhere]",
            deltaTone === "up" && "border-positive/30 bg-positive-muted text-positive",
            deltaTone === "down" && "border-negative/30 bg-negative-muted text-negative",
            deltaTone === "warning" && "border-warning/30 bg-warning-muted text-warning",
            deltaTone === "neutral" && "border-border bg-muted text-muted-foreground"
          )}
        >
          {delta}
        </div>
      ) : null}
      {footnote ? (
        <div className="mt-1.5 text-[11px] text-muted-foreground">{footnote}</div>
      ) : null}
    </div>
  );
}