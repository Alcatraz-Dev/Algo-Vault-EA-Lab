import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Toolbar — canonical control row (filters, search, actions) for tables/panels.
 */
export function Toolbar({
  children,
  className,
  align = "between",
}: {
  children: ReactNode;
  className?: string;
  align?: "between" | "start" | "end";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        align === "between" && "justify-between",
        align === "start" && "justify-start",
        align === "end" && "justify-end",
        className
      )}
    >
      {children}
    </div>
  );
}