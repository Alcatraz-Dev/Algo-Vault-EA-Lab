import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ToggleChip — a small multi-select pill used for channels, placement keys and
 * other option groups. Selected state uses the primary accent plus a check
 * mark, so a row of chips reads at a glance.
 */
export function ToggleChip({
    active,
    onClick,
    children,
    className,
    disabled,
    ...props
}: Omit<React.ComponentProps<"button">, "onClick" | "children"> & {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            data-slot="toggle-chip"
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                className
            )}
            {...props}
        >
            {active && <Check aria-hidden className="size-3.5" strokeWidth={2.5} />}
            {children}
        </button>
    );
}