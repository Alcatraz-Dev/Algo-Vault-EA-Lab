"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useShellHeaderHeight — measures the sticky shell page header and republishes its
 * height as the `--shell-header-h` CSS custom property on the shell root.
 *
 * Sticky sub-headers (market header, workspace rails) used to guess a fixed offset
 * (`top-14` = the old 56px topbar) and end up tucked behind the real header once it
 * changes size at another breakpoint. They can instead use
 * `top-[var(--shell-header-h,3.5rem)]`, which is correct in every shell.
 */
export function useShellHeaderHeight(ref: React.RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.height ?? 0;
      setHeight((current) => (Math.abs(current - next) < 0.5 ? current : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return height;
}

/** Inline style publishing the measured header height for sticky sub-headers. */
export function shellHeaderStyle(height: number): React.CSSProperties | undefined {
  if (!height) return undefined;
  return { "--shell-header-h": `${height}px` } as React.CSSProperties;
}
