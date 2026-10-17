/**
 * ToolPageShell — the shared layout for every public tool page.
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
    badge?: ToolBadgeKind;
    backHref?: string;
    proHeadline?: string;
    proFeatures?: string[];
    showProCTA?: boolean;
    children: React.ReactNode;
    className?: string;
}) {
    const tier: ToolBadgeKind = badge ?? "free";

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className={cn("mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8", className)}>
                <header data-guide="page-header" className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-card/60 shadow-[0_1px_3px_rgb(0_0_0/0.05)] px-6 py-6 sm:px-8 sm:py-7">
                    <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
                    <div className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-info/10 blur-3xl" />
                    <div className="relative z-10">
                        {backHref ? (
                            <Link
                                href={backHref}
                                aria-label="Back to Tools"
                                title="Back to Tools"
                                className="mb-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                                <ArrowLeft size={16} />
                                <span className="sr-only">Back</span>
                            </Link>
                        ) : null}
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    {Icon ? (
                                        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm">
                                            <Icon className="size-4" />
                                        </div>
                                    ) : null}
                                    <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:text-4xl">
                                        {title}
                                    </h1>
                                    <ToolBadge kind={tier} />
                                </div>
                                {description ? (
                                    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                                        {description}
                                    </p>
                                ) : null}
                            </div>
                        </div>
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
