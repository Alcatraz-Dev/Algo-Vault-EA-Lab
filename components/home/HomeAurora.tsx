"use client";

import { cn } from "@/lib/utils";

type HomeAuroraProps = {
    className?: string;
    aClassName?: string;
    bClassName?: string;
};

/**
 * Shared aurora atmosphere for a landing section (DESIGN.md §21.2).
 *
 * Two slow, token-coloured light blobs drift behind the section's content.
 * Purely decorative: the wrapper is `aria-hidden` and `pointer-events-none`,
 * and both blobs freeze under `prefers-reduced-motion` (the CSS guard in
 * `app/globals.css`). Position and size live on the caller via `aClassName` /
 * `bClassName`, so each section places the glow where it reads best; the blobs
 * deliberately bleed past their section, which is why `.home-page` clips the
 * document axis rather than each section.
 */
export default function HomeAurora({ className, aClassName, bClassName }: HomeAuroraProps) {
    return (
        <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
            <span className={cn("av-aurora av-aurora-a", aClassName)} />
            <span className={cn("av-aurora av-aurora-b", bClassName)} />
        </div>
    );
}