/**
 * Phase 11 — mobile navigation model.
 *
 * A small number of strong destinations, not a mirror of every desktop route. The
 * existing shell had five tabs and a placeholder "More" drawer, which produced
 * neither a clear mental model nor complete coverage.
 *
 *   Home        — the command centre: what matters right now
 *   Markets     — watchlist and symbol discovery
 *   Terminal    — chart + drawing + the canonical chart engine
 *   Intelligence— Setups, Alerts, Research, Strategies, Journal
 *   Account     — subscription, devices, risk, settings
 *
 * Pure module: the model is data, so it can be asserted in tests and reused by
 * both the shell and the deep-link router.
 */

import type { LucideIcon } from "lucide-react";
import {
    Bell,
    ChartNoAxesCombined,
    House,
    NotebookPen,
    Radar,
    Search,
    ShieldAlert,
    User,
} from "lucide-react";

export type MobileTabId = "home" | "markets" | "terminal" | "intelligence" | "account";

export interface MobileTab {
    id: MobileTabId;
    href: string;
    label: string;
    icon: LucideIcon;
    /** Shown when signed out. */
    requiresAuth: boolean;
}

export const MOBILE_TABS: readonly MobileTab[] = [
    { id: "home", href: "/mobile", label: "Home", icon: House, requiresAuth: true },
    { id: "markets", href: "/mobile/markets", label: "Markets", icon: Search, requiresAuth: false },
    { id: "terminal", href: "/mobile/terminal", label: "Terminal", icon: ChartNoAxesCombined, requiresAuth: true },
    { id: "intelligence", href: "/mobile/intelligence", label: "Intelligence", icon: Radar, requiresAuth: true },
    { id: "account", href: "/mobile/account", label: "Account", icon: User, requiresAuth: false },
];

export interface IntelligenceDestination {
    id: string;
    href: string;
    label: string;
    icon: LucideIcon;
    /** Feature gate key resolved against the single subscription truth. */
    pro: boolean;
    /** One line on what this surface is for. Shown on the hub so the hub earns its keep. */
    purpose: string;
}

/**
 * Intelligence sub-destinations. Each one is a real workflow, not a duplicate
 * dashboard — they are thin surfaces over the canonical engines.
 */
export const INTELLIGENCE_DESTINATIONS: readonly IntelligenceDestination[] = [
    {
        id: "setups",
        href: "/mobile/setups",
        label: "Setups",
        icon: Radar,
        pro: true,
        purpose: "Detected, confirmed and invalidated setups with their evidence.",
    },
    {
        id: "alerts",
        href: "/mobile/alerts",
        label: "Alerts",
        icon: Bell,
        pro: false,
        purpose: "Price, Smart Money, strategy, risk and research alerts in one feed.",
    },
    {
        id: "research",
        href: "/mobile/research",
        label: "Research",
        icon: Search,
        pro: true,
        purpose: "Monitor autonomous research runs. Computation stays server-side.",
    },
    {
        id: "strategies",
        href: "/mobile/strategies",
        label: "Strategies",
        icon: ChartNoAxesCombined,
        pro: true,
        purpose: "Health, degradation and live-vs-paper divergence.",
    },
    {
        id: "journal",
        href: "/mobile/journal",
        label: "Journal",
        icon: NotebookPen,
        pro: false,
        purpose: "Record theses and review AI analysis of what actually happened.",
    },
    {
        id: "risk",
        href: "/mobile/risk",
        label: "Risk",
        icon: ShieldAlert,
        pro: false,
        purpose: "Exposure, drawdown, limits and kill-switch state.",
    },
];

export function tabForPath(pathname: string): MobileTab {
    if (pathname.startsWith("/mobile/markets")) return MOBILE_TABS[1];
    if (pathname.startsWith("/mobile/terminal") || pathname.startsWith("/mobile/chart")) return MOBILE_TABS[2];
    if (pathname.startsWith("/mobile/intelligence") || isIntelligenceSubPath(pathname)) return MOBILE_TABS[3];
    if (pathname.startsWith("/mobile/account")) return MOBILE_TABS[4];
    return MOBILE_TABS[0];
}

/** Intelligence sub-screens (setups, alerts, …) keep the Intelligence tab lit. */
export function isIntelligenceSubPath(pathname: string): boolean {
    return INTELLIGENCE_DESTINATIONS.some((d) => pathname.startsWith(d.href));
}

export function destinationForPath(pathname: string): IntelligenceDestination | null {
    return INTELLIGENCE_DESTINATIONS.find((d) => pathname.startsWith(d.href)) ?? null;
}
