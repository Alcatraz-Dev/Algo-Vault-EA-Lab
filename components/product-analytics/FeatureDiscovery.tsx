"use client";

/**
 * FeatureDiscovery — contextual, non-intrusive next-step suggestion.
 *
 * Shown inline after a meaningful action, never as a popup or a modal. The
 * suggestion always names the workflow the user just completed and offers the
 * one natural next step in the AlgoVault loop:
 *
 *   chart → analyse → setup → backtest → validate → paper trade → journal
 *
 * Dismissal is remembered for the session so we do not nag.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, X, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/product-analytics/client";
import type { ProductEventType } from "@/lib/product-analytics/events";

/**
 * Discovery rules. Keyed by the event the user just completed. Each rule
 * points at a route that really exists and a next step that genuinely follows.
 */
export const DISCOVERY_RULES: Partial<Record<ProductEventType, { text: string; cta: string; href: string }>> = {
    SMART_MONEY_VIEWED: {
        text: "Found a setup worth keeping? Turn it into a strategy you can test.",
        cta: "Build a strategy",
        href: "/strategy-lab",
    },
    SETUP_CREATED: {
        text: "This setup has a rule set now. Test it against history before you risk anything.",
        cta: "Backtest it",
        href: "/backtests",
    },
    STRATEGY_BACKTESTED: {
        text: "A backtest tells you how it behaved in-sample. Robustness tells you whether that survives.",
        cta: "Run OOS + Monte Carlo",
        href: "/monte-carlo",
    },
    RESEARCH_COMPLETED: {
        text: "Your strategy passed research. Paper trading is the next step before live.",
        cta: "Start paper trading",
        href: "/account/trading",
    },
    ROBUSTNESS_RUN: {
        text: "If performance changed, Research can show you where it broke down.",
        cta: "Investigate with Research",
        href: "/strategy-research",
    },
    TRADE_COMPLETED: {
        text: "The journal turns individual trades into a pattern you can act on.",
        cta: "Review the trade",
        href: "/trade-journal",
    },
    AI_ANALYSIS_COMPLETED: {
        text: "Save the levels worth revisiting and AlgoVault will keep watching them.",
        cta: "Create a setup",
        href: "/market-intelligence/smart-money",
    },
};

export function FeatureDiscovery({
    after,
    surface,
    className,
}: {
    /** The event the user just completed. */
    after: ProductEventType;
    surface?: Parameters<typeof track>[2];
    className?: string;
}) {
    const [dismissed, setDismissed] = useState(false);
    const rule = DISCOVERY_RULES[after];
    if (!rule || dismissed) return null;

    return (
        <aside
            className={`flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3 ${className ?? ""}`}
            data-testid="feature-discovery"
        >
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{rule.text}</p>
                <Button
                    variant="link"
                    size="xs"
                    className="mt-1 h-auto p-0"
                    nativeButton={false}
                    render={
                        <Link
                            href={rule.href}
                            onClick={() => track("FEATURE_DISCOVERY_CLICKED", { feature: after }, surface)}
                        />
                    }
                >
                    {rule.cta}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Button>
            </div>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Dismiss suggestion"
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
                <X className="h-3.5 w-3.5" aria-hidden />
            </button>
        </aside>
    );
}
