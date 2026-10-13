"use client";
import React, { useRef } from "react";
import { useMotionValueEvent, useScroll } from "motion/react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export const StickyScroll = ({
  content,
  contentClassName,
}: {
  content: {
    title: string;
    description: string;
    content?: React.ReactNode;
  }[];
  contentClassName?: string;
}) => {
  const [activeCard, setActiveCard] = React.useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  // Page-scroll variant (upstream defaulted to an inner overflow container,
  // which would hijack scroll on a marketing page). The section sticks while
  // the page scrolls; the breakpoint mechanic is unchanged.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start center", "end center"],
  });
  const cardLength = content.length;

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    const cardsBreakpoints = content.map((_, index) => index / cardLength);
    const closestBreakpointIndex = cardsBreakpoints.reduce(
      (acc, breakpoint, index) => {
        const distance = Math.abs(latest - breakpoint);
        if (distance < Math.abs(latest - cardsBreakpoints[acc])) {
          return index;
        }
        return acc;
      },
      0,
    );
    setActiveCard(closestBreakpointIndex);
  });

  // Tokenized to the AlgoVault surface + ember accent. Upstream cycled
  // slate/black/neutral backgrounds with cyan/emerald, pink/indigo and
  // orange/yellow gradients.
  const backgroundColors = [
    "var(--card)",
    "var(--card)",
    "var(--card)",
    "var(--card)",
  ];
  const linearGradients = [
    "linear-gradient(to bottom right, var(--primary), color-mix(in oklch, var(--primary) 45%, transparent))",
    "linear-gradient(to bottom right, var(--positive), color-mix(in oklch, var(--positive) 45%, transparent))",
    "linear-gradient(to bottom right, var(--info), color-mix(in oklch, var(--info) 45%, transparent))",
    "linear-gradient(to bottom right, var(--warning), color-mix(in oklch, var(--warning) 45%, transparent))",
  ];

  // Derived during render (no setState-in-effect): the active gradient
  // follows the active card directly.
  const backgroundGradient =
    linearGradients[activeCard % linearGradients.length];

  return (
    <motion.div
      animate={{
        backgroundColor: backgroundColors[activeCard % backgroundColors.length],
      }}
      className="relative flex justify-center gap-10 py-10"
      ref={ref}
    >
      <div className="relative flex items-start px-4">
        <div className="max-w-2xl">
          {content.map((item, index) => (
            <div key={item.title + index} className="my-16 first:mt-8 last:mb-8">
              <motion.h3
                initial={{
                  opacity: 0,
                }}
                animate={{
                  opacity: activeCard === index ? 1 : 0.3,
                }}
                className="text-2xl font-bold text-foreground"
              >
                {item.title}
              </motion.h3>
              <motion.p
                initial={{
                  opacity: 0,
                }}
                animate={{
                  opacity: activeCard === index ? 1 : 0.3,
                }}
                // Fixed upstream `text-kg` typo; tokenized slate-300.
                className="mt-6 max-w-sm text-sm leading-6 text-muted-foreground"
              >
                {item.description}
              </motion.p>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{ background: backgroundGradient }}
        className={cn(
          "sticky top-24 hidden h-72 w-96 shrink-0 self-start overflow-hidden rounded-xl border border-border bg-card lg:block",
          contentClassName,
        )}
      >
        {content[activeCard].content ?? null}
      </div>
    </motion.div>
  );
};
