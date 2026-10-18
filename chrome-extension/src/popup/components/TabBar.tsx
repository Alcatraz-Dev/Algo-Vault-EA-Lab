import { Activity, MessageSquareText, Radar, Settings } from "lucide-react";

import { cn } from "@/lib/utils";

export type TabId = "home" | "analysis" | "copilot" | "settings";

const TABS: Array<{ id: TabId; label: string; icon: typeof Activity }> = [
  { id: "home", label: "Home", icon: Activity },
  { id: "analysis", label: "Intel", icon: Radar },
  { id: "copilot", label: "Copilot", icon: MessageSquareText },
  { id: "settings", label: "Settings", icon: Settings },
];

interface TabBarProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav
      aria-label="Primary"
      className="grid h-12 shrink-0 grid-cols-4 border-t border-border bg-background"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
