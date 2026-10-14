"use client";

import { useEffect, useState } from "react";
import DesktopLayout from "./DesktopLayout";

/**
 * DesktopShell — Client component that renders the desktop shell when running in Electron.
 * Returns null when running in the browser or during SSR.
 */
export function DesktopShell({ children }: { children: React.ReactNode }) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      (window as any).__ALGOVAULT_DESKTOP__ === true
    ) {
      setIsDesktop(true);
    }
  }, []);

  if (!isDesktop) return null;

  return <DesktopLayout>{children}</DesktopLayout>;
}