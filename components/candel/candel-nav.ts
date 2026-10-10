import type { NavGroup, NavItem } from "@/components/layout/AppShell";
import {
  Activity,
  Bot,
  Brain,
  CalendarClock,
  FileText,
  GitBranch,
  Hammer,
  ListChecks,
  ShieldCheck,
  Wrench,
} from "lucide-react";

/**
 * CANDEL_NAV_ITEMS — the complete Candel navigation surface.
 *
 * This is the single source of truth for the Candel area: `AccountShell` uses
 * it to replace the account sidebar while inside `/account/candels/*`, and the
 * account sidebar's "AI Workspace" group embeds the same list so the two navs
 * can never drift apart (they previously disagreed — a dead `Workspace` link on
 * one side, `Builder`/`Approvals` only on the other).
 */
export const CANDEL_NAV_ITEMS: NavItem[] = [
  { href: "/account/candels", label: "My Candels", icon: Bot },
  { href: "/account/candels/builder", label: "Builder", icon: Hammer },
  { href: "/account/candels/workspace", label: "Workspace", icon: FileText },
  { href: "/account/candels/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/account/candels/proposals", label: "Proposals", icon: ListChecks },
  { href: "/account/candels/activity", label: "Activity", icon: Activity },
  { href: "/account/candels/tool-calls", label: "Tool calls", icon: Wrench },
  { href: "/account/candels/jobs", label: "Background jobs", icon: CalendarClock },
  { href: "/account/candels/automations", label: "Automations", icon: GitBranch },
  { href: "/account/candels/memory", label: "Memory", icon: Brain },
];

/** The Candel sidebar group shown inside the Candel area. */
export const CANDEL_NAV: NavGroup[] = [
  {
    label: "Candels",
    items: CANDEL_NAV_ITEMS,
  },
];
