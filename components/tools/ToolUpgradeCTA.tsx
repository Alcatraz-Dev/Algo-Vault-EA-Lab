/**
 * ToolUpgradeCTA — inline panel placed at the top of a free/Lite tool page
 * that announces the upgrade path to Pro. Honest: the lite features below
 * still work; this is the value-prop anchor that explains what Pro adds.
 *
 * It also doubles as the locked CTA on Pro-only sections inside a Lite tool
 * page (e.g. "Profit Split Calculator — Pro feature").
 */

"use client";

import Link from "next/link";
import { ArrowRight, Check, Crown, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function ToolUpgradeCTA({
    proHeadline,
    proFeatures,
    liteFeatures,
    proHref,
    variant = "panel",
}: {
    proHeadline: string;
    proFeatures: string[];
    liteFeatures?: string[];
    /** Where the upgrade CTA points. Defaults to /pricing. */
    proHref?: string;
    /** "panel" = full banner at the top, "card" = smaller locked-section card */
    variant?: "panel" | "card";
}) {
    const ctaHref = proHref ?? "/pricing";

    if (variant === "card") {
        return (
            <div className="relative rounded-lg border border-primary/25 bg-gradient-to-br from-primary/[0.07] via-primary/[0.03] to-transparent p-5">
                <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Lock className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground">
                                Pro feature
                            </h3>
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                                <Crown className="size-2.5" />
                                Pro
                            </span>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                            {proHeadline}
                        </p>
                        {proFeatures.length > 0 ? (
                            <ul className="mt-3 space-y-1.5">
                                {proFeatures.slice(0, 4).map((f) => (
                                    <li
                                        key={f}
                                        className="flex items-start gap-2 text-xs text-muted-foreground"
                                    >
                                        <Check className="mt-0.5 size-3 shrink-0 text-primary" />
                                        <span>{f}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        <Link
                            href={ctaHref}
                            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
                        >
                            Unlock with Pro
                            <ArrowRight className="size-3" />
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] via-card to-primary/[0.04]">
            <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                            <Crown className="size-3" />
                            Pro unlocks
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {liteFeatures && liteFeatures.length > 0
                                ? "You're on Lite. Pro adds the features below."
                                : "Pro unlocks the features below."}
                        </span>
                    </div>
                    <h3 className="mt-3 text-base font-semibold tracking-tight text-foreground">
                        {proHeadline}
                    </h3>
                    {proFeatures.length > 0 ? (
                        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                            {proFeatures.map((f) => (
                                <li
                                    key={f}
                                    className="flex items-start gap-2 text-xs text-muted-foreground"
                                >
                                    <Check className="mt-0.5 size-3 shrink-0 text-primary" />
                                    <span>{f}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                    <Link
                        href={ctaHref}
                        className={cn(
                            "inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90",
                        )}
                    >
                        <Sparkles className="size-3.5" />
                        Upgrade to Pro
                    </Link>
                    <Link
                        href="/pricing"
                        className="text-xs text-muted-foreground transition hover:text-foreground"
                    >
                        Compare plans →
                    </Link>
                </div>
            </div>
        </div>
    );
}

/**
 * LockedSectionCard — wraps a section of UI that is Pro-only and replaces
 * the content with an upgrade prompt. Use inside Lite tool pages to mark
 * a Pro-only block without changing the layout.
 */
export function LockedSectionCard({
    title,
    description,
    proHref,
}: {
    title: string;
    description: string;
    proHref?: string;
}) {
    return (
        <div className="relative rounded-2xl border border-dashed border-primary/30 bg-primary/[0.03] p-5">
            <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Lock className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">
                            {title}
                        </h4>
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                            <Crown className="size-2.5" />
                            Pro
                        </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {description}
                    </p>
                    <Link
                        href={proHref ?? "/pricing"}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition hover:text-primary/80"
                    >
                        Unlock with Pro
                        <ArrowRight className="size-3" />
                    </Link>
                </div>
            </div>
        </div>
    );
}