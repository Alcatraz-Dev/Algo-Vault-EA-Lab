/**
 * Pro Terminal → Candel Integration Entry Point.
 *
 * Phase 3 — Candel entry point in the Pro Terminal.
 *
 * Adds a "Candel" button to the existing terminal toolbar (matching the
 * existing AlgoVault visual language). Clicking opens the Candel panel
 * (right-side rail, chart remains dominant). No separate full-screen
 * chatbot; no giant floating widget; no redundant AI engine.
 *
 * The entry point:
 *   ProScalpingTerminal.tsx  →  CandelToolbarButton  →  CandelPanel
 *
 * Candel receives the normalized TerminalCandelContext (lib/candel/
 * terminal-context.ts) and orchestrates the existing Market Intelligence
 * Engine, agent engine, and RTDB.
 */

import { useState } from "react";
import { Brain, BrainCircuit, BrainCog, X, Sparkles, BarChart3, Target, AlertTriangle, DollarSign, PlusCircle, FileText, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Candel toolbar button — the entry point.
 *
 * Pro Terminal UX (Phase 3 §4): professional trading-terminal tool,
 * not a giant floating chatbot. Button in the existing toolbar row.
 */
export function CandelToolbarButton({
  symbol,
  timeframe,
  openPanel,
  className,
}: {
  symbol: string;
  timeframe: string;
  openPanel: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "group flex items-center gap-2 rounded-md border border-border/60 bg-background/80 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/30",
        className
      )}
      onClick={openPanel}
      title={`Candel — AI market analysis for ${symbol} ${timeframe}`}
    >
      <Sparkles className="h-3.5 w-3.5 transition group-hover:text-primary" />
      <span>Candel</span>
      <span className="hidden sm:inline text-micro font-numeric text-muted-foreground">
        {symbol} {timeframe}
      </span>
      <kbd className="hidden sm:inline-flex h-4 w-4 select-none items-center justify-center rounded border border-border/50 bg-muted px-0.5 text-micro font-medium text-muted-foreground">
        C
      </kbd>
    </button>
  );
}

/**
 * Candel context header — shows authorized context (symbol/timeframe/account).
 *
 * Phase 3 §18: XAUUSD · M5 · Account: Demo · Market: Open/Closed
 * Only displays account if authorized. Never exposes secrets.
 */
export function CandelContextHeader({
  symbol,
  timeframe,
  accountLabel,
  marketStatus,
}: {
  symbol: string;
  timeframe: string;
  accountLabel: string | null;
  marketStatus: "open" | "closed" | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
      <span className="font-numeric text-sm font-semibold text-foreground">
        {symbol} {timeframe}
      </span>
      {accountLabel ? (
        <>
          <span className="text-micro text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">Account: {accountLabel}</span>
        </>
      ) : (
        <>
          <span className="text-micro text-muted-foreground">·</span>
          <span className="text-xs italic text-muted-foreground">Account: unavailable</span>
        </>
      )}      {marketStatus ? (
        <>
          <span className="text-micro text-muted-foreground">·</span>
          <span className={cn(
            "text-xs font-medium",
            marketStatus === "open" ? "text-positive" : "text-negative"
          )}>
            Market: {marketStatus}
          </span>
        </>
      ) : null}
    </div>
  );
}

/**
 * Candel quick actions — context-aware buttons that send structured
 * requests to the Candel backend (no hard-coded fake responses).
 *
 * Phase 3 §19: Analyze Market, Find Setup, Analyze Structure, Analyze Risk,
 * Explain Current Move, Review Position, Compare Strategy, Prepare Trade Proposal.
 */
export function CandelQuickActions({
  onAction,
  disabled,
}: {
  onAction: (action: string) => void;
  disabled?: boolean;
}) {
  const actions = [
    { key: "market", label: "Analyze Market", icon: BarChart3 },
    { key: "setup", label: "Find Setup", icon: BrainCog },
    { key: "structure", label: "Analyze Structure", icon: Brain },
    { key: "risk", label: "Analyze Risk", icon: AlertTriangle },
    { key: "move", label: "Explain Current Move", icon: Target },
    { key: "position", label: "Review Position", icon: DollarSign },
    { key: "compare", label: "Compare Strategy", icon: BrainCircuit },
    { key: "proposal", label: "Prepare Trade Proposal", icon: PlusCircle },
  ];

  return (
    <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-3 py-2">
      {actions.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-micro font-medium transition",
            disabled
              ? "cursor-not-allowed text-muted-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent",
            disabled && "opacity-50 cursor-wait"
          )}
          onClick={() => onAction(`quick: ${key}`)}
          disabled={disabled}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Candel panel — the educated UX (Phase 3 §17): right-side rail, chart
 * remains dominant, context header, market analysis, quick actions.
 *
 * Phase 3 §33 (mobile): the same panel becomes a drawer/full-screen sheet.
 * The CandelPanel itself is layout-agnostic; the shell decides overcapping.
 */
export function CandelPanel({
  symbol,
  timeframe,
  accountLabel,
  marketStatus,
  intelligence,
  analysisResponse,
  onAction,
  open,
  onClose,
}: {
  symbol: string;
  timeframe: string;
  accountLabel: string | null;
  marketStatus: "open" | "closed" | null;
  intelligence: Array<{ type: string; text: string }>;
  analysisResponse?: { summary: string; observations: Array<{ type: string; text: string }>; limitations: string[] } | null;
  onAction: (action: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      {/* Overlay — dismiss */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="relative flex flex-col max-w-2xl h-full bg-card border-l border-border/60 shadow-2xl">
        {/* Header — context */}
        <CandelContextHeader
          symbol={symbol}
          timeframe={timeframe}
          accountLabel={accountLabel}
          marketStatus={marketStatus}
        />

        {/* Body — intelligence (no stale cached data) */}
        <div className="flex-1 overflow-auto p-4">
          {/* Analysis summary */}
          {analysisResponse?.summary ? (
            <div className="rounded-lg border border-border/60 bg-background p-3">
              <p className="text-xs text-muted-foreground">Analysis</p>
              <p className="mt-1 text-sm text-foreground">{analysisResponse.summary}</p>
            </div>
          ) : null}

          {/* Observations: facts vs interpretations vs limitations (Phase 3 §11) */}
          {intelligence.length > 0 ? (
            <div className="mt-3 space-y-2">
              {intelligence.map((obs, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-md px-3 py-2 text-xs",
                    obs.type === "fact" && "bg-positive/10 text-positive",
                    obs.type === "interpretation" && "bg-info/10 text-info",
                    obs.type === "limitation" && "bg-warning/10 text-warning"
                  )}
                >
                  <span className="font-semibold uppercase tracking-wide">
                    {obs.type}
                  </span>
                  <span className="ml-2">{obs.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              No intelligence data available for this context.
            </p>
          )}

          {/* Limitations (never present as facts) */}
          {analysisResponse?.limitations?.length ? (
            <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
              <p className="text-micro uppercase tracking-wide text-warning">Limitations</p>
              <p className="mt-1 text-xs text-warning">{analysisResponse.limitations.join("; ")}</p>
            </div>
          ) : null}

          {/* Quick actions */}
          <CandelQuickActions onAction={onAction} />
        </div>

        {/* Footer — close */}
        <div className="flex justify-end px-3 py-2">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-micro font-medium text-muted-foreground transition hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Candel panel controller — manages panel open state and quick-action
 * routing to the Candel backend (lib/candel/dot/adapter.ts).
 *
 * This is the wiring: ProScalpingTerminal → CandelToolbarButton →
 * CandelPanelController → Candel backend (via runMarketAnalysis etc).
 */
export function CandelPanelController({
  symbol,
  timeframe,
  accountLabel,
  marketStatus,
  onAction,
}: {
  symbol: string;
  timeframe: string;
  accountLabel: string | null;
  marketStatus: "open" | "closed" | null;
  onAction: (action: string, payload?: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [intelligence, setIntelligence] = useState<Array<{ type: string; text: string }>>([]);
  const [analysisResponse, setAnalysisResponse] = useState<{
    summary: string;
    observations: Array<{ type: string; text: string }>;
    limitations: string[];
  } | null>(null);

  const handleAction = async (action: string) => {
    setOpen(true);
    // Route to the Candel backend. In Phase 3 the backend is a server
    // route or SDK function (runMarketAnalysis etc). This is the thin
    // client-side action router — the actual execution is server-side.
    onAction(action, { symbol, timeframe });
  };

  const handleClose = () => {
    setOpen(false);
    setIntelligence([]);
    setAnalysisResponse(null);
  };

  return (
    <>
      <CandelToolbarButton
        symbol={symbol}
        timeframe={timeframe}
        openPanel={() => setOpen(true)}
      />
      <CandelPanel
        symbol={symbol}
        timeframe={timeframe}
        accountLabel={accountLabel}
        marketStatus={marketStatus}
        intelligence={intelligence}
        analysisResponse={analysisResponse}
        onAction={handleAction}
        open={open}
        onClose={handleClose}
      />
    </>
  );
}
