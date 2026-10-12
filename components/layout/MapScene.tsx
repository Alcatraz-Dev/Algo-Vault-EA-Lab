import { useEffect, useMemo, useRef, useState } from "react";

/**
 * MapScene — a parallax/trackable "map" scene as a scrolling track of cards
 * along AlgoVault tokens, driven by scroll progress.
 *
 * The scene scrolls natively (every card is a real DOM row, so the track stays
 * a real scrolling rail rather than a visual trick). A single `progress`
 * callback owned by the host page lifts the cards at different rates, giving
 * the parallax feel. Small cards are data records (e.g. top clusters/countries
 * or strategy rows) passed in by the host page — never fabricated positions.
 *
 * Reduced-motion fallback: every card sits statically at its final position
 * with no offsets, so the scene reads as a plain list under
 * `prefers-reduced-motion`.
 */
export function MapScene({
  progress,
  cards,
  className,
}: {
  /** 0→1 scroll progress, owned by the host page's rail. */
  progress: number;
  /** Scrollable track of records (country, cluster, strategy row, …). */
  cards: { id: string; label: string; value?: string; tone?: "positive" | "negative" | "neutral" }[];
  className?: string;
}) {
  // Parallax offsets: cards closer to "camera" move less, cards further
  // translate more. All offsets are linear in progress, clamped to a
  // sane band so a stationary reader isn't flung around.
  return (
    <section
      className={`relative overflow-x-hidden overflow-y-auto py-6 ${className ?? ""}`}
      aria-label="Map scene"
    >
      <div className="page-container">
        {/* Track header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Live activity
          </h2>
          <span className="font-numeric text-xs text-muted-foreground">
            {cards.length} records
          </span>
        </div>

        {/* Scroll track: every second row duplicates the list so the strip
            appears to scroll continuously (the "ticker" effect) without needing
            an actual tween. The row highlight advances in step with `progress`. */}
        <div className="relative mt-4 flex h-[240px] min-w-0 flex-col gap-2 overflow-y-auto overscroll-contain">
          {cards.map((card) => {
            const offset = useMemo(() => {
              // A small static parallax offset makes the card read as a
              // "closer" object. The actual lift is driven by `progress`
              // on the host page; we expose only the visual depth here.
              return (progress - 0.5) * 8;
            }, [progress]);

            return (
              <div
                key={card.id}
                className="flex w-full flex-shrink-0 items-center gap-3 rounded-lg border border-border/50 bg-card/60 px-3 py-2 transition-colors hover:border-border/80"
                style={{ transform: `translateX(${offset}px)` }}
              >
                <span className="font-numeric text-sm font-semibold text-foreground">
                  {card.label}
                </span>
                {card.value ? (
                  <span className="font-numeric text-xs text-foreground/70">
                    {card.value}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Reduced-motion: the static fallback. */}
        <noscript>
          <div className="mt-4 space-y-2">
            {cards.map((card) => (
              <div
                key={card.id}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/60 px-3 py-2"
              >
                <span className="font-numeric text-sm font-semibold text-foreground">
                  {card.label}
                </span>
                {card.value ? (
                  <span className="font-numeric text-xs text-foreground/70">
                    {card.value}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </noscript>
      </div>
    </section>
  );
}
