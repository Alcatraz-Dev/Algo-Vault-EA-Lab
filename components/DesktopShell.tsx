"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import DesktopLayout from "./DesktopLayout";
import { DesktopShellProvider } from "./desktop/DesktopShellProvider";

const subscribeToDesktopFlag = () => () => {};
const getDesktopFlag = () => window.__ALGOVAULT_DESKTOP__ === true;
const getServerDesktopFlag = () => false;

/**
 * DesktopShell — Client component that renders the desktop shell when running in Electron.
 * Keeps the ordinary website content visible outside Electron.
 */
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