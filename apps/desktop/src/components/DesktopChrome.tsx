import React from "react";
import { Minus, Square, X } from "lucide-react";

/**
 * DesktopChrome — custom title bar for the Electron desktop surface.
 * Matches the ReUI homepage design: graphite (#0b0c0e) + Vault gold (#de661c).
 */
export default function DesktopChrome() {
  return (
    <div
      className="flex h-10 w-full items-center justify-between select-none bg-[#0b0c0e] px-3 text-xs text-[#9a9fa6] border-b border-[#2b2e32]"
      data-slot="desktop-chrome"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 font-medium tracking-tight text-[#f4f5f6]">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-[#de661c] text-[0.55rem] font-extrabold text-[#1d1406]">
          AV
        </span>
        <span>AlgoVault</span>
        <span className="text-[0.55rem] text-[#9a9fa6]">v1.0.0</span>
      </div>
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={() => (window as any).window?.minimize()}  
          className="flex h-6 w-6 items-center justify-center rounded-md text-[#9a9fa6] hover:bg-[#2b2e32] hover:text-[#de661c] transition-colors"
          aria-label="Minimize"
          title="Minimize"
        >
          <Minus size={12} />
        </button>
        <button
          onClick={() => (window as any).window?.maximize()}  
          className="flex h-6 w-6 items-center justify-center rounded-md text-[#9a9fa6] hover:bg-[#2b2e32] hover:text-[#de661c] transition-colors"
          aria-label="Maximize"
          title="Maximize"
        >
          <Square size={10} />
        </button>
        <button
          onClick={() => (window as any).window?.close()}  
          className="flex h-6 w-6 items-center justify-center rounded-md text-[#9a9fa6] hover:bg-[#ff645f] hover:text-[#f4f5f6] transition-colors"
          aria-label="Close"
          title="Close"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
