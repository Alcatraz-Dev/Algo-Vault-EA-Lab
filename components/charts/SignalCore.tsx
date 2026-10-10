"use client";

import { cn } from "@/lib/utils";

export type SignalVerdict = "buy" | "sell" | "flat";

type Tone = {
    text: string;
    ring: string;
    surface: string;
    cssVar: string;
};

const TONES: Record<SignalVerdict, Tone> = {
    buy: {
        text: "text-positive",
        ring: "border-positive/70",
        surface: "bg-positive/10",
        cssVar: "var(--positive)",
    },
    sell: {
        text: "text-negative",
        ring: "border-negative/70",
        surface: "bg-negative/10",
        cssVar: "var(--negative)",
    },
    flat: {
        text: "text-muted-foreground",
        ring: "border-info/60",
        surface: "bg-info/10",
        cssVar: "var(--info)",
    },
};

const VERDICT_LABEL: Record<SignalVerdict, string> = {
    buy: "BUY",
    sell: "SELL",
    flat: "FLAT",
};

/**
 * SignalCore — the circular, pulsing verdict badge of the dashboard.
 *
 * Two staggered rings breathe outward (the `core-ping` status treatment
 * defined in app/globals.css) around a solid core carrying the verdict, so the
 * panel reads like a live instrument rather than a static pill. Colour is
 * derived from the verdict, never chosen freely, and the whole badge collapses
 * to a static ring under prefers-reduced-motion.
 */
export default function SignalCore({
    verdict,
    size = 128,
    eyebrow = "AI Signal",
    caption,
    className,
}: {
    verdict: SignalVerdict;
    size?: number;
    eyebrow?: string;
    caption?: string;
    className?: string;
}) {
    const tone = TONES[verdict] ?? TONES.flat;
    const coreSize = Math.round(size * 0.66);

    return (
        <div
            className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
            style={{ width: size, height: size }}
            role="img"
            aria-label={`${eyebrow}: ${VERDICT_LABEL[verdict]}${caption ? `, ${caption}` : ""}`}
        >
            <span
                aria-hidden="true"
                className={cn("absolute inset-0 animate-core-ping rounded-full border-2", tone.ring)}
            />
            <span
                aria-hidden="true"
                className={cn(
                    "absolute inset-0 animate-core-ping rounded-full border",
                    tone.ring,
                    "[animation-delay:1.2s]"
                )}
            />
            <span
                className={cn(
                    "relative flex flex-col items-center justify-center gap-0.5 rounded-full border-2",
                    tone.ring,
                    tone.surface
                )}
                style={{ width: coreSize, height: coreSize }}
            >
                <span className="text-micro uppercase tracking-[0.18em] text-muted-foreground">
                    {eyebrow}
                </span>
                <span className={cn("font-numeric text-xl font-semibold uppercase tracking-wider", tone.text)}>
                    {VERDICT_LABEL[verdict]}
                </span>
                {caption ? (
                    <span className="max-w-[90%] truncate text-micro text-muted-foreground">{caption}</span>
                ) : null}
            </span>
        </div>
    );
}
