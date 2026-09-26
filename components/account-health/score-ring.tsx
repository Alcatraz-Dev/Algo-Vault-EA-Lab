"use client";

/**
 * Animated health score ring.
 *
 * ── Why SVG and not a rotated border ──────────────────────────────────────────
 * The previous implementation was a square div with a transparent top border,
 * rotated. That cannot animate a partial sweep, it snaps between positions, and
 * it cannot render an accurate arc. This draws a real arc with
 * `stroke-dasharray`, so the sweep is proportional to the score and the
 * transition is genuinely interpolated.
 *
 * ── Why an account with no data shows no arc ──────────────────────────────────
 * A brand-new account scores ~100 purely because it has nothing to lose.
 * Animating a full green ring for that is an untested claim rendered as a
 * reassuring one, so an inactive account gets a muted dash ring and an em dash.
 */

import { cn } from "@/lib/utils";
import { useCountUp } from "./motion";
import type { RiskLevel } from "@/lib/account-health/types";

const RING: Record<RiskLevel, { stroke: string; text: string; glow: string }> = {
    LOW: { stroke: "stroke-emerald-500", text: "text-emerald-400", glow: "drop-shadow-[0_0_6px_rgba(16,185,129,0.35)]" },
    MODERATE: { stroke: "stroke-amber-500", text: "text-amber-400", glow: "drop-shadow-[0_0_6px_rgba(245,158,11,0.35)]" },
    HIGH: { stroke: "stroke-rose-500", text: "text-rose-400", glow: "drop-shadow-[0_0_6px_rgba(244,63,94,0.35)]" },
};

export function ScoreRing({
    score,
    riskLevel,
    hasData,
    size = 120,
    strokeWidth = 8,
    className,
}: {
    score: number;
    riskLevel: RiskLevel;
    hasData: boolean;
    size?: number;
    strokeWidth?: number;
    className?: string;
}) {
    // The sweep and the number share one animated value, so the arc and the
    // count can never disagree mid-animation.
    const shown = useCountUp(hasData ? Math.max(0, Math.min(100, score)) : 0);

    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const sweep = hasData ? (shown / 100) * circumference : 0;
    const tone = RING[riskLevel];

    return (
        <div
            className={cn("relative shrink-0", className)}
            style={{ width: size, height: size }}
            role="img"
            aria-label={hasData ? `Health score ${score} out of 100, risk ${riskLevel}` : "No health score: no trading activity"}
        >
            <svg width={size} height={size} className="-rotate-90" aria-hidden>
                {/* Track */}
                <circle
                    cx={size / 2} cy={size / 2} r={radius}
                    fill="none" strokeWidth={strokeWidth}
                    className={hasData ? "stroke-border/50" : "stroke-border/30"}
                    strokeDasharray={hasData ? undefined : `${circumference * 0.06} ${circumference}`}
                />
                {/* Sweep */}
                {hasData && (
                    <circle
                        cx={size / 2} cy={size / 2} r={radius}
                        fill="none" strokeWidth={strokeWidth} strokeLinecap="round"
                        className={cn(tone.stroke, tone.glow)}
                        strokeDasharray={circumference}
                        strokeDashoffset={circumference - sweep}
                        style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)" }}
                    />
                )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                    className={cn(
                        "font-mono font-bold tabular-nums leading-none",
                        hasData ? tone.text : "text-muted-foreground",
                    )}
                    style={{ fontSize: size * 0.27 }}
                >
                    {hasData ? shown : "—"}
                </span>
                <span className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    {hasData ? "/ 100" : "no data"}
                </span>
            </div>
        </div>
    );
}
