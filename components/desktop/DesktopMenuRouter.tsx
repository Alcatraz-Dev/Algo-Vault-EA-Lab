"use client";

/**
 * DesktopMenuRouter — wires native macOS application menu navigation
 * into the Next.js router.
 *
 * The main process sends `navigation:go` IPC events when the user clicks
 * a menu item (e.g. Navigate → Dashboard). This component listens via the
 * preload bridge and pushes the route. Mount it once at the app root.
 *
 * Also wires `menu:export` for file export triggers, etc.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getDesktopBridge } from "@/hooks/use-desktop";

export function DesktopMenuRouter() {
  const router = useRouter();

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;

    // Native menu Navigate → <route>
    const cleanupNav = bridge.navigation.onNavigate((route) => {
      if (route && typeof route === "string" && route.startsWith("/")) {
        router.push(route);
      }
    });

    // Native menu File → Export
    const cleanupExport = bridge.navigation.onMenuAction("export", () => {
      // Dispatch a custom DOM event that export-aware pages can catch
      window.dispatchEvent(new CustomEvent("algovault:export"));
    });

    return () => {
      cleanupNav();
      cleanupExport();
    };
  }, [router]);

  return null;
}
