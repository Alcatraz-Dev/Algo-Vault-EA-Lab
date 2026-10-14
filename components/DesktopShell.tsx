"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import DesktopLayout from "./DesktopLayout";
import { DesktopShellProvider } from "./desktop/DesktopShellProvider";

/**
 * DesktopShell — Client component that renders the desktop shell when running in Electron.
 * Keeps the ordinary website content visible outside Electron.
 */
function subscribeToDesktopFlag(onStoreChange: () => void) {
  window.addEventListener("algovault:desktop-ready", onStoreChange);
  // The preload bridge exists before the renderer hydrates. Recheck the flag
  // after subscribing so the server snapshot can safely remain false for web.
  queueMicrotask(onStoreChange);
  return () => window.removeEventListener("algovault:desktop-ready", onStoreChange);
}

function getDesktopFlag() {
  return window.__ALGOVAULT_DESKTOP__ === true;
}

function getServerDesktopFlag() {
  return false;
}

export function DesktopShell({ children }: { children: ReactNode }) {
  const isDesktop = useSyncExternalStore(
    subscribeToDesktopFlag,
    getDesktopFlag,
    getServerDesktopFlag,
  );

  if (!isDesktop) return <>{children}</>;

  return (
    <DesktopLayout>
      {children}
      <DesktopShellProvider />
    </DesktopLayout>
  );
}