import React from "react";
import { ArrowLeft, Settings } from "lucide-react";
import { StatusDot } from "./ui";

/** The real AlgoVault logo, same asset the website header uses. */
const LOGO_URL = chrome.runtime.getURL("logos/logo.png");

interface HeaderProps {
  isHealthy: boolean;
  gatewayConnected: boolean;
  userEmail?: string | null;
  onBack?: () => void;
  onSettings?: () => void;
}

export function Header({ isHealthy, gatewayConnected, userEmail, onBack, onSettings }: HeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-edge/70 bg-card px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {onBack && (
          <button
            onClick={onBack}
            className="rounded p-1 text-ink-mute transition-colors hover:bg-raised hover:text-ink"
            title="Back"
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <div className="flex items-center gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-md border border-edge/70 bg-raised/50">
            <img src={LOGO_URL} alt="AlgoVault" className="h-4 w-4 object-contain" />
          </span>
          <span className="text-sm font-semibold tracking-tight">AlgoVault</span>
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
