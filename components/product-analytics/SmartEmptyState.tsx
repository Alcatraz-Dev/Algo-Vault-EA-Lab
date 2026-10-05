"use client";

/**
 * SmartEmptyState — an empty state that teaches.
 *
 * A bare "No setups." tells the user nothing. Every empty state in AlgoVault
 * should answer three questions:
 *
 *   1. What is this, and why would I want it?
 *   2. What is a realistic first example?
 *   3. What single action starts me?
 *
 * The `example` is a real, specific starting point (a symbol, a timeframe, a
 * method combination) rather than generic filler.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { track } from "@/lib/product-analytics/client";

export type SmartEmptyStateProps = {
    icon?: React.ReactNode;
    /** Plain statement of what is missing. */
    title: string;
    /** Why this would be useful to them. */
    description: string;
    /**
     * A concrete, realistic first example. Rendered as a short recipe so the
     * user can act without inventing a starting point.
     */
    example?: { label: string; steps: string[] };
    /** The one action to take now. */
    action: { label: string; href: string };
    surface?: Parameters<typeof track>[2];
    compact?: boolean;
    className?: string;
};

export function SmartEmptyState({
    icon,
    title,
    description,
    example,
    action,
    surface = "other",
    compact = false,
    className,
}: SmartEmptyStateProps) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center rounded-lg border border-dashed border-border text-center",
                compact ? "px-4 py-8" : "px-6 py-14",
                className
            )}
            data-testid="smart-empty-state"
        >
            {icon ? (
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    {icon}
                </div>
            ) : null}
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p>

            {example ? (
                <div className="mt-4 w-full max-w-sm rounded-md border border-border bg-muted/40 p-3 text-left">
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {example.label}
                    </p>
                    <ul className="space-y-1">
                        {example.steps.map((step) => (
                            <li key={step} className="flex items-start gap-2 text-sm text-foreground">
                                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                                <span>{step}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <div className="mt-4">
                <Button
                    nativeButton={false}
                    render={
                        <Link
                            href={action.href}
                            onClick={() => track("FEATURE_DISCOVERY_CLICKED", { source: "empty-state" }, surface)}
                        />
                    }
                >
                    {action.label}
                    <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
                </Button>
            </div>
        </div>
    );
}
