import React from "react";
import { Activity, MessageSquareText, Radar, Settings } from "lucide-react";

export type TabId = "home" | "analysis" | "copilot" | "settings";

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "home", label: "Home", icon: <Activity size={16} /> },
  { id: "analysis", label: "Intel", icon: <Radar size={16} /> },
  { id: "copilot", label: "Copilot", icon: <MessageSquareText size={16} /> },
  { id: "settings", label: "Settings", icon: <Settings size={16} /> },
];

interface TabBarProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav className="flex border-t border-edge/70 bg-card">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-1.5 transition-colors ${
              isActive ? "text-ink" : "text-ink-faint hover:text-ink-mute"
            }`}
          >
            <span className={`grid size-5 place-items-center rounded-md transition-colors ${isActive ? "bg-brand-500/15 text-brand-400" : "text-ink-faint"}`}>{tab.icon}</span>
            <span className={`text-[9px] ${isActive ? "font-semibold" : "font-medium"}`}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
