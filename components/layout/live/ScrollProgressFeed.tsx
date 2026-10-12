import { useScrollProgress } from "../../scroll/ScrollProgressContext";

/** Scroll-driven "scrollable content rail" spine bar. */

export function ScrollProgressFeed({
  rows,
  className,
}: {
  rows: { id: string; label: string }[];
  className?: string;
}) {
  const { progress } = useScrollProgress();

  return (
    <aside
      className={`sticky top-20 flex flex-col gap-1 overflow-x-hidden border-l border-border/60 px-3 py-4 ${className ?? ""}`}
      aria-label="Scroll progress rail"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          Scroll
        </h2>
        <span className="font-numeric text-xs text-muted-foreground">{rows.length}</span>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-border/60">
            <div
              className="h-full rounded-full bg-primary origin-left"
              style={{ width: `${progress * 100}%` }}
              aria-hidden
            />
          </div>
          <span className="font-numeric text-xs text-muted-foreground tabular-nums">
            {Math.round(progress * 100)}%
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-2 overflow-hidden">
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No activity yet.</p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className={`flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${progress > 0 && progress < 1 ? "bg-primary/5 text-foreground" : "bg-card/60 text-muted-foreground"}`}
              >
                <span className="font-numeric font-semibold text-foreground">{row.label}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
