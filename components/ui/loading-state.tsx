import { cn } from "@/lib/utils";

/**
 * Skeleton — shimmering placeholder for loading states.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted",
        className
      )}
      aria-hidden="true"
    />
  );
}

/**
 * LoadingState — canonical loading block (inline or full-page).
 * Prefer over bare spinners on important data surfaces.
 */
export function LoadingState({
  label = "Loading…",
  className,
  rows = 3,
}: {
  label?: string;
  className?: string;
  rows?: number;
}) {
  return (
    <div
      className={cn("flex flex-col gap-3 rounded-lg border border-border bg-card p-5", className)}
      role="status"
      aria-label={label}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-16" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Full-page centering wrapper for auth/route-level loading. */
export function FullPageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status">
      <div className="flex flex-col items-center gap-3">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-border border-t-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}