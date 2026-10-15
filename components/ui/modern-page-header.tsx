"use client";

import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";

export default function ModernPageHeader({
  backHref = "/",
  backLabel = "Back",
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  backHref?: string;
  backLabel?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card/60 shadow-[0_1px_3px_rgb(0_0_0/0.05)]">
      {/* Aceternity-style subtle gradient glow behind header */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-info/10 blur-3xl" />

      <div className="relative z-10 px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex items-start gap-3">
          {backHref && (
            <Link
              href={backHref}
              aria-label={`Back to ${backLabel}`}
              title={backLabel}
              className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ArrowLeft size={16} />
              <span className="sr-only">{backLabel}</span>
            </Link>
          )}

          <div className="min-w-0 flex-1">
            {eyebrow && (
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary">
                <Sparkles size={14} />
                <span>{eyebrow}</span>
              </div>
            )}

            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
              {title}
            </h1>

            {subtitle && (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {actions && <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </section>
  );
}
