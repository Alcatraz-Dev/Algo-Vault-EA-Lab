/**
 * ToolBadge — PRO / LITE pill shown in headers, nav items and cards.
 * Used as the single visual marker of which tier a tool is on.
 */

"use client";

import { Crown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToolBadgeKind = "pro" | "lite" | "free";

export function ToolBadge({
    kind,
    className,
    size = "sm",
}: {
    kind: ToolBadgeKind;
    className?: string;
    size?: "sm" | "md";
}) {
    if (kind === "pro") {
        return (
            <span
                className={cn(
                    "inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 font-bold uppercase tracking-wider text-primary px-1 py-0 text-[9px] leading-none",
                    size === "md" ? "px-1.5 py-0 text-[9px]" : "",
                    className,
                )}
                aria-label="Pro feature"
            >
                <Crown className="size-2.5 shrink-0" />
                <span className="px-0.5">Pro</span>
            </span>
        );
    }

    if (kind === "lite") {
        return (
            <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border border-border bg-muted font-semibold uppercase tracking-wider text-muted-foreground px-1 py-0 text-[9px] leading-none",
                    size === "md" ? "px-1.5 py-0 text-[9px]" : "",
                    className,
                )}
                aria-label="Free / Lite feature"
            >
                <span className="px-0.5">Lite</span>
            </span>
        );
    }

    return (
        <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-border bg-muted font-semibold uppercase tracking-wider text-muted-foreground px-1 py-0 text-[9px] leading-none",
                size === "md" ? "px-1.5 py-0.5 text-[11px]" : "",
                className,
            )}
        >
            <Sparkles className="size-2.5 shrink-0" />
            <span className="px-0.5">Free</span>
        </span>
    );
}