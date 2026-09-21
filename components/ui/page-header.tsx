import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — canonical page title block.
 * eyebrow → title → subtitle, with optional action cluster.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  className,
  titleClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 md:flex-row md:items-end md:justify-between",
        className
      )}
    >
      <div data-guide="page-header" className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={cn(
            "mt-1 text-2xl font-semibold tracking-tight text-foreground",
            titleClassName
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}