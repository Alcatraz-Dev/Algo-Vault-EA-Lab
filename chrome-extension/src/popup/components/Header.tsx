import React from "react";
import { ArrowLeft, Zap, Settings } from "lucide-react";
import { StatusDot } from "./ui";

interface HeaderProps {
  isHealthy: boolean;
  gatewayConnected: boolean;
  userEmail?: string | null;
  onBack?: () => void;
  onSettings?: () => void;
}

export function Header({ isHealthy, gatewayConnected, userEmail, onBack, onSettings }: HeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-edge bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            className="rounded p-1 text-ink-mute transition-colors hover:bg-raised hover:text-ink"
            title="Back"
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-500/15">
            <Zap size={12} className="text-brand-500" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-ink">AlgoVault</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {userEmail && (
          <span className="max-w-[70px] truncate text-[10px] text-ink-mute" title={userEmail}>
            {userEmail.split("@")[0]}
          </span>
        )}
        <div className="flex items-center gap-1 rounded-md border border-edge bg-base px-1.5 py-0.5" title="AlgoVault API">
          <StatusDot state={isHealthy ? "ok" : "off"} />
          <span className="text-[9px] font-medium text-ink-mute">API</span>
        </div>
        <div
          className="flex items-center gap-1 rounded-md border border-edge bg-base px-1.5 py-0.5"
          title={gatewayConnected ? "Trading gateway connected" : "Gateway disconnected"}
        >
          <StatusDot state={gatewayConnected ? "ok" : "off"} />
          <span className="text-[9px] font-medium text-ink-mute">GW</span>
        </div>
        {onSettings && (
          <button
            onClick={onSettings}
            className="rounded p-1 text-ink-mute transition-colors hover:bg-raised hover:text-ink"
            title="Settings"
          >
            <Settings size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
