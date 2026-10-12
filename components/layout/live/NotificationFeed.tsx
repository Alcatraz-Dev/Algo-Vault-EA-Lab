import type { ReactNode } from "react";
import { useScrollProgress } from "../../scroll/ScrollProgressContext";
import { LiveProgress } from "./LiveProgress";

/**
 * NotificationFeed — a scroll-parallel activity rail driven by scroll
 * progress. The feed maps the page's vertical scroll onto a set of rows so a
 * reader tripping through the content rail sees matching "live" noise on the
 * side rail, with no network and no fabricated activity.
 *
 * Rows are passed in by the host page (goods, trades, notifications) and each
 * row is honest `LoadingState` when the host has no data yet. The host is
 * responsible for populating the rows; this component only turns a progress
 * value into a moving rail.
 *
 * Reduced-motion fallback: rows are static and fully visible immediately —
 * no transitions — so a user who prefers reduced motion reads the feed
 * instantly instead of waiting for it to scroll into view.
 */
export function NotificationFeed({
  progress,
  rows,
  className,
}: {
  /** 0→1 scroll progress, owned by the host page's scroll rail. */
  progress?: number;
  /** Flat array of activity rows; the host owns the data. */
  rows: { id: string; label: string }[];
  className?: string;
}) {
  return (
    <aside
      className={`sticky top-20 flex flex-col gap-1 overflow-x-hidden border-l border-border/60 px-3 py-4 ${className ?? ""}`}
      aria-label="Activity feed"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          Feed
        </h2>
        <span className="font-numeric text-xs text-muted-foreground">
          {rows.length}
        </span>
      </div>

      {/* Shared progress track: lives in the middle of the rail. */}
      <div className="flex flex-1 flex-col gap-2">
        <LiveProgress progress={progress} />

        {/* Activity rows. When progress is undefined there is no rail, so the
            rows just sit as a static card — never a bogus progress. */}
        <div className="flex flex-1 flex-col gap-2 overflow-hidden">
          {rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No activity yet.</p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className={`flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  progress !== undefined && progress > 0 && progress < 1
                    ? "bg-card/60 text-muted-foreground"
                    : "bg-card/60 text-muted-foreground"
                }`}
              >
                <span className="font-numeric font-semibold text-foreground">
                  {row.label}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
