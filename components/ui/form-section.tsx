import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * FormSection — a labeled group inside a long form dialog. The hairline + small
 * uppercase label breaks a stacking of fields into scannable groups without
 * adding weight.
 */
export function FormSection({
    title,
    children,
    className,
}: {
    title: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section data-slot="form-section" className={cn("space-y-4", className)}>
            <div className="flex items-center gap-3">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {title}
                </span>
                <span aria-hidden className="h-px flex-1 bg-border/70" />
            </div>
            {children}
        </section>
    );
}