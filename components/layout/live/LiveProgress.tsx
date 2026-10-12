import { cn } from "@/lib/utils";

/** Shared scroll-progress-driven progress track for the live rail. */

export function LiveProgress({
  progress,
  className,
  trackClassName,
  indicatorClassName,
}: {
  progress?: number;
  className?: string;
  trackClassName?: string;
  indicatorClassName?: string;
}) {
  const settled = progress ?? 0;

  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-full bg-muted/60", className ?? "")}
      role="progressbar"
      aria-valuenow={Math.round(settled * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Scroll progress"
    >
      {progress !== undefined ? (
        <div
          className={cn("absolute left-0 top-1/2 h-0.5 rounded-full bg-primary origin-left", trackClassName ?? "")}
          style={{ width: `${settled * 100}%`, transform: `translateY(-50%) scaleX(var(--scroll-progress, ${settled}))` }}
          aria-hidden
        />
      ) : (
        <div
          className="absolute left-0 top-1/2 h-0.5 rounded-full bg-border/60"
          style={{ width: "100%", transform: "translateY(-50%)" }}
          aria-hidden
        />
      )}

      {progress !== undefined ? (
        <div
          className={cn("absolute left-0 top-1/2 h-2.5 w-2.5 rounded-full bg-primary origin-left", indicatorClassName ?? "")}
          style={{ width: "2.5rem", transform: `translateY(-50%) translateX(${settled * 100}%)` }}
          aria-hidden
        />
      ) : (
        <div
          className="absolute left-0 top-1/2 h-2.5 w-2.5 rounded-full bg-border/60"
          style={{ transform: "translateY(-50%)" }}
          aria-hidden
        />
      )}
    </div>
  );
}
