/**
 * AI Command Bar (⌘K Launcher)
 *
 * Professional fuzzy command palette for the AlgoVault Pro Terminal.
 * Context-aware: automatically knows current TradingView symbol and timeframe.
 * Triggers analysis, checklists, replay, strategy generation, backtests, and research.
 */
import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  Sparkles,
  SearchX,
  ClipboardList,
  History,
  HeartPulse,
  ScanEye,
  Layers,
  Bell,
  Wand2,
  Cpu,
  FlaskConical,
  ExternalLink,
  ChevronRight,
  Command,
  Activity,
  MessageSquareText,
  Globe2,
  PencilLine,
  XCircle,
} from "lucide-react";
import type { CommandId, CommandSpec } from "@/types/pro";
import { cn } from "@/lib/utils";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  timeframe: string;
  onExecute: (commandId: CommandId) => void;
}

export const COMMANDS: CommandSpec[] = [
  {
    id: "analyze_chart",
    label: "Analyze Current Chart",
    description: "Full AI reading of market structure, momentum, and key levels",
    icon: "Sparkles",
    keywords: ["analyze", "copilot", "chat", "structure", "read"],
  },
  {
    id: "what_am_i_missing",
    label: "What Am I Missing?",
    description: "Scan for blind spots, HTF conflicts, and unresolved conditions",
    icon: "SearchX",
    keywords: ["missing", "blindspot", "conflict", "risk", "hidden"],
  },
  {
    id: "run_checklist",
    label: "Run Pre-Trade Checklist",
    description: "Deterministic evidence check before entering a trade",
    icon: "ClipboardList",
    keywords: ["checklist", "evidence", "rules", "pretrade", "validate"],
  },
  {
    id: "show_similar_setups",
    label: "Replay Similar Historical Setups",
    description: "Find historical occurrences matching this setup structure",
    icon: "History",
    keywords: ["replay", "historical", "similar", "analogue", "past"],
  },
  {
    id: "show_strategy_health",
    label: "Check Strategy Health",
    description: "Evaluate strategy compatibility with current market regime",
    icon: "HeartPulse",
    keywords: ["health", "regime", "compatibility", "volatility"],
  },
  {
    id: "show_market_radar",
    label: "Pro Multi-Symbol Market Radar",
    description: "Monitor watchlists and active setup forming states",
    icon: "ScanEye",
    keywords: ["radar", "watchlist", "scanner", "multi-symbol", "pairs"],
  },
  {
    id: "show_mtf",
    label: "Multi-Timeframe Matrix",
    description: "Inspect macro to entry structure alignment across 6 timeframes",
    icon: "Layers",
    keywords: ["mtf", "timeframe", "matrix", "macro", "alignment"],
  },
  {
    id: "show_smart_alerts",
    label: "Smart Market Alerts",
    description: "View deterministic alerts for liquidity sweeps & structure breaks",
    icon: "Bell",
    keywords: ["alerts", "notifications", "signals", "sweeps"],
  },
  {
    id: "create_indicator",
    label: "AI Pine Indicator Studio",
    description: "Generate and validate custom Pine Script indicators",
    icon: "Wand2",
    keywords: ["indicator", "pine", "studio", "script", "generate"],
  },
  {
    id: "create_strategy",
    label: "AI Strategy Builder",
    description: "Construct Pine Script strategies with entry/exit/risk rules",
    icon: "Cpu",
    keywords: ["strategy", "builder", "pine", "rules", "algo"],
  },
  {
    id: "research_setup",
    label: "Research This Setup in AlgoVault",
    description: "Send current setup into the AlgoVault Strategy Research Engine",
    icon: "FlaskConical",
    keywords: ["research", "monte carlo", "oos", "walk forward", "engine"],
  },
  {
    id: "show_open_positions",
    label: "Show My Open Positions",
    description: "Live positions reported by the connected execution gateway",
    icon: "Activity",
    keywords: ["positions", "open", "holdings", "pnl", "trade"],
  },
  {
    id: "explain_position",
    label: "Explain This Position",
    description: "AI walkthrough of the open position on the active symbol",
    icon: "MessageSquareText",
    keywords: ["explain", "position", "why", "hold", "trade"],
  },
  {
    id: "show_market_context",
    label: "Show Current Market Context",
    description: "Structure, liquidity, momentum and HTF context right now",
    icon: "Globe2",
    keywords: ["context", "market", "structure", "htf", "bias"],
  },
  {
    id: "prepare_modification",
    label: "Prepare a Position Modification",
    description: "Prepare a stop/target change — execution stays behind your confirmation",
    icon: "PencilLine",
    keywords: ["modify", "stop", "target", "change", "position"],
  },
  {
    id: "prepare_close",
    label: "Prepare a Position Close",
    description: "Prepare a close request — nothing is closed until you confirm",
    icon: "XCircle",
    keywords: ["close", "exit", "flatten", "position"],
  },
  {
    id: "open_algovault",
    label: "Open AlgoVault Command Center",
    description: "Launch the full Pro Command Center on the web platform",
    icon: "ExternalLink",
    keywords: ["command center", "dashboard", "pro", "web"],
  },
];

const ICON_MAP: Record<string, React.ReactNode> = {
  Sparkles: <Sparkles size={14} className="text-muted-foreground" />,
  SearchX: <SearchX size={14} className="text-muted-foreground" />,
  ClipboardList: <ClipboardList size={14} className="text-muted-foreground" />,
  History: <History size={14} className="text-muted-foreground" />,
  HeartPulse: <HeartPulse size={14} className="text-muted-foreground" />,
  ScanEye: <ScanEye size={14} className="text-muted-foreground" />,
  Layers: <Layers size={14} className="text-muted-foreground" />,
  Bell: <Bell size={14} className="text-muted-foreground" />,
  Wand2: <Wand2 size={14} className="text-muted-foreground" />,
  Cpu: <Cpu size={14} className="text-muted-foreground" />,
  FlaskConical: <FlaskConical size={14} className="text-muted-foreground" />,
  ExternalLink: <ExternalLink size={14} className="text-muted-foreground" />,
  Activity: <Activity size={14} className="text-muted-foreground" />,
  MessageSquareText: <MessageSquareText size={14} className="text-muted-foreground" />,
  Globe2: <Globe2 size={14} className="text-muted-foreground" />,
  PencilLine: <PencilLine size={14} className="text-muted-foreground" />,
  XCircle: <XCircle size={14} className="text-muted-foreground" />,
};

/**
 * Presentation-only grouping used for section headings. Results keep the
 * original flat order, so keyboard navigation and onExecute are unchanged.
 */
const SECTION_OF: Partial<Record<CommandId, string>> = {
  analyze_chart: "Analyze",
  what_am_i_missing: "Analyze",
  run_checklist: "Analyze",
  show_similar_setups: "Analyze",
  show_strategy_health: "Analyze",
  show_market_radar: "Markets",
  show_mtf: "Markets",
  show_smart_alerts: "Markets",
  create_indicator: "Build",
  create_strategy: "Build",
  show_open_positions: "Trade",
  explain_position: "Trade",
  show_market_context: "Trade",
  prepare_modification: "Trade",
  prepare_close: "Trade",
  open_algovault: "Navigate",
};

export function CommandBar({ isOpen, onClose, symbol, timeframe, onExecute }: Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((cmd) => {
      return (
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.keywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        onExecute(filtered[selectedIndex].id);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-3 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* search input */}
        <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Command ${symbol ? `(${symbol} · ${timeframe})` : ""}…`}
            className="flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1 py-0.5 font-numeric text-[10px] text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* context indicator */}
        <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <span>
            Active Chart:{" "}
            <span className="font-numeric font-medium text-foreground">
              {symbol || "N/A"} · {timeframe}
            </span>
          </span>
          <span className="font-numeric">
            {filtered.length} action{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* command list */}
        <div className="flex-1 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-[11px] text-muted-foreground">
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const active = idx === selectedIndex;
              const section = SECTION_OF[cmd.id];
              const prevSection = idx > 0 ? SECTION_OF[filtered[idx - 1].id] : null;
              return (
                <React.Fragment key={cmd.id}>
                  {section && section !== prevSection && (
                    <p className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {section}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onExecute(cmd.id);
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
                      active
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60"
                    )}
                  >
                    <span className="shrink-0">
                      {ICON_MAP[cmd.icon] ?? <Command size={14} className="text-muted-foreground" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium leading-tight text-foreground">
                        {cmd.label}
                      </p>
                      <p className="truncate text-[10px] leading-normal text-muted-foreground">
                        {cmd.description}
                      </p>
                    </div>
                    {active && (
                      <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* footer hint */}
        <div className="flex items-center justify-between border-t border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <kbd className="rounded border border-border px-1 font-numeric text-[10px] text-muted-foreground">
            ↑↓ to navigate
          </kbd>
          <kbd className="rounded border border-border px-1 font-numeric text-[10px] text-muted-foreground">
            ↵ to execute
          </kbd>
          <kbd className="rounded border border-border px-1 font-numeric text-[10px] text-muted-foreground">
            ⌘K to toggle
          </kbd>
        </div>
      </div>
    </div>
  );
}
