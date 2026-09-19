import React from "react";
import { Zap, ArrowLeft, Wifi as WifiIcon } from "lucide-react";

interface HeaderProps {
  isHealthy: boolean;
  gatewayConnected: boolean;
  userEmail?: string | null;
  onBack?: () => void;
}

export function Header({ isHealthy, gatewayConnected, userEmail, onBack }: HeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-[#0d0d14]">
      <div className="flex items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            className="p-1 rounded hover:bg-white/5 text-[#8888aa] hover:text-[#f0f0f5] transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <Zap size={16} className="text-violet-400" />
          <span className="text-sm font-semibold tracking-tight text-[#f0f0f5]">
            AlgoVault
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              isHealthy ? "bg-emerald-400" : "bg-rose-400"
            }`}
          />
          <span className="text-[10px] text-[#8888aa]">API</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              gatewayConnected ? "bg-emerald-400" : "bg-neutral-500"
            }`}
          />
          <span className="text-[10px] text-[#8888aa]">GW</span>
        </div>
        <div className="flex items-center gap-1">
          <WifiIcon size={10} className={userEmail ? "text-emerald-400" : "text-[#8888aa]"} />
          <span className="text-[10px] text-[#8888aa] truncate max-w-[60px]">
            {userEmail || "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
