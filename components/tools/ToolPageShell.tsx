/**
 * ToolPageShell — the shared layout for every public tool page.
 *
 * Responsibilities:
 *  - header (title + tier badge + back link + optional description)
 *  - one inline "what Pro adds" CTA strip so the value gap is visible
 *  - consistent container widths and spacing
 *
 * Tool pages opt in by composing with this shell; they remain free to
 * render any content inside.
 */

"use client";

import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolBadge, type ToolBadgeKind } from "@/components/tools/tier-ui";
import { ToolUpgradeCTA } from "@/components/tools/ToolUpgradeCTA";

export function ToolPageShell({
    title,
    description,
    icon: Icon,
    badge,
    backHref,
    proHeadline,
    proFeatures,
    showProCTA = true,
    children,
    className,
}: {
    title: string;
    description?: string;
    icon?: LucideIcon;
    /** Defaults to "free" (Lite). Set to "pro" for Pro tool pages. */
    badge?: ToolBadgeKind;
    backHref?: string;
    /** Headline shown in the Pro upgrade strip at the top. */
    proHeadline?: string;
    /** Concrete Pro features listed in the strip. */
    proFeatures?: string[];
    /** Set false to suppress the Pro upgrade strip (e.g. already on a Pro page). */
    showProCTA?: boolean;
    children: React.ReactNode;
    className?: string;
}) {
    const tier: ToolBadgeKind = badge ?? "free";

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className={cn("mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8", className)}>
                {backHref ? (
                    <Link
                        href={backHref}
                        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
                    >
                        <ArrowLeft className="size-3.5" />
                        Back
                    </Link>
                ) : null}

                <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            {Icon ? (
                                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground">
                                    <Icon className="size-4" />
                                </div>
                            ) : null}
                            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                                {title}
                            </h1>
                            <ToolBadge kind={tier} />
                        </div>
                        {description ? (
                            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                                {description}
                            </p>
                        ) : null}
                    </div>
                </header>

                {showProCTA && tier === "free" && proHeadline && proFeatures ? (
                    <div className="mb-6">
                        <ToolUpgradeCTA
                            proHeadline={proHeadline}
                            proFeatures={proFeatures}
                            variant="panel"
                        />
                    </div>
                ) : null}

                <div className="flex flex-col gap-6">{children}</div>
            </div>
        </div>
    );
}