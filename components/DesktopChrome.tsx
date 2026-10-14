import React from "react";

/**
 * Empty draggable title-bar strip — sits inside the Next.js page so the
 * macOS `titleBarOverlay` has a matching surface that catches
 * `WebkitAppRegion: drag` for moving the window.
 *
 * No chrome text or logo here — the macOS traffic lights sit in the leading
 * 80px reserved by `DesktopNav`, and the brand is already present in the
 * web app's top bar / sidebar / footer.
 *
 * Colours read from CSS variables (`bg-card`, `border-border`) so the strip
 * stays in lockstep with the rest of the theme.
 */
export default function DesktopChrome() {
  return (
    <div
      className="h-11 w-full shrink-0 select-none border-b border-border bg-card"
      data-slot="desktop-chrome"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      aria-hidden
    />
  );
}