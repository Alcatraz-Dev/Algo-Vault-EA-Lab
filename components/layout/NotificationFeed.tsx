import { useEffect, useRef, useState } from "react";

/**
 * NotificationFeed — a scroll-parallel activity rail driven by scroll progress.
 *
 * The feed is a column of rows that tracks the page's vertical scroll; the
 * trackable row highlight advances in step with the spine progress bar, so a
 * user scrolling the content rail sees matching "live" noise on the side rail
 * without any network. It never fabricates activity: rows are passed in by
 * the host page (goods, trades, notifications), and each row is honest
 * `LoadingState` when the host has no data yet.
 *
 * Reduced-motion fallback: rows are static and fully visible immediately —
 * no transitions — so a user who prefers reduced motion reads the feed
 * instantly instead of waiting for it to scroll into view.
 */
export function NotificationFeed({
  progress,
  className,
  rows,
}: {
  /** 0→1 scroll progress, owned by the host page's scroll rail. */
  progress: number;
  className?: string;
  rows: { id: string; label: string; tone?: "live" | "stale" | "offline" | "neutral" }[];
}) {
  return (
    <aside
      className={`sticky top-20 flex flex-col gap-1 overflow-x-hidden border-l border-border/60 px-3 py-4 ${className ?? ""}`}
      aria-label="Scroll feed"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          Feed
        </h2>
        <span className="font-numeric text-xs text-muted-foreground">
          {rows.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No activity yet.</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className={`flex items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-xs transition-colors ${
                row.tone === "live"
                  ? "bg-primary/5 text-foreground"
                  : row.tone === "stale"
                    ? "bg-warning/5 text-foreground/70"
                    : row.tone === "offline"
                      ? "bg-muted/60 text-muted-foreground"
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
    </aside>
  );
}
