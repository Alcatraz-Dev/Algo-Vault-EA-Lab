import { Activity, MessageSquareText, Radar, SlidersHorizontal, Sparkles } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type PopupTabId = "home" | "analysis" | "copilot" | "settings";

interface NavItem {
  id: PopupTabId;
  label: string;
  hint: string;
  icon: typeof Activity;
  pro?: boolean;
}

/**
 * Popup navigation rail — mirrors the side panel's `NavRail` (w-11, bg-card,
 * border-r, h-9 w-9 buttons, active bg-secondary + brand indicator bar, right
 * tooltips) so the popup and the docked workspace share one navigation face.
 *
 * The popup keeps its own 4-destination surface (it is a fixed 400×600 action
 * window, not a full workspace); the visual language is identical.
 */
const GROUPS: Array<{ name: string; items: NavItem[] }> = [
  {
    name: "Work",
    items: [
      { id: "home", label: "Home", hint: "Chart context & verdicts", icon: Activity },
      { id: "copilot", label: "Copilot", hint: "Chat with the chart copilot", icon: MessageSquareText },
    ],
  },
  {
    name: "Intelligence",
    items: [
      { id: "analysis", label: "Intel", hint: "AI analysis of the chart", icon: Radar, pro: true },
    ],
  },
  {
    name: "System",
    items: [
      { id: "settings", label: "Setup", hint: "Symbol override & preferences", icon: SlidersHorizontal },
    ],
  },
];

interface NavRailProps {
  active: PopupTabId;
  onSelect: (tab: PopupTabId) => void;
  isPro: boolean;
}

export function NavRail({ active, onSelect, isPro }: NavRailProps) {
  return (
    <nav
      aria-label="Popup sections"
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