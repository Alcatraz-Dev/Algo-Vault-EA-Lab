"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type NoticeBannerVariant = "info" | "success" | "warn" | "error";

const variants: Record<NoticeBannerVariant, string> = {
    info: "border-info/30 bg-info/5 text-info-foreground",
    success: "border-positive/30 bg-positive/10 text-positive-foreground",
    warn: "border-warning/30 bg-warning/10 text-warning-foreground",
    error: "border-destructive/30 bg-destructive/10 text-destructive-foreground",
};

export function NoticeBanner({
    children,
    variant = "info",
    className,
    ...props
}: {
    children: ReactNode;
    variant?: NoticeBannerVariant;
    className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            role="status"
            className={cn(
                "rounded-md border px-3 py-2 text-xs",
                variants[variant],
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}
