"use client";

/**
 * DesktopTitleBarInset — inserts top padding on macOS to push content
 * below the hidden-inset traffic-light controls.
 *
 * With `titleBarStyle: 'hiddenInset'`, the traffic lights float over the
 * window. This component renders a 44px inset area styled as an invisible
 * draggable region so content beneath is unobstructed.
 */
import { useIsDesktop } from "@/hooks/use-desktop";

export function DesktopTitleBarInset() {
  const isDesktop = useIsDesktop();

  if (!isDesktop) return null;

  return (
    <div
      aria-hidden="true"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className="h-10 w-full shrink-0 select-none"
    />
  );
}
