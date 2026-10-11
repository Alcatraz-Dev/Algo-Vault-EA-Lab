import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";

/**
 * Select / Textarea — FlyonUI `.select` / `.textarea` controls.
 *
 * FlyonUI's `.select` ships its own chevron background-image; `bg-none`
 * suppresses it so the single AlgoVault `ChevronDown` affordance stays. Brand
 * border (`border-input`) and dense sizing are pinned on top.
 */
const selectCls =
    "select h-9 w-full min-w-0 bg-none border-input py-2 pl-3 pr-9 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-sm dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

export function Select({
    className,
    containerClassName,
    children,
    ...props
}: React.ComponentProps<"select"> & { containerClassName?: string }) {
    return (
        <div className={cn("relative min-w-0 w-full", containerClassName)} data-slot="select">
            <select className={cn(selectCls, className)} {...props}>
                {children}
            </select>
            <ChevronDown
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
        </div>
    );
}

export function SelectTrigger({
    className,
    containerClassName,
    children,
    ...props
}: React.ComponentProps<"select"> & { containerClassName?: string }) {
    return (
        <Select className={className} containerClassName={containerClassName} {...props}>
            {children}
        </Select>
    );
}

export function Textarea({
    className,
    ...props
}: React.ComponentProps<"textarea">) {
    return (
        <textarea
            className={cn(
                "textarea resize-y min-h-[80px] w-full border-input px-3 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-sm dark:disabled:bg-input/80",
                className
            )}
            rows={4}
            {...props}
        />
    );
}
