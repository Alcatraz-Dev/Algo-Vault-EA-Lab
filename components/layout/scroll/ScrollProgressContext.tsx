"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** Scroll progress context — single driver for every scroll-driven surface. */

export interface ScrollProgressValue {
  progress: number;
  restart: () => void;
}

const ScrollProgressContext = createContext<ScrollProgressValue | null>(null);

/** Family: parcel one provider per page; every scroll-driven rail reads the same value. */
export function ScrollProgressProvider({ children }: { children: React.ReactNode }) {
  const [progress, setProgress] = useState(0);

  const restart = useCallback(() => setProgress(0), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const doc = document.documentElement;
    const scrollHeight = doc.scrollHeight;
    const clientHeight = doc.clientHeight;
    const total = Math.max(scrollHeight - clientHeight, 1);

    const onScroll = () => {
      const top = window.pageYOffset;
      setProgress(Math.min(1, top / total));
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const value = useMemo<ScrollProgressValue>(() => ({ progress, restart }), [progress, restart]);

  return <ScrollProgressContext.Provider value={value}>{children}</ScrollProgressContext.Provider>;
}

export function useScrollProgress(): ScrollProgressValue {
  const ctx = useContext(ScrollProgressContext);
  if (!ctx) throw new Error("useScrollProgress must be used within a ScrollProgressProvider");
  return ctx;
}
