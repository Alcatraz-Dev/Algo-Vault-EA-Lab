"use client";

/**
 * ProValueGate — contextual Pro gate.
 *
 * Replaces the hard block with an explanation. When a Free user reaches a Pro
 * capability they see:
 *
 *   This workflow requires Pro.
 *   You're currently looking at: Strategy robustness analysis.
 *   Pro adds:
 *     ✓ Out-of-sample testing
 *     ✓ Walk-forward analysis
 *     ...
 *   [Upgrade to Pro]  [See an example]
 *
 * The "See an example" path is the important part: the user can evaluate the
 * capability before paying for it. We never fabricate a screenshot or a metric
 * to make the gate feel more compelling.
 *
 * Copy comes from `lib/product-analytics/pro-value.ts`, which is validated
 * against real routes by `lib/product-analytics/__tests__/check-routes.ts`.
 */

import Link from "next/link";
import { Lock, ArrowRight, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getProValue } from "@/lib/product-analytics/pro-value";
import { track } from "@/lib/product-analytics/client";

export function ProValueGate({
    trigger,
    /** What the user is looking at right now, in their workflow's language. */
    currentView,
    className,
}: {
    trigger: string;
    currentView?: string;
    className?: string;
}) {
    const value = getProValue(trigger);

    const recordIntent = (stage: "viewed" | "upgrade" | "example") => {
        if (stage === "viewed") {
            track("PRO_FEATURE_VIEWED", { feature: trigger, blocker: "pro" });
            return;
        }
        track(stage === "upgrade" ? "PRO_UPGRADE_CLICKED" : "FEATURE_DISCOVERY_CLICKED", {
            feature: trigger,
            source: "pro-gate",
        });
    };

    return (
        <div
            className={`rounded-lg border border-border bg-card p-6 ${className ?? ""}`}
            data-testid="pro-value-gate"
        >
            <div className="mb-4 flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Lock className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0">
                    <h2 className="text-base font-semibold text-foreground">This workflow requires Pro</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        You&apos;re currently looking at:{" "}
                        <span className="text-foreground">{currentView ?? value.title}</span>
                    </p>
                </div>
            </div>

            <div className="mb-5 rounded-md border border-border bg-muted/40 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On Free you already have</p>
                <p className="mt-1 text-sm text-foreground">{value.freeIncludes}</p>
            </div>

            <div className="mb-6">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Pro adds</p>
                <ul className="space-y-1.5">
                    {value.adds.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm text-foreground">
                            <span aria-hidden className="mt-0.5 text-positive">
                                ✓
                            </span>
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <Button
                    render={<Link href="/pricing" />}
                    onClick={() => recordIntent("upgrade")}
                    nativeButton={false}
                >
                    Upgrade to Pro
                    <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
                </Button>
                {/* The honest path: look at the capability before deciding. */}
                <Button
                    variant="ghost"
                    render={<Link href={value.exampleRoute} />}
                    onClick={() => recordIntent("example")}
                    nativeButton={false}
                >
                    <Eye className="mr-1.5 h-4 w-4" aria-hidden />
                    See an example
                </Button>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
                Historical analysis and backtests describe past data. They are not a performance guarantee.
            </p>
        </div>
    );
}
