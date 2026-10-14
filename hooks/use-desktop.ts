/**
 * useIsDesktop — detects if the app is running inside the AlgoVault
 * Electron desktop shell.
 *
 * The preload script exposes `window.__ALGOVAULT_DESKTOP__ = true` via
 * contextBridge. This hook reads that flag client-side only. Never assume
 * desktop on the server or during SSR — always returns false until mounted.
 */
import { useEffect, useState } from "react";

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any)["__ALGOVAULT_DESKTOP__"] === true) {
      setIsDesktop(true);
    }
  }, []);

  return isDesktop;
}

/**
 * Synchronous check — only call after mount, never during SSR.
 */
export function isDesktopApp(): boolean {
  if (typeof window === "undefined") return false;
  return (window as any)["__ALGOVAULT_DESKTOP__"] === true;
}

/**
 * Access the full AlgoVault desktop bridge (typed, safe).
 * Returns null when running in the browser / SSR.
 */
export interface AlgoVaultDesktopBridge {
  isDesktop: true;
  platform: string;
  version: string;
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    isFullScreen: () => Promise<boolean>;
  };
  app: {
    getVersion: () => Promise<string>;
    restart: () => Promise<void>;
    quit: () => Promise<void>;
    openExternal: (url: string) => Promise<boolean>;
  };
  dialog: {
    showSaveDialog: (options?: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => Promise<{ canceled: boolean; filePath?: string }>;
    showOpenDialog: (options?: {
      title?: string;
      properties?: ("openFile" | "openDirectory" | "multiSelections")[];
      filters?: { name: string; extensions: string[] }[];
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
    confirm: (options: {
      title?: string;
      message: string;
      detail?: string;
      type?: "warning" | "info" | "question";
    }) => Promise<boolean>;
    alert: (options: {
      title?: string;
      message: string;
      detail?: string;
    }) => Promise<void>;
  };
  clipboard: {
    writeText: (text: string) => Promise<void>;
    readText: () => Promise<string>;
  };
  notification: {
    show: (options: { title: string; body: string }) => Promise<boolean>;
  };
  connection: {
    getStatus: () => Promise<{ online: boolean }>;
    onStatusChange: (
      callback: (status: { online: boolean }) => void
    ) => () => void;
  };
  updater: {
    check: () => Promise<void>;
    onUpdate: (callback: () => void) => () => void;
  };
  navigation: {
    onNavigate: (callback: (route: string) => void) => () => void;
    onMenuAction: (action: string, callback: () => void) => () => void;
  };
}

export function getDesktopBridge(): AlgoVaultDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  if (w["__ALGOVAULT_DESKTOP__"] !== true) return null;
  return (w["algovault"] as AlgoVaultDesktopBridge) ?? null;
}
