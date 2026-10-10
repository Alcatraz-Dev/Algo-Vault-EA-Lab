"use client";

import { Activity, Bot, LayoutDashboard, Layers, Shield, Terminal, Wallet } from "lucide-react";
import { AppShell, type NavGroup } from "@/components/layout/AppShell";

const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/ui-preview-shell", label: "Dashboard", icon: LayoutDashboard },
      { href: "/ui-preview-shell/portfolio", label: "Portfolio", icon: Wallet },
      { href: "/ui-preview-shell/goals", label: "Goals", icon: Layers },
    ],
  },
  {
    label: "Markets",
    items: [
      { href: "/ui-preview-shell/scanner", label: "Market Scanner", icon: Activity },
      { href: "/ui-preview-shell/risk", label: "Risk Analysis", icon: Shield, pro: true },
      { href: "/ui-preview-shell/cross-asset", label: "Market Relationships", icon: Shield, pro: true },
    ],
  },
  {
    label: "Trading",
    items: [
      { href: "/ui-preview-shell/terminal", label: "Terminal", icon: Terminal, pro: true },
      { href: "/ui-preview-shell/trading", label: "Live Trading", icon: Terminal, pro: true },
      { href: "/ui-preview-shell/journal", label: "Trade Journal", icon: Bot },
    ],
  },
];

export default function ShellPreviewPage() {
  return (
    <AppShell
      navGroups={NAV}
      title="Shell Preview"
      subtitle="Temporary route used to verify the global shell. Safe to delete."
      eyebrow="QA"
    >
      <div className="rounded-card border border-border bg-card p-6">
        <p className="text-body-sm text-muted-foreground">
          Preview content. Verifies collapsed groups, active rail, Pro chips, and the mobile drawer.
        </p>
      </div>
    </AppShell>
  );
}
