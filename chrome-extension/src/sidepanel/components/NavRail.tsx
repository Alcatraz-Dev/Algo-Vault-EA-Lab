import {
  Bell,
  ClipboardList,
  Code,
  Cpu,
  FlaskConical,
  HeartPulse,
  History,
  Layers,
  MessageSquareText,
  Radar,
  ScanEye,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  Wallet,
} from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type NavTabId =
  | "copilot"
  | "execution"
  | "radar"
  | "smartAlerts"
  | "mtf"
  | "indicators"
  | "strategies"
  | "checklist"
  | "missing"
  | "replay"
  | "health"
  | "marketRadar"
  | "research"
  | "alerts"
  | "setup";

interface NavItem {
  id: NavTabId;
  label: string;
  hint: string;
  icon: typeof MessageSquareText;
  pro?: boolean;
}

/**
 * Grouped destinations. Groups render as visually separated clusters so a
 * 15-destination surface stays scannable in a 44px-wide rail, without the
 * ambiguity of a flat icon strip.
 */
const GROUPS: Array<{ name: string; items: NavItem[] }> = [
  {
    name: "Work",
    items: [
      { id: "copilot", label: "Copilot", hint: "Chat with the chart copilot", icon: MessageSquareText },
      { id: "research", label: "Research", hint: "Cached AI research notes", icon: FlaskConical },
    ],
  },
  {
    name: "Intelligence",
    items: [
      { id: "radar", label: "Setup Radar", hint: "Live setup detection", icon: Radar, pro: true },
      { id: "smartAlerts", label: "Smart Alerts", hint: "Deterministic signal engine", icon: Bell, pro: true },
      { id: "mtf", label: "MTF Matrix", hint: "Multi-timeframe alignment", icon: Layers, pro: true },
      { id: "marketRadar", label: "Market Scan", hint: "Cross-market opportunity scan", icon: ScanEye, pro: true },
      { id: "health", label: "Strategy Health", hint: "Strategy drift & performance", icon: HeartPulse, pro: true },
      { id: "replay", label: "Replay", hint: "Similar historical setups", icon: History, pro: true },
      { id: "checklist", label: "Checklist", hint: "Pre-trade checklist", icon: ClipboardList, pro: true },
      { id: "missing", label: "Gaps", hint: "What am I missing?", icon: SearchX, pro: true },
    ],
  },
  {
    name: "Build",
    items: [
      { id: "indicators", label: "Pine Generator", hint: "AI Pine Script indicator", icon: Code, pro: true },
      { id: "strategies", label: "Strategy Studio", hint: "AI strategy builder & backtest", icon: Cpu, pro: true },
    ],
  },
  {
    name: "Trade",
    items: [
      { id: "execution", label: "Execution", hint: "Ticket, positions, pending, history", icon: Wallet, pro: true },
    ],
  },
  {
    name: "System",
    items: [
      { id: "alerts", label: "Alerts", hint: "Price alerts", icon: Bell },
      { id: "setup", label: "Setup", hint: "Symbol override & preferences", icon: SlidersHorizontal },
    ],
  },
];

interface NavRailProps {
  active: NavTabId;
  onSelect: (tab: NavTabId) => void;
  isPro: boolean;
}

export function NavRail({ active, onSelect, isPro }: NavRailProps) {
  return (
    <nav
      aria-label="Side panel sections"
      className="no-scrollbar flex w-11 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-card py-1.5"
    >
      {GROUPS.map((group, index) => (
        <div key={group.name} className="flex flex-col gap-0.5">
          {index > 0 && <Separator className="my-1" />}
          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            const locked = Boolean(item.pro) && !isPro;
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    aria-label={item.label}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "relative mx-1 flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
                      isActive
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {locked && (
                      <span
                        className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand"
                        title="Pro feature"
                      />
                    )}
                    {isActive && (
                      <span className="absolute -left-1 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex items-center gap-1.5">
                  <span>{item.label}</span>
                  <span className="text-muted-foreground">— {item.hint}</span>
                  {item.pro && (
                    <span className="inline-flex items-center gap-0.5 text-brand">
                      <Sparkles className="h-2.5 w-2.5" />
                      Pro
                    </span>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
