import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * SectionHeader — canonical section title row inside a page/panel.
 * Optional leading icon, trailing meta and action.
 */
export function SectionHeader({
  title,
  description,
  icon,
  meta,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-muted/50 text-muted-foreground [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-balance text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {meta}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}