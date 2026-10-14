import React from "react";
export default function DesktopChrome() {
    return (<div className="flex h-10 w-full items-center select-none bg-gradient-to-b from-[#0b0c0e] to-[#121316] pl-28 pr-4 text-sm text-[#a1a1aa] border-b border-[#27272a] backdrop-blur-sm" data-slot="desktop-chrome" style={{ WebkitAppRegion: "drag" }}>
      <div className="flex items-center gap-3 font-medium tracking-tight text-white">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-gradient-to-r from-[#f97316] to-[#ea580c] text-[0.6rem] font-extrabold text-white">
          AV
        </span>
        <div className="flex flex-col items-start">
          <span className="text-[0.875rem] font-semibold tracking-tight">AlgoVault</span>
          <span className="text-[0.625rem] tracking-tighter text-[#9ca3af]">v{process.env.NEXT_PUBLIC_VERSION || '0.1.0'}</span>
        </div>
      </div>
    </div>);
}
