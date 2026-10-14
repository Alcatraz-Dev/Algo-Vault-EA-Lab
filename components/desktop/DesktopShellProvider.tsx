"use client";

/**
 * DesktopShellProvider — mount this once at the app root.
 *
 * On the website: renders nothing (no cost, no side effects).
 * Inside the Electron desktop: activates all desktop-specific behaviors:
 *   • Wires native menu navigation to the Next.js router
 *   • Shows offline connection banner
 *   • Mounts the document-level tooltip layer for the icons-only rail
 *   • Injects global CSS attribute `data-desktop="true"` on <html> so CSS
 *     rules can suppress website-only chrome (navbar, footer, etc.)
 */
import { useEffect } from "react";
import { DesktopMenuRouter } from "./DesktopMenuRouter";
import { DesktopConnectionBanner } from "./DesktopConnectionBanner";
import { DesktopTooltipLayer } from "./DesktopTooltipLayer";
import { useIsDesktop } from "@/hooks/use-desktop";

export function DesktopShellProvider() {
  const isDesktop = useIsDesktop();

  useEffect(() => {
    if (!isDesktop) return;
    // Stamp the document so CSS can hide/adapt website chrome
    document.documentElement.setAttribute("data-desktop", "true");
    return () => {
      document.documentElement.removeAttribute("data-desktop");
    };
  }, [isDesktop]);

  if (!isDesktop) return null;

  return (
    <>
      <DesktopMenuRouter />
      <DesktopConnectionBanner />
      <DesktopTooltipLayer />
    </>
  );
}
