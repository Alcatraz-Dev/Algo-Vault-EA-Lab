import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The landing page's section header.
 *
 * Every marketing section reads its type from the one ladder in globals.css
 * (`.home-eyebrow` → `.home-title` → `.home-lede`, DESIGN.md §21.2), so sections
 * cannot drift into ad-hoc sizes and weights. This component is the only place
 * that ladder is applied, which is what keeps the page rhythm consistent.
 *
 * `align="center"` is the default band header; `align="left"` puts the copy in a
 * two-column row with a trailing action (used by the evidence and showcase
 * sections, where the eye is already moving right toward the data).
 */
export default function HomeSectionHeader({
    eyebrow,
    title,
    description,
    align = "center",
    action,
    className,
}: {
    /** All-caps group label. Sits on the house 11px micro floor. */
    eyebrow: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    align?: "center" | "left";
    /** Trailing link/button — only rendered in the `left` layout. */
    action?: ReactNode;
    className?: string;
}) {
    if (align === "left") {
        return (
            <div
                className={cn(
                    "flex flex-col gap-5 md:flex-row md:items-end md:justify-between",
                    className
                )}
            >
                <div className="max-w-2xl">
                    <p className="home-eyebrow">{eyebrow}</p>
                    <h2 className="home-title mt-3">{title}</h2>
                    {description ? <p className="home-lede mt-4">{description}</p> : null}
                </div>
                {action ? <div className="shrink-0">{action}</div> : null}
            </div>
        );
    }

    return (
        <div className={cn("mx-auto max-w-2xl text-center", className)}>
            <p className="home-eyebrow">{eyebrow}</p>
            <h2 className="home-title mt-3">{title}</h2>
            {description ? <p className="home-lede mt-4">{description}</p> : null}
            {action ? <div className="mt-6">{action}</div> : null}
        </div>
    );
}
