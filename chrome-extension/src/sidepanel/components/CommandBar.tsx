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
} from "lucide-react";
import type { CommandId, CommandSpec } from "@/types/pro";

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
    id: "open_algovault",
    label: "Open AlgoVault Command Center",
    description: "Launch the full Pro Command Center on the web platform",
    icon: "ExternalLink",
    keywords: ["command center", "dashboard", "pro", "web"],
  },
];

const ICON_MAP: Record<string, React.ReactNode> = {
  Sparkles: <Sparkles size={14} className="text-brand-400" />,
  SearchX: <SearchX size={14} className="text-amber-400" />,
  ClipboardList: <ClipboardList size={14} className="text-emerald-400" />,
  History: <History size={14} className="text-sky-400" />,
  HeartPulse: <HeartPulse size={14} className="text-rose-400" />,
  ScanEye: <ScanEye size={14} className="text-violet-400" />,
  Layers: <Layers size={14} className="text-indigo-400" />,
  Bell: <Bell size={14} className="text-yellow-400" />,
  Wand2: <Wand2 size={14} className="text-purple-400" />,
  Cpu: <Cpu size={14} className="text-teal-400" />,
  FlaskConical: <FlaskConical size={14} className="text-pink-400" />,
  ExternalLink: <ExternalLink size={14} className="text-ink-mute" />,
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div
        className="w-full max-w-sm rounded-xl border border-edge bg-card shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* search input */}
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2.5 bg-raised/50">
          <Search size={14} className="text-brand-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Command ${symbol ? `(${symbol} · ${timeframe})` : ""}…`}
            className="flex-1 bg-transparent text-[11px] text-ink placeholder:text-ink-faint outline-none"
          />
          <kbd className="rounded border border-edge bg-white/5 px-1.5 py-0.5 text-[8px] font-mono text-ink-faint">
            ESC
          </kbd>
        </div>

        {/* context indicator */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-black/20 border-b border-edge/30 text-[9px] text-ink-faint">
          <span>Active Chart: <span className="font-mono text-brand-300 font-medium">{symbol || "N/A"} · {timeframe}</span></span>
          <span>{filtered.length} action{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        {/* command list */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-[10px] text-ink-faint">
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={cmd.id}
                  onClick={() => {
                    onExecute(cmd.id);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    active
                      ? "bg-brand-500/15 text-ink border border-brand-500/30"
                      : "text-ink-mute hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <span className="shrink-0">{ICON_MAP[cmd.icon] ?? <Command size={14} />}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-medium leading-tight ${active ? "text-brand-300" : "text-ink"}`}>
                      {cmd.label}
                    </p>
                    <p className="truncate text-[9px] text-ink-faint leading-normal">
                      {cmd.description}
                    </p>
                  </div>
                  {active && (
                    <ChevronRight size={12} className="text-brand-400 shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* footer hint */}
        <div className="flex items-center justify-between border-t border-edge/40 px-3 py-1.5 bg-raised/30 text-[8px] text-ink-faint">
          <span>↑↓ to navigate</span>
          <span>↵ to execute</span>
          <span>⌘K to toggle</span>
        </div>
      </div>
    </div>
  );
}
