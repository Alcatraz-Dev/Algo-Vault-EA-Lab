"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Sourced } from "@/lib/ai/provenance";

/**
 * Terminal primitives.
 *
 * These components exist to enforce one rule at the render layer: a metric that
 * the engine did not produce must never render as a number. `SourcedValue`
 * takes a `Sourced<T>` directly, so a caller cannot accidentally pass a raw
 * number and bypass the unavailable state.
 *
 * All styling uses existing AlgoVault tokens (1px borders, `--card`,
 * `--muted`, `--border`, `--primary`) at the sizes DESIGN.md permits. No new
 * colours, no micro-typography below `text-xs`.
 */

// ── panel ───────────────────────────────────────────────────────────────────

export function TerminalPanel({
  title,
  icon,
  meta,
  action,
  children,
  className,
  bodyClassName,
  dense,
}: {
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  dense?: boolean;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
          <h2 className="truncate text-xs font-semibold tracking-wide text-foreground uppercase">
            {title}
          </h2>
          {meta ? <span className="truncate text-xs text-muted-foreground">{meta}</span> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}
      </header>
      <div className={cn("min-w-0 flex-1", dense ? "p-0" : "p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

// ── sourced value ───────────────────────────────────────────────────────────

const UNAVAILABLE_CLASS =
    "text-xs text-muted-foreground italic";

export function SourcedValue({
  metric,
  format,
  className,
  unavailableClassName,
  showReason = false,
}: {
  metric: Sourced<number> | null | undefined;
  format?: (value: number) => string;
  className?: string;
  unavailableClassName?: string;
  showReason?: boolean;
}) {
  if (!metric || metric.status !== "available" || metric.value === null) {
    return (
      <span
        className={cn(UNAVAILABLE_CLASS, unavailableClassName)}
        title={metric?.reason ?? "Engine did not report this metric."}
      >
        Data unavailable
        {showReason && metric?.reason ? `: ${metric.reason}` : ""}
      </span>
    );
  }
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {format ? format(metric.value) : metric.value}
    </span>
  );
}

/** Text variant for sourced strings / unions. */
export function SourcedText({
  metric,
  format,
  className,
  unavailableClassName,
}: {
  metric: Sourced<string> | null | undefined;
  format?: (value: string) => string;
  className?: string;
  unavailableClassName?: string;
}) {
  if (!metric || metric.status !== "available" || metric.value === null) {
    return (
      <span className={cn(UNAVAILABLE_CLASS, unavailableClassName)} title={metric?.reason}>
        Data unavailable
      </span>
    );
  }
  return <span className={className}>{format ? format(metric.value) : metric.value}</span>;
}

/** A sourced value that must be coerced to a string for display. */
export function SourcedLoose({
  metric,
  format,
  className,
  fallbackText = "Data unavailable",
}: {
  metric: Sourced<string | number | null> | null | undefined;
  format?: (value: string | number) => string;
  className?: string;
  fallbackText?: string;
}) {
  if (!metric || metric.status !== "available" || metric.value === null || metric.value === undefined) {
    return (
      <span className={UNAVAILABLE_CLASS} title={metric?.reason}>
        {fallbackText}
      </span>
    );
  }
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {format ? format(metric.value) : String(metric.value)}
    </span>
  );
}

// ── directional bias chip ───────────────────────────────────────────────────

export type BiasTone = "bullish" | "bearish" | "neutral" | "unavailable";

const BIAS_CLASS: Record<Exclude<BiasTone, "unavailable">, string> = {
  bullish: "border-positive/40 bg-positive/10 text-positive",
  bearish: "border-negative/40 bg-negative/10 text-negative",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function BiasChip({
  bias,
  className,
}: {
  bias: string | null | undefined;
  className?: string;
}) {
  const tone: BiasTone =
    bias === "bullish" || bias === "bearish" || bias === "neutral" ? bias : "unavailable";

  if (tone === "unavailable") {
    return (
      <span className={cn("rounded-full border border-border px-1.5 py-0.5 text-xs text-muted-foreground", className)}>
        Unavailable
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide",
        BIAS_CLASS[tone],
        className
      )}
    >
      {tone}
    </span>
  );
}

// ── confidence meter ────────────────────────────────────────────────────────

/**
 * Confidence bar. The number is always rendered alongside the bar, and the
 * bar is a direct linear mapping of the sourced 0–100 value. When the metric is
 * unavailable, no bar and no percentage are drawn.
 */
export function ConfidenceMeter({
  metric,
  label,
  label2,
  className,
  weightNote,
}: {
  metric: Sourced<number> | null | undefined;
  label?: ReactNode;
  label2?: ReactNode;
  className?: string;
  weightNote?: ReactNode;
}) {
  const available = !!metric && metric.status === "available" && metric.value !== null;
  const pct = available ? Math.max(0, Math.min(100, metric!.value as number)) : 0;

  return (
    <div className={cn("min-w-0", className)}>
      {(label || label2) && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          {label ? <span className="truncate text-xs text-muted-foreground">{label}</span> : null}
          {label2 ? <span className="shrink-0 text-xs text-muted-foreground">{label2}</span> : null}
        </div>
      )}
      {available ? (
        <>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={typeof label === "string" ? label : "confidence"}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
              {pct.toFixed(1)}
            </span>
            {weightNote ? (
              <span className="truncate text-xs text-muted-foreground">{weightNote}</span>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className={UNAVAILABLE_CLASS} title={metric?.reason}>
            Data unavailable
          </span>
          <span className="text-xs text-muted-foreground">—</span>
        </div>
      )}
    </div>
  );
}

// ── data table ──────────────────────────────────────────────────────────────

export function TerminalTable({
  head,
  children,
  className,
}: {
  head: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border">
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-2 py-1.5 text-left text-xs font-medium text-muted-foreground",
                  i > 0 && "text-right"
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function TerminalRow({
  cells,
  className,
  highlight,
}: {
  cells: ReactNode[];
  className?: string;
  highlight?: boolean;
}) {
  return (
    <tr
      className={cn(
        "border-b border-border/60 last:border-0",
        highlight && "bg-primary/5",
        className
      )}
    >
      {cells.map((c, i) => (
        <td
          key={i}
          className={cn(
            "px-2 py-1.5 align-middle whitespace-nowrap",
            i === 0 ? "text-left" : "text-right"
          )}
        >
          {c}
        </td>
      ))}
    </tr>
  );
}

// ── source attribution ──────────────────────────────────────────────────────

/**
 * Renders the provenance of a metric. The brief requires every metric to
 * identify its source, so this is used at the row/panel level rather than
 * being optional decoration.
 */
export function SourceTag({
  source,
  className,
}: {
  source: { id: string; label: string; asOf: number | null } | null | undefined;
  className?: string;
}) {
  if (!source) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground",
        className
      )}
      title={source.asOf ? `Data as of ${new Date(source.asOf).toISOString()}` : "No data timestamp reported"}
    >
      <span className="text-muted-foreground/70">src</span>
      <span className="truncate">{source.label}</span>
    </span>
  );
}

export function SourceFooter({
  items,
  className,
}: {
  items: Array<{ label: string; value: ReactNode }>;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground/70">{it.label}</span>
          {it.value}
        </span>
      ))}
    </div>
  );
}

// ── empty / awaiting ────────────────────────────────────────────────────────

export function AwaitingState({
  reason,
  className,
  compact,
}: {
  reason?: string | null;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border text-center",
        compact ? "px-3 py-4" : "px-4 py-8",
        className
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">Awaiting engine data</p>
      {reason ? (
        <p className="mt-1 max-w-md text-xs text-muted-foreground/80">{reason}</p>
      ) : null}
    </div>
  );
}

// ── key/value stat row ──────────────────────────────────────────────────────

export function StatRow({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1", className)} title={hint}>
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-xs">{value}</span>
    </div>
  );
}
