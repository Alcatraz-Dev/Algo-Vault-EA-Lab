import { useScrollProgress } from "../../scroll/ScrollProgressContext";
import { LiveProgress } from "./LiveProgress";

/**
 * LiveScrollFeed — a parallax/trackable "map" scene: a scrolling track of
 * cards along AlgoVault tokens, driven by a single scroll-progress value.
 *
 * The scene is a real scrolling rail (every card is a DOM row), so the track
 * stays a genuine scrollable column rather than a visual trick. A one-line
 * `progress` callback owned by the host page drives every card's parallax
 * offset, giving the depth impression without layered scroll containers or
 * `translateZ` traps.
 *
 * Data records (country, cluster, strategy row, …) are passed in by the host
 * page — never fabricated positions. The feed never declares a card's
 * coordinates; it only positions records the host already knows.
 *
 * Reduced-motion fallback: every card sits statically at its final position
 * with no offset, so the scene reads as a plain list under
 * `prefers-reduced-motion`.
 */
export function LiveScrollFeed({
  progress,
  cards,
  className,
}: {
  /** 0→1 scroll progress, owned by the host page's scroll rail. */
  progress?: number;
  /** Scrollable track of records. */
  cards: { id: string; label: string; value?: string; tone?: "positive" | "negative" | "neutral" }[];
  className?: string;
}) {
  return (
    <section
      className={`relative overflow-x-hidden overflow-y-auto py-6 ${className ?? ""}`}
      aria-label="Tracked scroll scene"
    >
      <div className="page-container">
        {/* Track header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Tracked records
          </h2>
          <span className="font-numeric text-xs text-muted-foreground">
            {cards.length} records
          </span>
        </div>

        {/* Scroll track — every card is a real DOM row. */}
        <div className="relative mt-4 flex flex-col gap-2 overflow-y-auto overscroll-contain">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex w-full flex-shrink-0 items-center gap-3 rounded-lg border border-border/50 bg-card/60 px-3 py-2 transition-colors hover:border-border/80"
              style={{
                transform: progress !== undefined ? `translateX(${progress * 8}px)` : undefined,
              }}
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
      </div>
    </section>
  );
}
