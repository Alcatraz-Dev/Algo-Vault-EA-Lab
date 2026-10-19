import { PanelRightOpen, RefreshCw, SlidersHorizontal, Sparkles, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface HeaderProps {
  isHealthy: boolean;
  gatewayConnected: boolean;
  userEmail: string | null;
  isPro: boolean;
  activeSymbol: string | null;
  activeTimeframe: string | null;
  onBack?: () => void;
  onSettings?: () => void;
  onOpenSidePanel?: () => void;
  onRefresh?: () => void;
  onOverride?: () => void;
}

function StatusPill({ ok, label, title }: { ok: boolean; label: string; title: string }) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-positive" : "bg-muted-foreground/40")}
      />
      {label}
    </span>
  );
}

export function Header({
  isHealthy,
  gatewayConnected,
  userEmail,
  isPro,
  activeSymbol,
  activeTimeframe,
  onBack,
  onSettings,
  onOpenSidePanel,
  onRefresh,
  onOverride,
}: HeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-secondary/60">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 7h7v7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-[13px] font-semibold tracking-tight">AlgoVault</span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wide",
            isPro
              ? "border-brand/40 bg-brand/10 text-brand-foreground"
              : "border-border bg-secondary/60 text-muted-foreground"
          )}
        >
          {isPro && <Sparkles className="h-2.5 w-2.5" />}
          {isPro ? "PRO" : "FREE"}
        </span>
        <span
          className="inline-flex min-w-0 items-center rounded-full border border-border bg-secondary/40 px-1.5 py-0.5 font-numeric text-[10px] text-muted-foreground"
          title="Live chart context"
        >
          <span className="truncate">
            {activeSymbol ? `${activeSymbol} · ${activeTimeframe}` : "no chart"}
          </span>
        </span>
        {userEmail ? (
          <span className="truncate text-[10px] text-muted-foreground">{userEmail}</span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="flex items-center gap-1">
          <StatusPill ok={isHealthy} label="API" title="AlgoVault API health" />
          <StatusPill ok={gatewayConnected} label="GW" title="Gateway connection" />
        </span>

        {onRefresh && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh} aria-label="Refresh chart context">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh chart context</TooltipContent>
          </Tooltip>
        )}

        {onOverride && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onOverride} aria-label="Override symbol and timeframe">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Override symbol / timeframe</TooltipContent>
          </Tooltip>
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onSettings} aria-label="Settings">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  );
}