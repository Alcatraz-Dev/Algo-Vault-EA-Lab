import React from "react";
import { Minus, Square, X } from "lucide-react";
/**
 * DesktopChrome — custom title bar for the Electron desktop surface.
 * Matches the ReUI homepage design: graphite (#0b0c0e) + Vault gold (#de661c).
 */
export default function DesktopChrome() {
    return (<div className="flex h-10 w-full items-center justify-between select-none bg-gradient-to-b from-[#0b0c0e] to-[#121316] px-4 text-sm text-[#a1a1aa] border-b border-[#27272a] backdrop-blur-sm" data-slot="desktop-chrome" style={{ WebkitAppRegion: "drag" }}>
      <div className="flex items-center gap-3 font-medium tracking-tight text-white">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-gradient-to-r from-[#f97316] to-[#ea580c] text-[0.6rem] font-bold text-white">
          AV
        </span>
        <div className="flex flex-col items-start">
          <span className="text-[0.875rem] font-semibold tracking-tight">AlgoVault</span>
          <span className="text-[0.625rem] tracking-tighter text-[#9ca3af]">v{process.env.NEXT_PUBLIC_VERSION || '0.1.0'}</span>
        </div>
      </div>
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" }}>
        <button onClick={() => (window.desktop?.minimize?.() ?? window.windowControls?.minimize?.() ?? window.electron?.window?.minimize?.())} className="relative flex h-7 w-7 items-center justify-center rounded-md bg-[#1f2937/50] text-[0.875rem] font-medium text-[#a1a1aa] hover:bg-[#1f2937/75] hover:text-white transition-all duration-200" aria-label="Minimize" title="Minimize">
          <Minus size={14} className="absolute -left-[2px] -top-[2px] w-10 h-10"/>
        </button>
        <button onClick={() => (window.desktop?.maximize?.() ?? window.windowControls?.maximize?.() ?? window.electron?.window?.maximize?.())} className="relative flex h-7 w-7 items-center justify-center rounded-md bg-[#1f2937/50] text-[0.875rem] font-medium text-[#a1a1aa] hover:bg-[#1f2937/75] hover:text-white transition-all duration-200" aria-label="Maximize" title="Maximize">
          <Square size={12} className="absolute -left-[2px] -top-[2px] w-10 h-10"/>
        </button>
        <button onClick={() => (window.desktop?.close?.() ?? window.windowControls?.close?.() ?? window.electron?.window?.close?.())} className="relative flex h-7 w-7 items-center justify-center rounded-md bg-[#1f2937/50] text-[0.875rem] font-medium text-[#a1a1aa] hover:bg-[#ef4444] hover:text-white transition-all duration-200" aria-label="Close" title="Close">
          <X size={14} className="absolute -left-[2px] -top-[2px] w-10 h-10"/>
        </button>
      </div>
    </div>);
}
