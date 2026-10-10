import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — canonical page title block.
  * eyebrow → title → subtitle, with optional action cluster + optional back button.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  className,
  titleClassName,
  backHref,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  backHref?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 md:flex-row md:items-end md:justify-between",
        className
      )}
    >
      {/* No data-guide here: AppShell/AdminShell topbars own the page-header anchor. */}
      <div className="min-w-0">
        {backHref ? (
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors mb-2">
            <ArrowLeft size={14} /> Back
          </Link>
        ) : null}
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