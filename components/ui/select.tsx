import * as React from "react";
import { cn } from "cn";

const selectCls =
    "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

export function Select({
    className,
    ...props
}: React.ComponentProps<"select">) {
    return (
        <select
            className={cn(selectCls, className)}
            {...props}
        />
    );
}

export function SelectTrigger({
    className,
    children,
    ...props
}: React.ComponentProps<"select">) {
    return (
        <Select className={cn("appearance-none", className)} {...props}>
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
                "resize-y min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
                className
            )}
            rows={4}
            {...props}
        />
    );
}
