import type { AlgoVaultDesktopBridge } from "@/hooks/use-desktop";

declare global {
  interface Window {
    readonly __ALGOVAULT_DESKTOP__?: true;
    readonly algovault?: AlgoVaultDesktopBridge;
  }
}

export {};
