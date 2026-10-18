import { PanelRightOpen, Settings, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface HeaderProps {
  isHealthy: boolean;
  gatewayConnected: boolean;
  userEmail: string | null;
  onBack?: () => void;
  onSettings?: () => void;
  onOpenSidePanel?: () => void;
}

export function Header({
  isHealthy,
  gatewayConnected,
  userEmail,
  onBack,
  onSettings,
  onOpenSidePanel,
}: HeaderProps) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background px-3">
      <div className="flex min-w-0 items-center gap-2">
        {onBack ? (
          <Button variant="ghost" size="icon" className="h-7 w-7 -ml-1.5" onClick={onBack} aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="h-3.5 w-3.5">
              <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 7h7v7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
        <div className="flex min-w-0 flex-col leading-none">
          <span className="truncate text-xs font-semibold tracking-tight text-foreground">
            AlgoVault
          </span>
          {userEmail && (
            <span className="mt-0.5 truncate text-[10px] text-muted-foreground">{userEmail}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span
          className={`flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 ${
            isHealthy ? "text-muted-foreground" : "text-warning"
          }`}
          title={isHealthy ? "Backend connected" : "Backend unreachable"}
        >
          {isHealthy ? (
            <span className="h-1.5 w-1.5 rounded-full bg-positive" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          <span className="text-[10px]">{isHealthy ? "Online" : "Offline"}</span>
        </span>

        {gatewayConnected && (
          <span className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-positive" />
            <span className="text-[10px]">Gateway</span>
          </span>
        )}

        {onOpenSidePanel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onOpenSidePanel} aria-label="Open side panel">
                <PanelRightOpen className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open full workspace</TooltipContent>
          </Tooltip>
        )}

        {onSettings && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSettings} aria-label="Settings">
            <Settings className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </header>
  );
}
