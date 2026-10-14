import React from "react";
import { LayoutDashboard, TrendingUp, Brain, ScanSearch, BarChart3, Users, Lightbulb, Settings } from "lucide-react";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, route: "/dashboard", shortcut: "⌘1" },
  { label: "Trading", icon: TrendingUp, route: "/trading", shortcut: "⌘2" },
  { label: "Signals", icon: Brain, route: "/signals", shortcut: "⌘3" },
  { label: "Scanner", icon: ScanSearch, route: "/scanner", shortcut: "⌘4" },
  { label: "Strategy", icon: BarChart3, route: "/strategy", shortcut: "⌘5" },
  { label: "Portfolio", icon: TrendingUp, route: "/portfolio", shortcut: "⌘6" },
  { label: "AI Copilot", icon: Lightbulb, route: "/ai-copilot", shortcut: "⌘7" },
];

export default function DesktopNav() {
  return (
    <nav
      className="flex w-16 flex-col items-center gap-1 bg-[#0b0c0e]/80 backdrop-blur-md border-r border-[#27272a] py-3 select-none"
      aria-label="Desktop navigation rail"
    >
      {/* Brand Mark */}
      <a
        href="#"
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-r from-[#f97316] to-[#ea580c] text-sm font-extrabold text-white shadow-lg shadow-[#f97316]/20 ring-1 ring-[#f97316]/30 transition-transform hover:scale-[1.05] hover:shadow-[#f97316]/30 active:scale-[0.98]"
        aria-label="AlgoVault home"
        title="AlgoVault"
      >
        AV
      </a>

      <div className="h-px w-6 bg-[#27272a] mb-2" />

      {navItems.map((item) => (
        <a
          key={item.label}
          href={item.route}
          className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-[#9ca3af] transition-all duration-200 hover:bg-[#27272a]/60 hover:text-[#f97316] hover:scale-[1.05] focus:outline-none focus:ring-2 focus:ring-[#f97316]/40 active:scale-[0.95]"
          aria-label={item.label}
          title={`${item.label} (${item.shortcut})`}
        >
          <item.icon size={18} strokeWidth={1.75} />
          <span className="pointer-events-none absolute -right-8 top-1/2 -translate-y-1/2 rounded-md bg-[#121316] px-2.5 py-1 text-[0.7rem] font-medium text-white opacity-0 shadow-xl shadow-black/50 transition-opacity duration-150 group-hover:opacity-100 ring-1 ring-[#27272a] whitespace-nowrap z-50">
            {item.label}
          </span>
        </a>
      ))}

      <div className="mt-auto flex flex-col gap-1">
        <div className="h-px w-6 bg-[#27272a] mb-1" />
        <a
          href="#"
          className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-[#9ca3af] transition-all duration-200 hover:bg-[#27272a]/60 hover:text-white hover:scale-[1.05]"
          aria-label="Account settings"
          title="Account settings"
        >
          <Settings size={18} strokeWidth={1.75} />
        </a>
      </div>
    </nav>
  );
}
