"use client";

import { useMotionValue, motion, useMotionTemplate } from "motion/react";
import React, { MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * CardSpotlight (Aceternity, adapted).
 *
 * Preserves the upstream mechanic — a pointer-tracked radial mask revealing
 * a tinted layer — but renders it as a pure CSS/motion-value effect on
 * design tokens. The upstream mounted `CanvasRevealEffect` (three.js dot
 * matrix, blue/violet) inside the reveal; that pulled `three` and
 * `@react-three/fiber` into the bundle for a hover decoration, so it is
 * deliberately replaced with a token tint. No canvas, no WebGL.
 */
export const CardSpotlight = ({
  children,
  radius = 350,
  color = "var(--primary)",
  tintOpacity = 0.12,
  className,
  ...props
}: {
  radius?: number;
  color?: string;
  tintOpacity?: number;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  function handleMouseMove({
    currentTarget,
    clientX,
    clientY,
  }: ReactMouseEvent<HTMLDivElement>) {
    const { left, top } = currentTarget.getBoundingClientRect();

    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <div
      className={cn(
        "group/spotlight relative rounded-xl border border-border bg-card",
        className,
      )}
      onMouseMove={handleMouseMove}
      {...props}
    >
      <motion.div
        className="pointer-events-none absolute -inset-px z-0 rounded-xl opacity-0 transition duration-300 group-hover/spotlight:opacity-100 motion-reduce:hidden"
        style={{
          backgroundColor: color,
          opacity: undefined,
          maskImage: useMotionTemplate`
            radial-gradient(
              ${radius}px circle at ${mouseX}px ${mouseY}px,
              white,
              transparent 80%
            )
          `,
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-xl bg-card"
          style={{ opacity: 1 - tintOpacity }}
        />
      </motion.div>
      {children}
    </div>
  );
};
